-- CleanUp · Kundanställd: samma möjligheter som huvudkontakt för ledighet och reklamation

DROP POLICY IF EXISTS holidays_customer_write ON public.customer_holidays;
CREATE POLICY holidays_customer_write ON public.customer_holidays
  FOR ALL TO authenticated
  USING (
    public.is_admin()
    OR (
      public.is_customer_role()
      AND customer_id IN (SELECT public.accessible_customer_ids())
    )
  )
  WITH CHECK (
    public.is_admin()
    OR (
      public.is_customer_role()
      AND created_by_user_id = auth.uid()
      AND customer_id IN (SELECT public.accessible_customer_ids())
    )
  );

DROP POLICY IF EXISTS holiday_props_write ON public.customer_holiday_properties;
CREATE POLICY holiday_props_write ON public.customer_holiday_properties
  FOR ALL TO authenticated
  USING (public.is_admin() OR public.is_customer_role())
  WITH CHECK (public.is_admin() OR public.is_customer_role());

DROP POLICY IF EXISTS incidents_insert ON public.incidents;
CREATE POLICY incidents_insert ON public.incidents
  FOR INSERT TO authenticated
  WITH CHECK (
    reported_by_user_id = auth.uid()
    AND org_id = public.current_org_id()
    AND (
      (public.is_cleaner() AND kind = 'cleaner_issue')
      OR (
        public.is_customer_role()
        AND kind = 'customer_complaint'
      )
    )
  );
