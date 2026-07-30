# Supabase-rollout for iframe-bokning

Den har filen ar korboken for det som maste goras i riktiga Supabase innan bokningsiframen kan testas fullt ut i produktion.

Malet ar att `cleanup.nu` visar lediga tider fran `logincleanup.app`, och att varje publik bokningsforfragan skapar:

- en `booking_requests`-rad
- ett nytt objekt/adress under lead-kunden `Publika forfragningar`
- ett `shifts`-pass med `status = Planerat`
- eventlogg och admin-notis

## 0. Viktigt lage just nu

- Status 2026-07-28: rollout mot Supabase-projektet ar genomford via CLI fallback.
- Lokal kod ar klar for databas, Edge Functions, admin-tillganglighet och iframe-route.
- Target project enligt lokal CLI: `bkmnlcdsbvpucpqmaycx`
- Project name enligt lokal CLI: `CleanUp`
- Supabase URL: `https://bkmnlcdsbvpucpqmaycx.supabase.co`
- CleanUp org i databasen: `a0000000-0000-4000-8000-000000000001`
- Lead-kund for publika forfragningar: `87e4bb0a-3f1a-463d-bc34-4b43d5748c74`
- MCP-problem just nu: Supabase MCP kan lasa projekt i organisationen `grfrmstyzdmxtpqjibnt`, men CleanUp ligger i separat Supabase-org `fndjjirlooqipiyfnitk`.
- MCP returnerar `INVALID_ARGUMENT` for `bkmnlcdsbvpucpqmaycx`; anvand CLI eller koppla MCP till CleanUp-kontot/org.

Vi ska inte applicera detta mot ett annat projekt av misstag.

## Rollout-resultat 2026-07-28

Genomfort:

1. CLI lankad till `bkmnlcdsbvpucpqmaycx`.
2. Lead-kund `Publika forfragningar` skapad.
3. Migration `20260727203034_public_booking_availability.sql` applicerad.
4. Migration `20260727203433_public_booking_request_rpc.sql` applicerad.
5. Edge Function `public-availability` deployad med `verify_jwt = false`.
6. Edge Function `public-booking-request` deployad med `verify_jwt = false`.
7. Secrets satta:
   - `PUBLIC_BOOKING_ORG_ID`
   - `PUBLIC_BOOKING_LEAD_CUSTOMER_ID`
   - `PUBLIC_BOOKING_ALLOWED_ORIGINS`
   - 2026-07-28: preview-testdomanen `https://cleanup-hiwanadili-4266s-projects.vercel.app` lades till i allowed origins.
8. Live-test genomfort:
   - skapade testslot
   - `public-availability` returnerade slotten
   - `public-booking-request` skapade `booking_request`, `Planerat` shift, event och adminnotiser
   - dubbelbokning stoppades med HTTP `409` och `slot_unavailable`
   - testslot/testbooking/testshift/testproperty/testnotiser bortstadade efter verifiering

Riktad advisor-status:

- Inga advisor-traf far `create_public_booking_request`, `booking_availability_slots` eller `booking_requests` efter policy-stadning.
- Det finns kvar aldre advisor-varningar i projektet, framfor allt `properties_customer` security definer view och flera befintliga security definer/helper-funktioner. De hor inte till iframe-rollouten och bor hanteras separat.

Frontend/hosting-status:

- `npm run build` passerar lokalt och skriver `dist/`.
- Lokal `.vercel/project.json` saknas och `vercel` CLI finns inte i PATH.
- Vercel MCP `deploy current project` returnerade `INVALID_ARGUMENT`, troligen eftersom detta workspace inte ar kopplat till ratt Vercel-projekt.
- Nasta manuella hostingsteg ar att deploya senaste repo-state till det Vercel-projekt som serverar `logincleanup.app` / `inlogg.cleanup.nu`.

## 1. Bekrafta ratt Supabase-projekt

I Supabase Dashboard:

1. Oppna projektet som hor till `logincleanup.app`.
2. Ga till `Project Settings -> General`.
3. Kontrollera `Reference ID`.

Forvantat:

```txt
bkmnlcdsbvpucpqmaycx
```

Om dashboarden visar en annan project ref:

1. Skriv ner den nya refen.
2. Byt alla kommandon i den har filen fran `bkmnlcdsbvpucpqmaycx` till den riktiga refen.
3. Uppdatera aven `SUPABASE_URL`:

```txt
https://<riktig-project-ref>.supabase.co
```

## 2. Hitta `org_id` och admin-anvandare

Kor i Supabase SQL Editor pa ratt projekt:

```sql
select id, name, slug, created_at
from public.organizations
order by created_at;
```

Forvantat: en rad for CleanUp, ofta `slug = 'cleanup'`.

Spara vardet:

```txt
PUBLIC_BOOKING_ORG_ID=<organization id>
```

Hitta en aktiv admin som kan vara primar kontakt for lead-kunden:

```sql
select id, org_id, name, email, role, active
from public.users
where role = 'admin'
order by created_at;
```

Spara `id` for en aktiv admin. Det anvands bara om lead-kunden maste skapas.

## 3. Skapa eller hitta lead-kunden

Vi anvander en intern lead-kund i V1:

```txt
Publika forfragningar
```

Kontrollera om den redan finns:

```sql
select id, org_id, name, primary_contact_user_id, created_at
from public.customers
where lower(name) in ('publika forfragningar', 'publika förfrågningar')
order by created_at;
```

Om den finns: spara `id` som:

```txt
PUBLIC_BOOKING_LEAD_CUSTOMER_ID=<customer id>
```

Om den saknas: skapa den med placeholders. Byt ut `ORG_ID_HAR` och `ADMIN_USER_ID_HAR`.

```sql
insert into public.customers (
  org_id,
  name,
  org_number,
  primary_contact_user_id,
  notes
)
values (
  'ORG_ID_HAR',
  'Publika forfragningar',
  null,
  'ADMIN_USER_ID_HAR',
  'Intern lead-kund for publika bokningsforfragningar fran cleanup.nu'
)
returning id, org_id, name;
```

Spara returnerat `id` som:

```txt
PUBLIC_BOOKING_LEAD_CUSTOMER_ID=<customer id>
```

## 4. Rekommenderad vag: fixa MCP och lat Codex kora rollout

Det har ar basta vagen nar accessen fungerar.

1. Koppla Supabase MCP till samma Supabase-konto/org som ager CleanUp-projektet.
2. Ladda om Codex-sessionen efter OAuth/koppling.
3. Be Codex kontrollera projektet igen.
4. Codex ska kunna lasa/deploya mot:

```txt
bkmnlcdsbvpucpqmaycx
```

Nar MCP fungerar ska Codex kora:

1. Apply migration `public_booking_availability`
2. Apply migration `public_booking_request_rpc`
3. Deploy Edge Function `public-availability`
4. Deploy Edge Function `public-booking-request`
5. Kontrollera advisors/security/performance
6. Kora testqueries nedan

## 5. Fallback: SQL Editor + CLI

Anvand detta om MCP fortfarande inte kommer at CleanUp-projektet.

### 5.1 Applicera databas-migrationer i SQL Editor

Kor filerna i exakt denna ordning i Supabase SQL Editor:

1. `supabase/migrations/20260727203034_public_booking_availability.sql`
2. `supabase/migrations/20260727203433_public_booking_request_rpc.sql`

Viktigt:

- Kor hela filen, inte utvalda delar.
- Kor mot ratt Supabase-projekt.
- Om SQL Editor sager att nagot redan finns, stoppa och las felmeddelandet. Migrationerna ar till stor del idempotenta, men triggers kan klaga om de redan finns.

### 5.2 Deploya Edge Functions med CLI

Fran repo-roten:

```powershell
supabase link --project-ref bkmnlcdsbvpucpqmaycx
supabase functions deploy public-availability --project-ref bkmnlcdsbvpucpqmaycx --no-verify-jwt --use-api
supabase functions deploy public-booking-request --project-ref bkmnlcdsbvpucpqmaycx --no-verify-jwt --use-api
```

