import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { repo, git } from './git-repo.js';
import { parseGuide, matchesGlob, loadGuides, guidesCheck, guidesForFiles } from '../src/guides.js';

const cli = resolve('bin/tds-factory.js');
const run = (cwd, ...args) => spawnSync(process.execPath, [cli, 'run', ...args], { cwd, encoding: 'utf8' });

function project(files) {
  const cwd = repo();
  for (const [name, text] of Object.entries(files)) { mkdirSync(dirname(join(cwd, name)), { recursive: true }); writeFileSync(join(cwd, name), text); }
  return cwd;
}
const AGENTS = '# Agents\n\nRead [dashboard rules](docs/dashboard.md) and [factory rules](docs/factory.md) and `docs/plain.md`.\n';
const guides = (extra = {}) => project({ 'AGENTS.md': AGENTS, 'docs/dashboard.md': '---\napplyTo: "dashboard/**, src/dashboard.js"\n---\n# Dashboard\n', 'docs/factory.md': '---\napplyTo: skills/**\n---\n# Factory\n', 'docs/plain.md': '# Plain\n', ...extra });

test('applyTo takes one glob or a comma-separated list, quoted or not', () => {
  assert.deepEqual(parseGuide('---\napplyTo: "a/**, b/*.js"\n---\n').globs, ['a/**', 'b/*.js']);
  assert.deepEqual(parseGuide("---\napplyTo: 'a/**'\n---\n").globs, ['a/**']);
  assert.deepEqual(parseGuide('---\napplyTo: skills/**\n---\n').globs, ['skills/**']);
});

test('a guide without frontmatter or without applyTo is unscoped', () => {
  assert.deepEqual(parseGuide('# Title\n'), { globs: [] });
  assert.deepEqual(parseGuide('---\ntitle: x\n---\n'), { globs: [] });
});

test('a malformed applyTo is a problem with its line', () => {
  for (const [text, line] of [['---\ntitle: x\napplyTo: "a/**\n---\n', 3], ['---\napplyTo:\n---\n', 2], ['---\napplyTo: a,,b\n---\n', 2], ['---\napplyTo: /etc/**\n---\n', 2], ['---\napplyTo: ../x/**\n---\n', 2]]) {
    const r = parseGuide(text);
    assert.equal(r.problem?.line, line, text);
  }
});

test('globs: ** crosses folders, * stays in one, a glob without a slash matches at any depth', () => {
  assert.ok(matchesGlob('dashboard/app.js', ['dashboard/**']));
  assert.ok(matchesGlob('dashboard/a/b/app.js', ['dashboard/**']));
  assert.ok(!matchesGlob('src/dashboard/app.js', ['dashboard/**']));
  assert.ok(matchesGlob('src/a.js', ['src/*.js']));
  assert.ok(!matchesGlob('src/x/a.js', ['src/*.js']));
  assert.ok(matchesGlob('src/x/a.ts', ['*.ts']));
  assert.ok(matchesGlob('x/y/z.js', ['**/z.js']) && matchesGlob('z.js', ['**/z.js']));
  assert.ok(!matchesGlob('a.jsx', ['a.js']));
});

test('guides come from the links in AGENTS.md; unscoped guides always apply', () => {
  const all = loadGuides(guides());
  assert.deepEqual(all.map((g) => g.path).sort(), ['docs/dashboard.md', 'docs/factory.md', 'docs/plain.md']);
  const apply = (files) => guidesForFiles(all, files).map((g) => g.path).sort();
  assert.deepEqual(apply(['dashboard/a.js']), ['docs/dashboard.md', 'docs/plain.md']);
  assert.deepEqual(apply(['skills/factory/SKILL.md', 'src/dashboard.js']), ['docs/dashboard.md', 'docs/factory.md', 'docs/plain.md']);
  assert.deepEqual(apply(['README.md']), ['docs/plain.md']);
});

test('doctor check: guides pass, and a missing guide or a bad applyTo fails with file and line', () => {
  assert.equal(guidesCheck(guides())[0], 'pass');
  assert.equal(guidesCheck(project({ 'AGENTS.md': '# A\n' }))[0], 'pass');
  const missing = guidesCheck(project({ 'AGENTS.md': '[x](docs/gone.md)\n' }));
  assert.equal(missing[0], 'fail'); assert.match(missing[1], /docs\/gone\.md:1: .*does not exist/);
  const bad = guidesCheck(guides({ 'docs/factory.md': '---\napplyTo: "x\n---\n' }));
  assert.equal(bad[0], 'fail'); assert.match(bad[1], /docs\/factory\.md:2: .*unclosed quote/);
});

test('a backticked path that does not exist, or a link outside the project, is ignored', () => {
  const dir = project({ 'AGENTS.md': 'See `changelog.d/<name>.md`, `NOPE.md`, [web](https://x.dev/a.md) and [up](../a.md).\n' });
  assert.deepEqual(loadGuides(dir), []);
});

test('run guides lists the guides recorded in the Run conventions that apply to its diff', () => {
  const cwd = guides();
  git(cwd, 'add', '.'); git(cwd, 'commit', '-q', '-m', 'guides');
  const started = run(cwd, 'start', '--data', JSON.stringify({ title: 'G', agent: 'claude', commands: 'true', conventions: ['AGENTS.md', 'docs/dashboard.md', 'docs/factory.md', 'docs/plain.md'] }));
  assert.equal(started.status, 0, started.stderr);
  const id = started.stdout.trim();
  const worktree = JSON.parse(readFileSync(join(cwd, '.factory', 'runs', id, 'run.json'), 'utf8')).worktree;
  mkdirSync(join(worktree, 'dashboard'), { recursive: true });
  writeFileSync(join(worktree, 'dashboard', 'a.js'), 'x\n');
  git(worktree, 'add', '.'); git(worktree, 'commit', '-q', '-m', 'change');
  const result = run(cwd, 'guides', '--id', id);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /docs\/dashboard\.md \(applyTo dashboard\/\*\*, src\/dashboard\.js\)/);
  assert.match(result.stdout, /docs\/plain\.md \(unscoped\)/);
  assert.doesNotMatch(result.stdout, /docs\/factory\.md/);
  assert.match(result.stdout, /2 guide\(s\) apply to 1 changed file\(s\); 1 scoped guide\(s\) do not\./);
});
