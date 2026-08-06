# Regression Tests

Fas 6 introducerar två återanvändbara testkommandon.

## Supabase Security Regression

```powershell
npm run test:security
```

Testet kör `supabase/tests/security_regression.sql` mot linked Supabase med Supabase CLI 2.79+.

Det är icke-destruktivt och kontrollerar:

- RLS är aktivt på centrala tabeller.
- Breda legacy-policies för städaruppdateringar är borta.
- `authenticated` kan inte längre skriva direkt till `notifications`.
- `anon`/`PUBLIC` kan inte köra känsliga `SECURITY DEFINER`-RPC:er.
- `finalize_eligible_shifts` kan bara köras av `service_role`.
- Utvalda `SECURITY DEFINER`-funktioner har `search_path=public`.
- Kund-/städarvyerna `properties_customer` och `cleaners_public` är `security_invoker=true`.

Wrappern `scripts/run-security-regression.js` väljer riktig Supabase CLI. Det behövs eftersom `npm exec supabase` kan peka på ett annat npm-paket än Supabase CLI.

## Playwright Smoke

```powershell
npm run test:smoke
```

Utan credentials testar den:

- Live-loginvyn laddar.
- Publik bokningswidget på `#/embed/booking` laddar.
- Browsern får inga page errors.

Med credentials testar den även rollernas icke-destruktiva vyer:

```text
CLEANUP_E2E_APP_URL=https://www.logincleanup.app/CleanUp.html
CLEANUP_E2E_ADMIN_EMAIL=...
CLEANUP_E2E_ADMIN_PASSWORD=...
CLEANUP_E2E_CLEANER_EMAIL=...
CLEANUP_E2E_CLEANER_PASSWORD=...
CLEANUP_E2E_CUSTOMER_EMAIL=...
CLEANUP_E2E_CUSTOMER_PASSWORD=...
```

Rollsmoken loggar in, öppnar centrala vyer och verifierar att rätt roll ser rätt yta:

- Admin: schema, meddelanden, rapporter.
- Städare: mina pass, meddelanden, rapporter/timmar.
- Kund: min bokning, meddelanden, hjälp.

Muterande flöden som faktisk check-in/check-out ska få egna fixtures innan de automatiseras fullt ut. De ska inte köras mot riktiga kundpass utan en markerad testbokning.
