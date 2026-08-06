# CleanUp System Security 1

Syfte: följa den rekommenderade säkerhetsordningen stegvis, markera varje del när den är klar och redovisa verifierade resultat här. Dokumentet ska vara arbetsjournal, inte marknadsstatus.

## Statusmodell

- [ ] Ej påbörjad
- [~] Pågår
- [x] Klar lokalt
- [!] Blockerad eller kräver manuell åtgärd
- [D] Deployad/verifierad i Supabase/Vercel

## Fas 1 - Lås breda skrivytor

Status: [D] Deployad/verifierad i Supabase

Mål:
- Stoppa icke-admins från att kunna ändra känsliga fält på sin egen `public.users`-rad.
- Stoppa städare från direkt `UPDATE` på hela `public.shifts`.
- Stoppa städare från direkt `UPDATE` på hela `public.shift_checklist_items`.
- Behåll fungerande adminflöden tills de flyttas till egna server-RPC:er i nästa faser.

Plan:
- [x] Skapa smal RPC för kundprofil: endast `name` och `phone`.
- [x] Skapa smal RPC för checklist-toggle: endast `done_at` och `done_by_cleaner_user_id`.
- [x] Lägg DB-trigger som stoppar osäkra self-updates på `users`.
- [x] Droppa bred policy `shifts_cleaner_update`.
- [x] Droppa bred policy `checklist_items_cleaner_write`.
- [x] Uppdatera frontend till RPC för kundprofil och checklist-toggle.
- [x] Verifiera build och Supabase lint/advisors.

Resultat:
- Migration skapad: `supabase/migrations/20260806064744_security_phase1_lock_broad_writes.sql`.
- Frontend ändrad:
  - `src/supabase.jsx`: `updateSelfProfile` använder nu `update_own_profile`.
  - `src/supabase.jsx`: `toggleChecklistItem` använder nu `toggle_shift_checklist_item`.
  - `src/mock.jsx`: lokal state uppdateras med canonical response från RPC.
- Live Supabase:
  - Migrationen dry-run-kördes med `BEGIN`/`ROLLBACK` utan SQL-fel.
  - Migrationen applicerades på linked Supabase.
  - Migration history reparerades för version `20260806064744`.
- Verifierat live:
  - `shifts_cleaner_update` finns inte längre.
  - `checklist_items_cleaner_write` finns inte längre.
  - `users_guard_self_safe_update` finns som `BEFORE UPDATE` trigger på `users`.
  - `update_own_profile`, `toggle_shift_checklist_item` och `guard_users_self_safe_update` finns i `public`.
- Verifiering:
  - `npm run build`: OK.
  - `supabase db lint --linked --schema public --fail-on none`: OK med kvarvarande äldre varningar i befintliga funktioner.
  - `supabase db advisors --linked --type security --level warn --fail-on none`: kvarvarande varningar finns, inklusive intentional `SECURITY DEFINER`-RPC och leaked password protection.
  - `supabase db advisors --linked --type performance --level warn --fail-on none`: kvarvarande performance-varningar finns, men `shifts`/`shift_checklist_items` update-varningar minskade jämfört med analysen.

Kvar att följa upp:
- `users_self_update` finns kvar för kompatibilitet med adminflöden, men icke-admin self-update begränsas nu av trigger. Full stängning kräver att fler admin-user-writes flyttas till RPC.
- De nya RPC:erna är `SECURITY DEFINER` och syns därför i security advisor. Det är avsiktligt i fas 1, men bör senare flyttas till tydligare command-RPC-mönster/privat helper-schema när fas 2-3 görs.

## Fas 2 - Notiser och e-postlänkar

Status: [D] Deployad/verifierad i Supabase

Mål:
- Ta bort klientens möjlighet att skapa godtyckliga notiser till valfri mottagare.
- Blockera absoluta externa URL:er i notis/e-postpayload.
- Tillåt endast kända interna route-prefix per roll.

Plan:
- [x] Ersätt osäker generisk `insert_notifications` med härdad kompatibilitets-RPC.
- [x] Whitelista `target_path`.
- [x] Gör CORS strikt på `send-notification-email`.
- [x] Lägg verifiering för origin-skydd, intern route-prefix och notistabellens insert-yta.

