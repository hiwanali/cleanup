-- CleanUp · Synk-kolumner på shifts, holiday-RPC, utökad realtime

-- ---------------------------------------------------------------------------
-- 1. Extra shift-fält för sjukanmälan och kundledighet
-- ---------------------------------------------------------------------------
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS sick_finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS pre_pause_status text,
  ADD COLUMN IF NOT EXISTS paused_by_holiday_id uuid REFERENCES public.customer_holidays (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS shifts_paused_by_holiday_idx
  ON public.shifts (paused_by_holiday_id)
  WHERE paused_by_holiday_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Skapa kundledighet + pausa matchande pass (SECURITY DEFINER)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_customer_holiday(
  p_customer_id uuid,
  p_scope public.scope_type,
  p_property_ids uuid[] DEFAULT '{}'::uuid[],
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL,
  p_reason text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_holiday_id uuid;
  v_paused_count integer := 0;
  v_shift record;
  v_prop_ids uuid[];
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.is_admin()
    OR (
      public.is_customer_role()
      AND p_customer_id IN (SELECT public.accessible_customer_ids())
    )
  ) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RAISE EXCEPTION 'invalid date range' USING ERRCODE = '22023';
  END IF;

  IF p_scope = 'selected' THEN
    IF p_property_ids IS NULL OR cardinality(p_property_ids) = 0 THEN
      RAISE EXCEPTION 'property_ids required for selected scope' USING ERRCODE = '22023';
    END IF;
    IF NOT public.is_admin() THEN
      IF EXISTS (
        SELECT 1 FROM unnest(p_property_ids) pid
        WHERE pid NOT IN (SELECT public.accessible_property_ids())
      ) THEN
        RAISE EXCEPTION 'forbidden property' USING ERRCODE = '42501';
      END IF;
    END IF;
    v_prop_ids := p_property_ids;
  ELSE
    SELECT coalesce(array_agg(p.id), '{}'::uuid[])
    INTO v_prop_ids
    FROM public.properties p
    WHERE p.customer_id = p_customer_id;
  END IF;

  INSERT INTO public.customer_holidays (
    customer_id, created_by_user_id, scope, start_date, end_date, reason
  ) VALUES (
    p_customer_id, v_actor, p_scope, p_start_date, p_end_date, coalesce(trim(p_reason), '')
  )
  RETURNING id INTO v_holiday_id;

  IF p_scope = 'selected' THEN
    INSERT INTO public.customer_holiday_properties (customer_holiday_id, property_id)
    SELECT v_holiday_id, pid FROM unnest(v_prop_ids) pid;
  END IF;

  FOR v_shift IN
    SELECT s.id, s.status
    FROM public.shifts s
    WHERE s.property_id = ANY (v_prop_ids)
      AND s.status IN ('Planerat', 'Godkänt')
      AND (s.start_at AT TIME ZONE 'Europe/Stockholm')::date >= p_start_date
      AND (s.start_at AT TIME ZONE 'Europe/Stockholm')::date <= p_end_date
  LOOP
    UPDATE public.shifts
    SET
      pre_pause_status = v_shift.status,
      paused_by_holiday_id = v_holiday_id,
      status = 'Pausat (kundledighet)',
      last_modified_by = v_actor
    WHERE id = v_shift.id;

    INSERT INTO public.shift_events (shift_id, actor_user_id, event_type, payload)
    VALUES (
      v_shift.id,
      v_actor,
      'paused_by_holiday',
      jsonb_build_object('holiday_id', v_holiday_id)
    );

    v_paused_count := v_paused_count + 1;
  END LOOP;

  RETURN jsonb_build_object('holiday_id', v_holiday_id, 'paused_count', v_paused_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_customer_holiday(
  uuid, public.scope_type, uuid[], date, date, text
) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Ta bort kundledighet + återställ framtida pausade pass
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_customer_holiday(p_holiday_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_holiday public.customer_holidays%ROWTYPE;
  v_restored_count integer := 0;
  v_shift record;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_holiday FROM public.customer_holidays WHERE id = p_holiday_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'holiday not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    public.is_admin()
    OR (
      public.is_customer_role()
      AND v_holiday.customer_id IN (SELECT public.accessible_customer_ids())
    )
  ) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  FOR v_shift IN
    SELECT s.id, s.pre_pause_status
    FROM public.shifts s
    WHERE s.paused_by_holiday_id = p_holiday_id
      AND s.end_at >= now()
  LOOP
    UPDATE public.shifts
    SET
      status = coalesce(v_shift.pre_pause_status, 'Godkänt'),
      pre_pause_status = NULL,
      paused_by_holiday_id = NULL,
      last_modified_by = v_actor
    WHERE id = v_shift.id;

    INSERT INTO public.shift_events (shift_id, actor_user_id, event_type, payload)
    VALUES (
      v_shift.id,
      v_actor,
      'holiday_removed',
      jsonb_build_object('holiday_id', p_holiday_id)
    );

    v_restored_count := v_restored_count + 1;
  END LOOP;

  DELETE FROM public.customer_holidays WHERE id = p_holiday_id;

  RETURN jsonb_build_object('restored_count', v_restored_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_customer_holiday(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Utökad Supabase Realtime
-- ---------------------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_holidays;
ALTER PUBLICATION supabase_realtime ADD TABLE public.shift_checklist_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.cleaning_checklists;
ALTER PUBLICATION supabase_realtime ADD TABLE public.property_cleaners;
