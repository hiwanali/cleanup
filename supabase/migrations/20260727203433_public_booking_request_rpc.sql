-- CleanUp - Atomic public iframe booking request
--
-- Called by the public-booking-request Edge Function with the service role.
-- Keeps slot reservation, lead property, planned shift, booking request,
-- shift event, and admin notification in one database transaction.

CREATE OR REPLACE FUNCTION public.create_public_booking_request(
  p_org_id uuid,
  p_lead_customer_id uuid,
  p_availability_slot_id uuid,
  p_service_type text,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_address text,
  p_postal_code text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_area_sqm integer DEFAULT NULL,
  p_rooms integer DEFAULT NULL,
  p_addons jsonb DEFAULT '{}'::jsonb,
  p_estimated_price_sek integer DEFAULT NULL,
  p_message text DEFAULT '',
  p_source_domain text DEFAULT 'cleanup.nu',
  p_ip_hash text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot public.booking_availability_slots%ROWTYPE;
  v_lead_customer public.customers%ROWTYPE;
  v_reserved_count integer := 0;
  v_property_id uuid;
  v_shift_id uuid;
  v_request_id uuid;
  v_customer_name text := trim(coalesce(p_customer_name, ''));
  v_customer_email text := lower(trim(coalesce(p_customer_email, '')));
  v_customer_phone text := trim(coalesce(p_customer_phone, ''));
  v_address text := trim(coalesce(p_address, ''));
  v_service_type text := trim(coalesce(p_service_type, ''));
  v_message text := trim(coalesce(p_message, ''));
  v_property_name text;
BEGIN
  IF p_org_id IS NULL OR p_lead_customer_id IS NULL OR p_availability_slot_id IS NULL THEN
    RAISE EXCEPTION 'missing required identifiers' USING ERRCODE = '22023';
  END IF;

  IF length(v_customer_name) < 2 THEN
    RAISE EXCEPTION 'invalid customer name' USING ERRCODE = '22023';
  END IF;

  IF v_customer_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'invalid customer email' USING ERRCODE = '22023';
  END IF;

  IF length(v_customer_phone) < 6 THEN
    RAISE EXCEPTION 'invalid customer phone' USING ERRCODE = '22023';
  END IF;

  IF length(v_address) < 3 THEN
    RAISE EXCEPTION 'invalid address' USING ERRCODE = '22023';
  END IF;

  IF p_area_sqm IS NOT NULL AND p_area_sqm <= 0 THEN
    RAISE EXCEPTION 'invalid area' USING ERRCODE = '22023';
  END IF;

  IF p_rooms IS NOT NULL AND p_rooms <= 0 THEN
    RAISE EXCEPTION 'invalid rooms' USING ERRCODE = '22023';
  END IF;

  IF p_estimated_price_sek IS NOT NULL AND p_estimated_price_sek < 0 THEN
    RAISE EXCEPTION 'invalid estimated price' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_lead_customer
  FROM public.customers
  WHERE id = p_lead_customer_id
    AND org_id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead customer not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT *
  INTO v_slot
  FROM public.booking_availability_slots
  WHERE id = p_availability_slot_id
    AND org_id = p_org_id
    AND active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'availability slot not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_slot.starts_at <= now() THEN
    RAISE EXCEPTION 'availability slot is in the past' USING ERRCODE = '22023';
  END IF;

  IF v_service_type = '' THEN
    v_service_type := v_slot.service_type;
  END IF;

  IF v_service_type <> v_slot.service_type THEN
    RAISE EXCEPTION 'service type does not match slot' USING ERRCODE = '22023';
  END IF;

  SELECT count(*)
  INTO v_reserved_count
  FROM public.booking_requests br
  WHERE br.availability_slot_id = p_availability_slot_id
    AND br.status IN ('new', 'linked_to_shift', 'approved');

  IF v_reserved_count >= v_slot.capacity THEN
    RAISE EXCEPTION 'availability slot is full' USING ERRCODE = '23505';
  END IF;

  v_property_name := left(v_customer_name || ' - ' || v_address, 120);

  INSERT INTO public.properties (
    customer_id,
    name,
    address,
    area_sqm,
    notes
  )
  VALUES (
    p_lead_customer_id,
    v_property_name,
    v_address,
    p_area_sqm,
    concat_ws(
      E'\n',
      'Public booking request',
      'Name: ' || v_customer_name,
      'Email: ' || v_customer_email,
      'Phone: ' || v_customer_phone,
      CASE WHEN nullif(trim(coalesce(p_postal_code, '')), '') IS NOT NULL THEN 'Postal code: ' || trim(p_postal_code) END,
      CASE WHEN nullif(trim(coalesce(p_city, '')), '') IS NOT NULL THEN 'City: ' || trim(p_city) END,
      CASE WHEN v_message <> '' THEN 'Message: ' || v_message END
    )
  )
  RETURNING id INTO v_property_id;

  INSERT INTO public.shifts (
    property_id,
    cleaner_user_id,
    start_at,
    end_at,
    status,
    source,
    recurring_id,
    original_start_at,
    original_end_at,
    last_modified_by,
    notes
  )
  VALUES (
    v_property_id,
    NULL,
    v_slot.starts_at,
    v_slot.ends_at,
    'Planerat',
    'customer_request',
    NULL,
    NULL,
    NULL,
    NULL,
    concat_ws(
      E'\n',
      'Public booking request',
      'Service: ' || v_service_type,
      'Name: ' || v_customer_name,
      'Email: ' || v_customer_email,
      'Phone: ' || v_customer_phone,
      CASE WHEN v_message <> '' THEN 'Message: ' || v_message END
    )
  )
  RETURNING id INTO v_shift_id;

  INSERT INTO public.booking_requests (
    org_id,
    availability_slot_id,
    shift_id,
    status,
    service_type,
    requested_starts_at,
    requested_ends_at,
    customer_name,
    customer_email,
    customer_phone,
    address,
    postal_code,
    city,
    area_sqm,
    rooms,
    addons,
    estimated_price_sek,
    message,
    source_domain,
    ip_hash,
    user_agent
  )
  VALUES (
    p_org_id,
    p_availability_slot_id,
    v_shift_id,
    'linked_to_shift',
    v_service_type,
    v_slot.starts_at,
    v_slot.ends_at,
    v_customer_name,
    v_customer_email,
    v_customer_phone,
    v_address,
    nullif(trim(coalesce(p_postal_code, '')), ''),
    nullif(trim(coalesce(p_city, '')), ''),
    p_area_sqm,
    p_rooms,
    coalesce(p_addons, '{}'::jsonb),
    p_estimated_price_sek,
    v_message,
    coalesce(nullif(trim(p_source_domain), ''), 'cleanup.nu'),
    p_ip_hash,
    left(coalesce(p_user_agent, ''), 500)
  )
  RETURNING id INTO v_request_id;

  INSERT INTO public.shift_events (
    shift_id,
    actor_user_id,
    event_type,
    payload
  )
  VALUES (
    v_shift_id,
    NULL,
    'customer_booking_requested',
    jsonb_build_object(
      'source', 'public_iframe',
      'booking_request_id', v_request_id,
      'availability_slot_id', p_availability_slot_id
    )
  );

  INSERT INTO public.notifications (
    recipient_user_id,
    channel,
    kind,
    payload
  )
  SELECT
    u.id,
    'in_app'::public.notification_channel,
    'customer_booking_request',
    jsonb_build_object(
      'shift_id', v_shift_id,
      'booking_request_id', v_request_id,
      'property_id', v_property_id,
      'start_at', v_slot.starts_at
    )
  FROM public.users u
  WHERE u.org_id = p_org_id
    AND u.role = 'admin'
    AND u.active = true;

  RETURN jsonb_build_object(
    'ok', true,
    'request_id', v_request_id,
    'shift_id', v_shift_id,
    'property_id', v_property_id,
    'status', 'linked_to_shift'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_public_booking_request(
  uuid, uuid, uuid, text, text, text, text, text, text, text, integer, integer, jsonb, integer, text, text, text, text
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.create_public_booking_request(
  uuid, uuid, uuid, text, text, text, text, text, text, text, integer, integer, jsonb, integer, text, text, text, text
) FROM anon;

REVOKE EXECUTE ON FUNCTION public.create_public_booking_request(
  uuid, uuid, uuid, text, text, text, text, text, text, text, integer, integer, jsonb, integer, text, text, text, text
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.create_public_booking_request(
  uuid, uuid, uuid, text, text, text, text, text, text, text, integer, integer, jsonb, integer, text, text, text, text
) TO service_role;
