-- Återkommande mönster: veckovis + sista veckodagen i månaden; etikett på mall.

ALTER TABLE public.recurring_schedules
  ADD COLUMN IF NOT EXISTS recurrence_kind text NOT NULL DEFAULT 'weekly',
  ADD COLUMN IF NOT EXISTS label text;

ALTER TABLE public.recurring_schedules
  DROP CONSTRAINT IF EXISTS recurring_schedules_recurrence_kind_check;

ALTER TABLE public.recurring_schedules
  ADD CONSTRAINT recurring_schedules_recurrence_kind_check
  CHECK (recurrence_kind IN ('weekly', 'monthly_last'));

COMMENT ON COLUMN public.recurring_schedules.recurrence_kind IS 'weekly = varje vecka; monthly_last = sista förekomsten av weekday i månaden';
COMMENT ON COLUMN public.recurring_schedules.label IS 'Valfri beskrivning t.ex. Storstädning';

CREATE OR REPLACE FUNCTION public.is_last_weekday_of_month(d date, weekday smallint)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.iso_weekday(d) = weekday
    AND (d + interval '7 days')::date >= (date_trunc('month', d) + interval '1 month')::date;
$$;

CREATE OR REPLACE FUNCTION public.recurring_matches_date(
  d date,
  weekday smallint,
  recurrence_kind text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.iso_weekday(d) = weekday
    AND (
      recurrence_kind = 'weekly'
      OR (
        recurrence_kind = 'monthly_last'
        AND public.is_last_weekday_of_month(d, weekday)
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.generate_shifts_from_recurring(
  p_from date DEFAULT (current_date - 28),
  p_to date DEFAULT (current_date + 168)
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  d date;
  v_start timestamptz;
  v_end timestamptz;
  v_status text;
  v_count integer := 0;
  v_inserted integer;
  v_existing record;
  v_new_mins integer;
  v_old_mins integer;
BEGIN
  FOR d IN SELECT generate_series(p_from, p_to, '1 day'::interval)::date LOOP
    FOR r IN
      SELECT *
      FROM public.recurring_schedules
      WHERE active
        AND public.recurring_matches_date(d, weekday, recurrence_kind)
        AND (valid_from IS NULL OR d >= valid_from)
        AND (valid_to IS NULL OR d <= valid_to)
    LOOP
      v_start := d + r.start_time;
      v_end := d + r.end_time;
      IF v_end <= now() THEN
        v_status := 'Utfört';
      ELSE
        v_status := 'Godkänt';
      END IF;

      v_new_mins := EXTRACT(EPOCH FROM (v_end - v_start)) / 60;

      SELECT s.id,
        EXTRACT(EPOCH FROM (s.end_at - s.start_at)) / 60 AS dur_mins
      INTO v_existing
      FROM public.shifts s
      WHERE s.property_id = r.property_id
        AND s.start_at::date = d
        AND s.status NOT IN ('Borttaget', 'Avbokat')
      ORDER BY (s.end_at - s.start_at) DESC
      LIMIT 1;

      IF FOUND THEN
        v_old_mins := v_existing.dur_mins;
        IF v_new_mins <= v_old_mins THEN
          CONTINUE;
        END IF;
        IF EXISTS (
          SELECT 1 FROM public.shifts s2
          WHERE s2.id = v_existing.id AND s2.start_at < now()
        ) THEN
          CONTINUE;
        END IF;
        DELETE FROM public.shifts WHERE id = v_existing.id;
      END IF;

      INSERT INTO public.shifts (
        property_id,
        cleaner_user_id,
        start_at,
        end_at,
        status,
        source,
        recurring_id,
        last_modified_by,
        checked_in_at,
        checked_out_at
      )
      SELECT
        r.property_id,
        r.default_cleaner_user_id,
        v_start,
        v_end,
        v_status,
        'recurring',
        r.id,
        (SELECT id FROM public.users WHERE role = 'admin' LIMIT 1),
        CASE WHEN v_status = 'Utfört' THEN v_start + interval '5 minutes' END,
        CASE WHEN v_status = 'Utfört' THEN v_end - interval '2 minutes' END
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.shifts s
        WHERE s.property_id = r.property_id
          AND s.recurring_id = r.id
          AND s.start_at = v_start
      );

      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      IF v_inserted > 0 THEN
        v_count := v_count + v_inserted;
        PERFORM public.snapshot_checklist_for_shift(
          (SELECT id FROM public.shifts
           WHERE property_id = r.property_id AND recurring_id = r.id AND start_at = v_start
           LIMIT 1)
        );
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_count;
END;
$$;
