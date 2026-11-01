// Sets up a development machine in one run, and refreshes it after a merge:
//   1. check the tools (node, git, npm) and the checkout
//   2. initialise the vendor/ submodules
//   3. install the CLI as it is on the default branch of origin (your checkout and working tree are not touched)
//   4. register the Factory: `tds-factory install` puts its skills and agents in ~/.claude and ~/.agents
//   5. check the result with `tds-factory doctor`
//   6. register the developer skills (not shipped to users) from vendor/ in ~/.claude/skills and ~/.agents/skills
// Every step is safe to re-run. A failing step skips the steps that depend on it; the others still run.
// Usage: node scripts/dev-install.js [--force] [--dry-run] [--skip-dev-skills]
//   --dry-run          print what would happen and change nothing
//   --force            replace skills that this script or `tds-factory install` did not install
//   --skip-dev-skills  leave out step 6
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = '.tds-factory-dev';
const DEV_SKILLS = [
  'vendor/awesome-copilot/skills/docs-sync-audit',
  'vendor/awesome-copilot/skills/test-gap-audit',
  'vendor/awesome-copilot/skills/github-actions-hardening',
  'vendor/pstack/skills/statechart',
  'vendor/pstack/skills/blast-radius',
  'vendor/awesome-copilot/skills/agentic-eval',
  'vendor/awesome-copilot/skills/eval-driven-dev',
  'vendor/awesome-copilot/skills/webapp-testing',
  'vendor/awesome-copilot/skills/github-release',
  'vendor/awesome-copilot/skills/conventional-commit',
  'vendor/awesome-copilot/skills/create-agentsmd',
  'vendor/pstack/skills/principle-make-operations-idempotent',
  'vendor/pstack/skills/principle-prove-it-works',
  'vendor/pstack/skills/principle-test-behavior-not-implementation',
];
const SKILL_TARGETS = ['.claude/skills', '.agents/skills'];
const USAGE = 'Usage: node scripts/dev-install.js [--force] [--dry-run] [--skip-dev-skills]';

const args = process.argv.slice(2);
const unknown = args.filter((a) => !['--force', '--dry-run', '--skip-dev-skills'].includes(a));
if (unknown.length) {
  console.error(`error: unknown option ${unknown.join(', ')}\n${USAGE}`);
  process.exit(1);
}
const force = args.includes('--force');
const dryRun = args.includes('--dry-run');
const skipDevSkills = args.includes('--skip-dev-skills');
const win = process.platform === 'win32';

const say = (msg = '') => console.log(msg);
const info = (msg) => console.log(`  ${msg}`);
const warn = (msg) => console.warn(`  warning: ${msg}`);
const first = (text) =>
  String(text ?? '')
    .trim()
    .split('\n')[0];
// On Windows npm and tds-factory are .cmd shims, which need a shell.
const spawnOpts = (cwd, stdio) => ({ cwd, stdio, encoding: 'utf8', shell: win });

function capture(cmd, cmdArgs, cwd = root) {
  const r = spawnSync(cmd, cmdArgs, spawnOpts(cwd, ['ignore', 'pipe', 'pipe']));
  if (r.error) throw new Error(`${cmd} is not available: ${r.error.message}`);
  if (r.status !== 0)
    throw new Error(`${cmd} ${cmdArgs.join(' ')} failed (exit ${r.status}): ${first(r.stderr) || first(r.stdout)}`);
  return r.stdout.trim();
}

function stream(cmd, cmdArgs, cwd = root) {
  info(`$ ${cmd} ${cmdArgs.join(' ')}`);
  if (dryRun) return;
  const r = spawnSync(cmd, cmdArgs, spawnOpts(cwd, 'inherit'));
  if (r.error) throw new Error(`${cmd} is not available: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(' ')} failed (${r.signal ?? `exit ${r.status}`})`);
}

const results = [];
let n = 0;
// Runs one step; a throw marks it failed (or warned) and the step returns false so dependants can be skipped.
function step(title, fn, { warnOnly = false } = {}) {
  say(`\n[${++n}] ${title}`);
  try {
    fn();
    results.push({ title, status: 'ok' });
    return true;
  } catch (err) {
    console.error(`  ${warnOnly ? 'warning' : 'error'}: ${first(err.message)}`);
    results.push({ title, status: warnOnly ? 'warned' : 'failed', detail: first(err.message) });
    return false;
  }
}
function skip(title, why) {
  say(`\n[${++n}] ${title}`);
  info(`skipped: ${why}`);
  results.push({ title, status: 'skipped', detail: why });
}

say(`tds-factory dev install${dryRun ? ' (dry run: nothing is changed)' : ''}`);
say(`checkout: ${root}`);

const tools = step('Check the tools and the checkout', () => {
  const major = Number(process.versions.node.split('.')[0]);
  const engines = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).engines?.node;
  const need = Number(engines?.match(/\d+/)?.[0] ?? 20);
  if (major < need) throw new Error(`Node ${need} or newer is required, found ${process.versions.node}`);
  info(`node ${process.versions.node}`);
  info(capture('git', ['--version']));
  info(`npm ${capture('npm', ['--version'])}`);
  if (capture('git', ['rev-parse', '--is-inside-work-tree']) !== 'true')
    throw new Error(`${root} is not a git checkout`);
  info(`origin ${capture('git', ['remote', 'get-url', 'origin'])}`);
  info(`npm global prefix ${capture('npm', ['prefix', '-g'])}`);
});

