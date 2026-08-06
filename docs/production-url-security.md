# Production URL and Auth Security

Status: active policy for CleanUp production.

## Canonical App Domain

Use this as the canonical app URL:

```text
https://www.logincleanup.app/CleanUp.html
```

This is the URL Edge Functions should use for customer magic links, notification links, and admin/customer/cleaner app entry links.

The apex domain currently redirects correctly:

```text
https://logincleanup.app/CleanUp.html -> https://www.logincleanup.app/CleanUp.html
```

Do not use these as production app URLs until TLS is fixed and verified:

```text
https://inlogg.cleanup.nu
https://login.cleanup.nu
```

They had certificate/SNI errors during the phase 5 check on 2026-08-06.

## Supabase Auth URL Configuration

In Supabase Dashboard -> Authentication -> URL Configuration:

Site URL:

```text
https://www.logincleanup.app/CleanUp.html
```

Additional Redirect URLs:

```text
https://www.logincleanup.app/CleanUp.html
https://www.logincleanup.app/CleanUp.html/**
https://logincleanup.app/CleanUp.html
https://logincleanup.app/CleanUp.html/**
http://localhost:5500/CleanUp.html
http://localhost:5500/CleanUp.html/**
http://localhost:5173/CleanUp.html
http://localhost:5173/CleanUp.html/**
http://127.0.0.1:5500/CleanUp.html
http://127.0.0.1:5500/CleanUp.html/**
```

Production should prefer exact redirect URLs. Wildcards are only for local development and controlled preview environments.

## Edge Function Secrets

Set this secret for all customer portal and notification Edge Functions:

```text
CUSTOMER_PORTAL_SITE_URL=https://www.logincleanup.app/CleanUp.html
```

For customer self-service login CORS:

```text
CUSTOMER_LOGIN_ALLOWED_ORIGINS=https://www.logincleanup.app,https://logincleanup.app,https://cleanup.nu,https://www.cleanup.nu
```

Keep `SUPABASE_SERVICE_ROLE_KEY` only in Supabase Edge Function secrets. It must never be present in Vercel frontend environment variables or generated `src/config.js`.

## Vercel Headers

`vercel.json` owns the production security headers:

- HSTS with subdomains and preload.
- `nosniff`.
- Strict referrer policy.
- Restrictive permissions policy.
- CSP that allows only the static app, required CDN scripts, Supabase REST/WebSocket connections, and iframe embedding from `cleanup.nu`.

The app intentionally allows `frame-ancestors` for `https://cleanup.nu` and `https://www.cleanup.nu` so the booking widget can be embedded there.

## Verification Commands

```powershell
npm run build
curl.exe -I https://www.logincleanup.app/CleanUp.html
curl.exe -I https://logincleanup.app/CleanUp.html
curl.exe -I https://inlogg.cleanup.nu
curl.exe -I https://login.cleanup.nu
```

Expected:

- `www.logincleanup.app` returns 200 and includes CSP, HSTS, `nosniff`, Referrer-Policy, and Permissions-Policy.
- `logincleanup.app` redirects to `www.logincleanup.app`.
- `inlogg.cleanup.nu` and `login.cleanup.nu` are not used until they pass TLS/header verification.
