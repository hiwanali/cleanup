-- CleanUp · Dialog i realtid (kund <-> admin) + önskemål per städtillfälle
--
-- A. message_threads / messages / thread_reads — en tråd per kund, admins <-> kund/kundanställda.
-- B. shift_requests — kundens önskemål per pass (engångs) eller stående (objekt framåt),
--    läsbart för admin + tilldelad/poolad städare via accessible_property_ids().
--
-- Endast tillägg. Följer mönstret i 20260529100100_rls_policies.sql.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE public.message_sender_role AS ENUM ('admin', 'customer', 'customer_employee');

CREATE TYPE public.shift_request_scope AS ENUM ('single', 'standing');

CREATE TYPE public.shift_request_role AS ENUM ('customer', 'customer_employee');

-- ---------------------------------------------------------------------------
-- A. Meddelanden
-- ---------------------------------------------------------------------------
CREATE TABLE public.message_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id)
);

CREATE INDEX message_threads_org_idx ON public.message_threads (org_id, last_message_at DESC);

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.message_threads (id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
  sender_role public.message_sender_role NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX messages_thread_idx ON public.messages (thread_id, created_at);

CREATE TABLE public.thread_reads (
  thread_id uuid NOT NULL REFERENCES public.message_threads (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, user_id)
);

-- ---------------------------------------------------------------------------
-- B. Önskemål per städtillfälle
-- ---------------------------------------------------------------------------
CREATE TABLE public.shift_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties (id) ON DELETE CASCADE,
  shift_id uuid REFERENCES public.shifts (id) ON DELETE CASCADE,
  scope public.shift_request_scope NOT NULL DEFAULT 'single',
  body text NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
  created_by_role public.shift_request_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Engångsönskemål kräver pass; stående gäller objektet och har inget pass.
  CHECK (
    (scope = 'single' AND shift_id IS NOT NULL)
    OR (scope = 'standing' AND shift_id IS NULL)
  )
);

CREATE INDEX shift_requests_shift_idx ON public.shift_requests (shift_id);
CREATE INDEX shift_requests_property_idx ON public.shift_requests (property_id, scope);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.message_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.thread_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_requests ENABLE ROW LEVEL SECURITY;

-- message_threads -----------------------------------------------------------
CREATE POLICY message_threads_select ON public.message_threads
  FOR SELECT TO authenticated
  USING (
    (public.is_admin() AND org_id = public.current_org_id())
    OR (public.is_customer_role() AND customer_id IN (SELECT public.accessible_customer_ids()))
  );

CREATE POLICY message_threads_insert ON public.message_threads
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.current_org_id()
    AND (
      public.is_admin()
      OR (public.is_customer_role() AND customer_id IN (SELECT public.accessible_customer_ids()))
    )
  );

-- messages ------------------------------------------------------------------
CREATE POLICY messages_select ON public.messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.message_threads t
      WHERE t.id = thread_id
        AND (
          (public.is_admin() AND t.org_id = public.current_org_id())
          OR (public.is_customer_role() AND t.customer_id IN (SELECT public.accessible_customer_ids()))
        )
    )
  );

CREATE POLICY messages_insert ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.message_threads t
      WHERE t.id = thread_id
        AND (
          (public.is_admin() AND t.org_id = public.current_org_id())
          OR (public.is_customer_role() AND t.customer_id IN (SELECT public.accessible_customer_ids()))
        )
    )
  );

-- thread_reads (varje användare hanterar sin egen läsmarkör) -----------------
CREATE POLICY thread_reads_select ON public.thread_reads
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY thread_reads_write ON public.thread_reads
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- shift_requests ------------------------------------------------------------
CREATE POLICY shift_requests_select ON public.shift_requests
  FOR SELECT TO authenticated
  USING (
    (public.is_admin() AND org_id = public.current_org_id())
    OR property_id IN (SELECT public.accessible_property_ids())
  );

CREATE POLICY shift_requests_customer_insert ON public.shift_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by_user_id = auth.uid()
    AND org_id = public.current_org_id()
    AND public.is_customer_role()
    AND property_id IN (SELECT public.accessible_property_ids())
  );

CREATE POLICY shift_requests_delete ON public.shift_requests
  FOR DELETE TO authenticated
  USING (
    (public.is_admin() AND org_id = public.current_org_id())
    OR created_by_user_id = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_threads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.thread_reads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.shift_requests;
