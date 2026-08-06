-- CleanUp security phase 3
--
-- Move high-risk admin shift actions into transaction-safe command RPCs.
-- Each function:
-- - authenticates the caller as an active admin in the current org
-- - locks the shift row with FOR UPDATE
-- - writes the shift mutation and audit event in one database transaction
-- - returns canonical shift/request/portal data for the client to hydrate from

CREATE OR REPLACE FUNCTION public.admin_approve_booking_shift(
  p_shift_id uuid,
  p_cleaner_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_org_id uuid;
  v_shift public.shifts%ROWTYPE;
  v_request public.booking_requests%ROWTYPE;
  v_cleaner_id uuid;
  v_portal jsonb := NULL;
BEGIN
  IF v_actor_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'org not found' USING ERRCODE = '42501';
  END IF;

  SELECT s.*
  INTO v_shift
  FROM public.shifts s
  JOIN public.properties p ON p.id = s.property_id
  JOIN public.customers c ON c.id = p.customer_id
  WHERE s.id = p_shift_id
    AND c.org_id = v_org_id
  FOR UPDATE OF s;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_shift.status <> 'Planerat' THEN
    RAISE EXCEPTION 'shift is not pending approval' USING ERRCODE = '22023';
  END IF;

  v_cleaner_id := coalesce(p_cleaner_user_id, v_shift.cleaner_user_id);
  IF v_cleaner_id IS NULL THEN
    RAISE EXCEPTION 'cleaner is required' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.users u
  WHERE u.id = v_cleaner_id
    AND u.org_id = v_org_id
    AND u.role = 'cleaner'
    AND u.active;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cleaner not found in organization' USING ERRCODE = '42501';
  END IF;

  UPDATE public.shifts
  SET
    status = 'Godkänt',
    cleaner_user_id = v_cleaner_id,
    last_modified_by = v_actor_id
  WHERE id = p_shift_id
  RETURNING * INTO v_shift;

  UPDATE public.booking_requests
  SET status = 'approved'
  WHERE shift_id = p_shift_id
    AND org_id = v_org_id
  RETURNING * INTO v_request;

  IF v_request.id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.shift_checklist_items sci
      WHERE sci.shift_id = p_shift_id
    )
  THEN
    PERFORM public.add_public_booking_service_checklist(
      p_shift_id,
      v_request.service_type,
      v_request.addons
    );
  END IF;

  IF v_request.id IS NOT NULL THEN
    v_portal := public.admin_prepare_customer_portal_for_booking_request(p_shift_id);
  END IF;

  INSERT INTO public.shift_events (shift_id, actor_user_id, event_type, payload)
  VALUES (p_shift_id, v_actor_id, 'shift_approved', '{}'::jsonb);

  RETURN jsonb_build_object(
    'ok', true,
    'shift', to_jsonb(v_shift),
    'booking_request', CASE WHEN v_request.id IS NULL THEN NULL ELSE to_jsonb(v_request) END,
    'portal', v_portal
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_decline_booking_shift(
  p_shift_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_org_id uuid;
  v_shift public.shifts%ROWTYPE;
  v_request public.booking_requests%ROWTYPE;
  v_hours_to_start numeric;
BEGIN
  IF v_actor_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'org not found' USING ERRCODE = '42501';
  END IF;

  SELECT s.*
  INTO v_shift
  FROM public.shifts s
  JOIN public.properties p ON p.id = s.property_id
  JOIN public.customers c ON c.id = p.customer_id
  WHERE s.id = p_shift_id
    AND c.org_id = v_org_id
  FOR UPDATE OF s;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift not found' USING ERRCODE = 'P0002';
  END IF;

  v_hours_to_start := extract(epoch from (v_shift.start_at - clock_timestamp())) / 3600.0;

  UPDATE public.shifts
  SET
    status = 'Avbokat',
    last_modified_by = v_actor_id
  WHERE id = p_shift_id
  RETURNING * INTO v_shift;

  UPDATE public.booking_requests
  SET status = 'declined'
  WHERE shift_id = p_shift_id
    AND org_id = v_org_id
  RETURNING * INTO v_request;

  INSERT INTO public.shift_events (shift_id, actor_user_id, event_type, payload)
  VALUES (
    p_shift_id,
    v_actor_id,
    'shift_declined',
    jsonb_build_object('hours_to_start', v_hours_to_start)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'shift', to_jsonb(v_shift),
    'booking_request', CASE WHEN v_request.id IS NULL THEN NULL ELSE to_jsonb(v_request) END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_shift(
  p_shift_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_org_id uuid;
  v_shift public.shifts%ROWTYPE;
  v_hours_to_start numeric;
BEGIN
  IF v_actor_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'org not found' USING ERRCODE = '42501';
  END IF;

  SELECT s.*
  INTO v_shift
  FROM public.shifts s
  JOIN public.properties p ON p.id = s.property_id
  JOIN public.customers c ON c.id = p.customer_id
  WHERE s.id = p_shift_id
    AND c.org_id = v_org_id
  FOR UPDATE OF s;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_shift.status = 'Borttaget' THEN
    RETURN jsonb_build_object('ok', true, 'shift', to_jsonb(v_shift), 'result', 'already_deleted');
  END IF;

  v_hours_to_start := extract(epoch from (v_shift.start_at - clock_timestamp())) / 3600.0;

  UPDATE public.shifts
  SET
    status = 'Borttaget',
    last_modified_by = v_actor_id
  WHERE id = p_shift_id
  RETURNING * INTO v_shift;

  INSERT INTO public.shift_events (shift_id, actor_user_id, event_type, payload)
  VALUES (
    p_shift_id,
    v_actor_id,
    'admin_deleted',
    jsonb_build_object('hours_to_start', v_hours_to_start)
  );

  RETURN jsonb_build_object('ok', true, 'shift', to_jsonb(v_shift));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_swap_shift_cleaner(
  p_shift_id uuid,
  p_new_cleaner_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_org_id uuid;
  v_shift public.shifts%ROWTYPE;
  v_old_cleaner_user_id uuid;
BEGIN
  IF v_actor_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'org not found' USING ERRCODE = '42501';
  END IF;

  SELECT s.*
  INTO v_shift
  FROM public.shifts s
  JOIN public.properties p ON p.id = s.property_id
  JOIN public.customers c ON c.id = p.customer_id
  WHERE s.id = p_shift_id
    AND c.org_id = v_org_id
  FOR UPDATE OF s;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_new_cleaner_user_id IS NOT NULL THEN
    PERFORM 1
    FROM public.users u
    WHERE u.id = p_new_cleaner_user_id
      AND u.org_id = v_org_id
      AND u.role = 'cleaner'
      AND u.active;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'cleaner not found in organization' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_old_cleaner_user_id := v_shift.cleaner_user_id;

  UPDATE public.shifts
  SET
    cleaner_user_id = p_new_cleaner_user_id,
    status = CASE WHEN v_shift.status = 'Sjukanmäld' THEN 'Godkänt' ELSE v_shift.status END,
    last_modified_by = v_actor_id
  WHERE id = p_shift_id
  RETURNING * INTO v_shift;

  INSERT INTO public.shift_events (shift_id, actor_user_id, event_type, payload)
  VALUES (
    p_shift_id,
    v_actor_id,
    'cleaner_swapped',
    jsonb_build_object('from', v_old_cleaner_user_id, 'to', p_new_cleaner_user_id)
  );

  RETURN jsonb_build_object('ok', true, 'shift', to_jsonb(v_shift), 'old_cleaner_user_id', v_old_cleaner_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_adjust_shift_time(
  p_shift_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_org_id uuid;
  v_shift public.shifts%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  IF p_start_at IS NULL OR p_end_at IS NULL OR p_end_at <= p_start_at THEN
    RAISE EXCEPTION 'invalid time range' USING ERRCODE = '22023';
  END IF;

  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'org not found' USING ERRCODE = '42501';
  END IF;

  SELECT s.*
  INTO v_shift
  FROM public.shifts s
  JOIN public.properties p ON p.id = s.property_id
  JOIN public.customers c ON c.id = p.customer_id
  WHERE s.id = p_shift_id
    AND c.org_id = v_org_id
  FOR UPDATE OF s;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.shifts
  SET
    start_at = p_start_at,
    end_at = p_end_at,
    original_start_at = coalesce(original_start_at, v_shift.start_at),
    original_end_at = coalesce(original_end_at, v_shift.end_at),
    status = CASE
      WHEN v_shift.status = 'Sjukanmäld' THEN 'Godkänt'
      WHEN v_shift.status = 'Väntar granskning' THEN 'Utfört'
      ELSE v_shift.status
    END,
    last_modified_by = v_actor_id
  WHERE id = p_shift_id
  RETURNING * INTO v_shift;

  INSERT INTO public.shift_events (shift_id, actor_user_id, event_type, payload)
  VALUES (
    p_shift_id,
    v_actor_id,
    'time_adjusted',
    jsonb_build_object('start_at', p_start_at, 'end_at', p_end_at)
  );

  RETURN jsonb_build_object('ok', true, 'shift', to_jsonb(v_shift));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_adjust_shift_worked_time(
  p_shift_id uuid,
  p_checked_in_at timestamptz,
  p_checked_out_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_org_id uuid;
  v_shift public.shifts%ROWTYPE;
  v_new_end_at timestamptz;
BEGIN
  IF v_actor_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  IF p_checked_in_at IS NULL THEN
    RAISE EXCEPTION 'checked_in_at is required' USING ERRCODE = '22023';
  END IF;

  IF p_checked_out_at IS NOT NULL AND p_checked_out_at <= p_checked_in_at THEN
    RAISE EXCEPTION 'checked_out_at must be after checked_in_at' USING ERRCODE = '22023';
  END IF;

  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'org not found' USING ERRCODE = '42501';
  END IF;

  SELECT s.*
  INTO v_shift
  FROM public.shifts s
  JOIN public.properties p ON p.id = s.property_id
  JOIN public.customers c ON c.id = p.customer_id
  WHERE s.id = p_shift_id
    AND c.org_id = v_org_id
  FOR UPDATE OF s;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift not found' USING ERRCODE = 'P0002';
  END IF;

  v_new_end_at := coalesce(
    p_checked_out_at,
    CASE
      WHEN v_shift.end_at > p_checked_in_at THEN v_shift.end_at
      ELSE p_checked_in_at + interval '1 minute'
    END
  );

  UPDATE public.shifts
  SET
    status = CASE WHEN p_checked_out_at IS NULL THEN 'Pågående' ELSE 'Utfört' END,
    checked_in_at = p_checked_in_at,
    checked_out_at = p_checked_out_at,
    start_at = p_checked_in_at,
    end_at = v_new_end_at,
    original_start_at = coalesce(original_start_at, v_shift.start_at),
    original_end_at = coalesce(original_end_at, v_shift.end_at),
    last_modified_by = v_actor_id
  WHERE id = p_shift_id
  RETURNING * INTO v_shift;

  INSERT INTO public.shift_events (shift_id, actor_user_id, event_type, payload)
  VALUES (
    p_shift_id,
    v_actor_id,
    'time_adjusted',
    jsonb_build_object(
      'kind', 'worked_time',
      'checked_in_at', p_checked_in_at,
      'checked_out_at', p_checked_out_at,
      'start_at', p_checked_in_at,
      'end_at', v_new_end_at
    )
  );

  RETURN jsonb_build_object('ok', true, 'shift', to_jsonb(v_shift));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_approve_booking_shift(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_decline_booking_shift(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_shift(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_swap_shift_cleaner(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_adjust_shift_time(uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_adjust_shift_worked_time(uuid, timestamptz, timestamptz) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.admin_approve_booking_shift(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_decline_booking_shift(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_delete_shift(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_swap_shift_cleaner(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_adjust_shift_time(uuid, timestamptz, timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_adjust_shift_worked_time(uuid, timestamptz, timestamptz) FROM anon;

GRANT EXECUTE ON FUNCTION public.admin_approve_booking_shift(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_decline_booking_shift(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_shift(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_swap_shift_cleaner(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_adjust_shift_time(uuid, timestamptz, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_adjust_shift_worked_time(uuid, timestamptz, timestamptz) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_approve_booking_shift(uuid, uuid) IS
  'Admin-only transactional command: approve a pending public booking shift, assign cleaner, update request, provision portal, and audit.';
COMMENT ON FUNCTION public.admin_decline_booking_shift(uuid) IS
  'Admin-only transactional command: decline a public booking shift and audit.';
COMMENT ON FUNCTION public.admin_delete_shift(uuid) IS
  'Admin-only transactional command: soft-delete a shift and audit.';
COMMENT ON FUNCTION public.admin_swap_shift_cleaner(uuid, uuid) IS
  'Admin-only transactional command: assign or unassign cleaner and audit.';
COMMENT ON FUNCTION public.admin_adjust_shift_time(uuid, timestamptz, timestamptz) IS
  'Admin-only transactional command: adjust scheduled shift time and audit.';
COMMENT ON FUNCTION public.admin_adjust_shift_worked_time(uuid, timestamptz, timestamptz) IS
  'Admin-only transactional command: adjust actual attendance timestamps and audit.';

NOTIFY pgrst, 'reload schema';
