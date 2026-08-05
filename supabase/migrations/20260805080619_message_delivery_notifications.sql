-- Message Delivery: create Message and new_message Notifications together.
--
-- Phase 1 keeps the current participants: admin, customer, customer_employee.
-- Cleaner access needs a participant model first so cleaners do not see broad
-- customer conversations accidentally.

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

  IF v_actor.role NOT IN ('admin', 'customer', 'customer_employee') THEN
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
    SELECT DISTINCT recipient.id, recipient.role
    FROM (
      SELECT u.id, u.role
      FROM public.users u
      WHERE v_actor.role = 'admin'
        AND u.id = v_customer.primary_contact_user_id
        AND u.id <> v_actor.id
        AND u.org_id = v_actor.org_id
        AND u.active

      UNION

      SELECT u.id, u.role
      FROM public.customer_employees ce
      JOIN public.users u ON u.id = ce.user_id
      WHERE v_actor.role = 'admin'
        AND ce.customer_id = p_customer_id
        AND u.id <> v_actor.id
        AND u.org_id = v_actor.org_id
        AND u.active

      UNION

      SELECT u.id, u.role
      FROM public.users u
      WHERE v_actor.role IN ('customer', 'customer_employee')
        AND u.role = 'admin'
        AND u.id <> v_actor.id
        AND u.org_id = v_actor.org_id
        AND u.active
    ) AS recipient
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
