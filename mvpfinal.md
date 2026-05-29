# CleanUp · MVP-spec (samlad)

> Detta dokument är **källan vi bygger plattformen utifrån**. Det konsoliderar allt från tidigare `mvp.md`, brand-/design-grunden i `CleanUp.html` och de nya kraven (sjukanmälan, 48h-avbokning, kundledighet, admin-justering, städschema per objekt, avvikelse/reklamation, separation av städardata, kundanställda).
>
> **Stack idag:** statisk HTML + React (CDN) + Tailwind + Babel-standalone (mockad data i front-end).
> **Stack framåt:** Next.js (App Router) på **Vercel** + **Supabase** (Auth, Postgres + RLS, Storage, Realtime, Edge Functions) via Supabase MCP-plugin. Auth och databas läggs på i ett senare steg – MVP:n specas nu så datamodellen är klar när vi kopplar in Supabase.

---

## 1. Vision & mål

CleanUp är en plattform för städföretag som binder ihop **admin**, **städare** och **kund (företag) + kundens anställda** kring återkommande städpass.

Målet med MVP:n:

1. Admin har **full kontroll och översikt** – planering, ombokning, avvikelser, ledigheter.
2. Städare har en **mobilförst arbetsvy** – ser bara sina egna pass, kan checka av städschema och rapportera avvikelser.
3. Kund (och kundens anställda) har **transparens** – ser kommande pass, kan avboka >48 h, registrera ledighet och reklamera utfört arbete.
4. **Notifieringar i realtid** håller alla parter informerade när något ändras.

---

## 2. Roller & behörigheter

| Roll | Beskrivning | Ser |
|---|---|---|
| **Admin** | Anställd hos städföretaget. Full åtkomst. | Allt – alla kunder, objekt, städare, pass, avvikelser, ledigheter. |
| **Städare** | Anställd hos städföretaget som utför pass. | **Endast egna pass**, egna städdagar/-tider, städschema för objekt som denne ska städa, samt egna avvikelser som uppstått under egna pass. Ser nyckel/larm-info för objekt denne har pass på. |
| **Kund (huvudkontakt)** | Företagets primära kontakt. | Alla objekt under kunden, alla pass på dessa objekt, kan avboka >48 h, registrera ledighet, reklamera, se städschema och utförd städning. |
| **Kundanställd** | Extra mejladresser kunden vill ge insyn (t.ex. platschefer). | Samma läsåtkomst som kund, eller begränsat till valda objekt (konfigurerbart per anställd). **Endast läsbehörighet** – kan inte avboka pass, registrera ledighet eller skapa reklamationer. |

### Kritisk separationsregel (städare)

Flera städare kan tilldelas **samma kund/objekt**, men varje städare ser **endast sina egna**:

- pass och tider,
- städschema-bockningar denne själv gjort,
- avvikelser som rapporterats under denne städarens egna pass.

Städare ser **aldrig** andra städares pass, scheman eller avvikelser – inte ens på samma objekt.

Nyckel/larm-fält på objektet är synligt för **admin + de städare som har minst ett pass på objektet** (aldrig för kund/kundanställd).

### Anonymisering av städare gentemot kund

Kund och kundanställd ser **aldrig städarens namn, mejl, telefon eller profilbild**. I alla kundvyer (pass-lista, pass-detalj, ledighetsförhandsvisning, notiser, e-postmallar) skrivs städaren ut som **"Städare"** (eller "Städare 1 / 2" om flera städare är tilldelade samma pass). Admin och städaren själv ser alltid riktiga namn.

> Implementation: En vy-/serializer-funktion `displayCleaner(role, cleaner)` returnerar `"Städare"` för rollerna `customer` och `customer_employee`, annars `cleaner.name`. RLS hindrar dessutom kund-rollerna från att SELECT:a `users.name` på cleaner-rader.

---

## 3. Designsystem (från `CleanUp.html`)

- **Typografi:** Plus Jakarta Sans (400/500/600/700/800).
- **Brand-palett (blå):**
  - `brand-50 #eef3fc`, `100 #d8e4f8`, `200 #b3c8f0`, `300 #84a4e6`,
    `400 #5079d6`, `500 #2f5ac6`, `600 #1e50b8` (primär), `700 #1a429a`,
    `800 #18387d`, `900 #173265`.
