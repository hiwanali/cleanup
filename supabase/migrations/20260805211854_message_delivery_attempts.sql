-- CleanUp · audit och kontrollerade svar för meddelandeskick

CREATE TABLE IF NOT EXISTS public.message_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempted_customer_id uuid,
  customer_id uuid REFERENCES public.customers (id) ON DELETE SET NULL,
  thread_id uuid REFERENCES public.message_threads (id) ON DELETE SET NULL,
  message_id uuid REFERENCES public.messages (id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  result text NOT NULL CHECK (result IN ('confirmed', 'rejected')),
  reason text NOT NULL,
  client_attempt_id text,
  body_length integer NOT NULL DEFAULT 0,
  body_preview text NOT NULL DEFAULT '',
  actor_role text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS message_delivery_attempts_actor_idx
  ON public.message_delivery_attempts (actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS message_delivery_attempts_customer_idx
  ON public.message_delivery_attempts (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS message_delivery_attempts_thread_idx
  ON public.message_delivery_attempts (thread_id, created_at DESC);

ALTER TABLE public.message_delivery_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.message_delivery_attempts FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.message_delivery_attempts FROM authenticated;
GRANT SELECT ON public.message_delivery_attempts TO authenticated;
GRANT SELECT ON public.message_delivery_attempts TO service_role;

DROP POLICY IF EXISTS message_delivery_attempts_select ON public.message_delivery_attempts;
CREATE POLICY message_delivery_attempts_select ON public.message_delivery_attempts
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR actor_user_id = (select auth.uid())
  );

DROP FUNCTION IF EXISTS public.send_message_with_notifications(uuid, text);

CREATE OR REPLACE FUNCTION public.send_message_with_notifications(
  p_customer_id uuid,
  p_body text,
  p_client_attempt_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users;
  v_customer public.customers;
  v_thread_id uuid;
  v_message_id uuid;
  v_message_created_at timestamptz;
  v_recipient record;
  v_notification_id uuid;
  v_notification_ids uuid[] := ARRAY[]::uuid[];
  v_body text := trim(coalesce(p_body, ''));
  v_attempt_id uuid;
  v_reason text;
  v_message text;
BEGIN
  IF auth.uid() IS NULL THEN
    v_reason := 'not_authenticated';
    v_message := 'Sessionen behöver uppdateras. Logga in igen innan du skickar meddelandet.';
    INSERT INTO public.message_delivery_attempts (
      attempted_customer_id, actor_user_id, result, reason, client_attempt_id,
      body_length, body_preview
    )
    VALUES (
      p_customer_id, NULL, 'rejected', v_reason, p_client_attempt_id,
      char_length(v_body), left(v_body, 160)
    )
    RETURNING id INTO v_attempt_id;

    RETURN jsonb_build_object('ok', false, 'result', 'rejected', 'reason', v_reason, 'message', v_message, 'attempt_id', v_attempt_id);
  END IF;

  SELECT *
  INTO v_actor
  FROM public.users
  WHERE id = auth.uid()
    AND active
  LIMIT 1;

  IF v_actor.id IS NULL THEN
    v_reason := 'active_user_not_found';
    v_message := 'Aktiv användare saknas för den här sessionen.';
    INSERT INTO public.message_delivery_attempts (
      attempted_customer_id, actor_user_id, result, reason, client_attempt_id,
      body_length, body_preview
    )
    VALUES (
      p_customer_id, auth.uid(), 'rejected', v_reason, p_client_attempt_id,
      char_length(v_body), left(v_body, 160)
    )
    RETURNING id INTO v_attempt_id;

    RETURN jsonb_build_object('ok', false, 'result', 'rejected', 'reason', v_reason, 'message', v_message, 'attempt_id', v_attempt_id);
  END IF;

  IF v_actor.role NOT IN ('admin', 'customer', 'customer_employee', 'cleaner') THEN
    v_reason := 'role_not_allowed';
    v_message := 'Din roll kan inte skicka meddelanden.';
    INSERT INTO public.message_delivery_attempts (
      attempted_customer_id, actor_user_id, result, reason, client_attempt_id,
      body_length, body_preview, actor_role
    )
    VALUES (
      p_customer_id, v_actor.id, 'rejected', v_reason, p_client_attempt_id,
      char_length(v_body), left(v_body, 160), v_actor.role
    )
    RETURNING id INTO v_attempt_id;

    RETURN jsonb_build_object('ok', false, 'result', 'rejected', 'reason', v_reason, 'message', v_message, 'attempt_id', v_attempt_id);
  END IF;

  IF v_body = '' THEN
    v_reason := 'empty_body';
    v_message := 'Meddelandet är tomt.';
    INSERT INTO public.message_delivery_attempts (
      attempted_customer_id, actor_user_id, result, reason, client_attempt_id,
      body_length, body_preview, actor_role
    )
    VALUES (
      p_customer_id, v_actor.id, 'rejected', v_reason, p_client_attempt_id,
      0, '', v_actor.role
    )
    RETURNING id INTO v_attempt_id;

    RETURN jsonb_build_object('ok', false, 'result', 'rejected', 'reason', v_reason, 'message', v_message, 'attempt_id', v_attempt_id);
  END IF;

  IF char_length(v_body) > 4000 THEN
    v_reason := 'body_too_long';
    v_message := 'Meddelandet är för långt.';
    INSERT INTO public.message_delivery_attempts (
      attempted_customer_id, actor_user_id, result, reason, client_attempt_id,
      body_length, body_preview, actor_role
    )
    VALUES (
      p_customer_id, v_actor.id, 'rejected', v_reason, p_client_attempt_id,
      char_length(v_body), left(v_body, 160), v_actor.role
    )
    RETURNING id INTO v_attempt_id;

    RETURN jsonb_build_object('ok', false, 'result', 'rejected', 'reason', v_reason, 'message', v_message, 'attempt_id', v_attempt_id);
  END IF;

  SELECT *
  INTO v_customer
  FROM public.customers
  WHERE id = p_customer_id
    AND org_id = v_actor.org_id
  LIMIT 1;

  IF v_customer.id IS NULL THEN
    v_reason := 'customer_not_found';
    v_message := 'Kunden hittades inte.';
    INSERT INTO public.message_delivery_attempts (
      attempted_customer_id, actor_user_id, result, reason, client_attempt_id,
      body_length, body_preview, actor_role
    )
    VALUES (
      p_customer_id, v_actor.id, 'rejected', v_reason, p_client_attempt_id,
      char_length(v_body), left(v_body, 160), v_actor.role
    )
    RETURNING id INTO v_attempt_id;

    RETURN jsonb_build_object('ok', false, 'result', 'rejected', 'reason', v_reason, 'message', v_message, 'attempt_id', v_attempt_id);
  END IF;

  IF v_actor.role IN ('customer', 'customer_employee')
    AND NOT EXISTS (
      SELECT 1
      FROM public.accessible_customer_ids() AS ac(customer_id)
      WHERE ac.customer_id = p_customer_id
    )
  THEN
    v_reason := 'customer_not_accessible';
    v_message := 'Du har inte åtkomst till den här dialogen.';
    INSERT INTO public.message_delivery_attempts (
      attempted_customer_id, customer_id, actor_user_id, result, reason, client_attempt_id,
      body_length, body_preview, actor_role
    )
    VALUES (
      p_customer_id, v_customer.id, v_actor.id, 'rejected', v_reason, p_client_attempt_id,
      char_length(v_body), left(v_body, 160), v_actor.role
    )
    RETURNING id INTO v_attempt_id;

    RETURN jsonb_build_object('ok', false, 'result', 'rejected', 'reason', v_reason, 'message', v_message, 'attempt_id', v_attempt_id);
  END IF;

  IF v_actor.role = 'cleaner'
    AND NOT public.customer_has_message_cleaner(p_customer_id, v_actor.id)
  THEN
    v_reason := 'customer_not_accessible';
    v_message := 'Du har inte åtkomst till den här dialogen.';
    INSERT INTO public.message_delivery_attempts (
      attempted_customer_id, customer_id, actor_user_id, result, reason, client_attempt_id,
      body_length, body_preview, actor_role
    )
    VALUES (
      p_customer_id, v_customer.id, v_actor.id, 'rejected', v_reason, p_client_attempt_id,
      char_length(v_body), left(v_body, 160), v_actor.role
    )
    RETURNING id INTO v_attempt_id;

    RETURN jsonb_build_object('ok', false, 'result', 'rejected', 'reason', v_reason, 'message', v_message, 'attempt_id', v_attempt_id);
  END IF;

  INSERT INTO public.message_threads (org_id, customer_id)
  VALUES (v_actor.org_id, p_customer_id)
  ON CONFLICT (customer_id) DO UPDATE
    SET last_message_at = public.message_threads.last_message_at
  RETURNING id INTO v_thread_id;

  INSERT INTO public.messages (
    thread_id,
    sender_user_id,
    sender_role,
    body
  )
  VALUES (
    v_thread_id,
    v_actor.id,
    v_actor.role::text::public.message_sender_role,
    v_body
  )
  RETURNING id, created_at INTO v_message_id, v_message_created_at;

  UPDATE public.message_threads
  SET last_message_at = v_message_created_at
  WHERE id = v_thread_id;

  INSERT INTO public.thread_reads (thread_id, user_id, last_read_at)
  VALUES (v_thread_id, v_actor.id, v_message_created_at)
  ON CONFLICT (thread_id, user_id) DO UPDATE
    SET last_read_at = EXCLUDED.last_read_at;

  FOR v_recipient IN
    SELECT p.user_id AS id, p.role
    FROM public.message_participants_for_customer(p_customer_id) p
    WHERE p.user_id <> v_actor.id
  LOOP
    INSERT INTO public.notifications (
      recipient_user_id,
      channel,
      kind,
      payload
    )
    VALUES (
      v_recipient.id,
      'in_app',
      'new_message',
      jsonb_build_object(
        'thread_id', v_thread_id,
        'customer_id', p_customer_id,
        'message_id', v_message_id,
        'sender_user_id', v_actor.id,
        'sender_role', v_actor.role,
        'target_path',
          CASE
            WHEN v_recipient.role = 'admin' THEN '/admin/meddelanden'
            WHEN v_recipient.role = 'cleaner' THEN '/stadare/meddelanden'
            WHEN v_recipient.role IN ('customer', 'customer_employee') THEN '/kund/meddelanden'
            ELSE '/meddelanden'
          END,
        'preview', left(v_body, 160)
      )
    )
    RETURNING id INTO v_notification_id;

    v_notification_ids := array_append(v_notification_ids, v_notification_id);
  END LOOP;

  INSERT INTO public.message_delivery_attempts (
    attempted_customer_id, customer_id, thread_id, message_id, actor_user_id,
    result, reason, client_attempt_id, body_length, body_preview, actor_role,
    payload
  )
  VALUES (
    p_customer_id, v_customer.id, v_thread_id, v_message_id, v_actor.id,
    'confirmed', 'sent', p_client_attempt_id, char_length(v_body), left(v_body, 160), v_actor.role,
    jsonb_build_object('notification_ids', v_notification_ids)
  )
  RETURNING id INTO v_attempt_id;

  RETURN jsonb_build_object(
    'ok', true,
    'result', 'confirmed',
    'reason', 'sent',
    'attempt_id', v_attempt_id,
    'thread_id', v_thread_id,
    'message_id', v_message_id,
    'message_created_at', v_message_created_at,
    'notification_ids', v_notification_ids
  );
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.message_delivery_attempts (
    attempted_customer_id, actor_user_id, result, reason, client_attempt_id,
    body_length, body_preview, actor_role,
    payload
  )
  VALUES (
    p_customer_id, coalesce(v_actor.id, auth.uid()), 'rejected', 'sql_error', p_client_attempt_id,
    char_length(v_body), left(v_body, 160), v_actor.role,
    jsonb_build_object('sqlstate', SQLSTATE, 'message', SQLERRM)
  )
  RETURNING id INTO v_attempt_id;

  RETURN jsonb_build_object(
    'ok', false,
    'result', 'rejected',
    'reason', 'sql_error',
    'message', 'Kunde inte spara meddelandet. Försök igen.',
    'attempt_id', v_attempt_id
  );
END;
$$;

NOTIFY pgrst, 'reload schema';

REVOKE ALL ON FUNCTION public.send_message_with_notifications(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.send_message_with_notifications(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.send_message_with_notifications(uuid, text, text) TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'message_delivery_attempts'
    )
  THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.message_delivery_attempts;
  END IF;
END;
$$;