Resultat:
- Migration skapad: `supabase/migrations/20260806065622_security_phase2_lock_notifications.sql`.
- Frontend ändrad:
  - `src/supabase.jsx`: filtrerar notiskind mot allowlist innan RPC.
  - `src/supabase.jsx`: normaliserar `target_path` till interna `#/`/`/admin`/`/stadare`/`/kund`-vägar och släpper externa URL:er.
- Edge Function ändrad:
  - `supabase/functions/send-notification-email/index.ts`: strikt CORS med allowlist för CleanUp-domäner och lokala dev-URL:er.
  - `send-notification-email`: externa `http(s)` target-länkar ignoreras; fallback blir rollstyrd intern vy.
  - `send-notification-email`: nekad origin får 403 utan `Access-Control-Allow-Origin`.
- Live Supabase:
  - Migrationen dry-run-kördes med `BEGIN`/`ROLLBACK` utan SQL-fel.
  - Migrationen applicerades på linked Supabase.
  - Migration history reparerades för version `20260806065622`.
  - Edge Function `send-notification-email` deployades till projekt `bkmnlcdsbvpucpqmaycx`.
- Verifierat live:
  - `notifications_insert`-policy finns inte längre.
  - `authenticated` har inte längre `INSERT` eller `DELETE` på `public.notifications`; endast `SELECT` och `UPDATE` ligger kvar för läs/markera läst.
  - `insert_notifications` är `SECURITY DEFINER` med `search_path=public`.
  - OPTIONS från `https://www.logincleanup.app` returnerar 200 och rätt `Access-Control-Allow-Origin`.
  - OPTIONS från `https://evil.example` returnerar 403 och ingen `Access-Control-Allow-Origin`.
- Verifiering:
  - `npm run build`: OK.
  - `supabase db lint --linked --schema public --fail-on none`: OK för nya `insert_notifications`; kvarvarande äldre lint-varningar finns i andra befintliga funktioner.
  - `supabase db advisors --linked --type security --level warn --fail-on none`: kvarvarande advisor-varningar finns för authenticated-callable `SECURITY DEFINER`-funktioner, inklusive denna härdade kompatibilitets-RPC.
  - `supabase db advisors --linked --type performance --level warn --fail-on none`: kvarvarande performance-varningar finns i äldre policies.

Kvar att följa upp:
- `insert_notifications` är fortfarande en authenticated-callable kompatibilitets-RPC för äldre klientflöden. Den är nu begränsad med kind-allowlist, orgkontroll, rollstyrda interna länkar och shift/property/customer-kopplingar, men nästa hårdare nivå är att flytta notisskapande till mer specifika command-RPC:er per domänflöde.
- `send_message_with_notifications` äger fortfarande meddelandenotiser, vilket är rätt riktning. Den bör ingå i senare RPC-granskning eftersom Supabase advisor flaggar alla `SECURITY DEFINER`-funktioner generellt.

## Fas 3 - Adminbokningar som transaktioner

Status: [D] Deployad/verifierad i Supabase

Mål:
- Flytta splittrade adminflöden till server-RPC med transaktion, row lock och audit.

Flöden:
- [x] Godkänn publik bokningsförfrågan.
- [x] Neka publik bokningsförfrågan.
- [x] Ta bort bokning.
- [x] Byt städare.
- [x] Justera tid.
- [x] Justera arbetad tid.

Resultat:
- Migration skapad: `supabase/migrations/20260806071542_security_phase3_admin_shift_commands.sql`.
- Nya admin-only RPC:er:
  - `admin_approve_booking_shift(p_shift_id, p_cleaner_user_id)`
  - `admin_decline_booking_shift(p_shift_id)`
  - `admin_delete_shift(p_shift_id)`
  - `admin_swap_shift_cleaner(p_shift_id, p_new_cleaner_user_id)`
  - `admin_adjust_shift_time(p_shift_id, p_start_at, p_end_at)`
  - `admin_adjust_shift_worked_time(p_shift_id, p_checked_in_at, p_checked_out_at)`
