-- CleanUp · serverstyrd in-/utcheckning med revisionsspår

CREATE TABLE IF NOT EXISTS public.booking_attendance_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempted_shift_id uuid,
  shift_id uuid REFERENCES public.shifts (id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('check_in', 'check_out')),
  result text NOT NULL CHECK (result IN ('confirmed', 'already_applied', 'rejected')),
  reason text NOT NULL,
  client_attempt_id text,
  client_observed_status text,
  client_observed_updated_at timestamptz,
  server_shift_status text,
  server_shift_updated_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS booking_attendance_attempts_actor_idx
  ON public.booking_attendance_attempts (actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS booking_attendance_attempts_shift_idx
  ON public.booking_attendance_attempts (shift_id, created_at DESC);

CREATE INDEX IF NOT EXISTS booking_attendance_attempts_attempted_shift_idx
  ON public.booking_attendance_attempts (attempted_shift_id, created_at DESC);

ALTER TABLE public.booking_attendance_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.booking_attendance_attempts FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.booking_attendance_attempts FROM authenticated;
GRANT SELECT ON public.booking_attendance_attempts TO authenticated;
GRANT SELECT ON public.booking_attendance_attempts TO service_role;

DROP POLICY IF EXISTS booking_attendance_attempts_select ON public.booking_attendance_attempts;
CREATE POLICY booking_attendance_attempts_select ON public.booking_attendance_attempts
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR actor_user_id = (select auth.uid())
  );

