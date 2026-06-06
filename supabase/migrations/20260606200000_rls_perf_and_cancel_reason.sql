-- CleanUp · RLS initplan-optimering + cancel_reason + FK-index
--
-- 1. Ersätter auth.uid() med (select auth.uid()) i hjälpfunktioner och policies
--    (Supabase performance advisor: undvik per-rad re-evaluering av auth.uid()).
-- 2. Lägger till shifts.cancel_reason (används vid kundavbokning).
-- 3. Index på FK-kolumner som används i schema/rapporter.

-- ---------------------------------------------------------------------------
-- 1. Helper functions — (select auth.uid()) för initplan
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_app_user()
RETURNS public.users
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.users u WHERE u.id = (select auth.uid()) AND u.active LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM public.users WHERE id = (select auth.uid()) AND active LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.users WHERE id = (select auth.uid()) AND active LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users WHERE id = (select auth.uid()) AND active AND role = 'admin'
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
    SELECT 1 FROM public.users WHERE id = (select auth.uid()) AND active AND role = 'cleaner'
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
    WHERE id = (select auth.uid())
      AND active
      AND role IN ('customer', 'customer_employee')
  );
$$;

CREATE OR REPLACE FUNCTION public.accessible_customer_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id
  FROM public.customers c
  WHERE c.primary_contact_user_id = (select auth.uid())
  UNION
  SELECT ce.customer_id
  FROM public.customer_employees ce
  WHERE ce.user_id = (select auth.uid());
$$;

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
  WHERE c.primary_contact_user_id = (select auth.uid())
  UNION
  SELECT p.id
  FROM public.properties p
  JOIN public.customer_employees ce ON ce.customer_id = p.customer_id
  WHERE ce.user_id = (select auth.uid())
    AND ce.scope = 'all_properties'
  UNION
  SELECT cep.property_id
  FROM public.customer_employee_properties cep
  JOIN public.customer_employees ce ON ce.id = cep.customer_employee_id
  WHERE ce.user_id = (select auth.uid())
    AND ce.scope = 'selected'
  UNION
  SELECT DISTINCT s.property_id
  FROM public.shifts s
  WHERE s.cleaner_user_id = (select auth.uid())
  UNION
  SELECT pc.property_id
  FROM public.property_cleaners pc
  WHERE pc.cleaner_user_id = (select auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- 2. Policies med direkt auth.uid() — (select auth.uid())
-- ---------------------------------------------------------------------------

-- users
DROP POLICY IF EXISTS users_select ON public.users;
CREATE POLICY users_select ON public.users
  FOR SELECT TO authenticated
  USING (
    (public.is_admin() AND org_id = public.current_org_id())
    OR id = (select auth.uid())
    OR (
      public.is_customer_role()
      AND role IN ('customer', 'customer_employee', 'admin')
      AND org_id = public.current_org_id()
    )
    OR (
      public.is_cleaner()
      AND (
        id = (select auth.uid())
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

DROP POLICY IF EXISTS users_self_update ON public.users;
CREATE POLICY users_self_update ON public.users
  FOR UPDATE TO authenticated
  USING (id = (select auth.uid()))
  WITH CHECK (id = (select auth.uid()));

-- shifts
DROP POLICY IF EXISTS shifts_select ON public.shifts;
CREATE POLICY shifts_select ON public.shifts
  FOR SELECT TO authenticated
  USING (
    (public.is_admin() AND property_id IN (
      SELECT p.id FROM public.properties p
      JOIN public.customers c ON c.id = p.customer_id
      WHERE c.org_id = public.current_org_id()
    ))
    OR (public.is_cleaner() AND cleaner_user_id = (select auth.uid()))
    OR (
      public.is_customer_role()
      AND property_id IN (SELECT public.accessible_property_ids())
    )
  );

DROP POLICY IF EXISTS shifts_cleaner_update ON public.shifts;
CREATE POLICY shifts_cleaner_update ON public.shifts
  FOR UPDATE TO authenticated
  USING (public.is_cleaner() AND cleaner_user_id = (select auth.uid()))
  WITH CHECK (public.is_cleaner() AND cleaner_user_id = (select auth.uid()));

-- shift_events (security_access_review-version)
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
        WHERE s.id = shift_id AND s.cleaner_user_id = (select auth.uid())
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

DROP POLICY IF EXISTS shift_events_insert ON public.shift_events;
CREATE POLICY shift_events_insert ON public.shift_events
  FOR INSERT TO authenticated
  WITH CHECK (
    actor_user_id = (select auth.uid())
    AND (
      public.is_admin()
      OR public.is_cleaner()
      OR public.is_customer_role()
    )
  );

-- shift_checklist_items
DROP POLICY IF EXISTS checklist_items_select ON public.shift_checklist_items;
CREATE POLICY checklist_items_select ON public.shift_checklist_items
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.shifts s
      WHERE s.id = shift_id
        AND (
          s.cleaner_user_id = (select auth.uid())
          OR s.property_id IN (SELECT public.accessible_property_ids())
        )
    )
  );

DROP POLICY IF EXISTS checklist_items_cleaner_write ON public.shift_checklist_items;
CREATE POLICY checklist_items_cleaner_write ON public.shift_checklist_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.shifts s
      WHERE s.id = shift_id AND s.cleaner_user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.shifts s
      WHERE s.id = shift_id AND s.cleaner_user_id = (select auth.uid())
    )
  );

