-- Huvudkontakt (role customer) får skapa och uppdatera egna objekt.
-- access_info och area_sqm sätts endast av admin (app + befintliga kolumner).

CREATE POLICY properties_customer_insert ON public.properties
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.id = customer_id
        AND c.primary_contact_user_id = (SELECT auth.uid())
    )
    AND (SELECT u.role FROM public.users u WHERE u.id = (SELECT auth.uid())) = 'customer'
  );

CREATE POLICY properties_customer_update ON public.properties
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.id = customer_id
        AND c.primary_contact_user_id = (SELECT auth.uid())
    )
    AND (SELECT u.role FROM public.users u WHERE u.id = (SELECT auth.uid())) = 'customer'
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.id = customer_id
        AND c.primary_contact_user_id = (SELECT auth.uid())
    )
    AND (SELECT u.role FROM public.users u WHERE u.id = (SELECT auth.uid())) = 'customer'
  );