- **Accent (orange, CSS-variabler – temabar):**
  - `--a50 255 242 238`, `--a100 255 225 214`,
    `--a500 242 96 60`, `--a600 224 74 38`, `--a700 187 58 29`.
- **Tema-tweaks:** stöd för hörnradie `Skarp` / `Standard` / `Rundad` via `body[data-round=...]` (finns redan i CSS).
- **Komponenter:** Tailwind utility-first, `rounded-2xl/3xl` kort, mjuka skuggor, lufitg layout. Mobile-first.
- **Språk i UI:** **svenska** genomgående.
- **Ikoner:** Lokal `icons.jsx` (att bygga). Inline SVG, inga ikon-paket.
- **Assets:** `CleanUp favicon.png`, `CleanUp logo original.png`, `CleanUp logo white original.jpg`.

> Bygg ut komponentbiblioteket i `src/ui.jsx` (knappar, kort, badges, modaler, tomma tillstånd). Status-badges nedan.

### Status-badges (pass)

| Status | Färg | Etikett |
|---|---|---|
| `Planerat` | brand-100 / brand-700 | "Planerat" |
| `Godkänt` | emerald-100 / emerald-700 | "Godkänt" |
| `Pågående` | accent-100 / accent-700 | "Pågående" |
| `Utfört` | slate-100 / slate-700 | "Utfört" |
| `Sjukanmält` | amber-100 / amber-700 | "Sjukanmäld" |
| `Pausat (kundledighet)` | sky-100 / sky-700 | "Pausad – ledighet" |
| `Avbokat` | rose-100 / rose-700 | "Avbokat" |
| `Borttaget` | zinc-100 / zinc-700 | "Borttaget" |

---

## 4. Informationsarkitektur (navigation per roll)

### Admin
1. **Dashboard** – "Kräver din åtgärd" överst (sjukanmälda pass, nya avvikelser, dagens pass utan inchecka).
2. **Schema** (kalender + lista) – alla pass, filter på städare/kund/status.
3. **Kunder** → kund → objekt → (Pass · Städschema · Nyckel/larm · Ledigheter · Kontakter).
4. **Städare** – lista, profiler, tilldelningar.
5. **Avvikelser** – ärendelista, öppna först.
6. **Inställningar** – företagsuppgifter, tema, mallar för städschema, notisinställningar.

### Städare (mobilförst)
1. **Idag** – dagens pass, "Checka in / Checka ut".
2. **Mina pass** – kommande + historik.
3. **Pass-detalj** – tider, objektinfo, **städschema-checklist**, nyckel/larm-info, **Sjukanmäl pass**, **Rapportera avvikelse**.
4. **Avvikelser** – egna rapporterade ärenden.

### Kund / kundanställd
1. **Översikt** – kommande pass, öppna ärenden.
2. **Objekt** – ett kort per objekt, kommande pass + senaste utförda.
3. **Pass-detalj** – tider, städare, städschema utfört, **Avboka** (>48 h) / kontaktinfo (<48 h), **Reklamera / avvikelse**.
4. **Ledighet** – ny flik (se §7.3).
5. **Avvikelser** – egna ärenden.
6. **Inställningar** – egna anställda (lägga till mejl, välja objekt).

---

## 5. Datamodell (för Supabase senare)

> Snake_case-namn, `uuid`-PK, `created_at timestamptz default now()`. RLS-policys nämns under varje tabell.

### `organizations`
Städföretaget självt (multi-tenant-ready). `id`, `name`, `slug`, `accent_color`, `theme_round`.

### `users`
Spegling/koppling till `auth.users`. `id`, `org_id`, `role` ∈ {`admin`, `cleaner`, `customer`, `customer_employee`}, `name`, `email`, `phone`, `active`.

### `customers` (kunder = företag)
`id`, `org_id`, `name`, `org_number`, `primary_contact_user_id`, `notes`.

### `customer_employees` (kundens egna anställda med inloggning)
`id`, `customer_id`, `user_id`, `scope` ∈ {`all_properties`, `selected`}, `created_by_admin_id`.

### `customer_employee_properties`
M2M när `scope = selected`. `customer_employee_id`, `property_id`.

### `properties` (objekt under kund)
`id`, `customer_id`, `name`, `address`, `area_sqm`, `access_info` *(nyckel/larm – endast admin + tilldelade städare)*, `notes`.

