-- CleanUp · initial schema (mvpfinal.md §5)
-- Multi-tenant via organizations; users.id = auth.users.id

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE public.user_role AS ENUM (
  'admin',
  'cleaner',
  'customer',
  'customer_employee'
);

CREATE TYPE public.scope_type AS ENUM ('all_properties', 'selected');

CREATE TYPE public.shift_source AS ENUM ('recurring', 'manual', 'one_off');

CREATE TYPE public.incident_kind AS ENUM ('cleaner_issue', 'customer_complaint');

CREATE TYPE public.incident_status AS ENUM ('open', 'in_progress', 'resolved');

CREATE TYPE public.reporter_role AS ENUM ('cleaner', 'customer', 'customer_employee');

CREATE TYPE public.notification_channel AS ENUM ('in_app', 'email');

-- ---------------------------------------------------------------------------
-- Utilities
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ISO weekday: måndag = 0 … söndag = 6 (matchar mock.jsx)
CREATE OR REPLACE FUNCTION public.iso_weekday(d date)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ((EXTRACT(DOW FROM d)::int + 6) % 7);
$$;

-- ---------------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------------
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  accent_color text NOT NULL DEFAULT '#f2603c',
  theme_round text NOT NULL DEFAULT 'Standard',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.users (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE RESTRICT,
  role public.user_role NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX users_org_id_idx ON public.users (org_id);
CREATE INDEX users_role_idx ON public.users (role);
CREATE UNIQUE INDEX users_email_org_idx ON public.users (org_id, lower(email));

CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE RESTRICT,
  name text NOT NULL,
  org_number text,
  primary_contact_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER customers_set_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX customers_org_id_idx ON public.customers (org_id);

CREATE TABLE public.customer_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  scope public.scope_type NOT NULL DEFAULT 'all_properties',
  created_by_admin_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, user_id)
);

CREATE INDEX customer_employees_user_id_idx ON public.customer_employees (user_id);

CREATE TABLE public.customer_employee_properties (
  customer_employee_id uuid NOT NULL REFERENCES public.customer_employees (id) ON DELETE CASCADE,
  property_id uuid NOT NULL,
  PRIMARY KEY (customer_employee_id, property_id)
);

CREATE TABLE public.properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers (id) ON DELETE CASCADE,
  name text NOT NULL,
  address text NOT NULL DEFAULT '',
  area_sqm integer,
  access_info text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER properties_set_updated_at
  BEFORE UPDATE ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX properties_customer_id_idx ON public.properties (customer_id);

ALTER TABLE public.customer_employee_properties
  ADD CONSTRAINT customer_employee_properties_property_id_fkey
  FOREIGN KEY (property_id) REFERENCES public.properties (id) ON DELETE CASCADE;

CREATE TABLE public.property_cleaners (
  property_id uuid NOT NULL REFERENCES public.properties (id) ON DELETE CASCADE,
  cleaner_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, cleaner_user_id)
);

CREATE TABLE public.recurring_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties (id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday >= 0 AND weekday <= 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  default_cleaner_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  valid_from date,
  valid_to date,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

CREATE INDEX recurring_schedules_property_idx ON public.recurring_schedules (property_id);

CREATE TABLE public.shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties (id) ON DELETE CASCADE,
  cleaner_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'Godkänt',
  source public.shift_source NOT NULL DEFAULT 'recurring',
  recurring_id uuid REFERENCES public.recurring_schedules (id) ON DELETE SET NULL,
  original_start_at timestamptz,
  original_end_at timestamptz,
  last_modified_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  notes text NOT NULL DEFAULT '',
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at),
  CHECK (
    status IN (
      'Planerat',
      'Godkänt',
      'Pågående',
      'Utfört',
      'Sjukanmäld',
      'Pausat (kundledighet)',
      'Avbokat',
      'Borttaget'
    )
  )
);

CREATE TRIGGER shifts_set_updated_at
  BEFORE UPDATE ON public.shifts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX shifts_property_start_idx ON public.shifts (property_id, start_at);
CREATE INDEX shifts_cleaner_start_idx ON public.shifts (cleaner_user_id, start_at);
CREATE INDEX shifts_status_idx ON public.shifts (status);

CREATE TABLE public.shift_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.shifts (id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX shift_events_shift_id_idx ON public.shift_events (shift_id, created_at DESC);

CREATE TABLE public.cleaning_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties (id) ON DELETE CASCADE,
  title text NOT NULL,
  position integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, position)
);

CREATE INDEX cleaning_checklists_property_idx ON public.cleaning_checklists (property_id, position);

CREATE TABLE public.shift_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.shifts (id) ON DELETE CASCADE,
  title text NOT NULL,
  position integer NOT NULL,
  done_at timestamptz,
  done_by_cleaner_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX shift_checklist_items_shift_idx ON public.shift_checklist_items (shift_id, position);

