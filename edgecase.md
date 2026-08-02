# Edgecase-plan

Det här dokumentet samlar edge cases 3-10 från genomgången av CleanUp-flödet. Målet är att arbeta stegvis, med ett tydligt slutmål per punkt och en verifiering innan fasen markeras klar.

## Övergripande slutmål

Kunden ska tryggt kunna skicka en offert-/bokningsförfrågan, admin ska kunna granska och godkänna utan dataläckage eller dubbelbokningar, städaren ska bara se det som behövs för utförandet, och kundportalen ska vara säker nog för skarp drift.

## Statusnyckel

- Ej startad: ingen kodändring i denna fas.
- Pågår: arbete är påbörjat men inte verifierat.
- Delvis klar: funktionalitet finns, men saknar full test/verifiering.
- Klar: implementerat, testat och accepterat.

---

## Fas 1 - Städare ska aldrig se pris

Status: Delvis klar

Edge case: Städare ska kunna se sina pass, adress, checklista, önskemål och in-/utcheckning, men inte pris/offert/justerat pris.

Slutmål: En städare kan logga in och se sitt schema utan att prisfält exponeras i UI, API-respons eller konsol. Admin ser fortsatt pris.

Steg:

1. Klart: kartlägg vilka tabeller/vyer frontend hämtar för städarrollen.
2. Klart: kontrollera särskilt `booking_requests`, `shifts`, `properties`, `properties_customer` och eventuell prisdata i `notes`/metadata.
3. Klart: säkerställ att städarvyer inte renderar `estimated_price_sek` eller liknande.
4. Klart: klienthydreringen hoppar nu helt över `booking_requests` för städarrollen, så pris/offerttabellen hämtas inte i städarens browser.
5. Återstår: testa med städarkonto i webbläsare och verifiera Network/Console.

Implementerat:

- `src/supabase.jsx` hämtar bara `booking_requests` för admin och kundroller. Städare får en tom lista i klientstate.
- Befintlig RLS/migration ger `booking_requests` adminstyrd SELECT, vilket innebär att städare inte ska få prisrader via Supabase Data API.
- Städarens synliga önskemål kommer via `shift_requests`, inte via direktläsning av `booking_requests`.
- Verifierat mot länkad Supabase: `booking_requests` har bara `booking_requests_admin_select` och `booking_requests_admin_update` för rollen `authenticated`, båda med `is_admin()` + `current_org_id()`.
- Verifierat lokalt: `npm run build` går igenom efter ändringen.

Verifiering:

- Städare ser inte pris i schema, passdetalj, checklista eller kundinformation.
- Admin ser pris i bokningsförfrågan och kan justera det.
- Inga prisfält finns i städarens relevanta API-responser.

Berörda ytor:

- `src/supabase.jsx`
- `src/views.jsx`
- RLS/vyer för `booking_requests`, `shifts` och eventuella rollspecifika vyer.

---

## Fas 2 - Skydda publik bokningsendpoint mot spam/missbruk

Status: Klar

Edge case: CORS stoppar fel webborigin, men en server kan fortfarande anropa `public-booking-request` direkt och skapa spamförfrågningar.

Slutmål: Publik bokning är fortsatt enkel för riktiga kunder, men har grundskydd mot automatiserat spam.

Steg:

1. Klart: behåll CORS allowlist som första skydd.
2. Klart: lägg till lågfriktionsskydd med honeypot-fält och minsta formulärtid.
3. Klart: logga inte personuppgifter i klartext vid valideringsfel.
4. Klart: gör felmeddelanden kundvänliga men inte informationsläckande.
5. Kvar som framtida eskalering: captcha eller riktig rate-limit först om spam faktiskt uppstår.

Implementerat:

- `supabase/functions/public-booking-request/index.ts` blockerar nu POST utan `Origin`.
- Edge Function kräver att `Origin` matchar allowlist.
- Edge Function returnerar fortfarande success-format för honeypotträffar, men skapar ingen bokningsrad.
- Edge Function kräver `form_started_at` och blockerar orimligt snabba formulär, under 4 sekunder.
- Edge Function blockerar formulärsessioner äldre än 24 timmar.
- `src/views.jsx` skickar `form_started_at` från widgetens starttid.
- `src/views.jsx` har två tysta honeypotfält: `website` och `company`.

Verifiering:

- `npm run build` går igenom.
- `public-booking-request` är deployad till Supabase.
- POST utan `Origin` returnerar `403 Origin not allowed`.
- Honeypot med `website` returnerar `200 {"ok":true,"status":"received"}` utan att gå vidare till RPC.
- Tillåten origin utan `form_started_at` returnerar `400 missing_form_started_at`.
- Tillåten origin med direkt/robot-snabb `form_started_at` returnerar `400 form_submitted_too_fast`.
- Frontend måste deployas tillsammans med Edge Function, eftersom live-widgeten behöver skicka `form_started_at`.