### `property_cleaners` (tilldelade städare till objekt – baspool)
`property_id`, `cleaner_user_id`. Används för defaultförslag vid schemaläggning.

### `recurring_schedules` (återkommande pass)
`id`, `property_id`, `weekday` (0–6), `start_time`, `end_time`, `default_cleaner_user_id`, `valid_from`, `valid_to`, `active`.

### `shifts` (enskilda pass – genererade från recurring eller skapade manuellt)
`id`, `property_id`, `cleaner_user_id` (nullable), `start_at`, `end_at`, `status` (se §6), `source` ∈ {`recurring`, `manual`}, `recurring_id` (nullable), `original_start_at`, `original_end_at`, `last_modified_by`, `notes`.

### `shift_events` (audit-logg per pass)
`id`, `shift_id`, `actor_user_id`, `event_type` (`created`, `time_adjusted`, `cleaner_swapped`, `sick_reported`, `customer_cancelled`, `paused_by_holiday`, `admin_deleted`, `check_in`, `check_out`, …), `payload jsonb`, `created_at`.

### `cleaning_checklists` (mall per objekt)
`id`, `property_id`, `title`, `position`, `active`.

### `shift_checklist_items` (snapshot på passet – så ändringar i mall inte förstör historik)
`id`, `shift_id`, `title`, `position`, `done_at`, `done_by_cleaner_user_id`.

### `customer_holidays` (kundledighet)
`id`, `customer_id`, `created_by_user_id`, `scope` ∈ {`all_properties`, `selected`}, `start_date`, `end_date`, `reason`.
`customer_holiday_properties` (M2M om `scope = selected`).

### `incidents` (avvikelser & reklamationer)
`id`, `org_id`, `shift_id`, `property_id`, `reported_by_user_id`, `reporter_role` ∈ {`cleaner`, `customer`, `customer_employee`}, `kind` ∈ {`cleaner_issue`, `customer_complaint`}, `category` (broken_equipment, no_access, alarm, missing_supplies, missed_area, poor_quality, damage, other), `title`, `description`, `attachments jsonb` *(array: `{ path, uploaded_by, uploaded_at, kind: "customer" \| "admin" }`)*, `status` ∈ {`open`, `in_progress`, `resolved`}, `resolved_by_admin_id`, `resolved_at`, `resolution_note`.

### `notifications`
`id`, `recipient_user_id`, `channel` ∈ {`in_app`, `email`}, `kind`, `payload jsonb`, `read_at`, `created_at`. (E-post via Supabase Edge Function + Resend/SendGrid senare.)

### RLS-grundregler (sammanfattning)

- **Admin:** full åtkomst inom egen `org_id`.
- **Cleaner:** SELECT på `shifts` där `cleaner_user_id = auth.uid()`; läsning av `properties` + `cleaning_checklists` endast för objekt där cleaner har minst en `shifts`-rad; läsning av `incidents` där `reported_by_user_id = auth.uid()` ELLER `shift_id` tillhör egen `shifts`.
- **Customer / customer_employee:** SELECT på `shifts`/`properties`/`incidents` via koppling `customers → customer_employees` (respektera `scope`). **Ser aldrig** `properties.access_info`. **Ser aldrig** `users.name/email/phone/avatar_url` för rader med `role = cleaner` (kolumnnivå-policy eller separat vy `cleaners_public` som bara exponerar `id` + statisk etikett "Städare"). Customer_employee kan **endast SELECT** – inga INSERT/UPDATE/DELETE på `shifts`, `customer_holidays` eller `incidents`.
- Skrivpolicys begränsas till respektive roll och endast på egna rader; allt loggas i `shift_events`.

---

## 6. Passets livscykel (statusmodell)

```
Planerat ──admin godkänner──▶ Godkänt ──start_at──▶ Pågående ──check-out──▶ Utfört
   │                              │                      │
   │ admin tar bort               │ sjukanmäl            │ avvikelse kan rapporteras
   ▼                              ▼                      │ (städare under, kund efter)
Borttaget                     Sjukanmäld ──ombokat──▶ Godkänt (ny städare)

Godkänt ──kundavboka >48h──▶ Avbokat
Godkänt ──kundledighet──────▶ Pausat (kundledighet)
Godkänt ──admin justerar tid▶ Godkänt (med original_*_at sparat + notis)
```

---

## 7. Funktionsmoduler

### 7.1 Sjukanmälan (städare)