Om project ref ar annan, byt `bkmnlcdsbvpucpqmaycx`.

`--no-verify-jwt` ar medvetet har eftersom iframen ar publik. Funktionen skyddar sig med CORS allowlist, validering, honeypot och server-side Supabase access.

### 5.3 Satt Edge Function secrets

I Supabase Dashboard:

1. Ga till `Edge Functions -> Secrets`, eller anvand CLI.
2. Satt:

```txt
PUBLIC_BOOKING_ORG_ID=<org_id fran steg 2>
PUBLIC_BOOKING_LEAD_CUSTOMER_ID=<customer_id fran steg 3>
PUBLIC_BOOKING_ALLOWED_ORIGINS=https://cleanup.nu,https://www.cleanup.nu,https://logincleanup.app,https://inlogg.cleanup.nu
```

CLI-variant:

```powershell
supabase secrets set `
  PUBLIC_BOOKING_ORG_ID=<org_id> `
  PUBLIC_BOOKING_LEAD_CUSTOMER_ID=<lead_customer_id> `
  PUBLIC_BOOKING_ALLOWED_ORIGINS=https://cleanup.nu,https://www.cleanup.nu,https://logincleanup.app,https://inlogg.cleanup.nu `
  --project-ref bkmnlcdsbvpucpqmaycx
```

Supabase tillhandahaller normalt dessa automatiskt i hosted Edge Functions:

```txt
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Lagg aldrig `SUPABASE_SERVICE_ROLE_KEY` i frontend, Vercel frontend-env eller `src/config.js`.

## 6. Verifiera databas efter migration

Kor i SQL Editor:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('booking_availability_slots', 'booking_requests')
order by table_name;
```

Forvantat:

```txt
booking_availability_slots
booking_requests
```

Kontrollera RLS:

```sql
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('booking_availability_slots', 'booking_requests');
```

Forvantat: `rowsecurity = true` pa bada.

Kontrollera policies:

```sql
select schemaname, tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('booking_availability_slots', 'booking_requests')
order by tablename, policyname;
```

Forvantat:

- admin select/write for `booking_availability_slots`
- admin select/write for `booking_requests`
- inga `anon`-policies

Kontrollera grants:

```sql
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('booking_availability_slots', 'booking_requests')
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;
```

Forvantat:

- `authenticated` har rattigheter
- `anon` ska inte ha direkta rattigheter pa dessa tabeller

Kontrollera RPC-rattigheter:

```sql
select
  n.nspname as schema,
  p.proname as function_name,
  pg_get_function_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'create_public_booking_request';
```

Forvantat: en funktion finns.

## 7. Skapa en test-tidslucka

Byt `ORG_ID_HAR` till `PUBLIC_BOOKING_ORG_ID`.

```sql
insert into public.booking_availability_slots (
  org_id,
  starts_at,
  ends_at,
  capacity,
  service_type,
  active,
  note
)
values (
  'ORG_ID_HAR',
  now() + interval '2 days',
  now() + interval '2 days' + interval '3 hours',
  1,
  'standard_cleaning',
  true,
  'Testslot for iframe rollout'
)
returning id, starts_at, ends_at, service_type, capacity;
```

Spara returnerat `id` som:

```txt
TEST_SLOT_ID=<slot id>
```

## 8. Testa Edge Function: availability

Nar `public-availability` ar deployad:

```powershell
curl "https://bkmnlcdsbvpucpqmaycx.supabase.co/functions/v1/public-availability?service_type=standard_cleaning" `
  -H "Origin: https://cleanup.nu"
```

Forvantat:

```json
{
  "slots": [
    {
      "id": "...",
      "starts_at": "...",
      "ends_at": "...",
      "available_capacity": 1,
      "service_type": "standard_cleaning"
    }
  ]
}
```

Om svaret ar 403:

- kontrollera `PUBLIC_BOOKING_ALLOWED_ORIGINS`
- kontrollera att `Origin` ar `https://cleanup.nu`, `https://www.cleanup.nu` eller `https://logincleanup.app`

