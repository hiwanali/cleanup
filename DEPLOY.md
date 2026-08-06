# Vercel Deploy Guide

## Canonical Production URL

Use this app URL in production:

```text
https://www.logincleanup.app/CleanUp.html
```

`https://logincleanup.app` redirects to `https://www.logincleanup.app`.

Do not use `https://inlogg.cleanup.nu` or `https://login.cleanup.nu` for login, magic links, or notification links until their TLS certificates are fixed and verified.

## Vercel Setup

1. Import the GitHub repository in Vercel.
2. Set Build Command to `npm run build`.
3. Set Output Directory to `dist`.
4. Keep `vercel.json` committed. It owns rewrites and security headers.

Environment variables in Vercel, for Production and Preview:

```text
SUPABASE_URL=https://bkmnlcdsbvpucpqmaycx.supabase.co
SUPABASE_ANON_KEY=<publishable anon key from Supabase Dashboard>
```

Never add `SUPABASE_SERVICE_ROLE_KEY` to Vercel frontend environment variables.

## Build Process

`npm run build` creates:

- `dist/CleanUp.html`
- `dist/src/styles.css`
- `dist/src/app.bundle.js`
- `dist/src/config.js`

The production HTML uses precompiled React/Tailwind assets. If Vercel serves the repo root instead of `dist`, the browser may load the development version and the app can look broken.

## Supabase Auth

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

Supabase recommends exact production redirect URLs; use wildcards only for local dev and controlled preview environments.

## Edge Function Secrets

Set in Supabase Dashboard -> Edge Functions -> Secrets:

```text
RESEND_API_KEY=<resend key>
RESEND_FROM=CleanUp <notis@cleanup.nu>
CUSTOMER_PORTAL_SITE_URL=https://www.logincleanup.app/CleanUp.html
CUSTOMER_LOGIN_ALLOWED_ORIGINS=https://www.logincleanup.app,https://logincleanup.app,https://cleanup.nu,https://www.cleanup.nu
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are Supabase-side function secrets/runtime values, not browser secrets.

## Verification After Deploy

```powershell
npm run build
curl.exe -I https://www.logincleanup.app/CleanUp.html
curl.exe -I https://logincleanup.app/CleanUp.html
```

Expected:

- `www.logincleanup.app` returns 200.
- `logincleanup.app` returns 308 to `www.logincleanup.app`.
- Response headers include `Strict-Transport-Security`, `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy`.

## Troubleshooting

If the app looks unstyled or like an old draft:

- Check Vercel Build Command is `npm run build`.
- Check Output Directory is `dist`.
- Redeploy from the latest Git commit.

If magic links land on the wrong URL:

- Check `CUSTOMER_PORTAL_SITE_URL` in Supabase Edge Function secrets.
- Check Supabase Auth Site URL and Redirect URLs.
- Regenerate/resend the link after changing settings.

If a custom domain fails:

- Verify DNS in the domain provider.
- Verify the domain is assigned to the correct Vercel project.
- Verify TLS with `curl.exe -I https://domain.example`.
