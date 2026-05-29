-- CleanUp · RLS (mvpfinal.md §5 sammanfattning)

-- ---------------------------------------------------------------------------
-- Helper functions (security definer – läs profil trots RLS på users)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_app_user()
RETURNS public.users
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.users u WHERE u.id = auth.uid() AND u.active LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM public.users WHERE id = auth.uid() AND active LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.users WHERE id = auth.uid() AND active LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND active AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_cleaner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND active AND role = 'cleaner'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_customer_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND active
      AND role IN ('customer', 'customer_employee')
  );
$$;

-- Kund-id för inloggad kund/huvudkontakt eller kundanställd
CREATE OR REPLACE FUNCTION public.accessible_customer_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id
  FROM public.customers c
  WHERE c.primary_contact_user_id = auth.uid()
  UNION
  SELECT ce.customer_id
  FROM public.customer_employees ce
  WHERE ce.user_id = auth.uid();
$$;

-- Objekt som användaren får se (kund + kundanställd med scope)
CREATE OR REPLACE FUNCTION public.accessible_property_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id
  FROM public.properties p
  JOIN public.customers c ON c.id = p.customer_id
  WHERE c.primary_contact_user_id = auth.uid()
  UNION
  SELECT p.id
  FROM public.properties p
  JOIN public.customer_employees ce ON ce.customer_id = p.customer_id
  WHERE ce.user_id = auth.uid()
    AND ce.scope = 'all_properties'
  UNION
  SELECT cep.property_id
  FROM public.customer_employee_properties cep
  JOIN public.customer_employees ce ON ce.id = cep.customer_employee_id
  WHERE ce.user_id = auth.uid()
    AND ce.scope = 'selected'
  UNION
  -- Städare: objekt med egna pass eller i baspool
  SELECT DISTINCT s.property_id
  FROM public.shifts s
  WHERE s.cleaner_user_id = auth.uid()
  UNION
  SELECT pc.property_id
  FROM public.property_cleaners pc
  WHERE pc.cleaner_user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.shift_in_org(p_shift_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.shifts s
    JOIN public.properties p ON p.id = s.property_id
    JOIN public.customers c ON c.id = p.customer_id
    WHERE s.id = p_shift_id
      AND c.org_id = public.current_org_id()
  );
$$;

