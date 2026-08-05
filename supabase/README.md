# Supabase · CleanUp

Databasen speglar **§5 i `mvpfinal.md`** och är deployad till projektet **CleanUp** (`bkmnlcdsbvpucpqmaycx`, region `eu-central-1`).

## Migreringar (lokal källa)

| Fil | Innehåll |
|-----|----------|
| `20260529100000_initial_schema.sql` | Tabeller, enums, vyer, auth-trigger, passgenerering |
| `20260529100100_rls_policies.sql` | RLS-hjälpfunktioner + policies |
| `20260529100200_seed_demo.sql` | Demodata + auth-användare (demo) |
| `20260529100300_function_grants_hardening.sql` | Säkerhet för SECURITY DEFINER-funktioner |
| `20260529100400_production_users_concito.sql` | **Produktionskonton cleanup.nu + kund Concito** |
| `20260529100500_properties_customer_view.sql` | Vy utan `access_info` för kundroller |
| `20260531120000_notification_email.sql` | `email_sent_at`, RPC `insert_notifications` |

> Första deploy till molnet gjordes delvis via Supabase MCP; kör `supabase db push` för att synka lokala filer.

## E-postnotiser (Resend)

Notiser sparas i `notifications` (in-app). E-post skickas via Edge Function `send-notification-email` när en rad skapats.

### 1. Migrering och funktion

```powershell
supabase db push
supabase functions deploy send-notification-email --project-ref bkmnlcdsbvpucpqmaycx
supabase functions deploy request-customer-login-link --project-ref bkmnlcdsbvpucpqmaycx
```

### 2. Secrets (Dashboard → Edge Functions)

| Secret | Exempel |
|--------|---------|
| `RESEND_API_KEY` | `re_...` från [resend.com](https://resend.com) |
| `RESEND_FROM` | `CleanUp <notis@cleanup.nu>` (verifierad domän) |

`SUPABASE_URL` och `SUPABASE_SERVICE_ROLE_KEY` sätts automatiskt vid deploy.

Ytterligare secrets för kundens självservice-login:

| Secret | Exempel |
|--------|---------|
| `CUSTOMER_LOGIN_HASH_SECRET` | Slumpad hemlighet för hashad audit/rate limit (rekommenderas) |
| `CUSTOMER_LOGIN_ALLOWED_ORIGINS` | Kommaseparerad allowlist vid behov, t.ex. `https://www.logincleanup.app,https://cleanup.nu` |

Auth signup ska vara avstängd i Supabase Dashboard. Kundens självservice-login ska gå via `request-customer-login-link`, som alltid svarar neutralt och bara skickar magic link till befintliga kundkonton.

### 3. Flöde

1. Frontend: `pushNotification` → lokal notis + `insert_notifications` RPC.
2. Efter insert: `functions.invoke('send-notification-email', { record: { id } })`.
3. Edge Function: hämtar mottagare, bygger svensk mall, anropar Resend, sätter `email_sent_at`.

**Valfritt (utan klientinvoke):** Database Webhook på `notifications` INSERT → samma Edge Function (använd inte båda utan idempotens via `email_sent_at`).

### 4. Test

1. Logga in med produktionskonto (UUID-användare).
2. Sjukanmäl pass → admin + kund ska få mejl.
3. Godkänn pass → städare + kund får `assigned_shift`.
4. Kontrollera `notifications.email_sent_at` i Table Editor.

## Produktionskonton (cleanup.nu)

| Mejl | Roll | Lösenord | Åtkomst |
|------|------|----------|---------|
| info@cleanup.nu | admin | `CleanUp2026!` | Hela organisationen |
| concito@cleanup.nu | customer | `Work123!` | Kund Concito (huvudkontakt) |
| linneaconcito@cleanup.nu | customer_employee | `Work123!` | Concito, alla objekt |
| cleanup123@cleanup.nu | cleaner | `CleanUp2026!` | Concito Kontor (pass + checklista) |

Mejl lagras i lowercase i Auth; inloggning fungerar oavsett versaler.

## Demokonton

Admin/städare i demodata använder `demo1234`. Kundroller ska logga in via magic link eller få ett lösenord satt av admin; migrationen för självservice-login roterar bort kunders gamla `demo1234`.

| Mejl | Roll | Inloggning |
|------|------|------------|
| sara@cleanup.se | admin | `demo1234` |
| anna@cleanup.se | cleaner | `demo1234` |
| erik@acme.se | customer (Acme) | magic link / admin reset |
| lisa@acme.se | customer_employee | magic link / admin reset |

## CLI

```powershell
cd "c:\Users\Hiwan\Downloads\städplattform"
supabase login
supabase link --project-ref bkmnlcdsbvpucpqmaycx
supabase db push
```

## Vercel-deploy

1. Importera repot på [vercel.com](https://vercel.com).
2. Lägg till miljövariabler (Production + Preview):
   - `SUPABASE_URL` = `https://bkmnlcdsbvpucpqmaycx.supabase.co`
   - `SUPABASE_ANON_KEY` = publishable key från Supabase Dashboard → API
3. Build command körs automatiskt via `vercel.json` (`npm run build` → output `dist/`).
4. Rot-URL `/` pekar på `CleanUp.html`.

Lokal utveckling:

```powershell
copy src\config.example.js src\config.js
# Fyll i anonKey, eller:
$env:SUPABASE_ANON_KEY="din_key"; node scripts/generate-config.js
python -m http.server 5500
# Öppna http://localhost:5500/CleanUp.html
```
