-- CleanUp - repair Auth rows created by the portal provisioning helper.
--
-- Supabase Auth's generate_link path expects these legacy token columns to be
-- blank strings, matching Supabase-created rows and the original production
-- seed helper. A stale helper left them NULL for some app-provisioned users,
-- which made Auth return "Database error finding user" for magic-link creation.

UPDATE auth.users
SET
  confirmation_token = coalesce(confirmation_token, ''),
  recovery_token = coalesce(recovery_token, ''),
  email_change_token_new = coalesce(email_change_token_new, ''),
  email_change = coalesce(email_change, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  phone_change = coalesce(phone_change, ''),
  phone_change_token = coalesce(phone_change_token, ''),
  reauthentication_token = coalesce(reauthentication_token, ''),
  updated_at = now()
WHERE confirmation_token IS NULL
  OR recovery_token IS NULL
  OR email_change_token_new IS NULL
  OR email_change IS NULL
  OR email_change_token_current IS NULL
  OR phone_change IS NULL
  OR phone_change_token IS NULL
  OR reauthentication_token IS NULL;

CREATE OR REPLACE FUNCTION private.seed_auth_user(
  p_id uuid,
  p_email text,
  p_role public.user_role,
  p_org_id uuid,
  p_name text,
  p_phone text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_instance_id uuid;
  v_email text := lower(trim(p_email));
BEGIN
  SELECT id INTO v_instance_id FROM auth.instances LIMIT 1;
  IF v_instance_id IS NULL THEN
    v_instance_id := '00000000-0000-0000-0000-000000000000'::uuid;
  END IF;

  INSERT INTO auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change,
    email_change_token_current,
    phone_change,
    phone_change_token,
    reauthentication_token
  )
  VALUES (
    p_id,
    v_instance_id,
    'authenticated',
    'authenticated',
    v_email,
    extensions.crypt('demo1234', extensions.gen_salt('bf')),
    now(),
    jsonb_build_object(
      'provider', 'email',
      'providers', jsonb_build_array('email'),
      'org_id', p_org_id::text,
      'role', p_role::text
    ),
    jsonb_build_object('name', p_name, 'phone', p_phone),
    now(),
    now(),
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    ''
  )
  ON CONFLICT (id) DO UPDATE SET
    email = lower(trim(EXCLUDED.email)),
    raw_app_meta_data = EXCLUDED.raw_app_meta_data,
    raw_user_meta_data = EXCLUDED.raw_user_meta_data,
    confirmation_token = coalesce(auth.users.confirmation_token, ''),
    recovery_token = coalesce(auth.users.recovery_token, ''),
    email_change_token_new = coalesce(auth.users.email_change_token_new, ''),
    email_change = coalesce(auth.users.email_change, ''),
    email_change_token_current = coalesce(auth.users.email_change_token_current, ''),
    phone_change = coalesce(auth.users.phone_change, ''),
    phone_change_token = coalesce(auth.users.phone_change_token, ''),
    reauthentication_token = coalesce(auth.users.reauthentication_token, ''),
    updated_at = now();

  INSERT INTO auth.identities (
    id,
    user_id,
    provider_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  )
  SELECT
    gen_random_uuid(),
    p_id,
    p_id::text,
    jsonb_build_object('sub', p_id::text, 'email', v_email),
    'email',
    now(),
    now(),
    now()
  WHERE NOT EXISTS (
    SELECT 1
    FROM auth.identities i
    WHERE i.user_id = p_id
      AND i.provider = 'email'
  );

  INSERT INTO public.users (id, org_id, role, name, email, phone, active)
  VALUES (p_id, p_org_id, p_role, p_name, v_email, p_phone, true)
  ON CONFLICT (id) DO UPDATE SET
    role = EXCLUDED.role,
    name = EXCLUDED.name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    active = true,
    updated_at = now();
END;
$$;
