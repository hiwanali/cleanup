-- Återställ EXECUTE för authenticated på RLS-hjälpfunktioner.
--
-- 20260529100600 revokerade dessa från authenticated för att dölja RPC i REST API,
-- men PostgreSQL kräver EXECUTE för att policies ska kunna anropa funktionerna.
-- Utan detta returnerar PostgREST 403 på alla tabeller som använder is_admin() m.fl.
--
-- Funktionerna förblir revokerade från anon (ingen oinloggad åtkomst).

GRANT EXECUTE ON FUNCTION public.current_app_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_org_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.accessible_customer_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.accessible_property_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_cleaner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_customer_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.shift_in_org(uuid) TO authenticated;
