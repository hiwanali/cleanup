-- CleanUp · demodata (speglar src/mock.jsx)
-- Lösenord för alla demo-konton: demo1234

CREATE SCHEMA IF NOT EXISTS private;

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
    -- GoTrue scannar dessa som icke-nullbara strängar; måste vara ''
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
    p_email,
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
    '', '', '', '', '', '', '', ''
  )
  ON CONFLICT (id) DO NOTHING;

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
    jsonb_build_object('sub', p_id::text, 'email', p_email),
    'email',
    now(),
    now(),
    now()
  WHERE NOT EXISTS (
    SELECT 1 FROM auth.identities i WHERE i.user_id = p_id AND i.provider = 'email'
  );

  INSERT INTO public.users (id, org_id, role, name, email, phone, active)
  VALUES (p_id, p_org_id, p_role, p_name, p_email, p_phone, true)
  ON CONFLICT (id) DO UPDATE SET
    role = EXCLUDED.role,
    name = EXCLUDED.name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    active = true;
END;
$$;

DO $$
DECLARE
  v_org uuid := 'a0000000-0000-4000-8000-000000000001';
  v_admin uuid := 'a0000000-0000-4000-8000-000000000010';
  v_anna uuid := 'a0000000-0000-4000-8000-000000000011';
  v_david uuid := 'a0000000-0000-4000-8000-000000000012';
  v_maria uuid := 'a0000000-0000-4000-8000-000000000013';
  v_erik uuid := 'a0000000-0000-4000-8000-000000000020';
  v_lisa uuid := 'a0000000-0000-4000-8000-000000000021';
  v_per uuid := 'a0000000-0000-4000-8000-000000000022';
  v_acme uuid := 'a0000000-0000-4000-8000-000000000101';
  v_north uuid := 'a0000000-0000-4000-8000-000000000102';
  v_hq uuid := 'a0000000-0000-4000-8000-000000000201';
  v_lab uuid := 'a0000000-0000-4000-8000-000000000202';
  v_noff uuid := 'a0000000-0000-4000-8000-000000000203';
  v_nwh uuid := 'a0000000-0000-4000-8000-000000000204';
  v_ce uuid := 'a0000000-0000-4000-8000-000000000301';
  v_sick uuid;
  r record;