CREATE TABLE public.customer_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers (id) ON DELETE CASCADE,
  created_by_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
  scope public.scope_type NOT NULL DEFAULT 'all_properties',
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE TABLE public.customer_holiday_properties (
  customer_holiday_id uuid NOT NULL REFERENCES public.customer_holidays (id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties (id) ON DELETE CASCADE,
  PRIMARY KEY (customer_holiday_id, property_id)
);

CREATE TABLE public.incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE RESTRICT,
  shift_id uuid REFERENCES public.shifts (id) ON DELETE SET NULL,
  property_id uuid NOT NULL REFERENCES public.properties (id) ON DELETE CASCADE,
  reported_by_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
  reporter_role public.reporter_role NOT NULL,
  kind public.incident_kind NOT NULL,
  category text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  status public.incident_status NOT NULL DEFAULT 'open',
  resolved_by_admin_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER incidents_set_updated_at
  BEFORE UPDATE ON public.incidents
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX incidents_org_status_idx ON public.incidents (org_id, status, created_at DESC);
CREATE INDEX incidents_property_idx ON public.incidents (property_id);

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  channel public.notification_channel NOT NULL DEFAULT 'in_app',
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_recipient_idx ON public.notifications (recipient_user_id, read_at, created_at DESC);

-- ---------------------------------------------------------------------------
-- Views (kund ser aldrig access_info eller städarnas PII)
-- ---------------------------------------------------------------------------
CREATE VIEW public.properties_customer
WITH (security_invoker = true) AS
SELECT
  id,
  customer_id,
  name,
  address,
  area_sqm,
  notes,
  created_at,
  updated_at
FROM public.properties;

CREATE VIEW public.cleaners_public
WITH (security_invoker = true) AS
SELECT id
FROM public.users
WHERE role = 'cleaner';

-- ---------------------------------------------------------------------------
-- Auth: skapa public.users vid ny auth.users
-- Roll/org sätts i raw_app_meta_data vid inbjudan (inte user_metadata).
-- ---------------------------------------------------------------------------
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
  IF NEW.raw_app_meta_data ? 'org_id' THEN
    v_org_id := (NEW.raw_app_meta_data ->> 'org_id')::uuid;
  ELSE
    SELECT id INTO v_org_id FROM public.organizations ORDER BY created_at LIMIT 1;
  END IF;

  IF NEW.raw_app_meta_data ? 'role' THEN
    v_role := (NEW.raw_app_meta_data ->> 'role')::public.user_role;
  ELSE
    v_role := 'customer';
  END IF;

  INSERT INTO public.users (id, org_id, role, name, email, phone, active)
  VALUES (
    NEW.id,
    v_org_id,
    v_role,
    COALESCE(NEW.raw_user_meta_data ->> 'name', split_part(NEW.email, '@', 1)),
    NEW.email,
    NEW.raw_user_meta_data ->> 'phone',
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

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Generera pass från återkommande scheman (4 v bakåt, 12 v framåt)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_shifts_from_recurring(
  p_from date DEFAULT (current_date - 28),
  p_to date DEFAULT (current_date + 84)
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  d date;
  v_start timestamptz;
  v_end timestamptz;
  v_status text;
  v_count integer := 0;
  v_inserted integer;
BEGIN
  FOR d IN SELECT generate_series(p_from, p_to, '1 day'::interval)::date LOOP
    FOR r IN
      SELECT *
      FROM public.recurring_schedules
      WHERE active
        AND weekday = public.iso_weekday(d)
        AND (valid_from IS NULL OR d >= valid_from)
        AND (valid_to IS NULL OR d <= valid_to)
    LOOP
      v_start := d + r.start_time;
      v_end := d + r.end_time;
      IF v_end <= now() THEN
        v_status := 'Utfört';
      ELSE
        v_status := 'Godkänt';
      END IF;

      INSERT INTO public.shifts (
        property_id,
        cleaner_user_id,
        start_at,
        end_at,
        status,
        source,
        recurring_id,
        last_modified_by,
        checked_in_at,
        checked_out_at
      )
      SELECT
        r.property_id,
        r.default_cleaner_user_id,
        v_start,
        v_end,
        v_status,
        'recurring',
        r.id,
        (SELECT id FROM public.users WHERE role = 'admin' LIMIT 1),
        CASE WHEN v_status = 'Utfört' THEN v_start + interval '5 minutes' END,
        CASE WHEN v_status = 'Utfört' THEN v_end - interval '2 minutes' END
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.shifts s
        WHERE s.property_id = r.property_id
          AND s.recurring_id = r.id
          AND s.start_at = v_start
      );

      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      v_count := v_count + v_inserted;
    END LOOP;
  END LOOP;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.snapshot_checklist_for_shift(p_shift_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_property_id uuid;
  v_done boolean;
  v_cleaner uuid;
  v_end timestamptz;
BEGIN
  SELECT s.property_id, (s.status = 'Utfört'), s.cleaner_user_id, s.end_at
  INTO v_property_id, v_done, v_cleaner, v_end
  FROM public.shifts s
  WHERE s.id = p_shift_id;

  IF v_property_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.shift_checklist_items (shift_id, title, position, done_at, done_by_cleaner_user_id)
  SELECT
    p_shift_id,
    c.title,
    c.position,
    CASE WHEN v_done THEN v_end - ((max_pos.max_p - c.position + 1) * interval '1 minute') END,
    CASE WHEN v_done THEN v_cleaner END
  FROM public.cleaning_checklists c
  CROSS JOIN LATERAL (
    SELECT max(position) AS max_p FROM public.cleaning_checklists WHERE property_id = v_property_id AND active
  ) max_pos
  WHERE c.property_id = v_property_id
    AND c.active
    AND NOT EXISTS (
      SELECT 1 FROM public.shift_checklist_items sci WHERE sci.shift_id = p_shift_id
    );
END;
$$;

COMMENT ON TABLE public.organizations IS 'Städföretag (tenant)';
COMMENT ON TABLE public.users IS 'App-profiler; id = auth.users.id';
COMMENT ON VIEW public.properties_customer IS 'Objekt utan access_info för kundroller';
COMMENT ON VIEW public.cleaners_public IS 'Endast id – kund ser "Städare" i UI';
