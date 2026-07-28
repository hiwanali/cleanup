-- CleanUp - Phase 1 for public iframe booking
--
-- V1 goals:
-- - admin creates exact available time slots
-- - public booking requests are stored separately
-- - Edge Functions in Phase 2 create requests/shifts with service role
-- - no anon policies on the raw tables

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'booking_request_status'
  ) THEN
    CREATE TYPE public.booking_request_status AS ENUM (
      'new',
      'linked_to_shift',
      'approved',
      'declined',
      'cancelled'
    );
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.booking_availability_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  capacity integer NOT NULL DEFAULT 1,
  service_type text NOT NULL DEFAULT 'standard_cleaning',
  active boolean NOT NULL DEFAULT true,
  note text NOT NULL DEFAULT '',
  created_by_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (capacity > 0),
  CHECK (length(trim(service_type)) > 0)
);

CREATE TRIGGER booking_availability_slots_set_updated_at
  BEFORE UPDATE ON public.booking_availability_slots
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS booking_availability_slots_org_start_idx
  ON public.booking_availability_slots (org_id, starts_at);

CREATE INDEX IF NOT EXISTS booking_availability_slots_active_start_idx
  ON public.booking_availability_slots (active, starts_at)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS booking_availability_slots_service_start_idx
  ON public.booking_availability_slots (service_type, starts_at)
  WHERE active = true;

CREATE TABLE IF NOT EXISTS public.booking_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  availability_slot_id uuid REFERENCES public.booking_availability_slots (id) ON DELETE SET NULL,
  shift_id uuid REFERENCES public.shifts (id) ON DELETE SET NULL,
  status public.booking_request_status NOT NULL DEFAULT 'new',

  service_type text NOT NULL,
  requested_starts_at timestamptz NOT NULL,
  requested_ends_at timestamptz NOT NULL,

  customer_name text NOT NULL,
  customer_email text NOT NULL,
  customer_phone text NOT NULL,
  address text NOT NULL,
  postal_code text,
  city text,
  area_sqm integer,
  rooms integer,
  addons jsonb NOT NULL DEFAULT '{}'::jsonb,
  estimated_price_sek integer,
  message text NOT NULL DEFAULT '',

  source_domain text NOT NULL DEFAULT 'cleanup.nu',
  ip_hash text,
  user_agent text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CHECK (requested_ends_at > requested_starts_at),
  CHECK (length(trim(service_type)) > 0),
  CHECK (length(trim(customer_name)) >= 2),
  CHECK (customer_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CHECK (length(trim(customer_phone)) >= 6),
  CHECK (length(trim(address)) >= 3),
  CHECK (area_sqm IS NULL OR area_sqm > 0),
  CHECK (rooms IS NULL OR rooms > 0),
  CHECK (estimated_price_sek IS NULL OR estimated_price_sek >= 0)
);

CREATE TRIGGER booking_requests_set_updated_at
  BEFORE UPDATE ON public.booking_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS booking_requests_org_created_idx
  ON public.booking_requests (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS booking_requests_status_idx
  ON public.booking_requests (status);

CREATE INDEX IF NOT EXISTS booking_requests_slot_idx
  ON public.booking_requests (availability_slot_id)
  WHERE availability_slot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS booking_requests_shift_idx
  ON public.booking_requests (shift_id)
  WHERE shift_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS booking_requests_requested_start_idx
  ON public.booking_requests (org_id, requested_starts_at);

ALTER TABLE public.booking_availability_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.booking_availability_slots FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.booking_requests FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_availability_slots TO authenticated;
GRANT SELECT, UPDATE ON public.booking_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_availability_slots TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_requests TO service_role;

DROP POLICY IF EXISTS booking_availability_slots_admin_select
  ON public.booking_availability_slots;

CREATE POLICY booking_availability_slots_admin_select
  ON public.booking_availability_slots
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    AND org_id = public.current_org_id()
  );

DROP POLICY IF EXISTS booking_availability_slots_admin_write
  ON public.booking_availability_slots;

DROP POLICY IF EXISTS booking_availability_slots_admin_insert
  ON public.booking_availability_slots;

CREATE POLICY booking_availability_slots_admin_insert
  ON public.booking_availability_slots
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    AND org_id = public.current_org_id()
  );

DROP POLICY IF EXISTS booking_availability_slots_admin_update
  ON public.booking_availability_slots;

CREATE POLICY booking_availability_slots_admin_update
  ON public.booking_availability_slots
  FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    AND org_id = public.current_org_id()
  )
  WITH CHECK (
    public.is_admin()
    AND org_id = public.current_org_id()
  );

DROP POLICY IF EXISTS booking_availability_slots_admin_delete
  ON public.booking_availability_slots;

CREATE POLICY booking_availability_slots_admin_delete
  ON public.booking_availability_slots
  FOR DELETE TO authenticated
  USING (
    public.is_admin()
    AND org_id = public.current_org_id()
  );

DROP POLICY IF EXISTS booking_requests_admin_select
  ON public.booking_requests;

CREATE POLICY booking_requests_admin_select
  ON public.booking_requests
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    AND org_id = public.current_org_id()
  );

DROP POLICY IF EXISTS booking_requests_admin_write
  ON public.booking_requests;

DROP POLICY IF EXISTS booking_requests_admin_update
  ON public.booking_requests;

CREATE POLICY booking_requests_admin_update
  ON public.booking_requests
  FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    AND org_id = public.current_org_id()
  )
  WITH CHECK (
    public.is_admin()
    AND org_id = public.current_org_id()
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'booking_availability_slots'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.booking_availability_slots;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'booking_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.booking_requests;
  END IF;
END;
$$;
