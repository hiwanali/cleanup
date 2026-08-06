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

Status: [ ] Ej påbörjad

Mål:
- Ta bort klientens möjlighet att skapa godtyckliga notiser till valfri mottagare.
- Blockera absoluta externa URL:er i notis/e-postpayload.
- Tillåt endast kända interna route-prefix per roll.

Plan:
- [ ] Ersätt generisk `insert_notifications` i klientflöden med domän-RPC:er.
- [ ] Whitelista `target_path`.
- [ ] Gör CORS strikt på `send-notification-email`.
- [ ] Lägg verifiering för ny meddelandelänk, adminlänk och kundlänk.

Resultat:
- Ej påbörjat.

## Fas 3 - Adminbokningar som transaktioner

Status: [ ] Ej påbörjad

Mål:
- Flytta splittrade adminflöden till server-RPC med transaktion, row lock och audit.

Flöden:
- [ ] Godkänn publik bokningsförfrågan.
- [ ] Neka publik bokningsförfrågan.
- [ ] Ta bort bokning.
- [ ] Byt städare.
- [ ] Justera tid.
- [ ] Justera arbetad tid.

Resultat:
- Ej påbörjat.

## Fas 4 - Serverstyrd passfinalisering

Status: [ ] Ej påbörjad

Mål:
- Ta bort statusändrande sidoeffekter från frontend-hydration och klientintervall.
- Flytta automatisk finalisering till serverjobb, cron eller explicit admin-RPC.

Resultat:
- Ej påbörjat.

## Fas 5 - URL, CSP och deploy-dokumentation

Status: [ ] Ej påbörjad

Mål:
- Välj en kanonisk appdomän.
- Säkerställ Supabase Auth Site URL och redirect URLs.
- Fixa `inlogg.cleanup.nu`/`login.cleanup.nu` eller ta bort dem från dokumentation.
- Skärp Content Security Policy.
- Uppdatera utdaterade docs som säger att allt redan är färdigproduktionsklart.

Resultat:
- Ej påbörjat.

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