CREATE OR REPLACE FUNCTION public.check_in_booking(
  p_shift_id uuid,
  p_client_attempt_id text DEFAULT NULL,
  p_client_observed_status text DEFAULT NULL,
  p_client_observed_updated_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_actor_active boolean;
  v_shift public.shifts%rowtype;
  v_updated_shift public.shifts%rowtype;
  v_attempt_id uuid;
  v_now timestamptz := clock_timestamp();
  v_planned_start timestamptz;
  v_planned_end timestamptz;
  v_late_same_day boolean := false;
BEGIN
  SELECT u.role, coalesce(u.active, false)
  INTO v_actor_role, v_actor_active
  FROM public.users u
  WHERE u.id = v_actor;

  IF v_actor IS NULL OR v_actor_role IS DISTINCT FROM 'cleaner' OR NOT coalesce(v_actor_active, false) THEN
    INSERT INTO public.booking_attendance_attempts (
      attempted_shift_id, actor_user_id, action, result, reason,
      client_attempt_id, client_observed_status, client_observed_updated_at,
      payload
    )
    VALUES (
      p_shift_id, v_actor, 'check_in', 'rejected', 'invalid_user',
      p_client_attempt_id, p_client_observed_status, p_client_observed_updated_at,
      jsonb_build_object('actor_role', v_actor_role, 'actor_active', v_actor_active)
    )
    RETURNING id INTO v_attempt_id;

    RETURN jsonb_build_object(
      'ok', false,
      'result', 'rejected',
      'reason', 'invalid_user',
      'message', 'Sessionen har inte behörighet att checka in.',
      'attempt_id', v_attempt_id
    );
  END IF;

  SELECT *
  INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.booking_attendance_attempts (
      attempted_shift_id, actor_user_id, action, result, reason,
      client_attempt_id, client_observed_status, client_observed_updated_at
    )
    VALUES (
      p_shift_id, v_actor, 'check_in', 'rejected', 'not_found',
      p_client_attempt_id, p_client_observed_status, p_client_observed_updated_at
    )
    RETURNING id INTO v_attempt_id;

    RETURN jsonb_build_object(
      'ok', false,
      'result', 'rejected',
      'reason', 'not_found',
      'message', 'Passet hittades inte.',
      'attempt_id', v_attempt_id
    );
  END IF;

  IF v_shift.cleaner_user_id IS DISTINCT FROM v_actor THEN
    INSERT INTO public.booking_attendance_attempts (
      attempted_shift_id, shift_id, actor_user_id, action, result, reason,
      client_attempt_id, client_observed_status, client_observed_updated_at,
      server_shift_status, server_shift_updated_at
    )
    VALUES (
      p_shift_id, v_shift.id, v_actor, 'check_in', 'rejected', 'not_owner',
      p_client_attempt_id, p_client_observed_status, p_client_observed_updated_at,
      v_shift.status, v_shift.updated_at
    )
    RETURNING id INTO v_attempt_id;

    RETURN jsonb_build_object(
      'ok', false,
      'result', 'rejected',
      'reason', 'not_owner',
      'message', 'Passet tillhör inte den inloggade städaren.',
      'attempt_id', v_attempt_id,
      'shift', to_jsonb(v_shift)
    );
  END IF;

  IF v_shift.checked_in_at IS NOT NULL AND v_shift.checked_out_at IS NULL THEN
    INSERT INTO public.booking_attendance_attempts (
      attempted_shift_id, shift_id, actor_user_id, action, result, reason,
      client_attempt_id, client_observed_status, client_observed_updated_at,
      server_shift_status, server_shift_updated_at
    )
    VALUES (
      p_shift_id, v_shift.id, v_actor, 'check_in', 'already_applied', 'already_checked_in',
      p_client_attempt_id, p_client_observed_status, p_client_observed_updated_at,
      v_shift.status, v_shift.updated_at
    )
    RETURNING id INTO v_attempt_id;

    RETURN jsonb_build_object(
      'ok', true,
      'result', 'already_applied',
      'reason', 'already_checked_in',
      'attempt_id', v_attempt_id,
      'shift', to_jsonb(v_shift)
    );
  END IF;

  v_planned_start := coalesce(v_shift.original_start_at, v_shift.start_at);
  v_planned_end := coalesce(v_shift.original_end_at, v_shift.end_at);
  v_late_same_day := (
    v_shift.status = 'Utfört'
    AND v_shift.checked_in_at IS NULL
    AND v_now > v_planned_end
    AND (v_now AT TIME ZONE 'Europe/Stockholm')::date = (v_planned_end AT TIME ZONE 'Europe/Stockholm')::date
  );

  IF NOT (
    v_shift.checked_in_at IS NULL
    AND (
      v_shift.status IN ('Godkänt', 'Planerat')
      OR v_late_same_day
    )
  ) THEN
    INSERT INTO public.booking_attendance_attempts (
      attempted_shift_id, shift_id, actor_user_id, action, result, reason,
      client_attempt_id, client_observed_status, client_observed_updated_at,
      server_shift_status, server_shift_updated_at,
      payload
    )
    VALUES (
      p_shift_id, v_shift.id, v_actor, 'check_in', 'rejected', 'not_eligible',
      p_client_attempt_id, p_client_observed_status, p_client_observed_updated_at,
      v_shift.status, v_shift.updated_at,
      jsonb_build_object(
        'checked_in_at', v_shift.checked_in_at,
        'checked_out_at', v_shift.checked_out_at
      )
    )
    RETURNING id INTO v_attempt_id;

    RETURN jsonb_build_object(
      'ok', false,
      'result', 'rejected',
      'reason', 'not_eligible',
      'message', 'Passet kan inte checkas in i sitt nuvarande läge.',
      'attempt_id', v_attempt_id,
      'shift', to_jsonb(v_shift)
    );
  END IF;

  IF v_late_same_day THEN
    UPDATE public.shifts
    SET
      status = 'Pågående',
      start_at = v_now,
      end_at = v_now + interval '1 second',
      original_start_at = coalesce(original_start_at, v_planned_start),
      original_end_at = coalesce(original_end_at, v_planned_end),
      checked_in_at = v_now,
      checked_out_at = NULL,
      last_modified_by = v_actor,
      updated_at = v_now
    WHERE id = v_shift.id
    RETURNING * INTO v_updated_shift;
  ELSE
    UPDATE public.shifts
    SET
      status = 'Pågående',
      checked_in_at = v_now,
      checked_out_at = NULL,
      last_modified_by = v_actor,
      updated_at = v_now
    WHERE id = v_shift.id
    RETURNING * INTO v_updated_shift;
  END IF;

  INSERT INTO public.booking_attendance_attempts (
    attempted_shift_id, shift_id, actor_user_id, action, result, reason,
    client_attempt_id, client_observed_status, client_observed_updated_at,
    server_shift_status, server_shift_updated_at,
    payload
  )
  VALUES (
    p_shift_id, v_updated_shift.id, v_actor, 'check_in', 'confirmed', 'checked_in',
    p_client_attempt_id, p_client_observed_status, p_client_observed_updated_at,
    v_updated_shift.status, v_updated_shift.updated_at,
    jsonb_build_object('late_same_day', v_late_same_day)
  )
  RETURNING id INTO v_attempt_id;

  INSERT INTO public.shift_events (shift_id, actor_user_id, event_type, payload)
  VALUES (
    v_updated_shift.id,
    v_actor,
    'check_in',
    jsonb_build_object(
      'late_same_day', v_late_same_day,
      'attendance_attempt_id', v_attempt_id,
      'client_attempt_id', p_client_attempt_id
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'result', 'confirmed',
    'reason', 'checked_in',
    'attempt_id', v_attempt_id,
    'shift', to_jsonb(v_updated_shift)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.check_out_booking(
  p_shift_id uuid,
  p_client_attempt_id text DEFAULT NULL,
  p_client_observed_status text DEFAULT NULL,
  p_client_observed_updated_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_actor_active boolean;
  v_shift public.shifts%rowtype;
  v_updated_shift public.shifts%rowtype;
  v_attempt_id uuid;
  v_now timestamptz := clock_timestamp();
  v_checked_out_at timestamptz;
  v_planned_start timestamptz;
  v_planned_end timestamptz;
BEGIN
  SELECT u.role, coalesce(u.active, false)
  INTO v_actor_role, v_actor_active
  FROM public.users u
  WHERE u.id = v_actor;

  IF v_actor IS NULL OR v_actor_role IS DISTINCT FROM 'cleaner' OR NOT coalesce(v_actor_active, false) THEN
    INSERT INTO public.booking_attendance_attempts (
      attempted_shift_id, actor_user_id, action, result, reason,
      client_attempt_id, client_observed_status, client_observed_updated_at,
      payload
    )
    VALUES (
      p_shift_id, v_actor, 'check_out', 'rejected', 'invalid_user',
      p_client_attempt_id, p_client_observed_status, p_client_observed_updated_at,
      jsonb_build_object('actor_role', v_actor_role, 'actor_active', v_actor_active)
    )
    RETURNING id INTO v_attempt_id;

    RETURN jsonb_build_object(
      'ok', false,
      'result', 'rejected',
      'reason', 'invalid_user',
      'message', 'Sessionen har inte behörighet att checka ut.',
      'attempt_id', v_attempt_id
    );
  END IF;

  SELECT *
  INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.booking_attendance_attempts (
      attempted_shift_id, actor_user_id, action, result, reason,
      client_attempt_id, client_observed_status, client_observed_updated_at
    )
    VALUES (
      p_shift_id, v_actor, 'check_out', 'rejected', 'not_found',
      p_client_attempt_id, p_client_observed_status, p_client_observed_updated_at
    )
    RETURNING id INTO v_attempt_id;

    RETURN jsonb_build_object(
      'ok', false,
      'result', 'rejected',
      'reason', 'not_found',
      'message', 'Passet hittades inte.',
      'attempt_id', v_attempt_id
    );
  END IF;

  IF v_shift.cleaner_user_id IS DISTINCT FROM v_actor THEN
    INSERT INTO public.booking_attendance_attempts (
      attempted_shift_id, shift_id, actor_user_id, action, result, reason,
      client_attempt_id, client_observed_status, client_observed_updated_at,
      server_shift_status, server_shift_updated_at
    )
    VALUES (
      p_shift_id, v_shift.id, v_actor, 'check_out', 'rejected', 'not_owner',
      p_client_attempt_id, p_client_observed_status, p_client_observed_updated_at,
      v_shift.status, v_shift.updated_at
    )
    RETURNING id INTO v_attempt_id;

    RETURN jsonb_build_object(
      'ok', false,
      'result', 'rejected',
      'reason', 'not_owner',
      'message', 'Passet tillhör inte den inloggade städaren.',
      'attempt_id', v_attempt_id,
      'shift', to_jsonb(v_shift)
    );
  END IF;

  IF v_shift.checked_out_at IS NOT NULL THEN
    INSERT INTO public.booking_attendance_attempts (
      attempted_shift_id, shift_id, actor_user_id, action, result, reason,
      client_attempt_id, client_observed_status, client_observed_updated_at,
      server_shift_status, server_shift_updated_at
    )
    VALUES (
      p_shift_id, v_shift.id, v_actor, 'check_out', 'already_applied', 'already_checked_out',
      p_client_attempt_id, p_client_observed_status, p_client_observed_updated_at,
      v_shift.status, v_shift.updated_at
    )
    RETURNING id INTO v_attempt_id;

    RETURN jsonb_build_object(
      'ok', true,
      'result', 'already_applied',
      'reason', 'already_checked_out',
      'attempt_id', v_attempt_id,
      'shift', to_jsonb(v_shift)
    );
  END IF;

  IF NOT (
    v_shift.checked_in_at IS NOT NULL
    AND v_shift.checked_out_at IS NULL
    AND v_shift.status IN ('Pågående', 'Utfört')
  ) THEN
    INSERT INTO public.booking_attendance_attempts (
      attempted_shift_id, shift_id, actor_user_id, action, result, reason,
      client_attempt_id, client_observed_status, client_observed_updated_at,
      server_shift_status, server_shift_updated_at,
      payload
    )
    VALUES (
      p_shift_id, v_shift.id, v_actor, 'check_out', 'rejected', 'not_eligible',
      p_client_attempt_id, p_client_observed_status, p_client_observed_updated_at,
      v_shift.status, v_shift.updated_at,
      jsonb_build_object(
        'checked_in_at', v_shift.checked_in_at,
        'checked_out_at', v_shift.checked_out_at
      )
    )
    RETURNING id INTO v_attempt_id;

    RETURN jsonb_build_object(
      'ok', false,
      'result', 'rejected',
      'reason', 'not_eligible',
      'message', 'Passet kan inte checkas ut i sitt nuvarande läge.',
      'attempt_id', v_attempt_id,
      'shift', to_jsonb(v_shift)
    );
  END IF;

  v_planned_start := coalesce(v_shift.original_start_at, v_shift.start_at);
  v_planned_end := coalesce(v_shift.original_end_at, v_shift.end_at);
  v_checked_out_at := greatest(v_now, v_shift.checked_in_at + interval '1 second');

  UPDATE public.shifts
  SET
    status = 'Utfört',
    start_at = v_shift.checked_in_at,
    end_at = v_checked_out_at,
    original_start_at = coalesce(original_start_at, v_planned_start),
    original_end_at = coalesce(original_end_at, v_planned_end),
    checked_in_at = v_shift.checked_in_at,
    checked_out_at = v_checked_out_at,
    last_modified_by = v_actor,
    updated_at = v_now
  WHERE id = v_shift.id
  RETURNING * INTO v_updated_shift;

  INSERT INTO public.booking_attendance_attempts (
    attempted_shift_id, shift_id, actor_user_id, action, result, reason,
    client_attempt_id, client_observed_status, client_observed_updated_at,
    server_shift_status, server_shift_updated_at,
    payload
  )
  VALUES (
    p_shift_id, v_updated_shift.id, v_actor, 'check_out', 'confirmed', 'checked_out',
    p_client_attempt_id, p_client_observed_status, p_client_observed_updated_at,
    v_updated_shift.status, v_updated_shift.updated_at,
    jsonb_build_object(
      'planned', jsonb_build_object(
        'start_at', v_updated_shift.original_start_at,
        'end_at', v_updated_shift.original_end_at
      ),
      'actual', jsonb_build_object(
        'start_at', v_updated_shift.start_at,
        'end_at', v_updated_shift.end_at
      )
    )
  )
  RETURNING id INTO v_attempt_id;

  INSERT INTO public.shift_events (shift_id, actor_user_id, event_type, payload)
  VALUES (
    v_updated_shift.id,
    v_actor,
    'check_out',
    jsonb_build_object(
      'planned', jsonb_build_object(
        'start_at', v_updated_shift.original_start_at,
        'end_at', v_updated_shift.original_end_at
      ),
      'actual', jsonb_build_object(
        'start_at', v_updated_shift.start_at,
        'end_at', v_updated_shift.end_at
      ),
      'attendance_attempt_id', v_attempt_id,
      'client_attempt_id', p_client_attempt_id
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'result', 'confirmed',
    'reason', 'checked_out',
    'attempt_id', v_attempt_id,
    'shift', to_jsonb(v_updated_shift)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_in_booking(uuid, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_in_booking(uuid, text, text, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.check_in_booking(uuid, text, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_in_booking(uuid, text, text, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.check_out_booking(uuid, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_out_booking(uuid, text, text, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.check_out_booking(uuid, text, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_out_booking(uuid, text, text, timestamptz) TO service_role;
