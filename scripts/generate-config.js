/**
 * Skriver src/config.js från miljövariabler (Vercel build / lokal .env).
 * Kräver: SUPABASE_URL, SUPABASE_ANON_KEY
 */
const fs = require('fs');
const path = require('path');

const url =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://bkmnlcdsbvpucpqmaycx.supabase.co';

const anonKey =
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';

const out = path.join(__dirname, '..', 'src', 'config.js');
const body = `/* Auto-genererad – kör inte node scripts/generate-config.js manuellt om du har .env */
(function () {
  window.__CLEANUP_CONFIG__ = {
    url: ${JSON.stringify(url)},
    anonKey: ${JSON.stringify(anonKey)},
  };
})();
`;

fs.writeFileSync(out, body, 'utf8');
console.log('Wrote', out, anonKey ? '(anon key set)' : '(WARN: no anon key)');
