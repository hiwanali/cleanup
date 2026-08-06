const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'output', 'playwright');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function appUrl(hash = '') {
  const base = process.env.CLEANUP_E2E_APP_URL || 'https://www.logincleanup.app/CleanUp.html';
  const cleaned = base.replace(/#.*$/, '');
  return hash ? `${cleaned}#${hash.replace(/^#/, '')}` : cleaned;
}

async function bodyText(page) {
  return (await page.locator('body').innerText({ timeout: 15000 })).replace(/\s+/g, ' ');
}

async function assertBody(page, pattern, label) {
  const text = await bodyText(page);
  assert(pattern.test(text), `${label} saknas. Body: ${text.slice(0, 500)}`);
}

async function screenshot(page, name) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const file = path.join(OUTPUT_DIR, `${name}-${Date.now()}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

async function runPublicSmoke(browser) {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  await page.goto(appUrl(), { waitUntil: 'domcontentloaded' });
  await assertBody(page, /CleanUp/i, 'Login-brand');
  await assertBody(page, /Logga in/i, 'Login-vy');

  await page.goto(appUrl('/embed/booking'), { waitUntil: 'domcontentloaded' });
  await assertBody(page, /Boka|Hemstädning|Flyttstädning|Fönsterputs|städning/i, 'Publik bokningswidget');

  assert(pageErrors.length === 0, `Browser page errors: ${pageErrors.join('; ')}`);
  await page.close();
}

async function runRoleSmoke(browser, role, email, password, expectedPattern, routes = []) {
  if (!email || !password) {
    console.log(`skip ${role}: saknar CLEANUP_E2E_${role.toUpperCase()}_EMAIL/PASSWORD`);
    return;
  }

  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  try {
    await page.goto(appUrl(), { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole('button', { name: /^Logga in$/ }).click();
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await assertBody(page, expectedPattern, `${role}-landning`);

    for (const route of routes) {
      await page.goto(appUrl(route.hash), { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await assertBody(page, route.expected, `${role}-${route.hash}`);
    }

    assert(pageErrors.length === 0, `${role} page errors: ${pageErrors.join('; ')}`);
  } catch (error) {
    const file = await screenshot(page, `smoke-${role}`);
    error.message = `${error.message}\nScreenshot: ${file}`;
    throw error;
  } finally {
    await context.close();
  }
}

async function main() {
  loadDotEnv(path.join(ROOT, '.env'));

  const browser = await chromium.launch({
    headless: process.env.PW_HEADED !== '1',
  });

  try {
    await runPublicSmoke(browser);
    await runRoleSmoke(
      browser,
      'admin',
      process.env.CLEANUP_E2E_ADMIN_EMAIL,
      process.env.CLEANUP_E2E_ADMIN_PASSWORD,
      /Dashboard|Schema|Kunder|Rapporter/i,
      [
        { hash: '/admin/schema', expected: /Schema/i },
        { hash: '/admin/meddelanden', expected: /Meddelanden/i },
        { hash: '/admin/rapporter', expected: /Rapporter/i },
      ],
    );
    await runRoleSmoke(
      browser,
      'cleaner',
      process.env.CLEANUP_E2E_CLEANER_EMAIL,
      process.env.CLEANUP_E2E_CLEANER_PASSWORD,
      /Mina pass|Idag|Meddelanden/i,
      [
        { hash: '/stadare/pass', expected: /Mina pass/i },
        { hash: '/stadare/meddelanden', expected: /Meddelanden/i },
        { hash: '/stadare/rapporter', expected: /Rapporter|timmar|pass/i },
      ],
    );
    await runRoleSmoke(
      browser,
      'customer',
      process.env.CLEANUP_E2E_CUSTOMER_EMAIL,
      process.env.CLEANUP_E2E_CUSTOMER_PASSWORD,
      /Min bokning|Din städare|Meddelanden/i,
      [
        { hash: '/kund/oversikt', expected: /Min bokning|Din städare/i },
        { hash: '/kund/meddelanden', expected: /Meddelanden/i },
        { hash: '/kund/avvikelser', expected: /Hjälp|Avvikelser/i },
      ],
    );
  } finally {
    await browser.close();
  }

  console.log('CleanUp Playwright smoke passed');
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
