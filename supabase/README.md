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

> Första deploy till molnet gjordes delvis via Supabase MCP; kör `supabase db push` för att synka lokala filer.

## Produktionskonton (cleanup.nu)

| Mejl | Roll | Lösenord | Åtkomst |
|------|------|----------|---------|
| info@cleanup.nu | admin | `CleanUp2026!` | Hela organisationen |
| concito@cleanup.nu | customer | `Work123!` | Kund Concito (huvudkontakt) |
| linneaconcito@cleanup.nu | customer_employee | `Work123!` | Concito, alla objekt |
| cleanup123@cleanup.nu | cleaner | `CleanUp2026!` | Concito Kontor (pass + checklista) |

Mejl lagras i lowercase i Auth; inloggning fungerar oavsett versaler.

## Demokonton (lösenord: `demo1234`)

| Mejl | Roll |
|------|------|
| sara@cleanup.se | admin |
| anna@cleanup.se | cleaner |
| erik@acme.se | customer (Acme) |
| lisa@acme.se | customer_employee |

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
3. Build command körs automatiskt via `vercel.json` (`node scripts/generate-config.js`).
4. Rot-URL `/` pekar på `CleanUp.html`.

Lokal utveckling:

```powershell
copy src\config.example.js src\config.js
# Fyll i anonKey, eller:
$env:SUPABASE_ANON_KEY="din_key"; node scripts/generate-config.js
python -m http.server 5500
# Öppna http://localhost:5500/CleanUp.html
```
