-- CleanUp security phase 4
--
-- Server owns automatic shift finalization. Frontend must not mutate shift
-- status during hydration/intervals in Supabase mode.

CREATE TABLE IF NOT EXISTS public.shift_finalization_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'skipped', 'error')),
  finalized_count integer NOT NULL DEFAULT 0,
  skipped_reason text,
  error_message text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NOT NULL DEFAULT current_user
);

CREATE INDEX IF NOT EXISTS shift_finalization_runs_started_idx
  ON public.shift_finalization_runs (started_at DESC);

ALTER TABLE public.shift_finalization_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.shift_finalization_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.shift_finalization_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shift_finalization_runs TO service_role;

DROP POLICY IF EXISTS shift_finalization_runs_admin_select ON public.shift_finalization_runs;
CREATE POLICY shift_finalization_runs_admin_select
  ON public.shift_finalization_runs
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.finalize_eligible_shifts(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift record;
  v_count integer := 0;
  v_planned_start timestamptz;
  v_planned_end timestamptz;
  v_new_start timestamptz;
  v_new_end timestamptz;
  v_orig_start timestamptz;
  v_orig_end timestamptz;
  v_reason text;
  v_run_id uuid;
  v_max_rows integer := 500;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('cleanup.finalize_eligible_shifts')) THEN
    INSERT INTO public.shift_finalization_runs (
      finished_at,
      status,
      skipped_reason,
      payload
    )
    VALUES (
      clock_timestamp(),
      'skipped',
      'already_running',
      jsonb_build_object('requested_now', p_now)
    );

    RETURN 0;
  END IF;

  INSERT INTO public.shift_finalization_runs (payload)
  VALUES (jsonb_build_object('requested_now', p_now, 'max_rows', v_max_rows))
  RETURNING id INTO v_run_id;

  BEGIN
    FOR v_shift IN
      SELECT s.*
      FROM public.shifts s
      WHERE s.status IN ('Godkänt', 'Pågående')
        AND s.checked_out_at IS NULL
        AND coalesce(s.original_end_at, s.end_at) < p_now
      ORDER BY coalesce(s.original_end_at, s.end_at), s.id
      LIMIT v_max_rows
      FOR UPDATE SKIP LOCKED
    LOOP
      v_planned_start := coalesce(v_shift.original_start_at, v_shift.start_at);
      v_planned_end := coalesce(v_shift.original_end_at, v_shift.end_at);
      v_orig_start := v_shift.original_start_at;
      v_orig_end := v_shift.original_end_at;

      IF v_shift.checked_in_at IS NOT NULL
        AND v_shift.checked_in_at > v_planned_end
        AND (v_shift.checked_in_at AT TIME ZONE 'Europe/Stockholm')::date =
          (v_planned_end AT TIME ZONE 'Europe/Stockholm')::date
      THEN
        CONTINUE;
      END IF;

      IF v_shift.checked_in_at IS NULL THEN
        v_new_start := v_planned_start;
        v_new_end := v_planned_end;
        v_reason := 'auto_no_checkin';
      ELSIF p_now >= v_shift.checked_in_at + interval '12 hours' THEN
        v_new_start := v_planned_start;
        v_new_end := v_planned_end;
        v_reason := 'abandoned_checkin_12h';
      ELSE
        v_new_start := v_shift.checked_in_at;
        v_new_end := v_planned_end;
        v_orig_start := coalesce(v_orig_start, v_planned_start);
        v_orig_end := coalesce(v_orig_end, v_planned_end);
        v_reason := 'auto_after_end';
      END IF;

      UPDATE public.shifts
      SET
        status = 'Utfört',
        start_at = v_new_start,
        end_at = v_new_end,
        original_start_at = v_orig_start,
        original_end_at = v_orig_end,
        checked_in_at = v_shift.checked_in_at,
        checked_out_at = NULL,
        last_modified_by = coalesce(v_shift.cleaner_user_id, v_shift.last_modified_by),
        updated_at = p_now
      WHERE id = v_shift.id;

      INSERT INTO public.shift_events (shift_id, actor_user_id, event_type, payload)
      VALUES (
        v_shift.id,
        coalesce(v_shift.cleaner_user_id, v_shift.last_modified_by),
        'auto_completed',
        jsonb_build_object(
          'reason', v_reason,
          'server_run_id', v_run_id,
          'planned', jsonb_build_object(
            'start_at', v_orig_start,
            'end_at', v_orig_end
          ),
          'actual', jsonb_build_object(
            'start_at', v_new_start,
            'end_at', v_new_end
          )
        )
      );

      v_count := v_count + 1;
    END LOOP;
  EXCEPTION WHEN others THEN
    UPDATE public.shift_finalization_runs
    SET
      finished_at = clock_timestamp(),
      status = 'error',
      finalized_count = v_count,
      error_message = SQLERRM
    WHERE id = v_run_id;

    RAISE;
  END;

  UPDATE public.shift_finalization_runs
  SET
    finished_at = clock_timestamp(),
    status = 'completed',
    finalized_count = v_count
  WHERE id = v_run_id;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_eligible_shifts(timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_eligible_shifts(timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.finalize_eligible_shifts(timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_eligible_shifts(timestamptz) TO service_role;

DO $cron$
DECLARE
  v_job record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    FOR v_job IN
      SELECT jobid
      FROM cron.job
      WHERE jobname = 'finalize-eligible-shifts'
    LOOP
      PERFORM cron.unschedule(v_job.jobid);
    END LOOP;

    PERFORM cron.schedule(
      'finalize-eligible-shifts',
      '* * * * *',
      $job$SELECT public.finalize_eligible_shifts();$job$
    );
  END IF;
END;
$cron$;

NOTIFY pgrst, 'reload schema';
