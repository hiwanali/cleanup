# CleanUp · Säkerhetsanalys

## ✅ Implementerade säkerhetsåtgärder

### Frontend
- **Produktions-React**: Använder minifierade productionversioner
- **CSP-headers**: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection
- **Input validering**: Email regex, trim(), längdkontroller
- **Error handling**: Generiska felmeddelanden, inga tekniska detaljer läcker
- **CORS**: Crossorigin på externa scripts
- **No unsafe operations**: Ingen innerHTML, eval, Function() eller liknande

### Autentisering
- **Supabase Auth**: Managed auth service med bcrypt
- **JWT tokens**: Automatisk refresh och säker lagring
- **Session management**: localStorage med fallback-hantering
- **Login protection**: Rate limiting via Supabase

### Databas (RLS)
- **Row Level Security**: Aktiverat på alla tabeller
- **Rollbaserad åtkomst**: admin/cleaner/customer/customer_employee
- **Org-separation**: Användare ser endast sin organisations data
- **Helper functions**: SECURITY DEFINER med begränsat scope
- **Function security**: RPC-åtkomst revokerad för interna funktioner
- **View security**: properties_customer utan SECURITY DEFINER

### Miljövariabler
- **Publishable keys**: Endast anon key exponeras i frontend
- **Service role**: Aldrig i frontend (.env/.gitignore)
- **Config generation**: Dynamisk från Vercel env vars

## 🔍 Identifierade och åtgärdade risker

### Supabase Security Advisor
1. **SECURITY DEFINER View** → Fixad: properties_customer utan SECURITY DEFINER
2. **RPC Function Exposure** → Fixad: REVOKE EXECUTE på interna funktioner
3. **Leaked Password Protection** → Kan aktiveras i Supabase Dashboard

### Frontend säkerhet
1. **Development React** → Fixad: Production builds
2. **Console.error leakage** → Fixad: Generiska felmeddelanden
3. **Missing security headers** → Fixad: Full header suite

## 🔐 Säkerhetsgenomgång efter lansering (2026-05-31)

Migration `20260531230000_security_access_review.sql` (applicerad live):

1. **shift_events_select (åtkomstlucka)** → Fixad: kundroller var begränsade till
   `shift_in_org()` (hela organisationen) och kunde därmed se in-/utcheckningshändelser
   för andra kunders pass. Nu begränsat till `accessible_property_ids()` (egna objekt).
2. **incidents_select (krav)** → Kund/kundanställd ser nu både egna reklamationer
   (`customer_complaint`) och städar-rapporterade avvikelser (`cleaner_issue`) på sina
   egna objekt. Städar-PII döljs fortsatt som "Städare" i klienten.
3. **properties_customer (advisor ERROR)** → Fixad: vyn satt till `security_invoker = true`
   (RLS på `properties` gäller nu anroparen, inte vyägaren).
4. **anon-EXECUTE (advisor WARN)** → Fixad: `REVOKE EXECUTE ... FROM anon, PUBLIC` på
   `admin_provision_user`, `generate_shifts_from_recurring`, `snapshot_checklist_for_shift`.
5. **Mutabel search_path (advisor WARN)** → Fixad: `search_path = public` satt på
   `is_last_weekday_of_month` och `recurring_matches_date`.

Frontend: `db.incidents()` i `src/mock.jsx` visar nu båda ärendetyperna för kundroller
(server-side RLS är den faktiska gränsen).

### Bekräftad åtkomstmodell
- **Admin**: endast egen organisations data (kunder, anställda, städare, rapporter) via `org_id = current_org_id()`.
- **Städare**: egna pass (`cleaner_user_id = auth.uid()`), incheckning/utcheckning, egna avvikelser.
- **Kund + kundanställd**: egna kontor, deras städningar (planerade + historiska) och avvikelser via `accessible_property_ids()` (kundanställd respekterar `scope`).

## 🚧 Kvarvarande åtgärder (rekommenderas)

### Supabase Dashboard (manuellt)
1. **Auth → Leaked Password Protection**: aktivera HaveIBeenPwned-kontroll (kan ej sättas via SQL/MCP).

### Valfri härdning (fas 2)
1. **Helper-funktioner exponerade som RPC för `authenticated`** (`is_admin()`, `current_org_id()` m.fl.):
   låg risk eftersom de internt filtrerar på `auth.uid()` och endast returnerar anroparens egen
   org/roll. RLS-policyerna kräver `EXECUTE`, så de kan inte enbart revokeras — full åtgärd kräver
   att de flyttas till ett icke-exponerat schema och att alla policyer skrivs om. Skjuts upp för
   att inte riskera live-driften nu.

### Production monitoring
1. **Error tracking**: Överväg Sentry/LogRocket för produktionsfel
2. **Database monitoring**: Supabase Dashboard → Observability

### Framtida förbättringar
1. **2FA**: Supabase stödjer MFA för admin-användare
2. **Email verification**: Kan aktiveras i Supabase Auth
3. **Audit logging**: Logga kritiska användaraktioner
4. **CSP**: Content Security Policy för ytterligare XSS-skydd

## ✅ Säkerhetsriktlinjer för utveckling

### Koden
- Använd alltid `trim()` på användarinput
- Validera email-format med regex
- Generiska felmeddelanden (inga tekniska detaljer)
- Ingen console.log av känslig data i produktion

### Databas
- Alla tabeller MÅSTE ha RLS aktiverat
- Nya funktioner: Sätt SECURITY DEFINER bara om nödvändigt
- Testa RLS policies med olika roller innan deploy
- Använd helper functions för konsekvent åtkomstkontroll

### Deploy
- Aldrig committa .env eller src/config.js
- Service role key endast i Vercel env vars (ej i kod)
- Test auth flows efter varje deploy
- Verifiera att RLS fungerar i produktion

---

**Status: REDO FÖR PRODUKTION** ✅

Alla kritiska säkerhetsrisker är åtgärdade. Systemet är säkert för produktionsanvändning med aktuell funktionalitet.