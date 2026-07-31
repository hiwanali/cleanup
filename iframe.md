# CleanUp iframe: kalkylator, bokning och synkad tillgänglighet

Det här dokumentet beskriver hur vi bygger en bokningswidget i iframe för `cleanup.nu`, där kalendern är synkad med tillgängligheten som admin styr i `logincleanup.app`.

Målet är:

1. Admin anger tillgängliga tider i `logincleanup.app`.
2. Iframen på `cleanup.nu` visar endast tider som admin har öppnat.
3. Kunden räknar pris, väljer en ledig tid och skickar bokningsförfrågan.
4. Förfrågan landar i `logincleanup.app` som `Planerat`.
5. Admin godkänner eller avslår.
6. Godkänd bokning blir ett riktigt pass i kalendern och tiden slutar visas som ledig i iframen.

## Låst slutmål för V1

V1 ska vara en kontrollerad bokningsförfrågan, inte ett fullautomatiskt bokningssystem.

Vi bygger:

- manuellt skapade exakta tidsluckor i admin, t.ex. `2026-08-04 09:00-12:00`
- iframe med kalkylator, lediga tider och kontaktformulär
- publik serverfunktion som skapar en bokningsförfrågan
- intern lead-kund `Publika förfrågningar` där publika adresser/objekt samlas
- intern kalenderpost som `Planerat`
- admin-godkännande där städare tilldelas
- reservation av vald tidslucka när förfrågan skickas
- tack-sida i iframen efter skickad förfrågan

Vi bygger inte i V1:

- återkommande tillgänglighetsregler
- direktbokning utan admin-godkännande
- betalning
- SMS
- kund-e-postbekräftelse
- ruttoptimering
- avancerad kapacitetsplanering

Beslut taget: V1 använder manuella exakta tidsluckor. Återkommande tillgänglighet kan läggas till senare när grundflödet fungerar.

Beslut taget: V1 kopplar publika bokningar till en intern lead-kund, t.ex. `Publika förfrågningar`. Vi bygger inte publik kundkontohantering i första versionen.

Beslut taget: en tidslucka reserveras direkt när kunden skickar förfrågan. Den räknas som upptagen medan bokningen är `new`, `linked_to_shift`, `Planerat` eller `Godkänt`, och frigörs om admin avslår/avbokar.

Beslut taget: V1 skickar ingen kund-e-post. Kunden får en tydlig tack-sida i iframen; e-postbekräftelse läggs till senare.

## Nuläge i databasen

Avstämt mot migreringarna i `supabase/migrations`.

Teknisk avstämning:

- Supabase CLI finns installerad och svarar som version `2.109.0`.
- Lokal Supabase-databas kunde inte inspekteras just nu eftersom Docker/Supabase-containern inte kör.
- Projektet har ingen länkad projektref i `supabase/.temp`; därför är avstämningen gjord mot repo:ts migrationsfiler, inte mot produktionsdatabasen.
- Innan implementation bör vi köra migrationslistan mot rätt Supabase-projekt eller lokal databas och jämföra att alla migrationsfiler verkligen är applicerade.

Det som redan finns och går att återanvända:

| Del | Finns? | Kommentar |
| --- | --- | --- |
| `organizations` | Ja | Multi-tenant-grund. |
| `users` | Ja | Roller: `admin`, `cleaner`, `customer`, `customer_employee`. |
| `customers` | Ja | Kundorganisationer. |
| `properties` | Ja | Objekt/adresser kopplade till kund. |
| `recurring_schedules` | Ja | Återkommande interna städscheman. Ska inte blandas ihop med publik tillgänglighet. |
| `shifts` | Ja | Kalenderpass. Har `start_at`, `end_at`, `status`, `source`, `cleaner_user_id`. |
| `shift_source` | Ja | Har ursprungligen `recurring`, `manual`, `one_off`; senare migration lägger till `customer_request`. |
| `shifts_customer_request_insert` | Ja | Inloggade kunder kan skapa `Planerat` pass med `source = customer_request`. |
| `approveShift` / `declineShift` | Ja | Admin kan godkänna `Planerat` till `Godkänt` eller avslå till `Avbokat`. |
| `shift_events` | Ja | Eventlogg, redan används för `customer_booking_requested`, `shift_approved`, `shift_declined`. |
| `notifications` | Ja | Admin-notiser finns, bland annat `customer_booking_request`. |
| Realtime | Ja | `shifts`, `notifications`, `shift_requests` m.fl. är kopplade till realtime. |

