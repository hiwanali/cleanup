-- CleanUp - make rolling availability horizon count exact.
--
-- The first selected occurrence is week 1, so a 12-week rolling horizon should
-- materialize 12 weekly slots, not 13.

CREATE OR REPLACE FUNCTION public.admin_create_booking_availability_series(
  p_org_id uuid,
  p_starts_on date,
  p_start_time time,
  p_end_time time,
  p_capacity integer,
  p_service_type text,
  p_note text DEFAULT '',
  p_created_by_user_id uuid DEFAULT NULL,
  p_horizon_weeks integer DEFAULT 12
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_series_id uuid;
  v_until date;
  v_inserted integer;
BEGIN
  IF v_actor_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  IF p_org_id IS NULL OR p_org_id <> public.current_org_id() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  IF p_starts_on IS NULL
    OR p_start_time IS NULL
    OR p_end_time IS NULL
    OR p_end_time <= p_start_time THEN
    RAISE EXCEPTION 'invalid time' USING ERRCODE = '22023';
  END IF;

  IF p_capacity IS NULL OR p_capacity < 1 OR p_capacity > 20 THEN
    RAISE EXCEPTION 'invalid capacity' USING ERRCODE = '22023';
  END IF;

  IF p_horizon_weeks IS NULL OR p_horizon_weeks < 4 OR p_horizon_weeks > 52 THEN
    RAISE EXCEPTION 'invalid horizon' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.booking_availability_series (
    org_id,
    service_type,
    weekday,
    starts_on,
    start_time,
    end_time,
    capacity,
    note,
    horizon_weeks,
    created_by_user_id
  )
  VALUES (
    p_org_id,
    nullif(trim(coalesce(p_service_type, '')), ''),
    public.iso_weekday(p_starts_on),
    p_starts_on,
    p_start_time,
    p_end_time,
    p_capacity,
    trim(coalesce(p_note, '')),
    p_horizon_weeks,
    coalesce(p_created_by_user_id, v_actor_id)
  )
  RETURNING id INTO v_series_id;

  v_until := (p_starts_on + make_interval(weeks => p_horizon_weeks - 1))::date;
  v_inserted := public.materialize_booking_availability_series(v_series_id, v_until);

  RETURN jsonb_build_object(
    'series_id', v_series_id,
    'materialized_until', v_until,
    'slots_created_or_updated', v_inserted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_booking_availability_series(uuid, date, time, time, integer, text, text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_booking_availability_series(uuid, date, time, time, integer, text, text, uuid, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.materialize_booking_availability_series(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_booking_availability_series(uuid, date) TO service_role;
