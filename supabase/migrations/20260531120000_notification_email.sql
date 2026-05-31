-- E-postnotiser via Resend (Edge Function send-notification-email)

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_error text;

COMMENT ON COLUMN public.notifications.email_sent_at IS 'När Resend-e-post skickades (idempotens).';
COMMENT ON COLUMN public.notifications.email_error IS 'Senaste fel vid e-postutskick.';

-- Batch-insert notiser inom samma org (städare/kund → admin m.m.)
CREATE OR REPLACE FUNCTION public.insert_notifications(p_rows jsonb)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_row jsonb;
  v_recipient uuid;
  v_kind text;
  v_payload jsonb;
  v_ids uuid[] := '{}';
  v_new_id uuid;
  v_count int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array';
  END IF;

  v_count := jsonb_array_length(p_rows);
  IF v_count = 0 THEN
    RETURN v_ids;
  END IF;

  IF v_count > 20 THEN
    RAISE EXCEPTION 'Too many notifications (max 20)';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_recipient := NULLIF(trim(v_row->>'recipient_user_id'), '')::uuid;
    v_kind := NULLIF(trim(v_row->>'kind'), '');
    v_payload := COALESCE(v_row->'payload', '{}'::jsonb);

    IF v_recipient IS NULL OR v_kind IS NULL THEN
      RAISE EXCEPTION 'Invalid notification row: recipient_user_id and kind required';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = v_recipient
        AND u.org_id = v_org_id
        AND u.active
    ) THEN
      RAISE EXCEPTION 'Recipient not in organization';
    END IF;

    INSERT INTO public.notifications (recipient_user_id, channel, kind, payload)
    VALUES (v_recipient, 'in_app', v_kind, v_payload)
    RETURNING id INTO v_new_id;

    v_ids := array_append(v_ids, v_new_id);
  END LOOP;

  RETURN v_ids;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_notifications(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.insert_notifications(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.insert_notifications(jsonb) TO authenticated, service_role;

ALTER FUNCTION public.insert_notifications(jsonb) SET search_path = public;
