-- CleanUp - safer customer portal email matching.
--
-- Same normalized email should reuse the existing customer/customer_employee
-- portal identity. Existing customer profile data is not overwritten; the
-- booking request receives a small portal_match audit payload for admin review.

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
  v_user_existing_name text;
  v_user_existing_phone text;
  v_user_existing_email text;
  v_customer_id uuid;
  v_customer_name text;
  v_redirect_path text;
  v_match_source text := 'new_customer';
  v_reused_existing_user boolean := false;
  v_reused_existing_customer boolean := false;
  v_name_differs boolean := false;
  v_phone_differs boolean := false;
  v_portal_match jsonb;
  v_conflict_user record;
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

  SELECT id, role, name, phone, email
  INTO v_user_id, v_user_role, v_user_existing_name, v_user_existing_phone, v_user_existing_email
  FROM public.users
  WHERE org_id = v_org_id
    AND lower(trim(email)) = v_email
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

  IF v_user_id IS NOT NULL THEN
    v_reused_existing_user := true;
    v_match_source := CASE
      WHEN v_user_role = 'customer_employee' THEN 'existing_customer_employee_email'
      ELSE 'existing_customer_email'
    END;
    v_name_differs := lower(trim(coalesce(v_user_existing_name, ''))) <> lower(trim(v_name));
    v_phone_differs := v_phone IS NOT NULL
      AND nullif(trim(coalesce(v_user_existing_phone, '')), '') IS NOT NULL
      AND trim(v_user_existing_phone) <> v_phone;

    UPDATE public.users
    SET
      name = CASE
        WHEN nullif(trim(coalesce(name, '')), '') IS NULL THEN v_name
        ELSE name
      END,
      phone = CASE
        WHEN nullif(trim(coalesce(phone, '')), '') IS NULL THEN v_phone
        ELSE phone
      END,
      email = lower(trim(email)),
      active = true,
      updated_at = now()
    WHERE id = v_user_id;
  ELSE
    SELECT id
    INTO v_user_id
    FROM auth.users
    WHERE lower(trim(email)) = v_email
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
      v_match_source := 'new_auth_customer';
    ELSE
      SELECT *
      INTO v_conflict_user
      FROM public.users
      WHERE id = v_user_id
      LIMIT 1;

      IF FOUND AND (
        v_conflict_user.org_id <> v_org_id
        OR v_conflict_user.role NOT IN ('customer', 'customer_employee')
      ) THEN
        RAISE EXCEPTION 'auth user belongs to another profile' USING ERRCODE = '23505';
      END IF;

      INSERT INTO public.users (id, org_id, role, name, email, phone, active)
      VALUES (v_user_id, v_org_id, 'customer', v_name, v_email, v_phone, true)
      ON CONFLICT (id) DO UPDATE SET
        name = CASE
          WHEN nullif(trim(coalesce(public.users.name, '')), '') IS NULL THEN EXCLUDED.name
          ELSE public.users.name
        END,
        phone = CASE
          WHEN nullif(trim(coalesce(public.users.phone, '')), '') IS NULL THEN EXCLUDED.phone
          ELSE public.users.phone
        END,
        email = lower(trim(public.users.email)),
        active = true,
        updated_at = now();

      v_match_source := 'existing_auth_user_new_customer_profile';
    END IF;
  END IF;

  SELECT c.id, c.name
  INTO v_customer_id, v_customer_name
  FROM public.customers c
  WHERE c.org_id = v_org_id
    AND c.primary_contact_user_id = v_user_id
  ORDER BY c.created_at
  LIMIT 1;

  IF v_customer_id IS NULL THEN
    SELECT ce.customer_id, c.name
    INTO v_customer_id, v_customer_name
    FROM public.customer_employees ce
    JOIN public.customers c ON c.id = ce.customer_id
    WHERE ce.user_id = v_user_id
      AND c.org_id = v_org_id
    ORDER BY ce.created_at
    LIMIT 1;
  END IF;

  IF v_customer_id IS NOT NULL THEN
    v_reused_existing_customer := true;
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
    RETURNING id, name INTO v_customer_id, v_customer_name;
  END IF;

  UPDATE public.properties
  SET
    customer_id = v_customer_id,
    address = coalesce(nullif(v_request.address, ''), address),
    area_sqm = coalesce(v_request.area_sqm, area_sqm),
    updated_at = now()
  WHERE id = v_shift.property_id;

  v_portal_match := jsonb_build_object(
    'source', v_match_source,
    'normalized_email', v_email,
    'reused_existing_user', v_reused_existing_user,
    'reused_existing_customer', v_reused_existing_customer,
    'customer_name', v_customer_name,
    'request_name_differs', v_name_differs,
    'request_phone_differs', v_phone_differs,
    'matched_at', now()
  );

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
    portal_redirect_path = v_redirect_path,
    addons = jsonb_set(coalesce(addons, '{}'::jsonb), '{portal_match}', v_portal_match, true)
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
      'redirect_path', v_redirect_path,
      'portal_match', v_portal_match
    )
  );

  RETURN jsonb_build_object(
    'booking_request_id', v_request.id,
    'portal_user_id', v_user_id,
    'portal_customer_id', v_customer_id,
    'portal_access_status', 'created',
    'portal_redirect_path', v_redirect_path,
    'portal_match', v_portal_match
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_prepare_customer_portal_for_booking_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_prepare_customer_portal_for_booking_request(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_prepare_customer_portal_for_booking_request(uuid) IS
  'Admin-only customer portal provisioning. Reuses normalized customer email without overwriting existing profile data.';