BEGIN
  INSERT INTO public.organizations (id, name, slug, accent_color, theme_round)
  VALUES (v_org, 'CleanUp', 'cleanup', '#f2603c', 'Standard')
  ON CONFLICT (id) DO NOTHING;

  PERFORM private.seed_auth_user(v_admin, 'sara@cleanup.se', 'admin', v_org, 'Sara Lindqvist', '+46 70 123 45 67');
  PERFORM private.seed_auth_user(v_anna, 'anna@cleanup.se', 'cleaner', v_org, 'Anna Berg', '+46 70 222 11 00');
  PERFORM private.seed_auth_user(v_david, 'david@cleanup.se', 'cleaner', v_org, 'David Nilsson', '+46 70 222 22 11');
  PERFORM private.seed_auth_user(v_maria, 'maria@cleanup.se', 'cleaner', v_org, 'Maria Karlsson', '+46 70 222 33 22');
  PERFORM private.seed_auth_user(v_erik, 'erik@acme.se', 'customer', v_org, 'Erik Holm', '+46 70 555 11 11');
  PERFORM private.seed_auth_user(v_lisa, 'lisa@acme.se', 'customer_employee', v_org, 'Lisa Ek', '+46 70 555 22 22');
  PERFORM private.seed_auth_user(v_per, 'per@northco.se', 'customer', v_org, 'Per Sundberg', '+46 70 666 11 11');

  INSERT INTO public.customers (id, org_id, name, org_number, primary_contact_user_id, notes)
  VALUES
    (v_acme, v_org, 'Acme AB', '556677-1122', v_erik, 'Föredrar morgonstädning före kontorsöppning.'),
    (v_north, v_org, 'NorthCo AB', '556677-3344', v_per, '')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.properties (id, customer_id, name, address, area_sqm, access_info, notes)
  VALUES
    (v_hq, v_acme, 'Acme HQ', 'Sveavägen 10, 111 57 Stockholm', 320,
      'Nyckel finns i kodlåda 1234 vid huvudentrén. Larm kod 5588.', ''),
    (v_lab, v_acme, 'Acme Labb', 'Vasagatan 3, 111 20 Stockholm', 110,
      'Tagg till reception lämnas av Erik dagen innan. Larm avstängt under arbetspass.', 'Använd ej parfymerade produkter.'),
    (v_noff, v_north, 'NorthCo Office', 'Birger Jarlsgatan 5, 114 34 Stockholm', 180,
      'Reception lämnar ut bricka 06:30–07:00.', ''),
    (v_nwh, v_north, 'NorthCo Lager', 'Industrigatan 8, 117 36 Stockholm', 220,
      'Larm kod 9911. Nyckel hänger i lådan inne i städskrubben.', 'Använd skyddsskor.')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.customer_employees (id, customer_id, user_id, scope, created_by_admin_id)
  VALUES (v_ce, v_acme, v_lisa, 'selected', v_admin)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.customer_employee_properties (customer_employee_id, property_id)
  VALUES (v_ce, v_hq)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.property_cleaners (property_id, cleaner_user_id) VALUES
    (v_hq, v_anna), (v_hq, v_david),
    (v_lab, v_anna),
    (v_noff, v_david), (v_noff, v_maria),
    (v_nwh, v_maria)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.cleaning_checklists (property_id, title, position, active)
  SELECT v.property_id, v.title, v.position, true
  FROM (VALUES
    (v_hq, 'Receptionen damtorkas', 1),
    (v_hq, 'Konferensrum – torka bord & stolar', 2),
    (v_hq, 'Pentry – diska & torka bänk', 3),
    (v_hq, 'Toaletter – sanering & påfyllning', 4),
    (v_hq, 'Golv – damsugning & moppning', 5),
    (v_hq, 'Soptömning', 6),
    (v_lab, 'Labbänkar avtorkning (alkohol)', 1),
    (v_lab, 'Diskbänk & vask', 2),
    (v_lab, 'Golv – moppning', 3),
    (v_lab, 'Avfallshantering', 4),
    (v_lab, 'Påfyllning handsprit', 5),
    (v_noff, 'Reception – damning', 1),
    (v_noff, 'Mötesrum 1–3 – torka bord', 2),
    (v_noff, 'Pentry – diska', 3),
    (v_noff, 'Toaletter', 4),
    (v_noff, 'Golv – moppning', 5),
    (v_noff, 'Soptömning', 6),
    (v_nwh, 'Lagergångar – sopning', 1),
    (v_nwh, 'Pausrum – torka bord & diska', 2),
    (v_nwh, 'Toalett – sanering', 3),
    (v_nwh, 'Påfyllning material', 4),
    (v_nwh, 'Soptömning', 5)
  ) AS v(property_id, title, position)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.cleaning_checklists c
    WHERE c.property_id = v.property_id AND c.position = v.position
  );

  INSERT INTO public.recurring_schedules (property_id, weekday, start_time, end_time, default_cleaner_user_id, active)
  SELECT v.property_id, v.weekday, v.start_time::time, v.end_time::time, v.cleaner_id, true
  FROM (VALUES
    (v_hq, 0, '08:00', '10:30', v_anna),
    (v_hq, 2, '08:00', '10:30', v_anna),
    (v_hq, 4, '08:00', '10:30', v_anna),
    (v_lab, 1, '13:00', '15:00', v_anna),
    (v_lab, 3, '13:00', '15:00', v_anna),
    (v_noff, 0, '07:00', '09:00', v_david),
    (v_noff, 3, '07:00', '09:00', v_david),
    (v_nwh, 4, '06:00', '08:00', v_maria)
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
    WHERE NOT EXISTS (SELECT 1 FROM public.shift_checklist_items sci WHERE sci.shift_id = s.id)
  LOOP
    PERFORM public.snapshot_checklist_for_shift(r.id);
  END LOOP;

  INSERT INTO public.shifts (
    property_id, cleaner_user_id, start_at, end_at, status, source, last_modified_by
  )
  SELECT
    v_hq,
    v_anna,
    (current_date + 1) + time '09:00',
    (current_date + 1) + time '11:00',
    'Godkänt',
    'one_off',
    v_admin
  WHERE NOT EXISTS (
    SELECT 1 FROM public.shifts s
    WHERE s.property_id = v_hq
      AND s.source = 'one_off'
      AND s.start_at::date = current_date + 1
  );

  FOR r IN
    SELECT s.id FROM public.shifts s
    WHERE s.property_id = v_hq AND s.source = 'one_off'
      AND NOT EXISTS (SELECT 1 FROM public.shift_checklist_items sci WHERE sci.shift_id = s.id)
  LOOP
    PERFORM public.snapshot_checklist_for_shift(r.id);
  END LOOP;

  SELECT s.id INTO v_sick
  FROM public.shifts s
  WHERE s.cleaner_user_id = v_anna
    AND s.start_at > now() + interval '72 hours'
    AND s.start_at < now() + interval '200 hours'
  ORDER BY s.start_at
  LIMIT 1;

  IF v_sick IS NOT NULL THEN
    UPDATE public.shifts SET status = 'Sjukanmäld' WHERE id = v_sick;
    INSERT INTO public.shift_events (shift_id, actor_user_id, event_type, payload)
    VALUES (v_sick, v_anna, 'sick_reported', '{"reason":"Förkyld, hög feber."}'::jsonb);
    INSERT INTO public.notifications (recipient_user_id, channel, kind, payload)
    VALUES (v_admin, 'in_app', 'sick_reported', jsonb_build_object('shift_id', v_sick));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.incidents WHERE title = 'Toalettpapper slut') THEN
    INSERT INTO public.incidents (
      org_id, shift_id, property_id, reported_by_user_id, reporter_role,
      kind, category, title, description, status
    )
    SELECT
      v_org, s.id, v_hq, v_anna, 'cleaner',
      'cleaner_issue', 'missing_supplies',
      'Toalettpapper slut',
      'Slut på toalettpapper på herrtoaletten. Fyllde på med reservpaket från städskrubben.',
      'open'
    FROM public.shifts s
    WHERE s.property_id = v_hq AND s.status = 'Utfört'
    LIMIT 1;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.incidents WHERE title = 'Mötesrum 2 ostädat') THEN
    INSERT INTO public.incidents (
      org_id, shift_id, property_id, reported_by_user_id, reporter_role,
      kind, category, title, description, status
    )
    SELECT
      v_org, s.id, v_noff, v_per, 'customer',
      'customer_complaint', 'missed_area',
      'Mötesrum 2 ostädat',
      'Mötesrum 2 verkar inte ha städats – bord ej avtorkat och papperskorgen full.',
      'open'
    FROM public.shifts s
    WHERE s.property_id = v_noff AND s.status = 'Utfört'
    LIMIT 1;
  END IF;
END;
$$;

DROP FUNCTION private.seed_auth_user(uuid, text, public.user_role, uuid, text, text);
