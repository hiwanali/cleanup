-- Admin kan provisionera auth.users + public.users vid skapande av kundkonton (§7.7).
-- Anropas från klienten via RPC när admin skapar kund/huvudkontakt.

CREATE OR REPLACE FUNCTION public.admin_provision_user(
  p_user_id uuid,
  p_org_id uuid,
  p_role public.user_role,
  p_name text,
  p_email text,
  p_phone text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS DISTINCT FROM public.current_org_id() THEN
    RAISE EXCEPTION 'org mismatch' USING ERRCODE = '42501';
  END IF;

  PERFORM private.seed_auth_user(
    p_user_id,
    lower(trim(p_email)),
    p_role,
    p_org_id,
    trim(p_name),
    nullif(trim(p_phone), '')
  );

  RETURN p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_provision_user(uuid, uuid, public.user_role, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_provision_user(uuid, uuid, public.user_role, text, text, text) TO authenticated;
