-- CleanUp · produktionskonton (cleanup.nu) + kund Concito
-- Initialt lösenord för alla fyra: CleanUp2026!
-- Byt lösenord i Supabase Dashboard → Authentication efter första inloggning.

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.seed_auth_user(
  p_id uuid,
  p_email text,
  p_role public.user_role,
  p_org_id uuid,
  p_name text,
  p_phone text DEFAULT NULL,
  p_password text DEFAULT 'CleanUp2026!'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_instance_id uuid;
BEGIN
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
    p_id, v_instance_id, 'authenticated', 'authenticated', lower(trim(p_email)),
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    jsonb_build_object(
      'provider', 'email', 'providers', jsonb_build_array('email'),
      'org_id', p_org_id::text, 'role', p_role::text
    ),
    jsonb_build_object('name', p_name, 'phone', p_phone),
    now(), now(), '', '', '', '', '', '', '', ''
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    encrypted_password = EXCLUDED.encrypted_password,
    raw_app_meta_data = EXCLUDED.raw_app_meta_data,
    raw_user_meta_data = EXCLUDED.raw_user_meta_data,
    updated_at = now();

  INSERT INTO auth.identities (
    id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  )
  SELECT gen_random_uuid(), p_id, p_id::text,
    jsonb_build_object('sub', p_id::text, 'email', lower(trim(p_email))),
    'email', now(), now(), now()
  WHERE NOT EXISTS (
    SELECT 1 FROM auth.identities i WHERE i.user_id = p_id AND i.provider = 'email'
  );

  INSERT INTO public.users (id, org_id, role, name, email, phone, active)
  VALUES (p_id, p_org_id, p_role, p_name, lower(trim(p_email)), p_phone, true)
  ON CONFLICT (id) DO UPDATE SET
    role = EXCLUDED.role, name = EXCLUDED.name, email = EXCLUDED.email,
    phone = EXCLUDED.phone, active = true;
END;
$$;

DO $$
DECLARE
  v_org uuid := 'a0000000-0000-4000-8000-000000000001';
  v_admin uuid := 'b0000000-0000-4000-8000-000000000010';
  v_cleaner uuid := 'b0000000-0000-4000-8000-000000000011';
  v_customer uuid := 'b0000000-0000-4000-8000-000000000020';
  v_ce_user uuid := 'b0000000-0000-4000-8000-000000000021';
  v_concito uuid := 'b0000000-0000-4000-8000-000000000103';
  v_concito_hq uuid := 'b0000000-0000-4000-8000-000000000205';
  v_concito_ce uuid := 'b0000000-0000-4000-8000-000000000302';
  r record;
BEGIN
  PERFORM private.seed_auth_user(
    v_admin, 'info@cleanup.nu', 'admin', v_org, 'CleanUp Admin', NULL, 'CleanUp2026!'
  );
  PERFORM private.seed_auth_user(
    v_customer, 'Concito@cleanup.nu', 'customer', v_org, 'Concito Kontakt', NULL, 'Work123!'
  );
  PERFORM private.seed_auth_user(
    v_ce_user, 'LinneaConcito@cleanup.nu', 'customer_employee', v_org, 'Linnea Concito', NULL, 'Work123!'
  );
  PERFORM private.seed_auth_user(
    v_cleaner, 'CleanUp123@cleanup.nu', 'cleaner', v_org, 'CleanUp Lokalvårdare', NULL, 'CleanUp2026!'
  );

  INSERT INTO public.customers (id, org_id, name, org_number, primary_contact_user_id, notes)
  VALUES (
    v_concito, v_org, 'Concito', NULL, v_customer,
    'Produktionskund · cleanup.nu'
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    primary_contact_user_id = EXCLUDED.primary_contact_user_id,
    notes = EXCLUDED.notes;

  INSERT INTO public.properties (id, customer_id, name, address, area_sqm, access_info, notes)
  VALUES (
    v_concito_hq, v_concito, 'Concito Kontor',
    'Kungsgatan 1, 111 43 Stockholm', 150,
    'Nyckel hos reception. Larmkod meddelas via Concito.',
    ''
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.customer_employees (id, customer_id, user_id, scope, created_by_admin_id)
  VALUES (v_concito_ce, v_concito, v_ce_user, 'all_properties', v_admin)
  ON CONFLICT (id) DO UPDATE SET
    customer_id = EXCLUDED.customer_id,
    user_id = EXCLUDED.user_id,
    scope = EXCLUDED.scope;

  INSERT INTO public.property_cleaners (property_id, cleaner_user_id)
  VALUES (v_concito_hq, v_cleaner)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.cleaning_checklists (property_id, title, position, active)
  SELECT v.property_id, v.title, v.position, true
  FROM (VALUES
    (v_concito_hq, 'Entré & reception – damning', 1),
    (v_concito_hq, 'Konferensrum – torka ytor', 2),
    (v_concito_hq, 'Pentry – diska & bänk', 3),
    (v_concito_hq, 'Toaletter – sanering', 4),
    (v_concito_hq, 'Golv – moppning', 5),
    (v_concito_hq, 'Soptömning', 6)
  ) AS v(property_id, title, position)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.cleaning_checklists c
    WHERE c.property_id = v.property_id AND c.position = v.position
  );

  INSERT INTO public.recurring_schedules (
    property_id, weekday, start_time, end_time, default_cleaner_user_id, active
  )
  SELECT v.property_id, v.weekday, v.start_time::time, v.end_time::time, v.cleaner_id, true
  FROM (VALUES
    (v_concito_hq, 1, '07:00', '09:30', v_cleaner),
    (v_concito_hq, 3, '07:00', '09:30', v_cleaner),
    (v_concito_hq, 5, '07:00', '09:30', v_cleaner)
  ) AS v(property_id, weekday, start_time, end_time, cleaner_id)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.recurring_schedules rs
    WHERE rs.property_id = v.property_id
      AND rs.weekday = v.weekday
      AND rs.start_time = v.start_time::time
  );

  PERFORM public.generate_shifts_from_recurring();

  FOR r IN
    SELECT s.id FROM public.shifts s
    WHERE s.property_id = v_concito_hq
      AND NOT EXISTS (
        SELECT 1 FROM public.shift_checklist_items sci WHERE sci.shift_id = s.id
      )
  LOOP
    PERFORM public.snapshot_checklist_for_shift(r.id);
  END LOOP;
END;
$$;

DROP FUNCTION private.seed_auth_user(uuid, text, public.user_role, uuid, text, text, text);

-- Säkerställ att befintliga auth-rader har tomma token-strängar (GoTrue-krav)
UPDATE auth.users SET
  confirmation_token = COALESCE(confirmation_token, ''),
  recovery_token = COALESCE(recovery_token, ''),
  email_change_token_new = COALESCE(email_change_token_new, ''),
  email_change = COALESCE(email_change, ''),
  email_change_token_current = COALESCE(email_change_token_current, ''),
  phone_change = COALESCE(phone_change, ''),
  phone_change_token = COALESCE(phone_change_token, ''),
  reauthentication_token = COALESCE(reauthentication_token, '')
WHERE email ILIKE '%@cleanup.nu' OR email ILIKE '%@cleanup.se' OR email ILIKE '%@acme.se' OR email ILIKE '%@northco.se';