Berörda ytor:

- `supabase/functions/public-booking-request/index.ts`
- `supabase/functions/public-availability/index.ts`
- Widgetens bokningsformulär i `src/views.jsx`.

---

## Fas 3 - Kundmatchning via e-post utan dubbletter

Status: Ej startad

Edge case: Befintlig kund med samma e-post ska få tillgång till sin vanliga profil. Ny profil ska inte skapas i onödan.

Slutmål: Samma normaliserade e-postadress leder till samma kund-/portalprofil, och admin kan hantera avvikande fall.

Steg:

1. Kontrollera hur `admin_prepare_customer_portal_for_booking_request` matchar e-post.
2. Säkerställ normalisering: trim + lowercase.
3. Definiera policy för samma e-post men nytt namn/telefon/adress.
4. Undvik att skriva över befintlig viktig kunddata utan avsikt.
5. Lägg till adminnotis om en bokning kopplas till befintlig kund.

Verifiering:

- Ny bokning med befintlig e-post skapar inte ny auth-/kundprofil.
- Kunden ser både tidigare och ny godkänd bokning i portalen.
- Ny bokning med annan e-post skapar separat kundspår.

Berörda ytor:

- `supabase/migrations/20260729124223_customer_portal_approval_provisioning.sql`
- `supabase/functions/send-customer-portal-invite/index.ts`
- Kundportalvyer i `src/views.jsx`.

---

## Fas 4 - Tillgänglighet tillsvidare utan dataväxtproblem

Status: Ej startad

Edge case: "Tillsvidare" är praktiskt, men kan skapa väldigt många framtida slots eller gamla oanvända slots.

Slutmål: Admin kan sätta återkommande tillgänglighet tillsvidare, men systemet genererar bara en rimlig horisont framåt och kan pausa/radera säkert.

Steg:

1. Kartlägg hur nuvarande tillsvidare skapas och lagras.
2. Bestäm materialiseringshorisont, exempelvis 8-12 veckor framåt.
3. Säkerställ att paus/radering påverkar kommande obokade tider utan att röra historik eller bokade pass felaktigt.
4. Lägg till/planera städning av gamla obokade availability slots.
5. Testa duplicerade tider för samma service och dag.

Verifiering:

- Admin kan skapa tillsvidare.
- Kalendern visar framtida tider utan orimligt många rader.
- Paus/radering tar bort rätt kommande tillgänglighet.
- Bokade pass ligger kvar och påverkas inte felaktigt.

Berörda ytor:

- Admin Tillgänglighet i `src/views.jsx`
- `booking_availability_slots`
- Relevanta public availability-funktioner.

---

## Fas 5 - Separera telefontider från städtider

Status: Ej startad

Edge case: Övriga tjänster ska boka telefontid, inte råka använda samma logik som städuppdrag eller visa pris.

Slutmål: Hemstädning, flyttstädning och storstädning har prisflöde. Övriga tjänster har kontakt-/telefontidsflöde utan pris och med egen 1h-buffer.

Steg:

1. Lista vilka tjänster som är prissatta respektive offert via samtal.
2. Säkerställ att service type styr rätt flöde i widgeten.
3. Separera availability för phone consultation från cleaning availability.
4. Sätt 1h buffer för telefontider.
5. Kontrollera att admin ser ärendet som telefontidsförfrågan, inte städpass.

Verifiering:

- Prissatta tjänster visar kalkylator och pris.
- Övriga tjänster visar inte pris.
- Telefontid skapas som rätt typ av förfrågan.
- Städarnas schema fylls inte av rena samtalsbokningar om de inte ska det.

Berörda ytor:

- Widget i `src/views.jsx`
- `supabase/functions/public-availability/index.ts`
- `supabase/functions/public-booking-request/index.ts`
- Adminvy för förfrågningar.

---

## Fas 6 - Checklistor för tillägg och tjänstemallar

Status: Klar

Edge case: Nya tillägg, exempelvis sängkläder och strykning, måste bli tydliga checklist-/önskemålspunkter när bokningen godkänns.

Slutmål: Varje godkänd bokning får rätt baschecklista för tjänsten plus automatiska punkter från kundens val och kommentar.

Steg:

1. Klart: granska `public_booking_service_checklist_items`.
2. Klart: säkerställ att hemstädningens nya tillägg finns med:
   - Byta sängkläder med antal sängar.
   - Strykning med antal och plaggtyp.
