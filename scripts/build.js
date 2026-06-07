/**
 * Produktionsbygge för CleanUp (statisk frontend).
 *
 * Steg:
 *   1. Generera src-config från miljövariabler -> dist/src/config.js
 *   2. Kompilera Tailwind -> dist/src/styles.css (ingen runtime-CDN i prod)
 *   3. Precompilera all JSX till en enda klassisk bundle -> dist/src/app.bundle.js
 *      (ingen Babel-i-webbläsaren, React laddas som production-build)
 *   4. Generera prod-versionen av CleanUp.html + kopiera statiska filer till dist/
 *
 * Källfilerna lämnas orörda så att lokal utveckling fortsätter fungera med
 * CDN + text/babel (öppna CleanUp.html direkt).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const babel = require('@babel/core');
const { writeConfig } = require('./generate-config');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const DIST_SRC = path.join(DIST, 'src');

// JS-filer (ingen JSX) – laddas före mock.
const JS_FILES = [
  'shiftFinalization.js',
  'reporting.js',
  'reportExport.js',
];

// JSX-filer i exakt laddningsordning (senare filer använder globaler från tidigare).
const JSX_FILES = [
  'icons.jsx',
  'ui.jsx',
  'supabase.jsx',
  'mock.jsx',
  'tweaks-panel.jsx',
  'views.jsx',
  'app.jsx',
];

// Statiska filer som kopieras rakt av till dist/.
const STATIC_FILES = ['index.html', 'CleanUp favicon.png'];

function rimraf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function step1_config() {
  writeConfig(path.join(DIST_SRC, 'config.js'));
}

function step2_tailwind() {
  const cli = require.resolve('tailwindcss/lib/cli.js');
  const input = path.join(ROOT, 'src', 'input.css');
  const output = path.join(DIST_SRC, 'styles.css');
  execFileSync(
    process.execPath,
    [cli, '-i', input, '-o', output, '--config', path.join(ROOT, 'tailwind.config.js'), '--minify'],
    { cwd: ROOT, stdio: 'inherit' },
  );
  console.log('Wrote', output);
}

function step3_bundle() {
  const parts = [
    '/* CleanUp – precompilerad bundle. Genererad av scripts/build.js. Redigera inte. */',
    '"use strict";',
  ];
  for (const file of JS_FILES) {
    const srcPath = path.join(ROOT, 'src', file);
    parts.push(`/* ===== ${file} ===== */`);
    parts.push(fs.readFileSync(srcPath, 'utf8'));
  }
  for (const file of JSX_FILES) {
    const srcPath = path.join(ROOT, 'src', file);
    const code = fs.readFileSync(srcPath, 'utf8');
    const result = babel.transformSync(code, {
      filename: srcPath,
      presets: [[require.resolve('@babel/preset-react'), { runtime: 'classic' }]],
      compact: false,
      comments: false,
      babelrc: false,
      configFile: false,
    });
    parts.push(`/* ===== ${file} ===== */`);
    parts.push(result.code);
  }
  const out = path.join(DIST_SRC, 'app.bundle.js');
  const bundle = parts.join('\n');
  fs.writeFileSync(out, bundle, 'utf8');
  const hash = crypto.createHash('sha256').update(bundle).digest('hex').slice(0, 12);
  console.log('Wrote', out, `(${JS_FILES.length + JSX_FILES.length} filer)`);
  return hash;
}

function step4_html(bundleHash) {
  // Prod-version av CleanUp.html: byt CDN/Babel mot byggda artefakter.
  const srcHtml = fs.readFileSync(path.join(ROOT, 'CleanUp.html'), 'utf8');

  const headReplacement = '<link rel="stylesheet" href="src/styles.css" />';
  const bodyReplacement = [
    '<script src="https://unpkg.com/react@18.3.1/umd/react.production.min.js" crossorigin="anonymous"></script>',
    '  <script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js" crossorigin="anonymous"></script>',
    '  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2" crossorigin="anonymous"></script>',
    '  <script src="src/config.js"></script>',
    `  <script src="src/app.bundle.js?v=${bundleHash}"></script>`,
  ].join('\n');

  const headOut = replaceRegion(srcHtml, 'build:dev:head', headReplacement);
  const prodHtml = replaceRegion(headOut, 'build:dev:body', bodyReplacement);

  if (prodHtml === srcHtml) {
    throw new Error('CleanUp.html: hittade inga build-markörer att ersätta.');
  }

  fs.writeFileSync(path.join(DIST, 'CleanUp.html'), prodHtml, 'utf8');
  console.log('Wrote', path.join(DIST, 'CleanUp.html'));

  for (const file of STATIC_FILES) {
    const from = path.join(ROOT, file);
    if (fs.existsSync(from)) {
      fs.copyFileSync(from, path.join(DIST, file));
      console.log('Copied', file);
    }
  }
}

// Ersätt allt mellan <!-- name:start --> och <!-- name:end --> (markörerna inkluderade).
function replaceRegion(html, name, replacement) {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  const i = html.indexOf(start);
  const j = html.indexOf(end);
  if (i === -1 || j === -1 || j < i) return html;
  return html.slice(0, i) + replacement + html.slice(j + end.length);
}

function main() {
  rimraf(DIST);
  fs.mkdirSync(DIST_SRC, { recursive: true });
  step1_config();
  step2_tailwind();
  const bundleHash = step3_bundle();
  step4_html(bundleHash);
  console.log('\nBygge klart -> dist/');
}

main();
