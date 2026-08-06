const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SQL_FILE = path.join(ROOT, 'supabase', 'tests', 'security_regression.sql');

function commandOutput(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
  });
  if (result.error) return null;
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function splitLines(text) {
  return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

function candidatePaths() {
  const candidates = [];
  if (process.env.SUPABASE_CLI) candidates.push(process.env.SUPABASE_CLI);

  if (process.platform === 'win32') {
    for (const name of ['supabase.exe', 'supabase.cmd', 'supabase.bat']) {
      const found = commandOutput('where.exe', [name]);
      if (found && found.status === 0) candidates.push(...splitLines(found.stdout));
    }
  } else {
    const found = commandOutput('sh', ['-lc', 'command -v -a supabase || which -a supabase']);
    if (found && found.status === 0) candidates.push(...splitLines(found.stdout));
  }

  return [...new Set(candidates)];
}

function parseMajor(versionText) {
  const match = versionText.match(/\b(\d+)\.(\d+)\.(\d+)\b/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    text: match[0],
  };
}

function findSupabaseCli() {
  const candidates = candidatePaths();
  for (const candidate of candidates) {
    const version = commandOutput(candidate, ['--version']);
    if (!version || version.status !== 0) continue;
    const parsed = parseMajor(`${version.stdout}\n${version.stderr}`);
    if (parsed && parsed.major >= 2 && (parsed.major > 2 || parsed.minor >= 79)) {
      return { command: candidate, version: parsed.text };
    }
  }

  throw new Error(
    [
      'Could not find Supabase CLI v2.79.0+.',
      'Install/update Supabase CLI, or set SUPABASE_CLI to the full executable path.',
      `Candidates checked: ${candidates.length ? candidates.join(', ') : '(none)'}`,
    ].join('\n'),
  );
}

const cli = findSupabaseCli();
console.log(`Using Supabase CLI ${cli.version}: ${cli.command}`);

const result = spawnSync(cli.command, ['db', 'query', '--linked', '--file', SQL_FILE], {
  cwd: ROOT,
  encoding: 'utf8',
  shell: false,
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exit(result.status == null ? 1 : result.status);
