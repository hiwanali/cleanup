/**
 * Skriver config.js från miljövariabler (Vercel build / lokal .env).
 * Kräver: SUPABASE_URL, SUPABASE_ANON_KEY
 *
 * Används både fristående (skriver src/config.js för lokal dev) och från
 * scripts/build.js (skriver in i dist-mappen).
 */
const fs = require('fs');
const path = require('path');

function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] == null) process.env[key] = value;
  });
}

function writeConfig(outFile) {
  loadDotEnv();
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    'https://bkmnlcdsbvpucpqmaycx.supabase.co';

  const anonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    '';

  const body = `/* Auto-genererad – redigera inte för hand. Värden kommer från miljövariabler. */
(function () {
  window.__CLEANUP_CONFIG__ = {
    url: ${JSON.stringify(url)},
    anonKey: ${JSON.stringify(anonKey)},
  };
})();
`;

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, body, 'utf8');
  console.log('Wrote', outFile, anonKey ? '(anon key set)' : '(WARN: no anon key)');
}

module.exports = { writeConfig };

// Fristående körning: skriv src/config.js (för lokal utveckling).
if (require.main === module) {
  writeConfig(path.join(__dirname, '..', 'src', 'config.js'));
}
