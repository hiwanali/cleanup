-- CleanUp security phase 1
--
-- Goal:
-- 1. Keep admin workflows working while blocking non-admin privilege escalation.
-- 2. Move customer self-profile updates to a narrow RPC.
-- 3. Move cleaner checklist toggles to a narrow RPC.
-- 4. Remove broad direct cleaner UPDATE policies on shifts and checklist rows.

CREATE OR REPLACE FUNCTION public.guard_users_self_safe_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role public.user_role;
BEGIN
  IF v_actor_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT u.role
  INTO v_actor_role
  FROM public.users u
  WHERE u.id = v_actor_id
    AND u.active;

  IF v_actor_id = OLD.id AND coalesce(v_actor_role::text, '') <> 'admin' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.org_id IS DISTINCT FROM OLD.org_id
      OR NEW.role IS DISTINCT FROM OLD.role
      OR NEW.email IS DISTINCT FROM OLD.email
      OR NEW.active IS DISTINCT FROM OLD.active
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'Only name and phone can be updated on your own profile'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_guard_self_safe_update ON public.users;
CREATE TRIGGER users_guard_self_safe_update
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_users_self_safe_update();

REVOKE ALL ON FUNCTION public.guard_users_self_safe_update() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_users_self_safe_update() TO service_role;

CREATE OR REPLACE FUNCTION public.update_own_profile(
  p_name text,
  p_phone text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%rowtype;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_updated public.users%rowtype;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'not_authenticated',
      'message', 'Sessionen behöver uppdateras. Logga in igen.'
    );
  END IF;

  SELECT *
  INTO v_actor
  FROM public.users
  WHERE id = auth.uid()
    AND active
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'invalid_user',
      'message', 'Kontot hittades inte eller är inte aktivt.'
    );
  END IF;

  IF v_actor.role NOT IN ('customer', 'customer_employee') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'forbidden',
      'message', 'Profilen kan inte uppdateras här.'
    );
  END IF;

  IF v_name IS NULL OR char_length(v_name) < 2 OR char_length(v_name) > 160 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'invalid_name',
      'message', 'Ange ett giltigt namn.'
    );
  END IF;

  IF v_phone IS NOT NULL AND char_length(v_phone) > 40 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'invalid_phone',
      'message', 'Telefonnumret är för långt.'
    );
  END IF;

  UPDATE public.users
  SET
    name = v_name,
    phone = v_phone,
    updated_at = now()
  WHERE id = v_actor.id
  RETURNING * INTO v_updated;

  RETURN jsonb_build_object(
    'ok', true,
    'user', to_jsonb(v_updated)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_own_profile(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_own_profile(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_own_profile(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.toggle_shift_checklist_item(
  p_item_id uuid,
  p_done boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%rowtype;
  v_shift public.shifts%rowtype;
  v_item public.shift_checklist_items%rowtype;
  v_updated public.shift_checklist_items%rowtype;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'not_authenticated',
      'message', 'Sessionen behöver uppdateras. Logga in igen.'
    );
  END IF;

  SELECT *
  INTO v_actor
  FROM public.users
  WHERE id = auth.uid()
    AND active;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'invalid_user',
      'message', 'Kontot hittades inte eller är inte aktivt.'
    );
  END IF;

  SELECT sci.*
  INTO v_item
  FROM public.shift_checklist_items sci
  WHERE sci.id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'not_found',
      'message', 'Checklistpunkten hittades inte.'
    );
  END IF;

  SELECT *
  INTO v_shift
  FROM public.shifts
  WHERE id = v_item.shift_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'shift_not_found',
      'message', 'Bokningen hittades inte.'
    );
  END IF;

  IF v_actor.role = 'admin' THEN
    IF NOT (
      v_shift.property_id IN (
        SELECT p.id
        FROM public.properties p
        JOIN public.customers c ON c.id = p.customer_id
        WHERE c.org_id = v_actor.org_id
      )
      AND v_shift.status NOT IN ('Borttaget', 'Avbokat')
    ) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'forbidden',
        'message', 'Du saknar behörighet att uppdatera checklistan.'
      );
    END IF;
  ELSIF v_actor.role = 'cleaner' THEN
    IF NOT (
      v_shift.cleaner_user_id = v_actor.id
      AND v_shift.status IN ('Pågående', 'Utfört')
    ) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'forbidden',
        'message', 'Du kan bara uppdatera checklistan på egna aktiva pass.'
      );
    END IF;
  ELSE
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'forbidden',
      'message', 'Du saknar behörighet att uppdatera checklistan.'
    );
  END IF;

  UPDATE public.shift_checklist_items
  SET
    done_at = CASE WHEN coalesce(p_done, false) THEN v_now ELSE NULL END,
    done_by_cleaner_user_id = CASE WHEN coalesce(p_done, false) THEN v_actor.id ELSE NULL END
  WHERE id = v_item.id
  RETURNING * INTO v_updated;

  RETURN jsonb_build_object(
    'ok', true,
    'item', to_jsonb(v_updated)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_shift_checklist_item(uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.toggle_shift_checklist_item(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.toggle_shift_checklist_item(uuid, boolean) TO authenticated, service_role;

DROP POLICY IF EXISTS shifts_cleaner_update ON public.shifts;
DROP POLICY IF EXISTS checklist_items_cleaner_write ON public.shift_checklist_items;

NOTIFY pgrst, 'reload schema';
