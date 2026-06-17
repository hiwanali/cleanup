-- CleanUp · Sen incheckning samma dag: vänta på utcheckning innan auto-klarmarkering

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
BEGIN
  FOR v_shift IN
    SELECT s.*
    FROM public.shifts s
    WHERE s.status IN ('Godkänt', 'Pågående')
      AND s.checked_out_at IS NULL
      AND coalesce(s.original_end_at, s.end_at) < p_now
  LOOP
    v_planned_start := coalesce(v_shift.original_start_at, v_shift.start_at);
    v_planned_end := coalesce(v_shift.original_end_at, v_shift.end_at);
    v_orig_start := v_shift.original_start_at;
    v_orig_end := v_shift.original_end_at;

    IF v_shift.checked_in_at IS NOT NULL
      AND v_shift.checked_in_at > v_planned_end
      AND v_shift.checked_in_at::date = v_planned_end::date THEN
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

  RETURN v_count;
END;
$$;
