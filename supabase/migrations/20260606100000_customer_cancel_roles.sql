-- CleanUp · Kundanställd får avboka pass (>48h hanteras i appen) + gemensam kalender
--
-- Utökar shifts_customer_cancel från enbart huvudkontakt till alla kundroller
-- (customer + customer_employee) via is_customer_role().

DROP POLICY IF EXISTS shifts_customer_cancel ON public.shifts;

CREATE POLICY shifts_customer_cancel ON public.shifts
  FOR UPDATE TO authenticated
  USING (
    public.is_customer_role()
    AND property_id IN (SELECT public.accessible_property_ids())
  )
  WITH CHECK (
    public.is_customer_role()
    AND property_id IN (SELECT public.accessible_property_ids())
  );
