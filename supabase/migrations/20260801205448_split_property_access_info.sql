-- CleanUp - split sensitive property access info out of public.properties
--
-- Rationale:
-- properties_customer was previously SECURITY DEFINER to hide access_info while
-- still showing customer-owned properties. The safer model is to keep ordinary
-- property metadata in public.properties and store key/alarm instructions in a
-- separate RLS-protected table.

CREATE TABLE IF NOT EXISTS public.property_access_info (
  property_id uuid PRIMARY KEY REFERENCES public.properties(id) ON DELETE CASCADE,
  access_info text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL
);

INSERT INTO public.property_access_info (property_id, access_info)
SELECT p.id, p.access_info
FROM public.properties p
WHERE coalesce(p.access_info, '') <> ''
ON CONFLICT (property_id) DO UPDATE
SET
  access_info = EXCLUDED.access_info,
  updated_at = now();

ALTER TABLE public.property_access_info ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS property_access_info_select ON public.property_access_info;
DROP POLICY IF EXISTS property_access_info_admin_write ON public.property_access_info;

CREATE POLICY property_access_info_select ON public.property_access_info
  FOR SELECT TO authenticated
  USING (
    (
      public.is_admin()
      AND EXISTS (
        SELECT 1
        FROM public.properties p
        JOIN public.customers c ON c.id = p.customer_id
        WHERE p.id = property_access_info.property_id
          AND c.org_id = public.current_org_id()
      )
    )
    OR (
      public.is_cleaner()
      AND (
        EXISTS (
          SELECT 1
          FROM public.property_cleaners pc
          WHERE pc.property_id = property_access_info.property_id
            AND pc.cleaner_user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1
          FROM public.shifts s
          WHERE s.property_id = property_access_info.property_id
            AND s.cleaner_user_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY property_access_info_admin_write ON public.property_access_info
  FOR ALL TO authenticated
  USING (
    public.is_admin()
    AND EXISTS (
      SELECT 1
      FROM public.properties p
      JOIN public.customers c ON c.id = p.customer_id
      WHERE p.id = property_access_info.property_id
        AND c.org_id = public.current_org_id()
    )
  )
  WITH CHECK (
    public.is_admin()
    AND EXISTS (
      SELECT 1
      FROM public.properties p
      JOIN public.customers c ON c.id = p.customer_id
      WHERE p.id = property_access_info.property_id
        AND c.org_id = public.current_org_id()
    )
  );

REVOKE ALL PRIVILEGES ON public.property_access_info FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_access_info TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_access_info TO service_role;

DROP TRIGGER IF EXISTS property_access_info_updated_at ON public.property_access_info;
CREATE TRIGGER property_access_info_updated_at
  BEFORE UPDATE ON public.property_access_info
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER VIEW public.properties_customer SET (security_invoker = true);
COMMENT ON VIEW public.properties_customer IS
  'Kundsaker objektvy utan nyckel/larm. SECURITY INVOKER; RLS pa public.properties galler anroparen.';

ALTER TABLE public.properties DROP COLUMN IF EXISTS access_info;

NOTIFY pgrst, 'reload schema';
