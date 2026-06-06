-- CleanUp · Kund/kundanställd kan begära nytt pass (Planerat, utan städare)

ALTER TYPE public.shift_source ADD VALUE IF NOT EXISTS 'customer_request';

CREATE POLICY shifts_customer_request_insert ON public.shifts
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_customer_role()
    AND property_id IN (SELECT public.accessible_property_ids())
    AND status = 'Planerat'
    AND cleaner_user_id IS NULL
    AND source = 'customer_request'
  );
