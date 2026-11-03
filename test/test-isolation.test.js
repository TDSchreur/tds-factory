import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** @param {string} text */
const importsGitRepo = (text) => /import\s+['"]\.\/git-repo\.js['"]|from\s+['"]\.\/git-repo\.js['"]/.test(text);
/** @param {string} text */
const setsFactoryConfigDir = (text) => /TDS_FACTORY_CONFIG_DIR/.test(text);
/** @param {string} text */
const usesCli = (text) => /bin\/tds-factory\.js/.test(text);
/** @param {string} text */
const usesLaunch = (text) => /\blaunchDashboard\s*\(/.test(text);
/** @param {string} text */
const usesStart = (text) => /\bstartDashboard\s*\(/.test(text);
/** @param {string} text */
function usesRegistryWithoutDir(text) {
  const calls = text.matchAll(/openProjectRegistry\(\s*\{([\s\S]*?)\}\s*\)/g);
  for (const call of calls) {
    if (!/dir\s*:/.test(call[1] ?? '')) return true;
  }
  return false;
}

/**
 * @param {{ path: string, text: string }[]} files
 * @returns {string[]}
 */
function unisolated(files) {
  return files
    .filter(({ text }) => usesCli(text) || usesLaunch(text) || usesStart(text) || usesRegistryWithoutDir(text))
    .filter(({ text }) => !importsGitRepo(text) && !setsFactoryConfigDir(text))
    .map(({ path }) => path);
}

test('the isolation guard catches a file that starts dashboard code without test config isolation', () => {
  const files = [
    {
      path: 'test/fixture-unisolated.test.js',
      text: "import { startDashboard } from '../src/dashboard.js';\nstartDashboard({ projectDir: 'x' });\n",
    },
  ];
  assert.deepEqual(unisolated(files), ['test/fixture-unisolated.test.js']);
});

test('every risky test file either imports git-repo or sets TDS_FACTORY_CONFIG_DIR', () => {
  const root = resolve('test');
  const files = readdirSync(root)
    .filter((name) => name.endsWith('.test.js'))
    .map((name) => ({ path: `test/${name}`, text: readFileSync(join(root, name), 'utf8') }));
  assert.deepEqual(
    unisolated(files),
    [],
    'Files that spawn the CLI or call launchDashboard/startDashboard/openProjectRegistry without dir need test config isolation',
  );
});

test('a direct node --test run keeps the default config folder untouched', () => {
  const root = mkdtempSync(join(tmpdir(), 'tds-config-home-'));
  const home = join(root, 'home');
  const xdg = join(root, 'xdg');
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: xdg };
  delete env.TDS_FACTORY_CONFIG_DIR;
  const result = spawnSync(process.execPath, ['--test', 'test/project-registry.test.js'], {
    cwd: resolve('.'),
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(existsSync(join(xdg, 'tds-factory')), false);
  rmSync(root, { recursive: true, force: true });
});
