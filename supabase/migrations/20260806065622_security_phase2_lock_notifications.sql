-- CleanUp security phase 2
--
-- Harden notification creation. The old insert_notifications RPC accepted any
-- kind/payload for any active recipient in the caller's org. This version keeps
-- legacy frontend flows working but validates kind, recipient relationship, and
-- target_path. Message notifications remain owned by send_message_with_notifications.

CREATE OR REPLACE FUNCTION public.insert_notifications(p_rows jsonb)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%rowtype;
  v_row jsonb;
  v_recipient public.users%rowtype;
  v_recipient_id uuid;
  v_kind text;
  v_payload jsonb;
  v_sanitized_payload jsonb;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_new_id uuid;
  v_count int;
  v_target text;
  v_shift_id uuid;
  v_shift_row_id uuid;
  v_shift_cleaner_user_id uuid;
  v_property_id uuid;
  v_customer_id uuid;
  v_resource_org_id uuid;
  v_uuid_re text := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  v_allowed_kinds text[] := ARRAY[
    'sick_reported',
    'assigned_shift',
    'shift_approved',
    'unassigned_shift',
    'cleaner_swapped',
    'time_adjusted',
    'customer_cancelled',
    'admin_deleted',
    'paused_by_holiday',
    'holiday_created',
    'holiday_removed',
    'incident_created',
    'incident_resolved',
    'incident_in_progress',
    'shift_will_be_missed',
    'shift_request_created',
    'customer_booking_request'
  ];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_actor
  FROM public.users
  WHERE id = auth.uid()
    AND active;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid user' USING ERRCODE = '42501';
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
    v_recipient_id := NULL;
    v_kind := NULLIF(trim(v_row->>'kind'), '');
    v_payload := COALESCE(v_row->'payload', '{}'::jsonb);
    v_sanitized_payload := v_payload - 'target_path';
    v_shift_id := NULL;
    v_shift_row_id := NULL;
    v_shift_cleaner_user_id := NULL;
    v_property_id := NULL;
    v_customer_id := NULL;
    v_resource_org_id := NULL;

    IF NULLIF(trim(v_row->>'recipient_user_id'), '') ~* v_uuid_re THEN
      v_recipient_id := NULLIF(trim(v_row->>'recipient_user_id'), '')::uuid;
    END IF;

    IF v_recipient_id IS NULL OR v_kind IS NULL THEN
      RAISE EXCEPTION 'Invalid notification row: recipient_user_id and kind required';
    END IF;

    IF NOT (v_kind = ANY (v_allowed_kinds)) THEN
      RAISE EXCEPTION 'Notification kind is not allowed: %', v_kind USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_recipient
    FROM public.users
    WHERE id = v_recipient_id
      AND org_id = v_actor.org_id
      AND active;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Recipient not in organization' USING ERRCODE = '42501';
    END IF;

    IF NULLIF(trim(v_payload->>'shift_id'), '') ~* v_uuid_re THEN
      v_shift_id := NULLIF(trim(v_payload->>'shift_id'), '')::uuid;

      SELECT s.id, s.cleaner_user_id, s.property_id
      INTO v_shift_row_id, v_shift_cleaner_user_id, v_property_id
      FROM public.shifts s
      WHERE s.id = v_shift_id;
    END IF;

    IF v_property_id IS NULL AND NULLIF(trim(v_payload->>'property_id'), '') ~* v_uuid_re THEN
      v_property_id := NULLIF(trim(v_payload->>'property_id'), '')::uuid;
    END IF;

    IF v_customer_id IS NULL AND NULLIF(trim(v_payload->>'customer_id'), '') ~* v_uuid_re THEN
      v_customer_id := NULLIF(trim(v_payload->>'customer_id'), '')::uuid;
    END IF;

    IF v_property_id IS NOT NULL THEN
      SELECT p.customer_id, c.org_id
      INTO v_customer_id, v_resource_org_id
      FROM public.properties p
      JOIN public.customers c ON c.id = p.customer_id
      WHERE p.id = v_property_id;
    ELSIF v_customer_id IS NOT NULL THEN
      SELECT c.org_id
      INTO v_resource_org_id
      FROM public.customers c
      WHERE c.id = v_customer_id;
    END IF;

    IF v_resource_org_id IS NOT NULL AND v_resource_org_id IS DISTINCT FROM v_actor.org_id THEN
      RAISE EXCEPTION 'Notification resource is outside organization' USING ERRCODE = '42501';
    END IF;

    IF v_actor.role <> 'admin' THEN
      IF v_recipient.role = 'admin' THEN
        NULL;
      ELSIF v_shift_id IS NOT NULL AND v_shift_row_id IS NOT NULL THEN
        IF v_actor.role = 'cleaner' AND v_shift_cleaner_user_id IS DISTINCT FROM v_actor.id THEN
          RAISE EXCEPTION 'Caller cannot notify for this shift' USING ERRCODE = '42501';
        END IF;

        IF v_actor.role IN ('customer', 'customer_employee')
          AND NOT (v_property_id IN (SELECT public.accessible_property_ids()))
        THEN
          RAISE EXCEPTION 'Caller cannot notify for this shift' USING ERRCODE = '42501';
        END IF;

        IF v_recipient.role = 'cleaner' AND v_shift_cleaner_user_id IS DISTINCT FROM v_recipient.id THEN
          RAISE EXCEPTION 'Recipient is not assigned to this shift' USING ERRCODE = '42501';
        END IF;

        IF v_recipient.role IN ('customer', 'customer_employee') AND NOT EXISTS (
          SELECT 1
          FROM public.customers c
          WHERE c.id = v_customer_id
            AND (
              c.primary_contact_user_id = v_recipient.id
              OR EXISTS (
                SELECT 1
                FROM public.customer_employees ce
                LEFT JOIN public.customer_employee_properties cep
                  ON cep.customer_employee_id = ce.id
                WHERE ce.customer_id = c.id
                  AND ce.user_id = v_recipient.id
                  AND (
                    ce.scope = 'all_properties'
                    OR cep.property_id = v_property_id
                  )
              )
            )
        ) THEN
          RAISE EXCEPTION 'Recipient is not linked to this shift' USING ERRCODE = '42501';
        END IF;
      ELSE
        RAISE EXCEPTION 'Non-admin notifications require an admin recipient or linked shift' USING ERRCODE = '42501';
      END IF;
    END IF;

    v_target := NULLIF(trim(v_payload->>'target_path'), '');
    IF v_target IS NOT NULL THEN
      IF left(v_target, 2) = '#/' THEN
        v_target := substring(v_target from 2);
      ELSIF left(v_target, 1) <> '/' THEN
        v_target := NULL;
      END IF;

      IF v_target IS NOT NULL AND NOT (
        (v_recipient.role = 'admin' AND v_target LIKE '/admin/%')
        OR (v_recipient.role = 'cleaner' AND v_target LIKE '/stadare/%')
        OR (v_recipient.role IN ('customer', 'customer_employee') AND v_target LIKE '/kund/%')
      ) THEN
        v_target := NULL;
      END IF;

      IF v_target IS NOT NULL THEN
        v_sanitized_payload := jsonb_set(v_sanitized_payload, '{target_path}', to_jsonb(v_target), true);
      END IF;
    END IF;

    INSERT INTO public.notifications (recipient_user_id, channel, kind, payload)
    VALUES (v_recipient.id, 'in_app', v_kind, v_sanitized_payload)
    RETURNING id INTO v_new_id;

    v_ids := array_append(v_ids, v_new_id);
  END LOOP;

  RETURN v_ids;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_notifications(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.insert_notifications(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.insert_notifications(jsonb) TO authenticated, service_role;

DROP POLICY IF EXISTS notifications_insert ON public.notifications;
REVOKE INSERT ON public.notifications FROM authenticated;
REVOKE DELETE ON public.notifications FROM authenticated;

NOTIFY pgrst, 'reload schema';