Det som saknas för iframe-flödet:

| Del | Saknas? | Varför behövs den? |
| --- | --- | --- |
| Publik tillgänglighet | Ja | Admin behöver kunna öppna/stänga tider som iframen visar. |
| Publik bokningsintake | Ja | Besökare på `cleanup.nu` är inte inloggade kunder och har inget `property_id`. |
| API/Edge Function för iframe | Ja | Iframen ska inte skriva direkt till Supabase-tabeller med adminbehörighet. |
| Dubbelbokningsskydd | Behöver läggas till | Samma lediga tid får inte kunna tas av två förfrågningar samtidigt. |
| Spam/rate limiting | Behöver läggas till | Publikt formulär behöver skydd. |

Viktig slutsats: vi ska bygga vidare på `shifts` och befintligt admin-godkännande, men lägga till en separat publik tillgänglighetsmodell och en serverfunktion som skapar förfrågningar säkert.

## Rekommenderad modell

Använd tre nivåer:

1. `booking_availability_slots`
   Adminstyrda lediga tider som iframen får visa.

2. `booking_requests`
   Publik formulärdata från `cleanup.nu`. Detta är rå intresseanmälan/förfrågan.

3. `shifts`
   Intern kalender. När en publik förfrågan tas emot skapas också ett `Planerat` pass, eller så skapas passet först när admin börjar hantera förfrågan. Rekommendation: skapa `Planerat` pass direkt så admin ser det i kalendern.

## Föreslagna databastabeller

### `booking_availability_slots`

Admin skapar de tider som ska visas i iframen.

```sql
create table public.booking_availability_slots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer not null default 1,
  service_type text not null default 'standard_cleaning',
  active boolean not null default true,
  note text not null default '',
  created_by_user_id uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (capacity > 0)
);
```

Index:

```sql
create index booking_availability_slots_org_start_idx
  on public.booking_availability_slots (org_id, starts_at);

create index booking_availability_slots_active_start_idx
  on public.booking_availability_slots (active, starts_at)
  where active = true;
```

RLS:

```sql
alter table public.booking_availability_slots enable row level security;

create policy booking_availability_slots_admin_select
  on public.booking_availability_slots
  for select to authenticated
  using (public.is_admin() and org_id = public.current_org_id());

create policy booking_availability_slots_admin_write
  on public.booking_availability_slots
  for all to authenticated
  using (public.is_admin() and org_id = public.current_org_id())
  with check (public.is_admin() and org_id = public.current_org_id());
```

Obs: ingen `anon`-policy behövs om all publik läsning går via Edge Function.

### `booking_requests`

Publik bokningsförfrågan från iframe. Här sparar vi kundens uppgifter och kalkylatorresultatet.

```sql
create type public.booking_request_status as enum (
  'new',
  'linked_to_shift',
  'approved',
  'declined',
  'cancelled'
);

create table public.booking_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  availability_slot_id uuid references public.booking_availability_slots (id) on delete set null,
  shift_id uuid references public.shifts (id) on delete set null,

  status public.booking_request_status not null default 'new',
  service_type text not null,
  requested_starts_at timestamptz not null,
  requested_ends_at timestamptz not null,

  customer_name text not null,
  customer_email text not null,
  customer_phone text not null,
  address text not null,
  postal_code text,
  city text,
  area_sqm integer,
  rooms integer,
  addons jsonb not null default '{}'::jsonb,
  estimated_price_sek integer,
  message text not null default '',

  source_domain text not null default 'cleanup.nu',
  ip_hash text,
  user_agent text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (requested_ends_at > requested_starts_at),
  check (length(customer_name) >= 2),
  check (customer_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);
```

Index:

```sql
create index booking_requests_org_created_idx
  on public.booking_requests (org_id, created_at desc);

create index booking_requests_status_idx
  on public.booking_requests (status);

create index booking_requests_slot_idx
  on public.booking_requests (availability_slot_id);
```

RLS:

