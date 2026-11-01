import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { repo, git } from './git-repo.js';
import { parseGuide, matchesGlob, loadGuides, guidesCheck, guidesForFiles, MAX_GLOB_LENGTH } from '../src/guides.js';
import { invokedByFactory } from '../src/sync.js';
import { SKILLS_DIR } from '../src/paths.js';

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

test('a hostile glob or link text cannot make matching or scanning slow', () => {
  const started = Date.now();
  assert.ok(!matchesGlob('a'.repeat(150), [`${'*a'.repeat(50)}b`, `${'**/*a'.repeat(30)}b`, '**/**/**/**/x']));
  const dir = project({ 'AGENTS.md': `${'[]('.repeat(100_000)}\n${'['.repeat(100_000)}\n` });
  assert.deepEqual(loadGuides(dir), []);
  assert.ok(Date.now() - started < 2000, 'finished quickly');
  assert.equal(parseGuide(`---\napplyTo: ${'a'.repeat(MAX_GLOB_LENGTH + 1)}\n---\n`).problem?.line, 2);
});

test('a trailing ** needs a segment below it and a middle ** may match none', () => {
  assert.ok(!matchesGlob('dashboard', ['dashboard/**']));
  assert.ok(matchesGlob('a/b', ['a/**/b']) && matchesGlob('a/x/y/b', ['a/**/b']));
  assert.ok(matchesGlob('a/b', ['a/b/']) === false);
});

test('a guide that is a link to a file outside the project is a problem', () => {
  const outside = project({ 'secret.md': '# secret\n' });
  const dir = project({ 'AGENTS.md': '[x](docs/out.md)\n' });
  mkdirSync(join(dir, 'docs'));
  symlinkSync(join(outside, 'secret.md'), join(dir, 'docs', 'out.md'));
  const check = guidesCheck(dir);
  assert.equal(check[0], 'fail'); assert.match(check[1], /outside the project/);
});

test('an oversized conventions file fails the guides check instead of passing as empty', () => {
  const dir = project({ 'AGENTS.md': 'x'.repeat((1 << 20) + 1) });
  assert.throws(() => guidesCheck(dir), /at most 1 MiB/);
});

test('run guides sees the old path of a renamed file', () => {
  const cwd = project({ 'AGENTS.md': '[o](docs/old.md)\n', 'docs/old.md': '---\napplyTo: old/**\n---\n', 'old/a.js': 'x\n' });
  git(cwd, 'add', '.'); git(cwd, 'commit', '-q', '-m', 'g');
  const started = run(cwd, 'start', '--data', JSON.stringify({ title: 'R', agent: 'claude', commands: 'true', conventions: ['AGENTS.md', 'docs/old.md'] }));
  const id = started.stdout.trim();
  const worktree = JSON.parse(readFileSync(join(cwd, '.factory', 'runs', id, 'run.json'), 'utf8')).worktree;
  mkdirSync(join(worktree, 'new'));
  git(worktree, 'mv', 'old/a.js', 'new/a.js'); git(worktree, 'commit', '-q', '-m', 'move');
  assert.match(run(cwd, 'guides', '--id', id).stdout, /docs\/old\.md \(applyTo old\/\*\*\)/);
});

test('the Skills the factory invokes are found in its reference files too', () => {
  const invoked = invokedByFactory(SKILLS_DIR);
  for (const name of ['diagnosing-bugs', 'pr', 'unslop', 'tdd', 'implement-spec', 'grill-with-docs']) assert.ok(invoked.has(name), name);
});