Om svaret ar 500:

- kontrollera Edge Function logs
- kontrollera att `PUBLIC_BOOKING_ORG_ID` ar satt
- kontrollera att migrationerna ar applicerade

## 9. Testa Edge Function: booking request

Byt `TEST_SLOT_ID` till id:t fran steg 7.

```powershell
curl "https://bkmnlcdsbvpucpqmaycx.supabase.co/functions/v1/public-booking-request" `
  -X POST `
  -H "Origin: https://cleanup.nu" `
  -H "Content-Type: application/json" `
  -d "{\"availability_slot_id\":\"TEST_SLOT_ID\",\"service_type\":\"standard_cleaning\",\"customer_name\":\"Test Kund\",\"customer_email\":\"test@example.com\",\"customer_phone\":\"0701234567\",\"address\":\"Testgatan 1\",\"postal_code\":\"12345\",\"city\":\"Stockholm\",\"area_sqm\":80,\"rooms\":3,\"addons\":{\"windows\":false,\"oven\":false,\"bathrooms\":1},\"estimated_price_sek\":1490,\"message\":\"Test fran rollout\"}"
```

Forvantat:

```json
{
  "ok": true,
  "request_id": "...",
  "shift_id": "...",
  "status": "linked_to_shift"
}
```

Spara `request_id` och `shift_id` om du vill verifiera manuellt.

## 10. Verifiera skapad bokning

Kor i SQL Editor:

```sql
select
  br.id,
  br.status,
  br.customer_name,
  br.customer_email,
  br.requested_starts_at,
  br.shift_id,
  s.status as shift_status,
  s.source as shift_source
from public.booking_requests br
left join public.shifts s on s.id = br.shift_id
where br.customer_email = 'test@example.com'
order by br.created_at desc
limit 5;
```

Forvantat:

- `booking_requests.status = linked_to_shift`
- `shifts.status = Planerat`
- `shifts.source = customer_request`

Kontrollera admin-notis:

```sql
select id, recipient_user_id, kind, payload, created_at
from public.notifications
where kind = 'customer_booking_request'
order by created_at desc
limit 10;
```

## 11. Testa dubbelbokningsskydd

Kor samma booking-request curl en gang till med samma `TEST_SLOT_ID`.

Forvantat:

```json
{
  "error": "slot_unavailable"
}
```

HTTP-status ska vara `409`.

## 12. Testa i appen

Efter database + functions + secrets:

1. Deploya `logincleanup.app` med senaste frontend.
2. Logga in som admin.
3. Ga till:

```txt
/admin/tillganglighet
```

4. Skapa en ny aktiv tidslucka.
5. Oppna:

```txt
https://logincleanup.app/embed/booking
```

6. Kontrollera att tidsluckan visas.
7. Skicka testforfragan.
8. Bekrafta att tack-sidan visas i iframen.
9. Bekrafta att admin ser passet som `Planerat`.

## 13. Koppla iframe pa cleanup.nu

Lagg detta i hero pa `cleanup.nu`:

```html
<div class="cleanup-booking-embed">
  <iframe
    id="cleanup-booking-frame"
    src="https://logincleanup.app/embed/booking"
    title="Boka städning med CleanUp"
    style="width: 100%; min-height: 760px; border: 0; display: block;"
    loading="lazy"
  ></iframe>
  <p>
    <a href="https://logincleanup.app/embed/booking" target="_blank" rel="noopener">
      Öppna bokningen i nytt fönster
    </a>
  </p>
</div>

<script>
  window.addEventListener('message', event => {
    if (event.origin !== 'https://logincleanup.app') return;
    if (event.data?.type !== 'cleanup.booking.height') return;

    const frame = document.getElementById('cleanup-booking-frame');
    if (!frame) return;

    const height = Number(event.data.height);
    if (Number.isFinite(height)) {
      frame.style.height = `${Math.max(760, height)}px`;
    }
  });
</script>
```

Om `logincleanup.app` i produktion egentligen ar `https://inlogg.cleanup.nu`, byt URL:en i iframe och CORS/allowed origins sa de matchar verklig host.