```sql
alter table public.booking_requests enable row level security;

create policy booking_requests_admin_select
  on public.booking_requests
  for select to authenticated
  using (public.is_admin() and org_id = public.current_org_id());

create policy booking_requests_admin_update
  on public.booking_requests
  for update to authenticated
  using (public.is_admin() and org_id = public.current_org_id())
  with check (public.is_admin() and org_id = public.current_org_id());
```

Obs: publik insert ska gå via Edge Function med servernyckel, inte via `anon` direkt mot tabellen.

## Dubbelbokningsskydd

När en kund trycker på boka måste servern kontrollera att slotten fortfarande är ledig.

Regel:

```txt
Antal aktiva förfrågningar/pass för slotten < capacity
```

Räkna dessa som upptagna:

- `booking_requests.status in ('new', 'linked_to_shift', 'approved')`
- `shifts.status in ('Planerat', 'Godkänt', 'Pågående')`

Räkna inte dessa som upptagna:

- `booking_requests.status in ('declined', 'cancelled')`
- `shifts.status in ('Avbokat', 'Borttaget')`

Beslut för V1: vald slot reserveras direkt när den publika bokningen skapas.

För bästa skydd bör bokningen göras i en databasfunktion eller transaktion:

```sql
create or replace function public.create_public_booking_request(...)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 1. validera input
  -- 2. lås vald availability-slot: select ... for update
  -- 3. kontrollera capacity
  -- 4. skapa eller hitta lead-kund/objekt
  -- 5. skapa shift med status 'Planerat' och source 'customer_request'
  -- 6. skapa booking_request kopplad till shift
  -- 7. skapa shift_event + admin-notis
end;
$$;
```

Viktigt: om vi använder `security definer` måste funktionen vara smal, validerad och inte ge generella skrivmöjligheter. Ge inte `EXECUTE` till `anon` direkt om Edge Function kan anropa den med service role.

## Hur publik kund kopplas till intern kalender

Besökaren på `cleanup.nu` är inte inloggad och har inget kundkonto. Vi behöver därför välja ett av två upplägg.

### Alternativ A: skapa en intern lead-kund

Skapa en kund i systemet, t.ex.:

```txt
Customer: Publika bokningar
Property: adressen kunden skrev in
```

När bokningen kommer in:

1. Leta efter befintligt objekt med samma adress/e-post, om vi vill undvika dubbletter.
2. Annars skapa nytt `customer` + `property`, eller koppla till en särskild lead-kund.
3. Skapa `shifts` med `status = Planerat`, `source = customer_request`, `cleaner_user_id = null`.
4. Admin ser passet och tilldelar städare vid godkännande.

Första MVP: använd en särskild lead-kund, t.ex. `Publika förfrågningar`, och skapa ett nytt objekt per adress. Det är enklast och går snabbt att bygga.

Beslut för V1: detta är valt upplägg.

### Alternativ B: bara `booking_requests`, skapa `shift` senare

Då hamnar bokningen först i en lista, och admin skapar passet manuellt.

Detta är renare datamässigt men sämre för dig nu, eftersom du uttryckligen vill att det ska synas i kalender/flöde.

Rekommendation: Alternativ A.

## Edge Functions

Vi skapar två publika funktioner.

### `public-availability`

Syfte: iframen hämtar lediga tider.

Metod:

```txt
GET /functions/v1/public-availability?from=2026-08-01&to=2026-08-31&service_type=standard_cleaning
```

Svar:

```json
{
  "slots": [
    {
      "id": "uuid",
      "starts_at": "2026-08-04T07:00:00.000Z",
      "ends_at": "2026-08-04T10:00:00.000Z",
      "available_capacity": 1,
      "service_type": "standard_cleaning"
    }
  ]
}
```

Servern ska:

- endast returnera `active = true`
- endast returnera framtida tider
- filtrera på datumintervall
- filtrera bort fullbokade tider
- aldrig returnera interna anteckningar
- sätta CORS så `cleanup.nu` får läsa

### `public-booking-request`

Syfte: kunden skickar in bokningen.

Metod:

```txt
POST /functions/v1/public-booking-request
```

Request:

```json
{
  "availability_slot_id": "uuid",
  "service_type": "standard_cleaning",
  "customer_name": "Anna Andersson",
  "customer_email": "anna@example.com",
  "customer_phone": "0701234567",
  "address": "Exempelgatan 1",
  "postal_code": "12345",
  "city": "Stockholm",
  "area_sqm": 85,
  "rooms": 3,
  "addons": {
    "windows": true,
    "oven": false
  },
  "estimated_price_sek": 1490,
  "message": "Portkod skickas på sms."
}
```

