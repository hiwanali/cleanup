-- CleanUp - harden public API surface after security review
--
-- Goals:
-- 1. Anonymous users should not have direct table/view privileges. Public
--    booking uses Edge Functions with service_role instead.
-- 2. Authenticated users do not need schema-level TRUNCATE/TRIGGER/REFERENCES.
-- 3. add_public_booking_service_checklist must never allow auth.uid() IS NULL.

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM authenticated;

REVOKE ALL PRIVILEGES ON public.properties_customer FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON public.cleaners_public FROM anon, authenticated;
GRANT SELECT ON public.properties_customer TO authenticated;
GRANT SELECT ON public.cleaners_public TO authenticated;

CREATE OR REPLACE FUNCTION public.add_public_booking_service_checklist(
  p_shift_id uuid,
  p_service_type text,
  p_addons jsonb DEFAULT '{}'::jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
BEGIN
  IF p_shift_id IS NULL THEN
    RETURN 0;
  END IF;

  IF NOT (v_jwt_role = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'admin required' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.shift_checklist_items sci
    WHERE sci.shift_id = p_shift_id
  ) THEN
    RETURN 0;
  END IF;

  INSERT INTO public.shift_checklist_items (shift_id, title, position)
  SELECT p_shift_id, i.title, i.item_position
  FROM public.public_booking_service_checklist_items(p_service_type, p_addons) i;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.add_public_booking_service_checklist(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_public_booking_service_checklist(uuid, text, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.public_booking_service_checklist_items(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.public_booking_service_checklist_items(text, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_customer_holiday(uuid, public.scope_type, uuid[], date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_customer_holiday(uuid, public.scope_type, uuid[], date, date, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.delete_customer_holiday(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_customer_holiday(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
