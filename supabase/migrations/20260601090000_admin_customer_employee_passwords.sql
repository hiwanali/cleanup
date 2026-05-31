-- CleanUp · Admin provisionerar kundanställda med valt lösenord (§7.7)
--
-- 1. admin_create_customer_employee: skapar auth.users (bekräftad e-post) +
--    public.users + customer_employees + ev. customer_employee_properties i en
--    transaktion. Admin väljer lösenordet direkt. Endast admin i samma org.
-- 2. admin_set_user_password: admin återställer lösenord för en användare i egen org.
--
-- Kundanställda byter själva lösenord via Supabase Auth (sb.auth.updateUser) i klienten.

-- ---------------------------------------------------------------------------
-- 1. Skapa kundanställd med valt lösenord
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_create_customer_employee(
  p_user_id uuid,
  p_ce_id uuid,
  p_customer_id uuid,
  p_name text,
  p_email text,
  p_password text,
  p_phone text DEFAULT NULL,
  p_scope public.scope_type DEFAULT 'all_properties',
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

  SELECT org_id INTO v_org_id FROM public.customers WHERE id = p_customer_id;
  IF v_org_id IS NULL OR v_org_id IS DISTINCT FROM public.current_org_id() THEN
    RAISE EXCEPTION 'customer not in org' USING ERRCODE = '42501';
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
      'org_id', v_org_id::text, 'role', 'customer_employee'
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

  -- handle_new_user-triggern skapar normalt public.users-raden; säkra korrekt data
  INSERT INTO public.users (id, org_id, role, name, email, phone, active)
  VALUES (p_user_id, v_org_id, 'customer_employee', v_name, v_email, v_phone, true)
  ON CONFLICT (id) DO UPDATE SET
    role = EXCLUDED.role, name = EXCLUDED.name, email = EXCLUDED.email,
    phone = EXCLUDED.phone, active = true;

  INSERT INTO public.customer_employees (id, customer_id, user_id, scope, created_by_admin_id)
  VALUES (p_ce_id, p_customer_id, p_user_id, p_scope, auth.uid());

  IF p_scope = 'selected' THEN
    FOREACH v_pid IN ARRAY coalesce(p_property_ids, '{}'::uuid[]) LOOP
      IF EXISTS (
        SELECT 1 FROM public.properties WHERE id = v_pid AND customer_id = p_customer_id
      ) THEN
        INSERT INTO public.customer_employee_properties (customer_employee_id, property_id)
        VALUES (p_ce_id, v_pid)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  RETURN p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_customer_employee(
  uuid, uuid, uuid, text, text, text, text, public.scope_type, uuid[]
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_customer_employee(
  uuid, uuid, uuid, text, text, text, text, public.scope_type, uuid[]
) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Admin återställer lösenord för användare i egen org
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_user_password(
  p_user_id uuid,
  p_password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF length(coalesce(p_password, '')) < 8 THEN
    RAISE EXCEPTION 'weak password' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_user_id AND org_id = public.current_org_id()
  ) THEN
    RAISE EXCEPTION 'user not in org' USING ERRCODE = '42501';
  END IF;

  UPDATE auth.users
  SET encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
      updated_at = now()
  WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_password(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_password(uuid, text) TO authenticated;
