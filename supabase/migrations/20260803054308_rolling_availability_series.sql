-- CleanUp - rolling public booking availability.
--
-- "Tillsvidare" availability is stored as a compact weekly series and only a
-- bounded horizon of concrete booking_availability_slots is materialized.

CREATE TABLE IF NOT EXISTS public.booking_availability_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  service_type text NOT NULL,
  weekday smallint NOT NULL CHECK (weekday >= 0 AND weekday <= 6),
  starts_on date NOT NULL,
  ends_on date,
  start_time time NOT NULL,
  end_time time NOT NULL,
  capacity integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  note text NOT NULL DEFAULT '',
  horizon_weeks integer NOT NULL DEFAULT 12 CHECK (horizon_weeks >= 4 AND horizon_weeks <= 52),
  materialized_until date,
  created_by_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time),
  CHECK (capacity > 0),
  CHECK (length(trim(service_type)) > 0),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE TRIGGER booking_availability_series_set_updated_at
  BEFORE UPDATE ON public.booking_availability_series
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS booking_availability_series_org_active_idx
  ON public.booking_availability_series (org_id, active, weekday, starts_on);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'booking_availability_slots'
      AND column_name = 'series_id'
  ) THEN
    ALTER TABLE public.booking_availability_slots
      ADD COLUMN series_id uuid REFERENCES public.booking_availability_series (id) ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS booking_availability_slots_series_start_idx
  ON public.booking_availability_slots (series_id, starts_at)
  WHERE series_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS booking_availability_slots_series_start_unique_idx
  ON public.booking_availability_slots (series_id, starts_at)
  WHERE series_id IS NOT NULL;

ALTER TABLE public.booking_availability_series ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.booking_availability_series FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_availability_series TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_availability_series TO service_role;

DROP POLICY IF EXISTS booking_availability_series_admin_select
  ON public.booking_availability_series;

CREATE POLICY booking_availability_series_admin_select
  ON public.booking_availability_series
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    AND org_id = public.current_org_id()
  );

DROP POLICY IF EXISTS booking_availability_series_admin_insert
  ON public.booking_availability_series;

CREATE POLICY booking_availability_series_admin_insert
  ON public.booking_availability_series
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    AND org_id = public.current_org_id()
  );

DROP POLICY IF EXISTS booking_availability_series_admin_update
  ON public.booking_availability_series;

CREATE POLICY booking_availability_series_admin_update
  ON public.booking_availability_series
  FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    AND org_id = public.current_org_id()
  )
  WITH CHECK (
    public.is_admin()
    AND org_id = public.current_org_id()
  );

DROP POLICY IF EXISTS booking_availability_series_admin_delete
  ON public.booking_availability_series;

CREATE POLICY booking_availability_series_admin_delete
  ON public.booking_availability_series
  FOR DELETE TO authenticated
  USING (
    public.is_admin()
    AND org_id = public.current_org_id()
  );