**Var:** Städarens kommande pass med status `Godkänt`.

**Flöde:**
1. Städare öppnar passet → knapp **"Sjukanmäl pass"** → bekräftelsedialog (valfri kort orsak).
2. Passets status → `Sjukanmäld`. `shift_events` loggas.
3. **Notiser skickas direkt:**
   - Admin (in-app + e-post + listas under "Kräver din åtgärd").
   - Kund + berörda kundanställda (in-app + e-post).
4. Admin öppnar passet under **"Kräver din åtgärd"** och kan i samma vy välja en av tre åtgärder:
   - **Lägg till annan städare** – väljer ny städare (defaultförslag = `property_cleaners`-poolen, men admin kan fritt välja vem som helst). Status åter till `Godkänt`, ersättare + kund notifieras.
   - **Justera tiden manuellt** – flytta `start_at`/`end_at` till ny tidpunkt och behåll ursprunglig städare eller välj en ny. Original-tiderna sparas i `original_start_at`/`original_end_at`. Status åter till `Godkänt`, berörda parter notifieras.
   - **Lämna som `Sjukanmäld`** – om ingen lösning hittas. Passet står kvar som `Sjukanmäld` i historiken; kund + admin notifieras att passet uteblir.
5. Admin kan även **sjukanmäla åt en städare** (samma flöde, `actor = admin`).

**UI-detalj:** I admins ombokningsvy visas tidigare städares namn, tid, objekt, och en sökbar lista över alla städare med tillgänglighetsindikator (krock = röd).

---

### 7.2 48-timmarsavbokning (kund)

**Var:** Kundvy på `Godkänt`-pass.

**Regel:** Tid kvar till `start_at`:

- **> 48 h:** Knapp **"Avboka"** visas → bekräftelsedialog → status `Avbokat`. Notis till admin + tilldelad städare.
- **≤ 48 h:** Knappen ersätts av en **infobox** med admins telefon och mejl: *"Inom 48 timmar – kontakta oss för att avboka."*. **Endast admin** kan i det läget ta bort passet via **"Ta bort"** (status `Borttaget`).

`shift_events` loggar `customer_cancelled` resp. `admin_deleted` med tidpunkt och `hours_to_start`.

---

### 7.3 Kundledighet

**Var:** Ny flik **"Ledighet"** under kundens vy.

**Formulär (skapa ledighet):**
- **Objekt:** välj ett, flera, eller **alla**.
- **Period:** fr.o.m. – t.o.m. (datum).
- **Anledning:** fri text (krav: minst 3 tecken).
- **Förhandsvisning** (live, innan registrering): *"X pass kommer att pausas mellan YYYY-MM-DD och YYYY-MM-DD."* – lista över de berörda passen (datum + tid + objekt + städare).

**Vid registrering:**
1. Skapar rad i `customer_holidays` (+ ev. `customer_holiday_properties`).
2. Alla berörda `shifts` med status `Godkänt`/`Planerat` i perioden → status `Pausat (kundledighet)`. (Statusen ersätter tidigare "Avbokad → Pausad" – vi har en egen status så ledighet inte räknas som avbokning i statistik.)
3. Notiser till admin + alla berörda städare.
4. Pass utanför perioden påverkas inte.

**Lista bredvid formuläret:** registrerade ledigheter (period, scope, antal pausade pass, vem som skapade). Admin kan **ta bort** en ledighet → berörda pass återfår tidigare status (om datum inte passerat).

---

### 7.4 Admin-justering av pass

**Var:** Valfritt pass i admin-vy.

Tre åtgärder:

1. **Justera tid** – ändra `start_at`/`end_at`. Sparar `original_start_at`/`original_end_at` om första justeringen. Gäller direkt. Notis till kund + städare.
2. **Byta städare** – välj annan städare. Notis till ny städare + kund + (valfritt) tidigare städare.
3. **Ta bort** – status `Borttaget`. Notis till kund + städare. Bekräftelse krävs.

**Återkommande scheman:** Skapas under objektets vy (admin). Veckodag + start–slut + defaultstädare + giltighetsperiod. En cron/edge-function (Supabase) genererar `shifts`-rader **rullande 12 veckor framåt** (dagligt jobb). Justeringar/borttagningar på enskilda pass påverkar **bara den raden**, inte mallen.

---

### 7.5 Städschema per objekt