3. Klart: säkerställ att flyttstädning, storstädning och fönsterputs får rätt basmall.
4. Klart: säkerställ att kundens kommentar landar i önskemål/shift requests.
5. Klart: admin kan lägga till/ta bort punkter efter godkännande.

Implementerat:

- Ny migration: `supabase/migrations/20260802214436_enrich_public_booking_checklist_addons.sql`.
- `public_booking_service_checklist_items(text, jsonb)` behåller samma interface men berikar implementationen:
  - Hemstädning med sängkläder skapar checklistpunkt med antal sängar.
  - Hemstädning med strykning skapar checklistpunkt med total antal plagg och plaggtyper, exempelvis skjortor, byxor och kostymbyxor.
  - Fönsterputs som tillägg skapas för hemstädning/storstädning.
  - Flyttstädning får inte extra fönsterputs-tillägg, eftersom fönsterputs ingår i flyttstädningsmallen.
- `src/mock.jsx` har samma checklistlogik som databasen för adminförhandsvisning och lokal state.

Verifiering:

- `npm run build` går igenom.
- Migrationen är körd mot länkad Supabase med `supabase db query --linked --file`.
- SQL-test för hemstädning med sängkläder, strykning och fönsterputs returnerar rätt `Tillagg:`-punkter.
- SQL-test för flyttstädning med `windows=true` returnerar `moving_window_addon_count = 0`, alltså ingen dubbel fönsterputs som tillägg.
- Kundkommentar hanteras redan via `shift_requests` i public booking RPC.
- Städare/admin kan bocka av shift-checklistan via befintlig `shift_checklist_items`-vy.
- Admin kan ändra checklistan via befintliga passdetaljåtgärder.

Berörda ytor:

- `supabase/migrations/20260731121500_public_booking_new_addon_checklists.sql`
- `supabase/migrations/20260729100538_ensure_booking_checklist_helpers.sql`
- Passdetalj/checklistvy i `src/views.jsx`.

---

## Fas 7 - 24h-avbokning med tidszon och tydliga fel

Status: Delvis klar

Edge case: Kund får avboka senast 24h innan start. Det måste fungera korrekt med svensk tid, sommar-/vintertid och ändrade starttider.

Slutmål: Kund kan avboka i portalen fram till exakt 24h före planerad start, och får tydligt meddelande när det inte längre går.

Steg:

1. Verifiera att databasen använder `timestamptz` och serverregel, inte frontendtid.
2. Testa `original_start_at` kontra `start_at`.
3. Testa avbokning 25h före, exakt 24h före och 23h59 före.
4. Kontrollera UI-copy i kundportalen.
5. Kontrollera notiser till admin och städare.

Verifiering:

- 25h före: avbokning fungerar.
- 24h eller mindre: avbokning blockeras.
- Admin/städare får notis.
- Status blir `Avbokat` och booking request blir `cancelled`.

Berörda ytor:

- `supabase/migrations/20260729133131_customer_cancel_24h_rpc.sql`
- Kundportal i `src/views.jsx`
- Notiser i `src/app.jsx`.

---

## Fas 8 - Reparera migrationshistorik och driftsdisciplin

Status: Ej startad

Edge case: Vissa SQL-ändringar har körts direkt eftersom lokal och remote migrationshistorik inte matchar helt. Det är inte akut i runtime, men det är teknisk skuld.

Slutmål: Lokal migrationshistorik och Supabase remote history är förståelig, dokumenterad och går att arbeta med utan att riskera fel push.

Steg:

1. Kör `supabase migration list` och dokumentera skillnader.
2. Bestäm strategi: repair, pull eller behåll direktapplicerade SQL som dokumenterad historik.
3. Undvik `supabase db push` tills historiken är förstådd.
4. Lägg alla nya schemaändringar i migrationer framåt.
5. Dokumentera manuell Supabase-rutin i `supabase-rollout.md` eller här.

Verifiering:

- Vi vet exakt vilka migrationer som finns lokalt och remote.
- Nästa schemaändring kan göras utan historikkrock.
- Teamet vet när SQL Editor ska användas och när migration ska användas.

Berörda ytor:

- `supabase/migrations`
- `supabase-rollout.md`
- Supabase CLI state.

---

## Rekommenderad arbetsordning

1. Fas 1 - prisläckage till städare.
2. Fas 6 - checklistor/tillägg.
3. Fas 5 - telefontider kontra städtider.
4. Fas 3 - kundmatchning.
5. Fas 7 - 24h-avbokning.
6. Fas 2 - spam/missbruk.
7. Fas 4 - tillsvidare-horisont.
8. Fas 8 - migrationshistorik.

Motivering: börja med dataläckage och kund-/städarupplevelse, därefter operationella och tekniska skulder.