let submodulesOk = false;
if (tools) {
  submodulesOk = step(
    'Initialise the vendor submodules',
    () => {
      if (!fs.existsSync(path.join(root, '.gitmodules'))) return info('no submodules in this checkout');
      stream('git', ['submodule', 'update', '--init']);
    },
    { warnOnly: true },
  );
} else skip('Initialise the vendor submodules', 'the tool check failed');

let installed = false;
if (tools) {
  installed = step('Install the latest tds-factory from origin', () => {
    info('$ git fetch origin');
    capture('git', ['fetch', '--quiet', 'origin']);
    capture('git', ['remote', 'set-head', 'origin', '--auto']);
    const ref = capture('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
    const commit = capture('git', ['rev-parse', '--short', ref]);
    info(`default branch of origin: ${ref} at ${commit}`);
    info(`package version there: ${JSON.parse(capture('git', ['show', `${ref}:package.json`])).version}`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tds-factory-'));
    try {
      info(`$ git archive ${ref}`);
      capture('git', ['archive', '--format=tgz', '--prefix=package/', '-o', path.join(tmp, 'tds-factory.tgz'), ref]);
      // Relative name from inside tmp: a shell on Windows would split a temp path with spaces.
      stream('npm', ['install', '-g', 'tds-factory.tgz'], tmp);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    info(`${dryRun ? 'would install' : 'installed'} ${ref} at ${commit}`);
  });
} else skip('Install the latest tds-factory from origin', 'the tool check failed');

// The global bin may not be on PATH yet (fresh machine); fall back to the npm prefix.
function factoryCommand() {
  if (spawnSync('tds-factory', ['--version'], spawnOpts(root, 'ignore')).status === 0) return 'tds-factory';
  const prefix = capture('npm', ['prefix', '-g']);
  const candidate = win ? path.join(prefix, 'tds-factory.cmd') : path.join(prefix, 'bin', 'tds-factory');
  if (!fs.existsSync(candidate))
    throw new Error('tds-factory is on neither PATH nor the npm global prefix; check `npm prefix -g`');
  warn(`tds-factory is not on PATH; add ${path.dirname(candidate)} to PATH. Using ${candidate} for now.`);
  return candidate;
}

let cli = 'tds-factory';
let registered = false;
if (installed) {
  registered = step('Register the Factory (tds-factory install)', () => {
    if (!dryRun) {
      cli = factoryCommand();
      info(`tds-factory ${capture(cli, ['--version'])}`);
    }
    stream(cli, ['install', ...(force ? ['--force'] : [])]);
  });
} else skip('Register the Factory (tds-factory install)', 'the CLI was not installed');

if (registered) {
  // Doctor judges the current directory as a project and reports the agents' tools (claude, codex, copilot);
  // a finding there does not undo the install, so it only warns.
  step('Check the installation (tds-factory doctor)', () => stream(cli, ['doctor']), { warnOnly: true });
} else skip('Check the installation (tds-factory doctor)', 'the Factory was not registered');

if (skipDevSkills) skip('Register the developer skills', '--skip-dev-skills');
else if (!tools) skip('Register the developer skills', 'the tool check failed');
else
  step('Register the developer skills', () => {
    if (!submodulesOk) warn('the submodules were not initialised; skills missing from vendor/ will fail');
    const problems = [];
    for (const skill of DEV_SKILLS) {
      const src = path.join(root, skill);
      const name = path.basename(skill);
      if (!fs.existsSync(path.join(src, 'SKILL.md'))) {
        problems.push(`${skill} has no SKILL.md`);
        continue;
      }
      for (const target of SKILL_TARGETS) {
        try {
          const dest = path.join(os.homedir(), target, name);
          const stat = fs.lstatSync(dest, { throwIfNoEntry: false });
          // A symlink is another installer's link to the same skill; replace it, not its target.
          const replaceable = force || stat?.isSymbolicLink() || (stat && fs.existsSync(path.join(dest, MARKER)));
          if (stat && !replaceable) {
            warn(`skip ${target}/${name}: exists and was not installed by this script (use --force)`);
            continue;
          }
          if (!dryRun) {
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.rmSync(dest, { recursive: true, force: true });
            fs.cpSync(src, dest, { recursive: true });
            fs.writeFileSync(path.join(dest, MARKER), '');
          }
          info(`${dryRun ? 'would install' : 'installed'} ${target}/${name}${stat ? ' (replaced)' : ''}`);
        } catch (err) {
          problems.push(`${target}/${name}: ${first(err.message)}`);
        }
      }
    }
    if (problems.length) throw new Error(`${problems.length} problem(s): ${problems.join('; ')}`);
    info('docs-sync-audit and test-gap-audit need python3; webapp-testing needs Playwright');
  });

say('\nSummary');
for (const r of results) say(`  ${r.status.padEnd(7)} ${r.title}${r.detail ? ` (${r.detail})` : ''}`);
if (results.some((r) => r.status === 'failed')) process.exitCode = 1;
else if (!dryRun) say('\nDone. Restart your agents so they pick up the new skills.');