**Var (admin):** Under **Kunder → kund → objekt** finns en knapp **"Städschema"**. Admin lägger till/ordnar/avaktiverar punkter (`cleaning_checklists`).

**Var (städare):** Vid arbetspasset (status `Pågående`, eller från `Godkänt` om man förbereder) visas en **checklist**. Städaren bockar av varje punkt → `shift_checklist_items.done_at` + `done_by_cleaner_user_id` sätts.

**Snapshot:** När ett pass skapas/genereras kopieras aktuella checklist-mallpunkter till `shift_checklist_items` så att senare mall-ändringar inte ändrar historik.

**Var (kund + admin):** Ser i pass-detaljen vilka punkter som utförts (grön bock + tidpunkt) och vad som inte gjordes.

**Nyckel/larm-info:** Fält på `properties.access_info`. Visas **endast för admin och städare som har minst ett pass på objektet**. Kund/kundanställd ser aldrig fältet (varken läs eller existens i UI).

---

### 7.6 Avvikelse / reklamation

#### Städaren rapporterar (under/efter pågående eller utfört pass)

Knapp **"Rapportera avvikelse"** i pass-detaljen. Kategorier:
- Trasig utrustning
- Kom ej in
- Larm / larmproblem
- Material slut
- Annat

Fält: titel, beskrivning. *Bildbilagor från städare läggs till i v1.1 – inte MVP.*
→ `incidents.kind = cleaner_issue`, `status = open`. Notis till admin.

#### Kunden reklamerar (utfört pass)

Knapp **"Reklamera / avvikelse"**. Kategorier:
- Missad yta
- Bristfällig städning
- Skada
- Annat

Fält: titel, beskrivning, **bildbilagor (upp till 5 bilder, JPEG/PNG, max 5 MB/st)** – ingår i MVP.
→ `incidents.kind = customer_complaint`, `status = open`. Notis till admin + tilldelad städare.

#### Admin-vy: **Avvikelser** (ny flik)

- Lista med **öppna ärenden överst**, sedan `in_progress`, sedan `resolved`.
- Filter på kund, objekt, städare, kategori, period.
- Varje rad: knapp **"Åtgärda"** → modal med fri text-resolution **och möjlighet att bifoga bilder (samma regler som kund: 5 st, JPEG/PNG, max 5 MB/st)** → status `resolved` (`resolved_by_admin_id`, `resolved_at`, `resolution_note`).
- Mellansteg `in_progress` kan markeras manuellt (t.ex. "väntar på leverans").
- Notis till rapportör när status ändras.

**Bildbilagor – teknisk implementation (Supabase Storage):**
- Bucket: `incident-attachments` (privat). Filnamn: `{org_id}/{incident_id}/{uuid}.{ext}`.
- Klienten validerar MIME och storlek innan upload; server validerar igen i en `incidents_attachments`-trigger.
- Filer refereras i `incidents.attachments jsonb` som `[{ path, uploaded_by, uploaded_at, kind: "customer" | "admin" }]`.
- Läsning via **signed URLs** (15 min TTL). RLS: läsbart för admin, rapportören, och tilldelad städare på passet.

---

### 7.7 Kontakter & kundanställda

**Vid skapande av kund (admin):**
- Grundinfo (företagsnamn, org.nr, primär kontakt: namn + mejl + telefon).
- **Lägg till anställda hos kunden** (kundens medarbetare som ska kunna logga in och följa pass):
  - mejl, namn, telefon (valfritt),
  - **scope:** alla objekt **eller** valda objekt (multiselect).
- Admin kan när som helst lägga till/ta bort kundanställda från kundens kontaktvy.
- Vid skapande: inbjudningsmejl med magic-link (Supabase Auth) – byggs när auth läggs på.

**Vid skapande av kund kan admin även lägga in städare (anställda hos städföretaget) som ska kopplas till kundens objekt** – via `property_cleaners`. Detta är basförslag vid schemaläggning, men admin kan tilldela vem som helst per pass.

---

### 7.8 Notifieringar

**Kanaler i MVP:** in-app (notis-bjälla + lista) + e-post (mall via Supabase Edge Function + leverantör senare). SMS kan komma efter MVP.

**Triggers:**

