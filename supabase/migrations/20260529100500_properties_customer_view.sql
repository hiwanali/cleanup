-- Kundroller läser objekt via vy (utan access_info)

DROP VIEW IF EXISTS public.properties_customer;
CREATE VIEW public.properties_customer AS
SELECT id, customer_id, name, address, area_sqm, notes, created_at, updated_at
FROM public.properties
WHERE id IN (SELECT public.accessible_property_ids());

REVOKE ALL ON public.properties_customer FROM anon;
GRANT SELECT ON public.properties_customer TO authenticated;

DROP POLICY IF EXISTS properties_select ON public.properties;
CREATE POLICY properties_select ON public.properties FOR SELECT TO authenticated USING (
  (public.is_admin() AND customer_id IN (
    SELECT id FROM public.customers WHERE org_id = public.current_org_id()
  ))
  OR (public.is_cleaner() AND id IN (SELECT public.accessible_property_ids()))
);