Svar:

```json
{
  "ok": true,
  "request_id": "uuid",
  "shift_id": "uuid",
  "status": "new"
}
```

Servern ska:

- validera e-post, telefon, datum, adress och prisinput
- ignorera pris om det ser manipulerat ut och räkna om på servern
- kontrollera att vald slot finns och är ledig
- skapa `booking_requests`
- skapa `shifts` med `status = Planerat` och `source = customer_request`
- skapa `shift_events` med `event_type = customer_booking_requested`
- skapa notis till admin, helst `customer_booking_request`
- returnera ett neutralt tack-svar

## CORS och iframe

Tillåt bara rätt origins:

```txt
https://cleanup.nu
https://www.cleanup.nu
https://logincleanup.app
```

Iframen på `cleanup.nu`:

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
```

Widgeten skickar höjd med `postMessage`. Föräldersidan på `cleanup.nu` kan lyssna och uppdatera iframe-höjden:

```js
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
```

### Rekommenderad popup-placering för stäng-knapp

Om bokningen öppnas i en popup/modal på `cleanup.nu` ska stäng-knappen inte ligga som en bred svart kapsel ovanpå iframens egna header. Det skapar visuell krock med `Steg 1 av 3`, särskilt på mobil.

Rekommenderat:

- använd en liten rund ikonknapp, minst `44x44px` för touch
- placera den absolut i popupens övre högra hörn
- låt den ligga utanför eller precis i kanten av iframe-ytan
- ge iframen lite toppmarginal/padding om knappen ligger inne i samma vita modal

```html
<div class="cleanup-booking-modal" role="dialog" aria-modal="true" aria-label="Boka städning">
  <button class="cleanup-booking-close" type="button" aria-label="Stäng bokningen">
    ×
  </button>

  <iframe
    id="cleanup-booking-frame"
    src="https://www.logincleanup.app/CleanUp.html#/embed/booking"
    title="Boka städning med CleanUp"
    loading="lazy"
  ></iframe>
</div>

<style>
  .cleanup-booking-modal {
    position: relative;
    width: min(940px, calc(100vw - 24px));
    max-height: min(92vh, 900px);
    margin: 0 auto;
    border-radius: 18px;
    background: #fff;
    overflow: hidden;
    box-shadow: 0 24px 70px rgba(15, 23, 42, 0.28);
  }

  .cleanup-booking-close {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 3;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: 999px;
    background: #07142d;
    color: #fff;
    font-size: 28px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.18);
  }

  .cleanup-booking-modal iframe {
    width: 100%;
    min-height: 760px;
    border: 0;
    display: block;
  }

  @media (max-width: 640px) {
    .cleanup-booking-modal {
      width: 100vw;
      max-height: 100dvh;
      border-radius: 0;
    }

    .cleanup-booking-close {
      top: calc(env(safe-area-inset-top, 0px) + 8px);
      right: 8px;
      width: 44px;
      height: 44px;
    }

    .cleanup-booking-modal iframe {
      min-height: 100dvh;
      padding-top: env(safe-area-inset-top, 0px);
    }
  }
