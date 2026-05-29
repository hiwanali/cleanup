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
- `vercel.json` kör `node scripts/generate-config.js` automatiskt
- Root `/` pekar på `CleanUp.html`

## 🔧 Konfiguration

### vercel.json
```json
{
  "buildCommand": "node scripts/generate-config.js",
  "outputDirectory": ".",
  "rewrites": [{ "source": "/", "destination": "/CleanUp.html" }],
  "headers": [/* säkerhetsheaders redan konfigurerade */]
}
```

### Buildprocess
1. Vercel läser miljövariabler
2. `scripts/generate-config.js` skriver `src/config.js`
3. Statiska filer serveras direkt

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