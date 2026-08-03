-- CleanUp - allow public booking RPC to add checklist via service-role.
--
-- The public booking Edge Function calls create_public_booking_request with the
-- service-role key. That RPC is SECURITY DEFINER and has no end-user auth.uid(),
-- so the previous "jwt role = service_role OR admin" check blocked priced
-- customer requests while trying to create the default cleaning checklist.
--
-- Direct anonymous access remains blocked by EXECUTE grants. Authenticated
-- non-admin users with auth.uid() are still rejected.

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
BEGIN
  IF p_shift_id IS NULL THEN
    RETURN 0;
  END IF;

  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
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

NOTIFY pgrst, 'reload schema';
