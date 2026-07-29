-- CleanUp - customer portal access phase 1
--
-- Adds the data model needed to connect a public booking request to a real
-- customer portal account after admin approval. This does not send emails or
-- change booking approval behaviour yet.

ALTER TABLE public.booking_requests
  ADD COLUMN IF NOT EXISTS portal_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS portal_customer_id uuid REFERENCES public.customers (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS portal_access_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS portal_access_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS portal_invited_at timestamptz,
  ADD COLUMN IF NOT EXISTS portal_last_magic_link_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS portal_redirect_path text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'booking_requests_portal_access_status_check'
      AND conrelid = 'public.booking_requests'::regclass
  ) THEN
    ALTER TABLE public.booking_requests
      ADD CONSTRAINT booking_requests_portal_access_status_check
      CHECK (portal_access_status IN ('none', 'created', 'invited', 'active'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS booking_requests_portal_user_idx
  ON public.booking_requests (portal_user_id)
  WHERE portal_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS booking_requests_portal_customer_idx
  ON public.booking_requests (portal_customer_id)
  WHERE portal_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS booking_requests_portal_access_status_idx
  ON public.booking_requests (portal_access_status)
  WHERE portal_access_status <> 'none';

COMMENT ON COLUMN public.booking_requests.portal_user_id IS
  'Customer portal user created/reused for this public booking after admin approval.';

COMMENT ON COLUMN public.booking_requests.portal_customer_id IS
  'Customer record created/reused for this public booking after admin approval.';

COMMENT ON COLUMN public.booking_requests.portal_access_status IS
  'Customer portal access lifecycle: none, created, invited, active.';

COMMENT ON COLUMN public.booking_requests.portal_access_created_at IS
  'When portal customer/user access was created or linked for this booking.';

COMMENT ON COLUMN public.booking_requests.portal_invited_at IS
  'When the customer was first invited to the portal for this booking.';

COMMENT ON COLUMN public.booking_requests.portal_last_magic_link_sent_at IS
  'Most recent magic-link email send timestamp for this booking.';

COMMENT ON COLUMN public.booking_requests.portal_redirect_path IS
  'App hash path where the customer should land after login, for example /kund/pass/{shiftId}.';
