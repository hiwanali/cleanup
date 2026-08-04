-- Allow customer/customer_employee users to read their accessible properties.
--
-- The frontend hydrates customer-visible properties through the
-- properties_customer view. That view intentionally omits sensitive access
-- info, but it still depends on the base properties SELECT policy under RLS.
-- Without this policy a magic-link customer can read the shift but not the
-- property used by db.shiftsForCustomerUser(), so the customer detail page
-- incorrectly renders "Det har passet tillhor inte dig".

DROP POLICY IF EXISTS properties_customer_select
  ON public.properties;

CREATE POLICY properties_customer_select
  ON public.properties
  FOR SELECT
  TO authenticated
  USING (
    public.is_customer_role()
    AND id IN (
      SELECT public.accessible_property_ids()
    )
  );