</style>
```

Hostingkrav på `logincleanup.app`: sidan måste få ramas in från `cleanup.nu`. I Vercel görs detta med `Content-Security-Policy: frame-ancestors ...` och utan `X-Frame-Options: DENY`.

## Adminflöde i `logincleanup.app`

### Ny meny eller flik

Lägg till adminvy:

```txt
/admin/tillganglighet
```

eller en flik i:

```txt
/admin/schema
```

MVP-kontroller:

- datum
- starttid
- sluttid
- kapacitet
- tjänstetyp
- aktiv/inaktiv
- lista över kommande öppna tider
- knapp för att stänga en tid

### Admin ser inkommande förfrågan

När kunden skickar bokning:

- `booking_requests.status = new`
- `shifts.status = Planerat`
- `shifts.source = customer_request`
- `shifts.cleaner_user_id = null`
- admin får notis

Admin klickar på passet:

1. ser kundens formulärdata
2. väljer städare
3. godkänner eller avslår

Befintligt godkännandeflöde kan återanvändas:

- `Planerat` -> `Godkänt`
- kräver `cleaner_user_id`
- event: `shift_approved`

Vi behöver bara se till att `booking_requests.status` uppdateras samtidigt:

- godkänd shift -> `booking_requests.status = approved`
- avslagen shift -> `booking_requests.status = declined`

## Iframe-flöde

Första versionen bör ha dessa steg:

1. Välj tjänst
2. Kalkylator
3. Välj ledig tid
4. Kontaktuppgifter
5. Bekräftelse

### Steg 1: välj tjänst

Exempel:

- Hemstädning
- Flyttstädning
- Storstädning
- Fönsterputs

### Steg 2: kalkylator

Input:

- kvadratmeter
- antal rum
- badrum
- tillval
- RUT-pris före/efter, om ni vill visa det

Viktigt: priset i frontend är endast uppskattning. Servern ska räkna om eller åtminstone validera rimlighet.

### Steg 3: välj tid

Iframen hämtar:

```txt
GET public-availability
```

Visa bara tider som servern säger är lediga.

### Steg 4: kontaktuppgifter

Input:

- namn
- e-post
- telefon
- adress
- postnummer
- ort
- kommentar
- GDPR-samtycke

### Steg 5: bekräftelse

Text:

```txt
Tack! Din förfrågan är skickad. Vi återkommer när tiden är bekräftad.
```

Skriv inte att tiden är definitivt bokad innan admin har godkänt den.

Beslut för V1: endast tack-sida i iframen. Ingen e-post till kund i första versionen.

## Steg-för-steg-implementation

### Fas 1: databas

1. Skapa migration med Supabase CLI:

```powershell
supabase migration new public_booking_availability
```

2. Lägg till:

- `booking_request_status`
- `booking_availability_slots`
- `booking_requests`
- index
- RLS
- grants där det behövs

3. Lägg till `updated_at` triggers med befintliga `public.set_updated_at()`.

4. Lägg till realtime om adminvyn ska uppdateras live:

```sql
alter publication supabase_realtime add table public.booking_availability_slots;
alter publication supabase_realtime add table public.booking_requests;
```

### Fas 2: serverlogik

1. Skapa Edge Function:

```powershell
supabase functions new public-availability
supabase functions new public-booking-request
```

2. Lägg till CORS allowlist.

3. Lägg till inputvalidering.

4. Lägg till kapacitetskontroll.

5. Skapa booking request och shift i samma säkra serverflöde.

6. Lägg till notis till admin.

### Fas 3: admin för tillgänglighet

1. Lägg till tabell i `src/supabase.jsx` hydrering:

- `booking_availability_slots`
- `booking_requests`

2. Lägg till mock-state i `src/mock.jsx`.

3. Lägg till adminmetoder:

- `createAvailabilitySlot`
- `updateAvailabilitySlot`
- `deleteAvailabilitySlot`
- `listAvailabilitySlots`
- `bookingRequestsForShift`

4. Lägg till vy:

```txt
/admin/tillganglighet
```

5. Koppla notiser/förfrågningar till befintlig schema-vy.

### Fas 4: booking-widget

1. Skapa route:

```txt
/embed/booking
```

2. Bygg formulärsteg:

- tjänst
- kalkylator
- kalender
- kontakt
- tack

3. Hämta tider från Edge Function.

4. Skicka bokning till Edge Function.

5. Lägg till loading, error och "tiden hann bli upptagen"-läge.

### Fas 5: cleanup.nu

1. Lägg iframe i hero.

2. Kontrollera responsiv höjd.

3. Lägg till fallback-länk:

```html
<a href="https://logincleanup.app/embed/booking" target="_blank" rel="noopener">
  Öppna bokningen i nytt fönster
