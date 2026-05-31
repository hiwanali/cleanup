-- CleanUp · Säkerhetsgenomgång efter lansering
--
-- 1. shift_events_select: kundroller fick läsa in-/utcheckningshändelser för ALLA
--    pass i organisationen (shift_in_org). Begränsas till egna objekt
--    (accessible_property_ids) så en kund inte ser andra kunders städhändelser.
-- 2. incidents_select: kund/kundanställd ska se både egna reklamationer
--    (customer_complaint) OCH städar-rapporterade avvikelser (cleaner_issue)
--    på sina egna objekt. Kund-PII för städare döljs fortsatt i klienten ("Städare").
-- 3. properties_customer: sätt security_invoker (advisor ERROR security_definer_view).
-- 4. Revokera EXECUTE för anon på SECURITY DEFINER-funktioner (advisor WARN).
-- 5. Sätt search_path på funktioner som saknar det (advisor WARN).

-- ---------------------------------------------------------------------------
-- 1. shift_events_select — kund begränsas till egna objekt
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS shift_events_select ON public.shift_events;

CREATE POLICY shift_events_select ON public.shift_events
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (
      public.is_cleaner()
      AND public.shift_in_org(shift_id)
      AND EXISTS (
        SELECT 1 FROM public.shifts s
        WHERE s.id = shift_id AND s.cleaner_user_id = auth.uid()
      )
    )
    OR (
      public.is_customer_role()
      AND EXISTS (
        SELECT 1 FROM public.shifts s
        WHERE s.id = shift_id
          AND s.property_id IN (SELECT public.accessible_property_ids())
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 2. incidents_select — kund ser både reklamationer och städaravvikelser på egna objekt
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS incidents_select ON public.incidents;

CREATE POLICY incidents_select ON public.incidents
  FOR SELECT TO authenticated
  USING (
    (public.is_admin() AND org_id = public.current_org_id())
    OR reported_by_user_id = auth.uid()
    OR (
      public.is_cleaner()
      AND EXISTS (
        SELECT 1 FROM public.shifts s
        WHERE s.id = shift_id AND s.cleaner_user_id = auth.uid()
      )
    )
    OR (
      public.is_customer_role()
      AND property_id IN (SELECT public.accessible_property_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- 3. properties_customer — security_invoker (RLS på properties gäller anroparen)
-- ---------------------------------------------------------------------------
ALTER VIEW public.properties_customer SET (security_invoker = true);

-- ---------------------------------------------------------------------------
-- 4. Revokera anon-EXECUTE på SECURITY DEFINER-funktioner
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.admin_provision_user(uuid, uuid, public.user_role, text, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_shifts_from_recurring(date, date) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.snapshot_checklist_for_shift(uuid) FROM anon, PUBLIC;

-- ---------------------------------------------------------------------------
-- 5. Sätt säker search_path där det saknas
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.is_last_weekday_of_month(date, smallint) SET search_path = public;
ALTER FUNCTION public.recurring_matches_date(date, smallint, text) SET search_path = public;
