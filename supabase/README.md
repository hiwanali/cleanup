# Supabase · CleanUp

Databasen speglar **§5 i `mvpfinal.md`** och är deployad till projektet **CleanUp** (`bkmnlcdsbvpucpqmaycx`, region `eu-central-1`).

## Migreringar (lokal källa)

| Fil | Innehåll |
|-----|----------|
| `20260529100000_initial_schema.sql` | Tabeller, enums, vyer, auth-trigger, passgenerering |
| `20260529100100_rls_policies.sql` | RLS-hjälpfunktioner + policies |
| `20260529100200_seed_demo.sql` | Demodata + auth-användare |
| `20260529100300_function_grants_hardening.sql` | *(lägg till lokalt om du kör db push igen)* |

> Första deploy till molnet gjordes via Supabase MCP i delar; historiken i Dashboard kan skilja sig något från filnamnen ovan.

## Demokonton (lösenord: `demo1234`)

| Mejl | Roll |
|------|------|
| sara@cleanup.se | admin |
| anna@cleanup.se | cleaner |
| david@cleanup.se | cleaner |
| maria@cleanup.se | cleaner |
| erik@acme.se | customer (Acme) |
| lisa@acme.se | customer_employee |
| per@northco.se | customer (NorthCo) |

## Verifierat i databasen

- 16 tabeller med RLS aktiverat
- 7 användare, 2 kunder, 4 objekt
- ~131 pass, ~454 checklist-rader
- Vyer: `properties_customer` (utan `access_info`), `cleaners_public`

## CLI

```powershell
cd "c:\Users\Hiwan\Downloads\städplattform"
supabase login
supabase link --project-ref bkmnlcdsbvpucpqmaycx
supabase db push
```

Kopiera `.env.example` → `.env` och fyll i publishable key från Dashboard.

## Nästa steg (app)

1. Ersätt `src/mock.jsx` med `src/supabase.js` (supabase-js via CDN eller npm vid Next-migrering).
2. Logga in med `signInWithPassword` istället för DEV-profilväljaren.
3. Kundroller: läs `properties_customer`, inte `properties` (döljer nyckel/larm).