-- customer_holidays (kundroller via is_customer_role)
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
      AND created_by_user_id = (select auth.uid())
      AND customer_id IN (SELECT public.accessible_customer_ids())
    )
  );

-- incidents (security_access_review-version)
DROP POLICY IF EXISTS incidents_select ON public.incidents;
CREATE POLICY incidents_select ON public.incidents
  FOR SELECT TO authenticated
  USING (
    (public.is_admin() AND org_id = public.current_org_id())
    OR reported_by_user_id = (select auth.uid())
    OR (
      public.is_cleaner()
      AND EXISTS (
        SELECT 1 FROM public.shifts s
        WHERE s.id = shift_id AND s.cleaner_user_id = (select auth.uid())
      )
    )
    OR (
      public.is_customer_role()
      AND property_id IN (SELECT public.accessible_property_ids())
    )
  );

DROP POLICY IF EXISTS incidents_insert ON public.incidents;
CREATE POLICY incidents_insert ON public.incidents
  FOR INSERT TO authenticated
  WITH CHECK (
    reported_by_user_id = (select auth.uid())
    AND org_id = public.current_org_id()
    AND (
      (public.is_cleaner() AND kind = 'cleaner_issue')
      OR (
        public.is_customer_role()
        AND kind = 'customer_complaint'
      )
    )
  );

-- notifications
DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications
  FOR SELECT TO authenticated
  USING (recipient_user_id = (select auth.uid()));

DROP POLICY IF EXISTS notifications_update ON public.notifications;
CREATE POLICY notifications_update ON public.notifications
  FOR UPDATE TO authenticated
  USING (recipient_user_id = (select auth.uid()))
  WITH CHECK (recipient_user_id = (select auth.uid()));

DROP POLICY IF EXISTS notifications_insert ON public.notifications;
CREATE POLICY notifications_insert ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() OR recipient_user_id = (select auth.uid()));

-- messaging
DROP POLICY IF EXISTS messages_insert ON public.messages;
CREATE POLICY messages_insert ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_user_id = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.message_threads t
      WHERE t.id = thread_id
        AND (
          (public.is_admin() AND t.org_id = public.current_org_id())
          OR (public.is_customer_role() AND t.customer_id IN (SELECT public.accessible_customer_ids()))
        )
    )
  );

DROP POLICY IF EXISTS thread_reads_select ON public.thread_reads;
CREATE POLICY thread_reads_select ON public.thread_reads
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS thread_reads_write ON public.thread_reads;
CREATE POLICY thread_reads_write ON public.thread_reads
  FOR ALL TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

-- shift_requests
DROP POLICY IF EXISTS shift_requests_customer_insert ON public.shift_requests;
CREATE POLICY shift_requests_customer_insert ON public.shift_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by_user_id = (select auth.uid())
    AND org_id = public.current_org_id()
    AND public.is_customer_role()
    AND property_id IN (SELECT public.accessible_property_ids())
  );

DROP POLICY IF EXISTS shift_requests_delete ON public.shift_requests;
CREATE POLICY shift_requests_delete ON public.shift_requests
  FOR DELETE TO authenticated
  USING (
    (public.is_admin() AND org_id = public.current_org_id())
    OR created_by_user_id = (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 3. cancel_reason på shifts
-- ---------------------------------------------------------------------------
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS cancel_reason text;

-- ---------------------------------------------------------------------------
-- 4. FK-index (prestanda vid joins i schema/rapporter)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS shifts_recurring_id_idx
  ON public.shifts (recurring_id)
  WHERE recurring_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS incidents_shift_id_idx
  ON public.incidents (shift_id)
  WHERE shift_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS customer_holidays_customer_id_idx
  ON public.customer_holidays (customer_id);

CREATE INDEX IF NOT EXISTS thread_reads_user_id_idx
  ON public.thread_reads (user_id);
