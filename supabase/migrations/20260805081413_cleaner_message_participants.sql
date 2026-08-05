-- Message Participants: allow assigned/pool cleaners into customer messages
-- without giving every cleaner access to every customer thread.

ALTER TYPE public.message_sender_role ADD VALUE IF NOT EXISTS 'cleaner';

CREATE OR REPLACE FUNCTION public.customer_has_message_cleaner(
  p_customer_id uuid,
  p_cleaner_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.customers c
    JOIN public.users u
      ON u.id = p_cleaner_user_id
     AND u.org_id = c.org_id
     AND u.role = 'cleaner'
     AND u.active
    WHERE c.id = p_customer_id
      AND EXISTS (
        SELECT 1
        FROM public.properties p
        WHERE p.customer_id = c.id
          AND (
            EXISTS (
              SELECT 1
              FROM public.property_cleaners pc
              WHERE pc.property_id = p.id
                AND pc.cleaner_user_id = p_cleaner_user_id
            )
            OR EXISTS (
              SELECT 1
              FROM public.shifts s
              WHERE s.property_id = p.id
                AND s.cleaner_user_id = p_cleaner_user_id
                AND s.end_at >= now() - interval '30 days'
            )
          )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.message_participants_for_customer(
  p_customer_id uuid
)
RETURNS TABLE(user_id uuid, role public.user_role)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH customer_row AS (
    SELECT c.*
    FROM public.customers c
    WHERE c.id = p_customer_id
  ),
  customer_properties AS (
    SELECT p.id
    FROM public.properties p
    JOIN customer_row c ON c.id = p.customer_id
  ),
  cleaner_ids AS (
    SELECT pc.cleaner_user_id AS user_id
    FROM public.property_cleaners pc
    JOIN customer_properties p ON p.id = pc.property_id

    UNION

    SELECT s.cleaner_user_id AS user_id
    FROM public.shifts s
    JOIN customer_properties p ON p.id = s.property_id
    WHERE s.cleaner_user_id IS NOT NULL
      AND s.end_at >= now() - interval '30 days'
  )
  SELECT DISTINCT u.id, u.role
  FROM public.users u
  JOIN customer_row c ON c.org_id = u.org_id
  WHERE u.active
    AND (
      u.role = 'admin'
      OR u.id = c.primary_contact_user_id
      OR EXISTS (
        SELECT 1
        FROM public.customer_employees ce
        WHERE ce.customer_id = c.id
          AND ce.user_id = u.id
      )
      OR EXISTS (
        SELECT 1
        FROM cleaner_ids ci
        WHERE ci.user_id = u.id
      )
    );
$$;

REVOKE ALL ON FUNCTION public.customer_has_message_cleaner(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.message_participants_for_customer(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.customer_has_message_cleaner(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.message_participants_for_customer(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.customer_has_message_cleaner(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.message_participants_for_customer(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS message_threads_select ON public.message_threads;
CREATE POLICY message_threads_select ON public.message_threads
  FOR SELECT TO authenticated
  USING (
    (public.is_admin() AND org_id = public.current_org_id())
    OR (public.is_customer_role() AND customer_id IN (SELECT public.accessible_customer_ids()))
    OR (public.is_cleaner() AND public.customer_has_message_cleaner(customer_id, (select auth.uid())))
  );

DROP POLICY IF EXISTS message_threads_insert ON public.message_threads;
CREATE POLICY message_threads_insert ON public.message_threads
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.current_org_id()
    AND (
      public.is_admin()
      OR (public.is_customer_role() AND customer_id IN (SELECT public.accessible_customer_ids()))
      OR (public.is_cleaner() AND public.customer_has_message_cleaner(customer_id, (select auth.uid())))
    )
  );

DROP POLICY IF EXISTS messages_select ON public.messages;
CREATE POLICY messages_select ON public.messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.message_threads t
      WHERE t.id = thread_id
        AND (
          (public.is_admin() AND t.org_id = public.current_org_id())
          OR (public.is_customer_role() AND t.customer_id IN (SELECT public.accessible_customer_ids()))
          OR (public.is_cleaner() AND public.customer_has_message_cleaner(t.customer_id, (select auth.uid())))
        )
    )
  );

DROP POLICY IF EXISTS messages_insert ON public.messages;
CREATE POLICY messages_insert ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_user_id = (select auth.uid())
    AND sender_role = public.current_user_role()::text::public.message_sender_role
    AND EXISTS (
      SELECT 1
      FROM public.message_threads t
      WHERE t.id = thread_id
        AND (
          (public.is_admin() AND t.org_id = public.current_org_id())
          OR (public.is_customer_role() AND t.customer_id IN (SELECT public.accessible_customer_ids()))
          OR (public.is_cleaner() AND public.customer_has_message_cleaner(t.customer_id, (select auth.uid())))
        )
    )
  );

CREATE OR REPLACE FUNCTION public.send_message_with_notifications(
  p_customer_id uuid,
  p_body text
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
  v_notification_ids uuid[] := '{}';
  v_body text := trim(coalesce(p_body, ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT *
  INTO v_actor
  FROM public.users
  WHERE id = auth.uid()
    AND active
  LIMIT 1;

  IF v_actor.id IS NULL THEN
    RAISE EXCEPTION 'Active user not found';
  END IF;

  IF v_actor.role NOT IN ('admin', 'customer', 'customer_employee', 'cleaner') THEN
    RAISE EXCEPTION 'Role cannot send customer messages';
  END IF;

  IF v_body = '' THEN
    RAISE EXCEPTION 'Message body required';
  END IF;

  IF char_length(v_body) > 4000 THEN
    RAISE EXCEPTION 'Message body too long';
  END IF;

  SELECT *
  INTO v_customer
  FROM public.customers
  WHERE id = p_customer_id
    AND org_id = v_actor.org_id
  LIMIT 1;

  IF v_customer.id IS NULL THEN
    RAISE EXCEPTION 'Customer not found';
  END IF;

  IF v_actor.role IN ('customer', 'customer_employee')
    AND NOT EXISTS (
      SELECT 1
      FROM public.accessible_customer_ids() AS ac(customer_id)
      WHERE ac.customer_id = p_customer_id
    )
  THEN
    RAISE EXCEPTION 'Customer not accessible';
  END IF;

  IF v_actor.role = 'cleaner'
    AND NOT public.customer_has_message_cleaner(p_customer_id, v_actor.id)
  THEN
    RAISE EXCEPTION 'Customer not accessible';
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

  RETURN jsonb_build_object(
    'thread_id', v_thread_id,
    'message_id', v_message_id,
    'notification_ids', v_notification_ids
  );
END;
$$;

REVOKE ALL ON FUNCTION public.send_message_with_notifications(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.send_message_with_notifications(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.send_message_with_notifications(uuid, text) TO authenticated, service_role;

ALTER FUNCTION public.send_message_with_notifications(uuid, text) SET search_path = public;