## 14. Stada testdata efter verifiering

Om du vill ta bort testforfragan fran SQL Editor:

```sql
delete from public.booking_requests
where customer_email = 'test@example.com';

delete from public.notifications
where kind = 'customer_booking_request'
  and payload::text ilike '%test%';

delete from public.shifts
where notes ilike '%test@example.com%';

delete from public.properties
where notes ilike '%test@example.com%';

delete from public.booking_availability_slots
where note = 'Testslot for iframe rollout';
```

Gor detta bara for testdata.

## 15. Stopplista

Stoppa rollout och felsok om nagot av detta hander:

- Project ref i dashboard matchar inte det projekt du tror ar CleanUp.
- MCP visar ett annat projekt eller annan organisation.
- `anon` far direkta rattigheter till `booking_requests`.
- Edge Function returnerar interna stack traces till klienten.
- `public-booking-request` skapar booking men inget `Planerat` shift.
- Samma slot med `capacity = 1` kan bokas tva ganger.
- Iframen blockeras av browsern med frame/CSP-fel.

## 16. Kvar innan vi kan kalla det klart

1. Deploya senaste frontend for `logincleanup.app` med nya `/embed/booking`.
2. Logga in som admin och skapa en riktig tillganglig tid i `/admin/tillganglighet`.
3. Oppna `https://logincleanup.app/embed/booking` och kontrollera att tiden visas.
4. `cleanup.nu` hero ska fa iframe-snippet.
5. Sluttesta fran `cleanup.nu`:
   - admin skapar slot
   - iframe visar slot
   - publik forfragan skickas
   - tack-sida visas
   - admin ser `Planerat`
   - slotten forsvinner/blir full

## Kallor kontrollerade

- Supabase Function Configuration: `verify_jwt = false` kan sattas for publika Edge Functions.
- Supabase RLS docs: RLS ska vara aktivt pa exponerade tabeller och policies styr radatkomst.
- Supabase MCP docs/setup: MCP-access beror pa ratt autentisering och projekt/org-access.

## 17. Smart tidsbokning inom tillganglighetsfonster

Denna rollout gor adminens tillganglighet till ett arbetsfonster. Exempel:

- Admin skapar hemstadning mandag `08:00-17:00`.
- Kunden anger kvm, systemet raknar stadtid.
- Iframen visar faktiska starttider i 30-minuterssteg, till exempel `07:30-10:30`, `08:00-11:00`, `08:30-11:30`.
- Systemet blockerar vald stadtid plus 30 min buffer for marginal/restid.
- Nar kunden skickar forfragan sparas exakt kundtid pa passet och booking request.

Kors i denna ordning:

1. Kor SQL-filen i Supabase SQL Editor:
   `supabase/migrations/20260729094416_smart_booking_windows.sql`
2. Deploya Edge Functions:

```bash
supabase functions deploy public-availability public-booking-request --project-ref bkmnlcdsbvpucpqmaycx --use-api
```

3. Pusha/deploya frontend.
4. Testa med ett fonster `08:00-17:00` och hemstadning `51-90 kvm`.
5. Kontrollera att kunden ser 3-timmarstider i 30-minuterssteg och att admin far ett pass med exakt vald tid.

Viktigt: Edge Functions ska inte deployas fore SQL-filen, eftersom `public-booking-request` skickar `requested_starts_at` och `requested_ends_at` till RPC-funktionen.

## 18. Kundportal fas 1: datamodell

Syfte: forbereda databasen sa en publik bokningsforfragan senare kan kopplas till kundens portal, utan att andra floden andras i denna fas.

Kor SQL-filen:

```sql
-- Supabase SQL Editor eller CLI
supabase/migrations/20260729123707_customer_portal_access_phase1.sql
```

Detta lagger till pa `booking_requests`:

- `portal_user_id`
- `portal_customer_id`
- `portal_access_status`
- `portal_access_created_at`
- `portal_invited_at`
- `portal_last_magic_link_sent_at`
- `portal_redirect_path`

