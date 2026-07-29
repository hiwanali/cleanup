-- CleanUp - service based checklists for public bookings
--
-- Public booking shifts are created on brand-new lead properties, so they often
-- do not have an object-specific cleaning_checklists template yet. This adds a
-- small service-based fallback that becomes a real shift_checklist_items
-- snapshot, visible to admin and the assigned cleaner.

CREATE OR REPLACE FUNCTION public.public_booking_service_checklist_items(
  p_service_type text,
  p_addons jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(position integer, title text)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_titles text[];
  v_title text;
  v_position integer := 0;
  v_service text := coalesce(nullif(trim(p_service_type), ''), 'standard_cleaning');
  v_addons jsonb := coalesce(p_addons, '{}'::jsonb);
  v_windows boolean := lower(coalesce(v_addons->>'windows', 'false')) IN ('true', '1', 'yes');
  v_oven boolean := lower(coalesce(v_addons->>'oven', 'false')) IN ('true', '1', 'yes');
BEGIN
  v_titles := CASE v_service
    WHEN 'deep_cleaning' THEN ARRAY[
      'Allmänt: dammsug och dammtorka golv, mattor och möbler',
      'Allmänt: våttorka golv',
      'Allmänt: rengör lampor, tavlor, persienner och skåp/garderober',
      'Allmänt: rengör dörrar, lister, eluttag och strömbrytare',
      'Allmänt: töm papperskorgar',
      'Badrum: rengör dusch/badkar, toalett, handfat, väggar och golv',
      'Badrum: rengör tvättmaskin/torkskåp vid behov',
      'Badrum: rensa golvbrunn och torka rör',
      'Kök: rengör köksbänk, spis, kakelvägg och fläkt',
      'Kök: torka köksluckor och utsidan av vitvaror'
    ]
    WHEN 'moving_cleaning' THEN ARRAY[
      'Allmänt: dammsug golv',
      'Allmänt: våttorka golv och lister',
      'Rummen: rengör dörrar, hyllor, skåp, garderober och element',
      'Rummen: rengör eluttag och strömbrytare',
      'Badrum: rengör dusch/badkar, tvättställ, toalett, handfat och väggar',
      'Badrum: torka duschväggar, putsa speglar och torka rör',
      'Badrum: rensa golvbrunn',
      'Kök: rengör köksbänk, vask, kakelvägg och skåp',
      'Kök: rengör spis in- och utvändigt',
      'Kök: rengör spisfläkt och filter',
      'Kök: rengör avfrostat kyl och frys in- och utvändigt',
      'Fönsterputs: putsa alla glas, fönsterkant och nedre fönsterkarm'
    ]
    WHEN 'window_cleaning' THEN ARRAY[
      'Fönster: tvätta och torka alla glas in- och utvändigt',
      'Fönster: rengör fönsterkant',
      'Fönster: rengör nedre fönsterkarm'
    ]
    ELSE ARRAY[
      'Rummen: dammsug golv, mattor och synliga ytor',
      'Rummen: dammtorka lister, element, möbler och fria ytor',
      'Badrum: rengör dusch/badkar, toalett, handfat och blandare',
      'Badrum: torka duschväggar och putsa speglar',
      'Kök: rengör köksbänk, spis, kakelvägg och fläktens utsida',
      'Kök: torka köksluckor och utsidan av vitvaror',
      'Avslut: kontrollera golv och synliga ytor innan utcheckning'
    ]
  END;

  FOREACH v_title IN ARRAY v_titles LOOP
    v_position := v_position + 1;
    position := v_position;
    title := v_title;
    RETURN NEXT;
  END LOOP;

  IF v_service <> 'moving_cleaning' AND v_windows THEN
    v_position := v_position + 1;
    position := v_position;
    title := 'Tillägg: fönsterputs enligt överenskommelse';
    RETURN NEXT;
  END IF;

  IF v_oven THEN
    v_position := v_position + 1;
    position := v_position;
    title := 'Tillägg: ugnsrengöring enligt överenskommelse';
    RETURN NEXT;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_public_booking_service_checklist(
  p_shift_id uuid,
  p_service_type text,
  p_addons jsonb DEFAULT '{}'::jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_shift_id IS NULL THEN
    RETURN 0;
  END IF;

  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin required' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.shift_checklist_items sci
    WHERE sci.shift_id = p_shift_id
  ) THEN
    RETURN 0;
  END IF;

  INSERT INTO public.shift_checklist_items (shift_id, title, position)
  SELECT p_shift_id, i.title, i.position
  FROM public.public_booking_service_checklist_items(p_service_type, p_addons) i;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.add_public_booking_service_checklist(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_public_booking_service_checklist(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_public_booking_service_checklist(uuid, text, jsonb) TO service_role;

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
      'Service: ' || v_service_type,
      CASE WHEN nullif(trim(coalesce(p_postal_code, '')), '') IS NOT NULL THEN 'Postal code: ' || trim(p_postal_code) END,
      CASE WHEN nullif(trim(coalesce(p_city, '')), '') IS NOT NULL THEN 'City: ' || trim(p_city) END
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

  PERFORM public.add_public_booking_service_checklist(v_shift_id, v_service_type, coalesce(p_addons, '{}'::jsonb));

  IF v_message <> '' THEN
    INSERT INTO public.shift_requests (
      org_id,
      property_id,
      shift_id,
      scope,
      body,
      created_by_user_id,
      created_by_role
    )
    VALUES (
      p_org_id,
      v_property_id,
      v_shift_id,
      'single',
      'Kundens kommentar från bokningen:' || E'\n' || v_message,
      v_lead_customer.primary_contact_user_id,
      'customer'
    );
  END IF;

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

-- Backfill existing public booking shifts that were created before this
-- migration and still have an empty checklist.
SELECT public.add_public_booking_service_checklist(br.shift_id, br.service_type, br.addons)
FROM public.booking_requests br
WHERE br.shift_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.shift_checklist_items sci
    WHERE sci.shift_id = br.shift_id
  );

INSERT INTO public.shift_requests (
  org_id,
  property_id,
  shift_id,
  scope,
  body,
  created_by_user_id,
  created_by_role
)
SELECT
  br.org_id,
  s.property_id,
  br.shift_id,
  'single',
  'Kundens kommentar från bokningen:' || E'\n' || br.message,
  c.primary_contact_user_id,
  'customer'
FROM public.booking_requests br
JOIN public.shifts s ON s.id = br.shift_id
JOIN public.properties p ON p.id = s.property_id
JOIN public.customers c ON c.id = p.customer_id
WHERE br.shift_id IS NOT NULL
  AND trim(coalesce(br.message, '')) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.shift_requests sr
    WHERE sr.shift_id = br.shift_id
      AND sr.body = 'Kundens kommentar från bokningen:' || E'\n' || br.message
  );