REVOKE ALL ON FUNCTION public.current_app_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_org_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_cleaner() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_customer_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accessible_customer_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accessible_property_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shift_in_org(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.current_app_user() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_org_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_cleaner() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_customer_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accessible_customer_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accessible_property_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.shift_in_org(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_employee_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_cleaners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleaning_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_holiday_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
CREATE POLICY organizations_select ON public.organizations
  FOR SELECT TO authenticated
  USING (id = public.current_org_id());

CREATE POLICY organizations_admin_write ON public.organizations
  FOR ALL TO authenticated
  USING (public.is_admin() AND id = public.current_org_id())
  WITH CHECK (public.is_admin() AND id = public.current_org_id());

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE POLICY users_select ON public.users
  FOR SELECT TO authenticated
  USING (
    (public.is_admin() AND org_id = public.current_org_id())
    OR id = auth.uid()
    OR (
      public.is_customer_role()
      AND role IN ('customer', 'customer_employee', 'admin')
      AND org_id = public.current_org_id()
    )
    OR (
      public.is_cleaner()
      AND (
        id = auth.uid()
        OR role = 'admin'
        OR id IN (
          SELECT DISTINCT s.cleaner_user_id
          FROM public.shifts s
          WHERE s.property_id IN (SELECT public.accessible_property_ids())
            AND s.cleaner_user_id IS NOT NULL
        )
      )
      AND org_id = public.current_org_id()
    )
  );

-- Kund ska inte läsa cleaner PII: begränsa kolumner via cleaners_public-vy i klienten.
-- Admin kan uppdatera profiler i org
CREATE POLICY users_admin_write ON public.users
  FOR ALL TO authenticated
  USING (public.is_admin() AND org_id = public.current_org_id())
  WITH CHECK (public.is_admin() AND org_id = public.current_org_id());

CREATE POLICY users_self_update ON public.users
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------
CREATE POLICY customers_select ON public.customers
  FOR SELECT TO authenticated
  USING (
    (public.is_admin() AND org_id = public.current_org_id())
    OR (public.is_customer_role() AND id IN (SELECT public.accessible_customer_ids()))
  );

CREATE POLICY customers_admin_write ON public.customers
  FOR ALL TO authenticated
  USING (public.is_admin() AND org_id = public.current_org_id())
  WITH CHECK (public.is_admin() AND org_id = public.current_org_id());

-- ---------------------------------------------------------------------------
-- customer_employees
-- ---------------------------------------------------------------------------
CREATE POLICY customer_employees_select ON public.customer_employees
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR customer_id IN (SELECT public.accessible_customer_ids())
  );

CREATE POLICY customer_employees_admin_write ON public.customer_employees
  FOR ALL TO authenticated
  USING (
    public.is_admin()
    OR (
      public.current_user_role() = 'customer'
      AND customer_id IN (SELECT public.accessible_customer_ids())
    )
  )
  WITH CHECK (
    public.is_admin()
    OR (
      public.current_user_role() = 'customer'
      AND customer_id IN (SELECT public.accessible_customer_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- customer_employee_properties
-- ---------------------------------------------------------------------------
CREATE POLICY cep_select ON public.customer_employee_properties
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR property_id IN (SELECT public.accessible_property_ids())
  );

CREATE POLICY cep_write ON public.customer_employee_properties
  FOR ALL TO authenticated
  USING (public.is_admin() OR public.current_user_role() = 'customer')
  WITH CHECK (public.is_admin() OR public.current_user_role() = 'customer');

-- ---------------------------------------------------------------------------
-- properties (kund: använd properties_customer-vyn)
-- ---------------------------------------------------------------------------
CREATE POLICY properties_select ON public.properties
  FOR SELECT TO authenticated
  USING (
    (public.is_admin() AND customer_id IN (
      SELECT id FROM public.customers WHERE org_id = public.current_org_id()
    ))
    OR id IN (SELECT public.accessible_property_ids())
  );

CREATE POLICY properties_admin_write ON public.properties
  FOR ALL TO authenticated
  USING (
    public.is_admin()
    AND customer_id IN (SELECT id FROM public.customers WHERE org_id = public.current_org_id())
  )
  WITH CHECK (
    public.is_admin()
    AND customer_id IN (SELECT id FROM public.customers WHERE org_id = public.current_org_id())
  );

-- ---------------------------------------------------------------------------
-- property_cleaners
-- ---------------------------------------------------------------------------
CREATE POLICY property_cleaners_select ON public.property_cleaners
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR property_id IN (SELECT public.accessible_property_ids())
  );

CREATE POLICY property_cleaners_admin_write ON public.property_cleaners
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- recurring_schedules
-- ---------------------------------------------------------------------------
CREATE POLICY recurring_select ON public.recurring_schedules
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR property_id IN (SELECT public.accessible_property_ids())
  );

CREATE POLICY recurring_admin_write ON public.recurring_schedules
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- shifts
-- ---------------------------------------------------------------------------
CREATE POLICY shifts_select ON public.shifts
  FOR SELECT TO authenticated
  USING (
    (public.is_admin() AND property_id IN (
      SELECT p.id FROM public.properties p
      JOIN public.customers c ON c.id = p.customer_id
      WHERE c.org_id = public.current_org_id()
    ))
    OR (public.is_cleaner() AND cleaner_user_id = auth.uid())
    OR (
      public.is_customer_role()
      AND property_id IN (SELECT public.accessible_property_ids())
    )
  );

CREATE POLICY shifts_admin_write ON public.shifts
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY shifts_cleaner_update ON public.shifts
  FOR UPDATE TO authenticated
  USING (public.is_cleaner() AND cleaner_user_id = auth.uid())
  WITH CHECK (public.is_cleaner() AND cleaner_user_id = auth.uid());

CREATE POLICY shifts_customer_cancel ON public.shifts
  FOR UPDATE TO authenticated
  USING (
    public.current_user_role() = 'customer'
    AND property_id IN (SELECT public.accessible_property_ids())
  )
  WITH CHECK (
    public.current_user_role() = 'customer'
    AND property_id IN (SELECT public.accessible_property_ids())
  );

-- ---------------------------------------------------------------------------
-- shift_events
-- ---------------------------------------------------------------------------
CREATE POLICY shift_events_select ON public.shift_events
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (public.is_cleaner() AND public.shift_in_org(shift_id) AND EXISTS (
      SELECT 1 FROM public.shifts s WHERE s.id = shift_id AND s.cleaner_user_id = auth.uid()
    ))
    OR (public.is_customer_role() AND public.shift_in_org(shift_id))
  );

