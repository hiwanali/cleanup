-- CleanUp - customer portal phase 5
--
-- Customer cancellation is now enforced in Postgres instead of trusting the
-- browser. Customers can cancel their own eligible shifts until 24 hours before
-- the planned start time.

DROP POLICY IF EXISTS shifts_customer_cancel ON public.shifts;

CREATE OR REPLACE FUNCTION public.customer_cancel_shift(
  p_shift_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_shift public.shifts%ROWTYPE;
  v_property public.properties%ROWTYPE;
  v_customer public.customers%ROWTYPE;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_planned_start timestamptz;
  v_hours_to_start numeric;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_customer_role() THEN
    RAISE EXCEPTION 'only customers can cancel shifts' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_shift.property_id NOT IN (SELECT public.accessible_property_ids()) THEN
    RAISE EXCEPTION 'shift not accessible for customer' USING ERRCODE = '42501';
  END IF;

  IF v_shift.status NOT IN ('Planerat', 'Godkänt') THEN
    RAISE EXCEPTION 'shift cannot be cancelled by customer in current status' USING ERRCODE = '22023';
  END IF;

  v_planned_start := coalesce(v_shift.original_start_at, v_shift.start_at);
  v_hours_to_start := extract(epoch FROM (v_planned_start - now())) / 3600.0;

  IF v_planned_start <= now() + interval '24 hours' THEN
    RAISE EXCEPTION 'inside 24h cancellation window'
      USING ERRCODE = '22023', HINT = 'INSIDE_24H';
  END IF;

  SELECT *
  INTO v_property
  FROM public.properties
  WHERE id = v_shift.property_id;

  SELECT *
  INTO v_customer
  FROM public.customers
  WHERE id = v_property.customer_id;

  UPDATE public.shifts
  SET
    status = 'Avbokat',
    cancel_reason = v_reason,
    last_modified_by = v_user_id
  WHERE id = p_shift_id;

  UPDATE public.booking_requests
  SET status = 'cancelled'
  WHERE shift_id = p_shift_id
    AND status IN ('linked_to_shift', 'approved');

  INSERT INTO public.shift_events (
    shift_id,
    actor_user_id,
    event_type,
    payload
  )
  VALUES (
    p_shift_id,
    v_user_id,
    'customer_cancelled',
    jsonb_build_object(
      'hours_to_start', v_hours_to_start,
      'reason', v_reason,
      'policy', 'customer_24h'
    )
  );

  INSERT INTO public.notifications (recipient_user_id, channel, kind, payload)
  SELECT u.id, 'in_app', 'customer_cancelled', jsonb_build_object(
    'shift_id', p_shift_id,
    'property_id', v_shift.property_id,
    'start_at', v_shift.start_at
  )
  FROM public.users u
  WHERE u.org_id = v_customer.org_id
    AND u.role = 'admin'
    AND u.active
    AND u.id <> v_user_id;

  IF v_shift.cleaner_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (recipient_user_id, channel, kind, payload)
    VALUES (
      v_shift.cleaner_user_id,
      'in_app',
      'customer_cancelled',
      jsonb_build_object(
        'shift_id', p_shift_id,
        'property_id', v_shift.property_id,
        'start_at', v_shift.start_at
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'shift_id', p_shift_id,
    'status', 'Avbokat',
    'hours_to_start', v_hours_to_start,
    'policy', 'customer_24h'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.customer_cancel_shift(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_cancel_shift(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.customer_cancel_shift(uuid, text) IS
  'Customer-only shift cancellation with a server-enforced 24 hour cutoff.';