| Händelse | Mottagare |
|---|---|
| Sjukanmälan | Admin, kund + kundanställda (scope), tilldelad städare |
| Ombokning av sjukanmält pass | Ny städare, tidigare städare (valfritt), kund |
| Kundavbokning >48 h | Admin, tilldelad städare |
| Admin tar bort pass | Kund, tilldelad städare |
| Kundledighet registrerad | Admin, alla berörda städare |
| Admin justerar tid | Kund, tilldelad städare |
| Admin byter städare | Ny städare, kund |
| Ny avvikelse (städare) | Admin |
| Ny reklamation (kund) | Admin, tilldelad städare |
| Avvikelse åtgärdad | Ursprunglig rapportör |
| Påminnelse 24 h innan pass | Tilldelad städare (valfritt) |

---

### 7.9 Dashboard: "Kräver din åtgärd" (admin)

Överst på admins startsida. Sektioner i prioritetsordning:

1. **Sjukanmälda pass** – med knappen **"Boka om"** inline.
2. **Nya avvikelser** (senaste 7 dagar, status `open`).
3. **Dagens pass utan incheckning** (efter förväntad starttid + 10 min).
4. **Avbokningar inom 48 h** (kunder som ringt in).
5. **Kundledigheter som börjar de närmaste 7 dagarna.**

Varje rad är klickbar → öppnar relevant detaljvy.

---

## 8. Vyer – sidkarta

```
/login
/admin
  /admin/dashboard           "Kräver din åtgärd"
  /admin/schema              kalender + lista
  /admin/kunder
    /admin/kunder/[id]       kunddashboard
    /admin/kunder/[id]/objekt/[pid]
       /pass /städschema /nyckel-larm /ledighet /kontakter
  /admin/städare
    /admin/städare/[id]
  /admin/avvikelser
  /admin/installningar
/städare                     mobilförst
  /städare/idag
  /städare/pass
  /städare/pass/[id]
  /städare/avvikelser
/kund                        kund + kundanställd
  /kund/oversikt
  /kund/objekt/[pid]
  /kund/pass/[id]
  /kund/ledighet
  /kund/avvikelser
  /kund/installningar        (egna anställda, om huvudkontakt)
```

---

## 9. Teknisk plan

### 9.1 Frontend nu (prototyp i `CleanUp.html`)

Behåll den lokala React-CDN-uppsättningen för snabb prototyp. Skapa filerna som redan refereras:

- `src/icons.jsx` – inline SVG-ikoner.
- `src/ui.jsx` – `Button`, `Card`, `Badge`, `Modal`, `Tabs`, `EmptyState`, `StatusBadge`, `Avatar`.
- `src/views.jsx` – en vy per sida ovan.
- `src/app.jsx` – router (hash-baserad räcker i prototypen), roll-switch, mock-state.
- `src/tweaks-panel.jsx` – fortsatt designtweak-panel (hörnradie, accentfärg).
- **Mock-data** i en `src/mock.js` som efterliknar tabellerna i §5 – så att övergången till Supabase blir ett byte av datasource.

### 9.2 Produktion (efter MVP-prototyp)

- Migrera till **Next.js (App Router)** i samma repo (`/app`, `/components`, `/lib`).
- **Supabase** för Auth, Postgres (med RLS från §5), Storage (bilagor till avvikelser), Realtime (live-uppdatering av pass/avvikelser), Edge Functions (notis-utskick, generera pass från `recurring_schedules`, dagliga jobb).
- All databas- och migrationshantering via **Supabase MCP-pluginen** (lista tabeller, applicera migrationer, hämta loggar, säkerhets-advisors).
- **Vercel** för hosting – preview-deploys på branches, prod på `main` efter säkerhetsgenomgång (RLS-tester, advisors, env-secrets).
- **Säkerhetsgenomgång inför publicering** (checklista):
  - RLS aktiverat på alla tabeller, testat per roll.
  - Inga service-role-nycklar i klient.
  - Bilduppladdning: signed URLs, MIME-validering, storleksgräns.
  - Rate-limit på inbjudnings-/login-endpoints.
  - Audit-logg (`shift_events`, `incidents` status-historik) komplett.
  - Personuppgifter (GDPR): kontaktuppgifter, åtkomstlogg, raderingsrutin.

### 9.3 Supabase Storage – buckets

| Bucket | Privat | Innehåll | Läsåtkomst (via signed URLs) |
|---|---|---|---|
| `incident-attachments` | Ja | Bilder bifogade vid reklamation eller åtgärd | Admin, ärendets rapportör, tilldelad städare på passet |

