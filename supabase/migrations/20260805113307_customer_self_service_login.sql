-- CleanUp - customer self-service login hardening.
--
-- This supports passwordless customer login without exposing whether an email
-- exists. The public Edge Function writes audit rows with hashed identifiers
-- using the service role; browser roles get no direct access.

CREATE TABLE IF NOT EXISTS public.customer_login_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash text NOT NULL,
  ip_hash text,
  user_agent text,
  status text NOT NULL DEFAULT 'accepted',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_login_requests_status_check
    CHECK (status IN ('accepted', 'sent', 'skipped', 'rate_limited', 'config_error', 'send_error'))
);

CREATE INDEX IF NOT EXISTS customer_login_requests_email_created_idx
  ON public.customer_login_requests (email_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS customer_login_requests_ip_created_idx
  ON public.customer_login_requests (ip_hash, created_at DESC)
  WHERE ip_hash IS NOT NULL;

ALTER TABLE public.customer_login_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON public.customer_login_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_login_requests TO service_role;

-- Stop implicit customer creation from open Auth signup. App-created users must
-- carry trusted app metadata with both org_id and role.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_role public.user_role;
BEGIN
  IF NOT (NEW.raw_app_meta_data ? 'org_id') OR NOT (NEW.raw_app_meta_data ? 'role') THEN
    RAISE EXCEPTION 'Missing trusted app metadata for user provisioning'
      USING ERRCODE = '28000';
  END IF;

  v_org_id := (NEW.raw_app_meta_data ->> 'org_id')::uuid;
  v_role := (NEW.raw_app_meta_data ->> 'role')::public.user_role;

  INSERT INTO public.users (id, org_id, role, name, email, phone, active)
  VALUES (
    NEW.id,
    v_org_id,
    v_role,
    COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'name', ''), split_part(NEW.email, '@', 1)),
    lower(trim(NEW.email)),
    NULLIF(NEW.raw_user_meta_data ->> 'phone', ''),
    true
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    updated_at = now();

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- New internally seeded Auth users should not share a usable password. First
-- access is by magic link; customers can set their own password after login.
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
    extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'), extensions.gen_salt('bf')),
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
    SELECT 1 FROM auth.identities i WHERE i.user_id = p_id AND i.provider = 'email'
  );
END;
$$;

UPDATE auth.users au
SET
  encrypted_password = extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'), extensions.gen_salt('bf')),
  updated_at = now()
FROM public.users u
WHERE u.id = au.id
  AND u.role IN ('customer', 'customer_employee')
  AND au.encrypted_password = extensions.crypt('demo1234', au.encrypted_password);