Fas 1 skickar inga mejl, skapar inga auth-users och andrar inte adminens godkannande. Det ar bara grunden for fas 2, dar godkand forfragan ska skapa/koppla kundkonto och forbereda magic-link-inbjudan.

## 19. Kundportal fas 2: koppling vid godkannande

Syfte: nar admin godkanner en publik bokningsforfragan ska passet kopplas till en riktig kundportal-identitet, men utan att skicka mejl annu.

Kor SQL-filen:

```sql
-- Supabase SQL Editor eller CLI
supabase/migrations/20260729124223_customer_portal_approval_provisioning.sql
```

Detta skapar RPC:n:

```sql
public.admin_prepare_customer_portal_for_booking_request(p_shift_id uuid)
```

Nar `approveShift` kors:

1. Passet markeras `Godkant`.
2. `booking_requests.status` markeras `approved`.
3. RPC:n skapar/ateranvander kundens `public.users`/Auth-rad via befintlig provisionering.
4. RPC:n skapar/ateranvander `customers`.
5. Objektet fran bokningsforfragan flyttas till kundens `customer_id`.
6. `booking_requests.portal_access_status` blir `created`.
7. `booking_requests.portal_redirect_path` blir `/kund/pass/{shiftId}`.

Fas 2 skickar fortfarande inga mejl. Det kommer i nasta fas nar vi lagger till serverstyrd magic-link/invite och markerar `portal_access_status = invited`.

## 20. Kundportal fas 3: magic-link via mejl

Syfte: nar admin godkanner en publik bokningsforfragan kan kunden fa en personlig magic-link till kundportalen.

Deploya Edge Function:

```bash
supabase functions deploy send-customer-portal-invite --project-ref bkmnlcdsbvpucpqmaycx --use-api
```

Secrets som maste finnas i Supabase:

- `SUPABASE_URL` - satts normalt automatiskt
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` - satts normalt automatiskt
- `RESEND_API_KEY`
- `RESEND_FROM`
- `CUSTOMER_PORTAL_SITE_URL` - rekommenderat: `https://www.logincleanup.app/CleanUp.html`

Flode:

1. Admin godkanner bokningen.
2. Fas 2 skapar/kopplar kundportal.
3. `send-customer-portal-invite` genererar magic-link med Supabase Auth Admin `generateLink`.
4. Mejlet skickas via Resend.
5. `booking_requests.portal_access_status` blir `invited`.
6. `portal_invited_at` och `portal_last_magic_link_sent_at` sparas.

Admin kan ocksa skicka/skicka om kundlanken fran bokningskortet pa passets detaljsida. Om `RESEND_API_KEY` eller `RESEND_FROM` saknas blir bokningen fortsatt godkand, men mejlet skickas inte.

Viktigt i Supabase Auth URL configuration: lagg till redirect URL for `https://www.logincleanup.app/CleanUp.html` sa magic-link-redirecten tillats.

## 21. Kundportal fas 4: aktiv portalstatus

Syfte: nar kunden faktiskt oppnar magic-linken och landar pa sitt pass ska bokningsforfragan markeras som aktiv i admin.

Kor SQL-filen:

```sql
supabase/migrations/20260729130115_customer_portal_active_status.sql
```

Detta skapar RPC:n:

```sql
public.mark_customer_portal_active(p_shift_id uuid)
```

Flode:

1. Kunden klickar magic-linken.
2. Appen laser `portalRedirect=/kund/pass/{shiftId}`.
3. Kunden skickas till ratt passvy.
4. Appen anropar `mark_customer_portal_active`.
5. Endast raden dar `booking_requests.portal_user_id = auth.uid()` far uppdateras.
6. `booking_requests.portal_access_status` blir `active`.

Fas 4 andrade inte avbokningsregeln. Fas 5 nedan flyttar kundavbokning till en serverstyrd 24h-regel.

## 22. Kundportal fas 5: serverstyrd 24h-avbokning

Syfte: kunden ska kunna avboka bekräftade pass via portalen fram till 24 timmar före planerad start, men regeln ska kontrolleras i databasen och inte enbart i klienten.

