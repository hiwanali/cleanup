-- Begränsa RPC: admin/cron-funktioner ska inte vara anon-anropbara
REVOKE EXECUTE ON FUNCTION public.current_app_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.current_org_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.current_user_role() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_cleaner() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_customer_role() FROM anon;
REVOKE EXECUTE ON FUNCTION public.accessible_customer_ids() FROM anon;
REVOKE EXECUTE ON FUNCTION public.accessible_property_ids() FROM anon;
REVOKE EXECUTE ON FUNCTION public.shift_in_org(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_shifts_from_recurring(date, date) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.snapshot_checklist_for_shift(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;

GRANT EXECUTE ON FUNCTION public.generate_shifts_from_recurring(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.snapshot_checklist_for_shift(uuid) TO service_role;

ALTER FUNCTION public.set_updated_at() SET search_path = public;
ALTER FUNCTION public.iso_weekday(date) SET search_path = public;