Övriga buckets (logotyper, profilbilder etc.) tas vid behov.

### 9.4 Miljö & hemligheter

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` i Vercel (preview + prod).
- `SUPABASE_SERVICE_ROLE_KEY` endast i server/edge-functions.
- E-postleverantör (Resend) `RESEND_API_KEY` i edge-functions.

---

## 10. Acceptanskriterier per modul (MVP klar när…)

- **Sjukanmälan:** Städare kan sjukanmäla → status ändras direkt → admin + kund får notis → admin kan i samma "Kräver din åtgärd"-vy boka om till annan städare med ett klick → ersättare + kund får notis. Admin kan göra hela flödet å städarens vägnar.
- **48h-avbokning:** Kund ser **Avboka** om >48 h kvar; <48 h ser kund **kontaktinfo-meddelande**; admin kan alltid ta bort pass. Notiser går ut korrekt.
- **Kundledighet:** Formulär visar **rätt förhandsantal pass** innan registrering. Vid registrering pausas exakt de passen (status `Pausat (kundledighet)`) och notiser går till admin + berörda städare.
- **Admin-justering:** Tidjustering, städarbyte och borttagning fungerar på enskilda pass utan att påverka återkommande mall. `shift_events` loggar varje åtgärd.
- **Städschema:** Admin kan skapa/ordna mallpunkter per objekt; städare kan bocka av på passet; kund + admin ser utfört. Nyckel/larm-fältet **syns aldrig** för kund.
- **Avvikelser/reklamation:** Båda flödena (städare + kund) skapar ärenden i ny **Avvikelser**-flik; öppna ärenden överst; **Åtgärda**-knapp sätter status och notifierar rapportör. Kund kan bifoga upp till 5 bilder vid reklamation; admin kan bifoga bilder vid åtgärd.
- **Separation:** Två städare på samma objekt kan logga in samtidigt och ser **endast egna pass och egna avvikelser** – verifierat via RLS-tester.
- **Anonym städare för kund:** Kund/kundanställd ser endast etiketten "Städare" i alla vyer, listor, notiser och e-postmallar – aldrig namn/mejl/telefon. Verifierat per roll.
- **Kundanställda:** Admin kan vid kundskapande och senare lägga till mejl/namn för kundens anställda, välja om de ser alla eller valda objekt. Kundanställda har **enbart läsrätt**.
- **Återkommande pass:** Aktiva `recurring_schedules` genererar `shifts`-rader rullande 12 veckor framåt, dagligt jobb.

---

## 11. Roadmap (efter MVP)

1. SMS-notiser (Twilio).
2. Tidrapportering & löneunderlag per städare.
3. Fakturaunderlag per kund (utförda pass × timpris).
4. Mobil-PWA / push-notiser för städare.
5. Kvalitetspoäng per städare baserat på reklamationsfrekvens.
6. Materialinventarie per objekt.
7. Flerföretagsstöd (organizations) för whitelabel.

---

## 12. Beslutade designval

| # | Fråga | Beslut |
|---|---|---|
| 1 | Ska kunden se vilken städare som är tilldelad? | **Nej.** Kund och kundanställd ser endast etiketten **"Städare"** (vid flera: "Städare 1 / 2"). Inga namn, mejl, telefon eller bilder. Admin och städaren själv ser fullständig info. |
| 2 | Hur långt fram genereras pass från `recurring_schedules`? | **Rullande 12 veckor**, dagligt cron-jobb i Supabase Edge Function. |
| 3 | Vid sjukanmälan utan ersättare – vad händer? | **Admin hanterar manuellt** i "Kräver din åtgärd": lägg till annan städare **eller** justera tiden manuellt (eventuellt med byte av städare). Om inget av detta görs förblir passet `Sjukanmäld` i historiken. |
| 4 | Kan kundanställd avboka eller bara läsa? | **Endast läsa.** Avbokning, ledighet och reklamation är förbehållna huvudkontakten på kunden. |
| 5 | Bildbilagor på avvikelser i MVP eller v1.1? | **MVP:** kund kan bifoga bilder vid reklamation och admin kan bifoga bilder vid åtgärd (max 5 st, JPEG/PNG, max 5 MB/st, Supabase Storage med signed URLs). Städar-bilagor sparas till **v1.1**. |
