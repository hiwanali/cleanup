-- CleanUp - customer portal access phase 2
--
-- When an admin approves a public booking request, prepare the customer portal
-- link without sending email yet. The function is idempotent and admin-only:
-- it creates/reuses a customer auth profile, creates/reuses the customer row,
-- moves the request property to that customer, and stores the portal redirect.

CREATE OR REPLACE FUNCTION public.admin_prepare_customer_portal_for_booking_request(
  p_shift_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, private, extensions
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_org_id uuid;
  v_request public.booking_requests%ROWTYPE;
  v_shift public.shifts%ROWTYPE;
  v_property public.properties%ROWTYPE;
  v_email text;
  v_name text;
  v_phone text;
  v_user_id uuid;
  v_user_role public.user_role;
  v_customer_id uuid;
  v_redirect_path text;
BEGIN
  IF v_actor_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'org not found' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_request
  FROM public.booking_requests
  WHERE shift_id = p_shift_id
    AND org_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking request not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT *
  INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT *
  INTO v_property
  FROM public.properties
  WHERE id = v_shift.property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'property not found' USING ERRCODE = 'P0002';
  END IF;

  v_email := lower(trim(v_request.customer_email));
  v_name := trim(v_request.customer_name);
  v_phone := nullif(trim(v_request.customer_phone), '');
  v_redirect_path := '/kund/pass/' || p_shift_id::text;

  IF length(coalesce(v_name, '')) < 2 THEN
    RAISE EXCEPTION 'invalid customer name' USING ERRCODE = '22023';
  END IF;

  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'invalid customer email' USING ERRCODE = '22023';
  END IF;

  SELECT id, role
  INTO v_user_id, v_user_role
  FROM public.users
  WHERE org_id = v_org_id
    AND lower(email) = v_email
  ORDER BY
    CASE role
      WHEN 'customer' THEN 0
      WHEN 'customer_employee' THEN 1
      ELSE 2
    END,
    created_at
  LIMIT 1;

  IF v_user_id IS NOT NULL AND v_user_role NOT IN ('customer', 'customer_employee') THEN
    RAISE EXCEPTION 'email belongs to an internal user' USING ERRCODE = '23505';
  END IF;

  IF v_user_id IS NULL THEN
    SELECT id
    INTO v_user_id
    FROM auth.users
    WHERE lower(email) = v_email
    LIMIT 1;

    IF v_user_id IS NULL THEN
      v_user_id := gen_random_uuid();
      PERFORM private.seed_auth_user(
        v_user_id,
        v_email,
        'customer',
        v_org_id,
        v_name,
        v_phone
      );
    ELSE
      INSERT INTO public.users (id, org_id, role, name, email, phone, active)
      VALUES (v_user_id, v_org_id, 'customer', v_name, v_email, v_phone, true)
      ON CONFLICT (id) DO UPDATE SET
        role = CASE
          WHEN public.users.role IN ('customer', 'customer_employee') THEN public.users.role
          ELSE EXCLUDED.role
        END,
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        active = true,
        updated_at = now();
    END IF;
  ELSE
    UPDATE public.users
    SET
      name = v_name,
      phone = coalesce(v_phone, phone),
      active = true,
      updated_at = now()
    WHERE id = v_user_id;
  END IF;

  SELECT c.id
  INTO v_customer_id
  FROM public.customers c
  WHERE c.org_id = v_org_id
    AND c.primary_contact_user_id = v_user_id
  ORDER BY c.created_at
  LIMIT 1;

  IF v_customer_id IS NULL THEN
    SELECT ce.customer_id
    INTO v_customer_id
    FROM public.customer_employees ce
    JOIN public.customers c ON c.id = ce.customer_id
    WHERE ce.user_id = v_user_id
      AND c.org_id = v_org_id
    ORDER BY ce.created_at
    LIMIT 1;
  END IF;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (
      org_id,
      name,
      org_number,
      primary_contact_user_id,
      notes
    )
    VALUES (
      v_org_id,
      v_name,
      NULL,
      v_user_id,
      concat_ws(
        E'\n',
        'Skapad fran publik bokningsforfragan.',
        'Kalla: ' || coalesce(nullif(v_request.source_domain, ''), 'cleanup.nu')
      )
    )
    RETURNING id INTO v_customer_id;
  END IF;

  UPDATE public.properties
  SET
    customer_id = v_customer_id,
    address = coalesce(nullif(v_request.address, ''), address),
    area_sqm = coalesce(v_request.area_sqm, area_sqm),
    updated_at = now()
  WHERE id = v_shift.property_id;

  UPDATE public.booking_requests
  SET
    status = 'approved',
    portal_user_id = v_user_id,
    portal_customer_id = v_customer_id,
    portal_access_status = CASE
      WHEN portal_access_status = 'active' THEN 'active'
      ELSE 'created'
    END,
    portal_access_created_at = coalesce(portal_access_created_at, now()),
    portal_redirect_path = v_redirect_path
  WHERE id = v_request.id;

  INSERT INTO public.shift_events (
    shift_id,
    actor_user_id,
    event_type,
    payload
  )
  VALUES (
    p_shift_id,
    v_actor_id,
    'customer_portal_prepared',
    jsonb_build_object(
      'booking_request_id', v_request.id,
      'portal_user_id', v_user_id,
      'portal_customer_id', v_customer_id,
      'redirect_path', v_redirect_path
    )
  );

  RETURN jsonb_build_object(
    'booking_request_id', v_request.id,
    'portal_user_id', v_user_id,
    'portal_customer_id', v_customer_id,
    'portal_access_status', 'created',
    'portal_redirect_path', v_redirect_path
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_prepare_customer_portal_for_booking_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_prepare_customer_portal_for_booking_request(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_prepare_customer_portal_for_booking_request(uuid) IS
  'Admin-only phase 2 customer portal provisioning for approved public booking requests.';