</a>
```

4. Testa på mobil, tablet och desktop.

## Säkerhetskrav

Publika endpoints:

- ska inte exponera `service_role` i frontend
- ska begränsa CORS
- ska ha rate limiting eller spamfilter
- ska ha honeypot-fält
- ska validera alla fält på servern
- ska räkna om eller validera pris på servern
- ska inte returnera interna felmeddelanden till besökaren

Databas:

- RLS på alla nya tabeller
- inga publika `anon`-policies på råtabeller om Edge Function används
- index på datum/status/org
- `security definer` endast där det behövs
- `search_path = public`
- revoke/grant på funktioner medvetet

GDPR:

- visa samtycke innan bokning skickas
- spara bara uppgifter som behövs
- lägg till retention senare, t.ex. ta bort nekade förfrågningar efter X månader

## Testplan

### Databas

- Admin kan skapa tillgänglig tid.
- Icke-admin kan inte skapa tillgänglig tid.
- Publik användare kan inte läsa råtabeller direkt.
- Edge Function kan läsa lediga tider.
- Edge Function skapar bokningsförfrågan.
- Samma slot kan inte överbokas över `capacity`.

### Admin

- Ny bokning syns som `Planerat`.
- Notis skapas till admin.
- Admin kan godkänna och tilldela städare.
- Admin kan avslå.
- Godkänd bokning försvinner från lediga tider i iframe.
- Avslagen bokning frigör slotten igen om kapacitet finns.

### Iframe

- Kalender visar endast öppna tider.
- Tom tillgänglighet visar bra tomläge.
- Bokning utan obligatoriska fält blockeras.
- Dubbelklick på boka skapar inte två förfrågningar.
- Om tiden tas av någon annan visas ett tydligt fel.
- Fungerar i hero på `cleanup.nu` på mobil och desktop.

## Viktiga beslut innan vi bygger

1. Ska publika förfrågningar kopplas till en särskild lead-kund, t.ex. `Publika förfrågningar`?
   Rekommendation: ja för MVP.

2. Ska admin skapa exakta tidsluckor eller återkommande tillgänglighet?
   Rekommendation: börja med exakta tidsluckor. Lägg till återkommande senare.

3. Ska kunden kunna boka direkt, eller bara skicka förfrågan?
   Rekommendation: förfrågan först, admin godkänner.

4. Ska slotten reserveras direkt när förfrågan skickas?
   Rekommendation: ja, räkna `new` och `Planerat` som upptaget tills admin avslår.

5. Ska bekräftelse skickas via e-post/SMS?
   Beslut: nej i V1. Kunden får tack-sida i iframen. E-post/SMS kommer senare.

## Implementation i nästa steg

Föreslagen ordning:

1. Skapa databas-migration för `booking_availability_slots` och `booking_requests`.
   Status: klar i `supabase/migrations/20260727203034_public_booking_availability.sql`.
2. Skapa Edge Functions för availability och booking request.
   Status: klar i `supabase/functions/public-availability`, `supabase/functions/public-booking-request` och `supabase/migrations/20260727203433_public_booking_request_rpc.sql`.
3. Lägg adminvy för tillgänglighet.
   Status: klar lokalt i `src/views.jsx`, `src/mock.jsx`, `src/supabase.jsx` och `src/app.jsx`.
4. Lägg iframe-route `/embed/booking`.
   Status: klar lokalt. `https://logincleanup.app/embed/booking` rewritas till appen och bypassar login.
5. Koppla in iframe på `cleanup.nu`.
   Status: integrationssnippet klart i den här filen. Själva `cleanup.nu`-sidans kod/CMS finns inte i detta workspace, så den fysiska hero-ändringen görs när vi har den koden.
6. Testa hela flödet från publik bokning till admin-godkännande.
   Status: väntar på Supabase rollout mot rätt projekt samt faktisk `cleanup.nu`-embed.

Databasen är redo att stödja själva kalendergodkännandet via befintliga `shifts`. Den stora nya byggstenen är synkad publik tillgänglighet.

Verifieringsnotis för Fas 1: migrationen är skapad och statiskt kontrollerad i repo:t, men den kunde inte lintas/appliceras lokalt här eftersom lokal Supabase/Postgres inte kör. Kör `supabase db lint --local` eller applicera migrationen mot rätt Supabase-miljö innan Fas 2 kopplas på.

Verifieringsnotis för Fas 2: Edge Functions är skapade lokalt och `supabase/config.toml` har `verify_jwt = false` för de publika endpoints. Deno finns inte i lokal PATH och lokal Supabase/Postgres kör inte, så kör `deno check` eller `supabase functions serve` samt `supabase db lint --local` när miljön är igång.

Secrets som behövs för Fas 2:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PUBLIC_BOOKING_ORG_ID`
- `PUBLIC_BOOKING_LEAD_CUSTOMER_ID`
- `PUBLIC_BOOKING_ALLOWED_ORIGINS`