- Frontend ändrad:
  - `src/supabase.jsx`: admin-persisters använder nu RPC:erna ovan i stället för splittrade `shifts.update` + `booking_requests.update` + `shift_events.insert`.
  - Kundportal-invite efter godkänd bokning skickas fortfarande efter att RPC:n returnerat portaldata.
- Live Supabase:
  - Migrationen dry-run-kördes med `BEGIN`/`ROLLBACK` utan SQL-fel.
  - Migrationen applicerades på linked Supabase.
  - Migration history reparerades för version `20260806071542`.
- Verifierat live:
  - Alla sex RPC:er finns i `public`, är `SECURITY DEFINER` och har `search_path=public`.
  - Execute-ACL är `authenticated`, `service_role` och ägaren `postgres`; `anon`/`public` har inte explicit execute.
  - `supabase migration list --linked` visar `20260806071542` som både lokal och remote.
- Verifiering:
  - `npm run build`: OK.
  - `supabase db lint --linked --schema public --fail-on none`: OK för nya fas 3-RPC:er; kvarvarande äldre lint-varningar finns i andra befintliga funktioner.
  - `supabase db advisors --linked --type security --level warn --fail-on none`: kvarvarande advisor-varningar finns för authenticated-callable `SECURITY DEFINER`-funktioner, inklusive de nya admin-RPC:erna.

Kvar att följa upp:
- Breda admin-RLS-policies ligger kvar eftersom andra adminflöden fortfarande använder direkta tabellskrivningar. Fas 3 minskar risk i bokningsåtgärderna, men full stängning av bred admin-write kräver att fler adminområden flyttas till command-RPC:er.
- Notiser/e-post efter åtgärder går fortsatt via befintligt notisflöde efter lyckad servertransaktion. Nästa hårdare steg är att låta serverkommandona även returnera eller skapa exakt notifieringskommando per flöde.

## Fas 4 - Serverstyrd passfinalisering

Status: [D] Deployad/verifierad i Supabase

Mål:
- Ta bort statusändrande sidoeffekter från frontend-hydration och klientintervall.
- Flytta automatisk finalisering till serverjobb, cron eller explicit admin-RPC.

Resultat:
- Migration skapad: `supabase/migrations/20260806100709_security_phase4_server_finalization.sql`.
- Server ändrad:
  - `finalize_eligible_shifts(p_now)` är omskriven med advisory lock så två körningar inte kan jobba parallellt.
  - Funktionen använder `FOR UPDATE SKIP LOCKED` och begränsad batchstorlek för stabil cron-körning.
  - Sen incheckning samma dag kontrolleras mot `Europe/Stockholm`.
  - Ny tabell `shift_finalization_runs` loggar körningar, antal finaliserade pass, skip/error och payload.
  - Cron-jobbet `finalize-eligible-shifts` är omschemalagt till `* * * * *` via `cron.unschedule`/`cron.schedule`.
- Frontend ändrad:
  - `src/supabase.jsx`: hydration kör inte längre `db.runShiftFinalization`.
  - `src/app.jsx`: minutintervallet kör bara lokal finalisering när Supabase inte är aktivt.
  - `src/views.jsx`: rapport-refresh kör inte lokal finalisering i Supabase-läge.
  - `src/mock.jsx`: `finalizeEligibleShifts` och `runShiftFinalization` returnerar no-op i Supabase-läge som extra skydd.
- Live Supabase:
  - Migrationen dry-run-kördes med `BEGIN`/`ROLLBACK` utan SQL-fel.
  - Migrationen applicerades på linked Supabase.
  - Migration history reparerades för version `20260806100709`.
- Verifierat live:
  - Cron-jobbet `finalize-eligible-shifts` är aktivt med schedule `* * * * *`.
  - Cron-kommandot är `SELECT public.finalize_eligible_shifts();`.
  - Ofarlig testkörning med `1900-01-01` gav loggrad `completed` med `finalized_count = 0`.
  - `finalize_eligible_shifts` är `SECURITY DEFINER`, har `search_path=public` och ACL `{postgres, service_role}`; vanliga `authenticated` kan inte köra funktionen.
  - `shift_finalization_runs` har RLS och admin-only select-policy.
