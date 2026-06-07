-- Konsolidera admin_create_cleaner: ta bort äldre överlagring och skapa cleaner_profiles-rad.

DROP FUNCTION IF EXISTS public.admin_create_cleaner(
  uuid, uuid, text, text, text, text, text, text, text, text, text
);

CREATE OR REPLACE FUNCTION public.admin_create_cleaner(
  p_user_id uuid,
  p_name text,
  p_email text,
  p_password text,
  p_phone text DEFAULT NULL,
  p_property_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_org_id uuid;
  v_instance_id uuid;
  v_email text := lower(trim(p_email));
  v_name text := trim(p_name);
  v_phone text := nullif(trim(p_phone), '');
  v_pid uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'org not found' USING ERRCODE = '42501';
  END IF;

  IF length(coalesce(v_name, '')) < 2 THEN
    RAISE EXCEPTION 'invalid name' USING ERRCODE = '22023';
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'invalid email' USING ERRCODE = '22023';
  END IF;
  IF length(coalesce(p_password, '')) < 8 THEN
    RAISE EXCEPTION 'weak password' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.users
    WHERE org_id = v_org_id AND lower(email) = v_email
  ) THEN
    RAISE EXCEPTION 'email exists' USING ERRCODE = '23505';
  END IF;

  SELECT id INTO v_instance_id FROM auth.instances LIMIT 1;
  IF v_instance_id IS NULL THEN
    v_instance_id := '00000000-0000-0000-0000-000000000000'::uuid;
  END IF;

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  )
  VALUES (
    p_user_id, v_instance_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    jsonb_build_object(
      'provider', 'email', 'providers', jsonb_build_array('email'),
      'org_id', v_org_id::text, 'role', 'cleaner'
    ),
    jsonb_build_object('name', v_name, 'phone', v_phone),
    now(), now(), '', '', '', '', '', '', '', ''
  );

  INSERT INTO auth.identities (
    id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  )
  VALUES (
    gen_random_uuid(), p_user_id, p_user_id::text,
    jsonb_build_object('sub', p_user_id::text, 'email', v_email),
    'email', now(), now(), now()
  );

  INSERT INTO public.users (id, org_id, role, name, email, phone, active)
  VALUES (p_user_id, v_org_id, 'cleaner', v_name, v_email, v_phone, true)
  ON CONFLICT (id) DO UPDATE SET
    role = EXCLUDED.role, name = EXCLUDED.name, email = EXCLUDED.email,
    phone = EXCLUDED.phone, active = true;

  INSERT INTO public.cleaner_profiles (user_id, org_id, personal_number, address, emergency_contact_name, emergency_contact_phone, notes)
  VALUES (p_user_id, v_org_id, NULL, '', '', '', '')
  ON CONFLICT (user_id) DO NOTHING;

  FOREACH v_pid IN ARRAY coalesce(p_property_ids, '{}'::uuid[]) LOOP
    IF EXISTS (
      SELECT 1 FROM public.properties p
      JOIN public.customers c ON c.id = p.customer_id
      WHERE p.id = v_pid AND c.org_id = v_org_id
    ) THEN
      INSERT INTO public.property_cleaners (property_id, cleaner_user_id)
      VALUES (v_pid, p_user_id)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  RETURN p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_cleaner(
  uuid, text, text, text, text, uuid[]
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_cleaner(
  uuid, text, text, text, text, uuid[]
) TO authenticated;