Kor SQL-filen:

```sql
supabase/migrations/20260729133131_customer_cancel_24h_rpc.sql
```

Detta skapar RPC:n:

```sql
public.customer_cancel_shift(p_shift_id uuid, p_reason text)
```

Flode:

1. Kunden trycker "Avboka pass" i kundportalen.
2. Klienten anropar `customer_cancel_shift`.
3. Databasen kontrollerar att inloggad kund har access till passets objekt.
4. Databasen kontrollerar att passet ar `Planerat` eller `Godkant`.
5. Databasen blockerar avbokning om planerad start ar inom 24 timmar.
6. Vid godkand avbokning markeras passet `Avbokat`, orsak sparas och en `customer_cancelled`-handelse skapas.

Migrationen tar ocksa bort den gamla direkta kund-update-policyn pa `shifts`, sa 24h-regeln inte kan rundas via direkt API-anrop.

## 23. Kundportal fas 6: robust magic-link-landning

Syfte: kunden ska alltid hamna i kundportalen pa ett begripligt stalle efter magic-link.

Klientflode:

1. Om magic-linken innehaller `portalRedirect=/kund/pass/{shiftId}` skickas kunden direkt till passet.
2. Om magic-linken pekar pa `/kund/oversikt` visas en kort bekräftelse i kundöversikten.
3. Om `portalRedirect` pekar pa en okand kundroute skickas kunden till `/kund/oversikt` i stallet for en trasig vy.
4. Nar kunden landar pa översikten finns knapp vidare till schema och kommande pass syns direkt.

Ingen ny SQL kravs for fas 6.

## 24. Kundportal fas 7: Mina bokningar

Syfte: kunden ska kunna se sina bokningar både som kalender och som tydlig lista.

Klientflode:

1. Kundens `Schema`-vy heter nu `Schema & bokningar`.
2. Kunden kan växla mellan kalender och lista.
3. Listan har filter for `Kommande`, `Väntar`, `Historik`, `Avbokade` och `Alla`.
4. Varje rad visar datum, tid, objekt, adress och status.
5. Klick pa en rad oppnar samma passdetalj som magic-linken.

Ingen ny SQL kravs for fas 7.

## 25. Kundportal fas 8: egen profil

Syfte: kunden ska kunna hålla sina egna kontaktuppgifter uppdaterade i portalen utan att skapa ny profil.

Klientflode:

1. Kund och kundanställd kan ändra namn och telefon på `Inställningar`.
2. E-post visas men är låst eftersom den används för Supabase Auth och magic-link.
3. Byte av e-post hanteras senare som en separat säker Auth-fas.
4. Uppdateringen sparas på inloggad användares egen `public.users`-rad.

Ingen ny SQL kravs for fas 8. Befintlig RLS-policy `users_self_update` används.

## 26. Kundportal fas 9: PDF-bokningsbekräftelse

Syfte: kunden ska kunna ladda ner en enkel bokningsbekräftelse från sin passvy i kundportalen.

Klientflode:

1. Kunden öppnar ett pass i `Schema & bokningar`.
2. Sidokolumnen visar ett nytt dokumentkort.
3. Kunden klickar `Bokningsbekräftelse`.
4. PDF:en innehåller passets status, datum, tid, objekt, adress och kundens kontaktuppgifter.
5. Om passet har en publik bokningsförfrågan kopplad inkluderas även offertunderlaget, samtycken och eventuella tillägg.

Ingen ny SQL kravs for fas 9.

## 27. Kundportal fas 10: bokningsstatus i passvyn

Syfte: kunden ska snabbt förstå vad som händer med ett bokat pass utan att behöva tolka interna statusar.

Klientflode:

1. Kunden öppnar ett pass i kundportalen.
2. Sidokolumnen visar `Bokningsstatus`.
3. Kortet visar bokad tid, bekräftelse/avbokning, start/incheckning och klar/utcheckning.
4. Vid avbokade eller borttagna pass visas en kort förklaring.
5. Vid utförda pass visas att passet är klart, och faktisk utcheckning visas när den finns.