CREATE POLICY shift_events_insert ON public.shift_events
  FOR INSERT TO authenticated
  WITH CHECK (
    actor_user_id = auth.uid()
    AND (
      public.is_admin()
      OR public.is_cleaner()
      OR public.current_user_role() = 'customer'
    )
  );

-- ---------------------------------------------------------------------------
-- cleaning_checklists
-- ---------------------------------------------------------------------------
CREATE POLICY checklists_select ON public.cleaning_checklists
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR property_id IN (SELECT public.accessible_property_ids())
  );

CREATE POLICY checklists_admin_write ON public.cleaning_checklists
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- shift_checklist_items
-- ---------------------------------------------------------------------------
CREATE POLICY checklist_items_select ON public.shift_checklist_items
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.shifts s
      WHERE s.id = shift_id
        AND (
          s.cleaner_user_id = auth.uid()
          OR s.property_id IN (SELECT public.accessible_property_ids())
        )
    )
  );

CREATE POLICY checklist_items_cleaner_write ON public.shift_checklist_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.shifts s
      WHERE s.id = shift_id AND s.cleaner_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.shifts s
      WHERE s.id = shift_id AND s.cleaner_user_id = auth.uid()
    )
  );

CREATE POLICY checklist_items_admin_write ON public.shift_checklist_items
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- customer_holidays
-- ---------------------------------------------------------------------------
CREATE POLICY holidays_select ON public.customer_holidays
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR customer_id IN (SELECT public.accessible_customer_ids())
  );

CREATE POLICY holidays_customer_write ON public.customer_holidays
  FOR ALL TO authenticated
  USING (
    public.is_admin()
    OR (
      public.current_user_role() = 'customer'
      AND customer_id IN (SELECT public.accessible_customer_ids())
    )
  )
  WITH CHECK (
    public.is_admin()
    OR (
      public.current_user_role() = 'customer'
      AND created_by_user_id = auth.uid()
      AND customer_id IN (SELECT public.accessible_customer_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- customer_holiday_properties
-- ---------------------------------------------------------------------------
CREATE POLICY holiday_props_select ON public.customer_holiday_properties
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR property_id IN (SELECT public.accessible_property_ids())
  );

CREATE POLICY holiday_props_write ON public.customer_holiday_properties
  FOR ALL TO authenticated
  USING (public.is_admin() OR public.current_user_role() = 'customer')
  WITH CHECK (public.is_admin() OR public.current_user_role() = 'customer');

-- ---------------------------------------------------------------------------
-- incidents
-- ---------------------------------------------------------------------------
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
      AND kind = 'customer_complaint'
      AND property_id IN (SELECT public.accessible_property_ids())
    )
  );

CREATE POLICY incidents_insert ON public.incidents
  FOR INSERT TO authenticated
  WITH CHECK (
    reported_by_user_id = auth.uid()
    AND org_id = public.current_org_id()
    AND (
      (public.is_cleaner() AND kind = 'cleaner_issue')
      OR (
        public.current_user_role() = 'customer'
        AND kind = 'customer_complaint'
      )
    )
  );

CREATE POLICY incidents_admin_write ON public.incidents
  FOR UPDATE TO authenticated
  USING (public.is_admin() AND org_id = public.current_org_id())
  WITH CHECK (public.is_admin() AND org_id = public.current_org_id());

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
CREATE POLICY notifications_select ON public.notifications
  FOR SELECT TO authenticated
  USING (recipient_user_id = auth.uid());

CREATE POLICY notifications_update ON public.notifications
  FOR UPDATE TO authenticated
  USING (recipient_user_id = auth.uid())
  WITH CHECK (recipient_user_id = auth.uid());

CREATE POLICY notifications_insert ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() OR recipient_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Views: grant select
-- ---------------------------------------------------------------------------
GRANT SELECT ON public.properties_customer TO authenticated;
GRANT SELECT ON public.cleaners_public TO authenticated;

-- Service role bypasses RLS; authenticated uses policies above.
