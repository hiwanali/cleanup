-- CleanUp · Fix: kund/kundanställd kunde inte se sina objekt (och därmed schema)
--
-- Bakgrund:
--   * properties_select (RLS på basbordet) tillåter AVSIKTLIGT inte kundroller att
--     läsa public.properties direkt – annars skulle de kunna läsa access_info
--     (nyckel/larm), vilket bryter mot §5/§7.5. Kundroller läser objekt via vyn
--     public.properties_customer som saknar access_info och filtrerar på
--     accessible_property_ids().
--   * Migration 20260531230000 satte security_invoker = true på vyn för att tysta
--     advisorn "security_definer_view". Det fick vyn att tillämpa basbordets RLS
--     för den inloggade kunden -> RLS nekar -> vyn returnerade 0 rader.
--     Resultat: kunder/kundanställda såg inga objekt eller städscheman.
--
-- Lösning:
--   Återställ vyn till en SECURITY DEFINER-vy (security_invoker = false). Vyn
--   begränsar själv raderna via accessible_property_ids() och exponerar aldrig
--   access_info, så den är säker. Advisor-varningen "security_definer_view" är här
--   avsiktlig och accepterad – den är förutsättningen för att dölja access_info för
--   kundroller samtidigt som objekten visas.

DROP VIEW IF EXISTS public.properties_customer;

CREATE VIEW public.properties_customer
WITH (security_invoker = false) AS
SELECT id, customer_id, name, address, area_sqm, notes, created_at, updated_at
FROM public.properties
WHERE id IN (SELECT public.accessible_property_ids());

REVOKE ALL ON public.properties_customer FROM anon;
GRANT SELECT ON public.properties_customer TO authenticated;

COMMENT ON VIEW public.properties_customer IS
  'Objekt utan access_info för kundroller. SECURITY DEFINER-vy som filtrerar via accessible_property_ids() – avsiktligt för att dölja access_info samtidigt som objekt visas.';
