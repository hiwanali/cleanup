-- CleanUp · säkerhetsförbättringar
-- 1. Åtgärda Supabase Security Advisor varningar
-- 2. Revokera execute på publika funktioner som inte ska vara RPC-tillgängliga
-- 3. Förbättra properties_customer vy utan SECURITY DEFINER

-- Ta bort SECURITY DEFINER från properties_customer (säkerhetsrisk enligt advisor)
DROP VIEW IF EXISTS public.properties_customer;
CREATE VIEW public.properties_customer AS
SELECT id, customer_id, name, address, area_sqm, notes, created_at, updated_at
FROM public.properties
WHERE id IN (SELECT public.accessible_property_ids());

-- Revokera RPC-åtkomst för interna funktioner som inte ska kallas via REST API
REVOKE EXECUTE ON FUNCTION public.generate_shifts_from_recurring(date, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.snapshot_checklist_for_shift(uuid) FROM anon;

-- RLS helper-funktioner behöver bara användas internt i policies, inte via RPC
REVOKE EXECUTE ON FUNCTION public.current_app_user() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.current_org_id() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.current_user_role() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.accessible_customer_ids() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.accessible_property_ids() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.is_cleaner() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.is_customer_role() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.shift_in_org(uuid) FROM authenticated;

-- Admin-endast funktioner
REVOKE EXECUTE ON FUNCTION public.generate_shifts_from_recurring(date, date) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.snapshot_checklist_for_shift(uuid) FROM authenticated;

-- Grant service_role för intern användning
GRANT EXECUTE ON FUNCTION public.generate_shifts_from_recurring(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.snapshot_checklist_for_shift(uuid) TO service_role;

-- Sätt säker search_path för alla funktioner
ALTER FUNCTION public.generate_shifts_from_recurring(date, date) SET search_path = public;
ALTER FUNCTION public.snapshot_checklist_for_shift(uuid) SET search_path = public;
ALTER FUNCTION public.current_app_user() SET search_path = public;
ALTER FUNCTION public.current_org_id() SET search_path = public;
ALTER FUNCTION public.current_user_role() SET search_path = public;
ALTER FUNCTION public.accessible_customer_ids() SET search_path = public;
ALTER FUNCTION public.accessible_property_ids() SET search_path = public;
ALTER FUNCTION public.is_admin() SET search_path = public;
ALTER FUNCTION public.is_cleaner() SET search_path = public;
ALTER FUNCTION public.is_customer_role() SET search_path = public;
ALTER FUNCTION public.shift_in_org(uuid) SET search_path = public;