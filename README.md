# CleanUp · Städplattform

> Plattform för städföretag — admin, städare och kund i samma app.
> Specen lever i [`mvpfinal.md`](./mvpfinal.md) och är det vi bygger ifrån steg för steg.

---

## Köra prototypen lokalt (Windows / PowerShell)

Prototypen är en statisk webbapp (React via CDN + Tailwind + Babel-standalone) och behöver bara en lokal webbserver för att fungera (öppna `CleanUp.html` direkt via `file://` blockerar Babel från att hämta `src/*.jsx`).

### Alternativ 1 – Python (oftast redan installerat)

```powershell
cd "c:\Users\Hiwan\Downloads\städplattform"
python -m http.server 5500
```

Öppna sedan: **http://localhost:5500/CleanUp.html**

### Alternativ 2 – Node `npx serve`

```powershell
cd "c:\Users\Hiwan\Downloads\städplattform"
npx serve -p 5500 .
```

### Alternativ 3 – VS Code "Live Server"

Installera tillägget *Live Server* → högerklicka `CleanUp.html` → **Open with Live Server**.

---

## Vad du ser

1. **Login-vy (mock)** – välj profil. Auth läggs på senare via Supabase, då försvinner väljaren.
2. **Admin-dashboard** – "Kräver din åtgärd" med sjukanmälda pass + öppna avvikelser.
3. **Städare → Idag** – dagens pass + kommande, ser **endast egna**.
4. **Kund → Översikt** – alla objekt och kommande pass. Notera: städare visas som "Städare" (anonymiserat per beslut §12.1 i `mvpfinal.md`).
5. **Topbar → DEV · Byt profil** – snabbswitch mellan profiler under utveckling. Bell-ikonen visar notiser.
6. **Designpanel** (palett-ikonen nere till vänster) – byt hörnradie och accentfärg live.

Övriga vyer är **placeholders** som pekar på exakt vilken §X.Y i `mvpfinal.md` de motsvarar – vi bygger ut dem i tur och ordning.

---

## Filstruktur

```
städplattform/
├── CleanUp.html               # entry-point, laddar React/Tailwind via CDN
├── CleanUp favicon.png
├── CleanUp logo original.png
├── CleanUp logo white original.jpg
├── mvpfinal.md                # SPEC — vi bygger från denna
├── README.md
└── src/
    ├── icons.jsx              # ikonregister (inline-SVG)
    ├── ui.jsx                 # Button, Card, Modal, StatusBadge, Toast, ...
    ├── mock.jsx               # speglar §5-datamodellen + seed-data + mutatorer
    ├── tweaks-panel.jsx       # design-tweaks (hörnradie, accent)
    ├── views.jsx              # Login + landningsvyer per roll + placeholders
    └── app.jsx                # router, session, layout, mount
```

### Beroenden (CDN, inga lokala npm-paket)

| Bibliotek | Version | Var |
|---|---|---|
| React | 18.3.1 | unpkg.com |
| ReactDOM | 18.3.1 | unpkg.com |
| Babel Standalone | 7.29.0 | unpkg.com |
| Tailwind CSS (Play CDN) | senaste | cdn.tailwindcss.com |
| Plus Jakarta Sans | — | fonts.googleapis.com |

---

## Hur mock.jsx mappar till Supabase senare

Allt i `src/mock.jsx` är skrivet så att vi 1:1 kan ersätta det med Supabase-anrop:

- Varje "tabell" i `state` motsvarar en Postgres-tabell i §5.
- Varje **selektor** (t.ex. `db.shiftsForCleaner(uid)`) blir en `from('shifts').select(...).eq(...)` med RLS som garanterar separationen i klienten.
- Varje **mutator** (t.ex. `db.reportSick(...)`) blir en RPC eller direkt insert/update i Supabase + en Edge Function som skickar e-postnotis.
- `pushNotification(...)` blir en INSERT i `notifications`-tabellen + realtidsuppdatering via Supabase Realtime.

---

## Nästa steg

Vi följer `mvpfinal.md` i denna ordning. Markera klart efter varje:

1. **§7.5 Städschema per objekt + pass-detalj för städare** – mest värdefulla vertikala skivan, lär oss flödet checka in → bocka checklist → checka ut.
2. **§7.1 Sjukanmälan + admins ombokningsmodal** – vi har redan datan; bygg interaktionen.
3. **§7.2 48h-avbokning** – knapp/kontaktinfo i kundens pass-detalj.
4. **§7.3 Kundledighet** – flik med formulär + live-förhandsvisning.
5. **§7.4 Admin-justering** – justera tid, byta städare, ta bort.
6. **§7.6 Avvikelse/reklamation** – båda flödena + admins Avvikelser-flik med bildbilagor.
7. **§7.7 Kundanställda** – inställningsvy + flow vid kundskapande.
8. **Schema-vy + kundvy-detaljer** – polering.
9. **Supabase-anslutning** – Auth, RLS-policys, migrera mock → riktig data.
10. **Säkerhetsgenomgång + Vercel-publicering**.
