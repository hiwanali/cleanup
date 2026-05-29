# Vercel Deploy Guide

## 🚀 Snabbstart

### 1. GitHub + Vercel Setup
```bash
# Pusha till GitHub (om inte redan gjort)
git add .
git commit -m "Production ready: security + config"
git push origin main

# På vercel.com:
# 1. New Project → Import från GitHub
# 2. Välj städplattform repo
```

### 2. Miljövariabler i Vercel
Lägg till i **Settings → Environment Variables** (både Production och Preview):

```
SUPABASE_URL=https://bkmnlcdsbvpucpqmaycx.supabase.co
SUPABASE_ANON_KEY=<din_publishable_key_från_supabase_dashboard>
```

**Hämta anon key**: Supabase Dashboard → Project Settings → API → `anon public`

### 3. Custom Domain
I Vercel **Settings → Domains**:
1. Add Domain: `inlogg.cleanup.nu`
2. Lägg till DNS-record hos domänleverantör (inleed.se):
   ```
   Type: CNAME
   Name: inlogg
   Value: cname.vercel-dns.com
   ```

### 4. Deploy
- Första deploy startar automatiskt vid import
- `vercel.json` kör **`npm run build`** (Tailwind + JSX-bundle + prod-HTML → `dist/`)
- Root `/` pekar på `CleanUp.html` (via rewrite)

## 🔧 Konfiguration

### vercel.json (ska matcha Vercel Dashboard)
```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [{ "source": "/", "destination": "/CleanUp.html" }]
}
```

**Viktigt i Vercel → Settings → Build and Deployment:** stäng av *Override* för Output Directory (eller sätt den till `dist`). Om Output Directory är `.` serveras **dev-versionen** av `CleanUp.html` (CDN Tailwind + Babel i webbläsaren) – då saknas ofta CSS och appen ser ut som ett tidigt utkast.

### Buildprocess
1. `npm install` (Tailwind + Babel som devDependencies)
2. `npm run build` → `dist/` med `styles.css`, `app.bundle.js`, `config.js`, prod-`CleanUp.html`
3. Vercel publicerar **endast** innehållet i `dist/`

Ett lyckat bygge tar flera sekunder (inte ~300 ms). I loggen ska du se t.ex. `Wrote .../dist/src/styles.css` och `Bygge klart -> dist/`.

## 📋 Verifiering efter deploy

### 1. Testa domäner
- `https://inlogg.cleanup.nu` → CleanUp login
- `https://[project].vercel.app` → Backup URL

### 2. Testa inloggning
- `concito@cleanup.nu` / `Work123!`
- `linneaconcito@cleanup.nu` / `Work123!`
- `info@cleanup.nu` / `CleanUp2026!`

### 3. Säkerhet
- F12 → Network: Verifiera HTTPS + security headers
- Testa att RLS fungerar (kunder ser bara sina objekt)

## 🛠️ Troubleshooting

### Sidan ser ostylad ut / gammalt utkast på produktion
- Build-loggen visar bara `Wrote .../src/config.js` och bygget tar ~300 ms → **hela bygget körs inte**
- Åtgärd: Build Command = `npm run build`, Output Directory = `dist`, trigga **Redeploy**
- Lokalt: `npm run build` och öppna `dist/CleanUp.html` – det ska matcha produktion

### "Config missing" fel
- Verifiera `SUPABASE_ANON_KEY` är satt i Vercel env vars
- Trigga ny deploy (Settings → Deployments → Redeploy)

### Domain inte aktiv
- DNS kan ta 24h att propagera
- Använd `dig inlogg.cleanup.nu` för att verifiera DNS

### Auth fungerar ej
- Kolla Supabase Dashboard → Authentication → Settings
- Site URL ska vara `https://inlogg.cleanup.nu`

## 🔐 Säkerhet i produktion

### Automatiskt aktiverat
✅ HTTPS (Vercel automatiskt)  
✅ Security headers (X-Frame-Options, etc.)  
✅ React production builds  
✅ RLS på alla tabeller  
✅ Function access controls  

### Manuellt i Supabase Dashboard
- [ ] Auth → Settings → **Leaked Password Protection** (rekommenderas)
- [ ] Auth → URL Configuration → Lägg till `https://inlogg.cleanup.nu`

---

**Status**: Redo för deploy! 🎯