Ingen ny SQL kravs for fas 10.

## 28. Kundportal fas 11: tydligare e-postnotiser

Syfte: kund, städare och admin ska få mer begripliga transaktionella mejl när befintliga notiser skapas.

Edge Function:

```text
supabase/functions/send-notification-email
```

Flode:

1. Appen skapar in-app-notiser som tidigare.
2. `insert_notifications` returnerar notis-id.
3. Klienten anropar `send-notification-email` för varje ny notis.
4. Edge Function hämtar mottagare, pass/objekt och bygger svensk mall.
5. Kunder får CTA till kundportalen.
6. Admin och städare får CTA till rätt schema-vy i portalen.

Ingen ny SQL kravs for fas 11. Kräver att `RESEND_API_KEY`, `RESEND_FROM` och `CUSTOMER_PORTAL_SITE_URL` finns som Edge Function secrets.

## 29. Kundportal fas 12: bokningsvillkor och GDPR i iframe

Syfte: kunden ska förstå de viktigaste villkoren innan förfrågan skickas, och godkännandet ska kunna följas i admin/PDF.

Klientflode:

1. Kontaktsteget i iframe visar en kort sammanfattning av villkoren.
2. Kunden måste godkänna bokningsvillkor och GDPR-information innan förfrågan skickas.
3. Formuläret sparar `policy_accepted`, `policy_version`, `privacy_notice_accepted`, `privacy_notice_version` och `accepted_at_client` i `booking_requests.addons`.
4. Tack-sidan bekräftar att godkännandet sparats med förfrågan.
5. PDF-bekräftelsen använder samma versions-id som formuläret.

Ingen ny SQL kravs for fas 12. Befintligt `addons`-fält används.

## 30. Kundportal fas 13: hemstädningsupplägg i kundens passvy

Syfte: kunden ska tydligt se upplägget för hemstädning, särskilt återkommande städning varje vecka eller varannan vecka.

Klientflode:

1. Kunden öppnar ett hemstädningspass i kundportalen.
2. Passvyn visar ett separat kort för `Hemstädning`.
3. Kortet visar frekvens, pris per tillfälle, beräknad tid och timpris efter RUT.
4. Om fler pass på samma objekt finns visar kortet nästa planerade pass.
5. Kortet förklarar att faktisk tid debiteras utifrån in- och utcheckning/GPS.

Ingen ny SQL kravs for fas 13. Befintliga värden i `booking_requests.addons` används.

## 31. Kundportal fas 14: adminjustering av pris före godkännande

Syfte: admin ska kunna justera priset efter dialog med kund innan en publik bokningsförfrågan godkänns.

Klientflode:

1. Admin öppnar ett planerat pass som kommer från publik bokningsförfrågan.
2. Admin klickar `Justera pris`.
3. Admin anger nytt pris och valfri intern notering.
4. Appen sparar nytt `estimated_price_sek` och prismetadata i `booking_requests.addons`.
5. Adminvyn, kundens hemstädningskort och PDF-bekräftelsen visar bekräftat pris när priset är justerat.

Ingen ny SQL kravs for fas 14. Produktion verifierad: `booking_requests.estimated_price_sek`, `booking_requests.addons` och admin-update-policy finns.

## 32. Kundportal fas 15: tjänstemallar för städschema

Syfte: admin ska tydligt se vilken städmall som kopplas till en publik bokning, och samma mall ska följa med i PDF-underlaget.

Klientflode:

1. Publika bokningar använder intern tjänstemall för hemstädning, storstädning, flyttstädning och fönsterputs.
2. Tillägg som fönsterputs och ugnsrengöring läggs automatiskt till i mallen när kunden valt dem.
3. Admin ser en förhandsvisning av mallen direkt på bokningsförfrågan.
4. När bokningen godkänns skapas passets städschema från samma mall om passet saknar städschema.
5. PDF-bekräftelsen innehåller sektionen `Städmall som kopplas till bokningen`.

Ingen ny SQL kravs for fas 15. Mallen ligger i appens interna tjänstekatalog och använder befintlig checklist-snapshot.