- Verifiering:
  - `npm run build`: OK.
  - `node -e "...ShiftFinalization.__runTests()"`: 24 tester OK.
  - `supabase db lint --linked --schema public --fail-on none`: OK för nya fas 4-objekt; kvarvarande äldre lint-varningar finns i andra befintliga funktioner.
  - `supabase db advisors --linked --type security --level warn --fail-on none`: `finalize_eligible_shifts` flaggas inte längre som authenticated-callable `SECURITY DEFINER`.
  - `supabase db advisors --linked --type performance --level warn --fail-on none`: kvarvarande performance-varningar finns i äldre policies.

Kvar att följa upp:
- `adminCompleteShift` och `approveShiftCompletion` är fortfarande separata adminflöden i frontend-persistern. De bör flyttas till command-RPC i nästa hårdningspass, men automatisk finalisering ägs nu av server/cron.
- Admin-UI kan senare visa `shift_finalization_runs` för driftstatus, senaste körning och eventuella error.

## Fas 5 - URL, CSP och deploy-dokumentation

Status: [~] Pågår

Mål:
- [x] Välj en kanonisk appdomän.
- [x] Dokumentera Supabase Auth Site URL och redirect URLs.
- [x] Ta bort `inlogg.cleanup.nu`/`login.cleanup.nu` som rekommenderade produktions-URL:er i docs.
- [x] Skärp Content Security Policy.
- [x] Uppdatera utdaterade docs som säger att allt redan är färdigproduktionsklart.
- [x] Bygg och verifiera lokalt.
- [ ] Pusha och verifiera Vercel-liveheaders efter deploy.

Resultat:
- Kanonisk appdomän vald: `https://www.logincleanup.app/CleanUp.html`.
- Ny dokumentation skapad: `docs/production-url-security.md`.
- `DEPLOY.md` omskriven till aktuell Vercel/Supabase Auth-guide utan trasiga `cleanup.nu`-subdomäner som Site URL.
- `supabase/README.md` uppdaterad med försiktigare produktionsrutiner, canonical URL och Edge Function secrets.
- `vercel.json` skärpt:
  - HSTS med `includeSubDomains` och `preload`.
  - CSP med `default-src`, `script-src`, `connect-src`, `object-src`, `base-uri`, `form-action`, `worker-src` och `frame-ancestors`.
  - `frame-ancestors` tillåter fortsatt iframe från `cleanup.nu`/`www.cleanup.nu`.
  - `Permissions-Policy` utökad för att stänga fler browser-capabilities.

Kvar att verifiera:
- `npm run build`: OK.
- Efter Vercel-deploy: `curl.exe -I https://www.logincleanup.app/CleanUp.html`.
- Manuellt i Supabase Dashboard:
  - Site URL = `https://www.logincleanup.app/CleanUp.html`.
  - Redirect URLs enligt `docs/production-url-security.md`.
  - `CUSTOMER_PORTAL_SITE_URL=https://www.logincleanup.app/CleanUp.html`.

## Fas 6 - Tester och regressionsskydd

Status: [ ] Ej påbörjad

Mål:
- Lägg RLS-/RPC-testfall för admin, städare, kund och kundanställd.
- Lägg Playwright smoke-flöden för login, kundportal, check-in/out, checklistor och meddelanden.

Resultat:
- Ej påbörjat.

## Kända kontrollpunkter från analys

- `npm audit --omit=dev`: 0 runtime-sårbarheter.
- `npm audit`: 1 hög dev-varning i PostCSS.
- `supabase db advisors --linked --type security`: varnar för flera authenticated-callable `SECURITY DEFINER`-funktioner och leaked password protection disabled.
- `supabase db advisors --linked --type performance`: varnar för flera permissive policies och en RLS initplan-varning.
- `https://www.logincleanup.app`: svarar med HSTS, `nosniff`, Referrer-Policy och frame-ancestor-CSP.
- `https://inlogg.cleanup.nu` och `https://login.cleanup.nu`: gav TLS/certifikatfel vid kontroll.
- Migrationshistorik är delvis driftad mellan lokal och remote; använd inte `supabase db push` slentrianmässigt.