CREATE OR REPLACE FUNCTION public.can_manage_booking_availability_org(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    current_setting('request.jwt.claim.role', true) = 'service_role'
    OR current_user = 'service_role'
    OR (
      public.is_admin()
      AND p_org_id = public.current_org_id()
    );
$$;

CREATE OR REPLACE FUNCTION public.materialize_booking_availability_series(
  p_series_id uuid,
  p_until date DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_series public.booking_availability_series%ROWTYPE;
  v_until date;
  v_inserted integer := 0;
BEGIN
  SELECT *
  INTO v_series
  FROM public.booking_availability_series
  WHERE id = p_series_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'availability series not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.can_manage_booking_availability_org(v_series.org_id) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  IF NOT v_series.active THEN
    RETURN 0;
  END IF;

  v_until := coalesce(
    p_until,
    (current_date + make_interval(weeks => v_series.horizon_weeks))::date
  );

  v_until := least(v_until, (current_date + interval '52 weeks')::date);

  IF v_series.ends_on IS NOT NULL THEN
    v_until := least(v_until, v_series.ends_on);
  END IF;

  IF v_until < v_series.starts_on THEN
    RETURN 0;
  END IF;

  INSERT INTO public.booking_availability_slots (
    org_id,
    starts_at,
    ends_at,
    capacity,
    service_type,
    active,
    note,
    created_by_user_id,
    series_id
  )
  SELECT
    v_series.org_id,
    (d::date + v_series.start_time) AT TIME ZONE 'Europe/Stockholm',
    (d::date + v_series.end_time) AT TIME ZONE 'Europe/Stockholm',
    v_series.capacity,
    v_series.service_type,
    true,
    v_series.note,
    v_series.created_by_user_id,
    v_series.id
  FROM generate_series(v_series.starts_on, v_until, interval '1 day') AS d
  WHERE public.iso_weekday(d::date) = v_series.weekday
    AND ((d::date + v_series.start_time) AT TIME ZONE 'Europe/Stockholm') > now()
  ON CONFLICT (series_id, starts_at) WHERE series_id IS NOT NULL
  DO UPDATE SET
    ends_at = EXCLUDED.ends_at,
    capacity = EXCLUDED.capacity,
    service_type = EXCLUDED.service_type,
    note = EXCLUDED.note,
    active = CASE
      WHEN public.booking_availability_slots.active = false THEN false
      ELSE EXCLUDED.active
    END,
    updated_at = now();

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  UPDATE public.booking_availability_series
  SET materialized_until = greatest(coalesce(materialized_until, v_series.starts_on), v_until)
  WHERE id = v_series.id;

  RETURN v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_booking_availability_series_horizon(
  p_org_id uuid,
  p_until date DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_until date := coalesce(p_until, (current_date + interval '12 weeks')::date);
  v_total integer := 0;
BEGIN
  IF NOT public.can_manage_booking_availability_org(p_org_id) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  v_until := least(v_until, (current_date + interval '52 weeks')::date);

  FOR r IN
    SELECT id
    FROM public.booking_availability_series
    WHERE org_id = p_org_id
      AND active = true
      AND starts_on <= v_until
      AND (ends_on IS NULL OR ends_on >= current_date)
  LOOP
    v_total := v_total + public.materialize_booking_availability_series(r.id, v_until);
  END LOOP;

  RETURN v_total;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.admin_set_booking_availability_series_active(
  p_series_id uuid,
  p_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_series public.booking_availability_series%ROWTYPE;
  v_touched integer := 0;
BEGIN
  IF v_actor_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_series
  FROM public.booking_availability_series
  WHERE id = p_series_id
    AND org_id = public.current_org_id()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'availability series not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.booking_availability_series
  SET active = coalesce(p_active, false)
  WHERE id = p_series_id;

  UPDATE public.booking_availability_slots s
  SET active = coalesce(p_active, false),
      updated_at = now()
  WHERE s.series_id = p_series_id
    AND s.starts_at >= now()
    AND NOT EXISTS (
      SELECT 1
      FROM public.booking_requests br
      WHERE br.availability_slot_id = s.id
        AND br.status IN ('new', 'linked_to_shift', 'approved')
    );

  GET DIAGNOSTICS v_touched = ROW_COUNT;

  IF coalesce(p_active, false) THEN
    PERFORM public.materialize_booking_availability_series(p_series_id);
  END IF;

  RETURN jsonb_build_object('series_id', p_series_id, 'active', coalesce(p_active, false), 'slots_touched', v_touched);
END;
$$;

REVOKE ALL ON FUNCTION public.can_manage_booking_availability_org(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.materialize_booking_availability_series(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ensure_booking_availability_series_horizon(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_create_booking_availability_series(uuid, date, time, time, integer, text, text, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_booking_availability_series_active(uuid, boolean) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.can_manage_booking_availability_org(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.materialize_booking_availability_series(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_booking_availability_series_horizon(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_booking_availability_series(uuid, date, time, time, integer, text, text, uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_booking_availability_series_active(uuid, boolean) TO authenticated, service_role;

COMMENT ON TABLE public.booking_availability_series IS
  'Compact weekly rules for rolling public booking availability. Concrete slots are materialized only for a bounded horizon.';
