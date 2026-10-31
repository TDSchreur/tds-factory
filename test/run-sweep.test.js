import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { repo, git } from './git-repo.js';

const cli = resolve('bin/tds-factory.js');
const run = (cwd, ...args) => spawnSync(process.execPath, [cli, 'run', ...args], { cwd, encoding: 'utf8' });

// A project with a Run whose worktree starts from `files`; `change` then edits and commits inside the Run worktree.
function project(files, change) {
  const cwd = repo();
  for (const [name, text] of Object.entries(files)) { mkdirSync(dirname(join(cwd, name)), { recursive: true }); writeFileSync(join(cwd, name), text); }
  git(cwd, 'add', '.'); git(cwd, 'commit', '-q', '-m', 'docs');
  const started = run(cwd, 'start', '--data', JSON.stringify({ title: 'Sweep', agent: 'claude', commands: 'true', conventions: [] }));
  assert.equal(started.status, 0, started.stderr);
  const id = started.stdout.trim();
  const worktree = JSON.parse(readFileSync(join(cwd, '.factory', 'runs', id, 'run.json'), 'utf8')).worktree;
  for (const [name, text] of Object.entries(change)) { mkdirSync(dirname(join(worktree, name)), { recursive: true }); writeFileSync(join(worktree, name), text); }
  git(worktree, 'add', '.'); git(worktree, 'commit', '-q', '-m', 'change');
  return { cwd, id, worktree };
}
const sweep = (p, ...args) => run(p.cwd, 'sweep', '--id', p.id, ...args);

test('the sweep finds a stale use of an identifier the Run changed, and tags hits in changed files', () => {
  const p = project(
    { 'docs/usage.md': 'Use `old_flag` to start.\n', 'docs/guide.md': 'Remember old_flag when you start.\n' },
    { 'docs/usage.md': 'Use `new_flag` to start.\n' },
  );
  const result = sweep(p);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /old_flag/);
  assert.match(result.stdout, /docs\/guide\.md:1\b.*Remember old_flag/);
  assert.match(result.stdout, /docs\/usage\.md:1\b.*new_flag.*\[changed\]/);
  assert.doesNotMatch(result.stdout, /docs\/guide\.md:1.*\[changed\]/);
});

test('--term adds a synonym the diff does not contain', () => {
  const p = project({ 'README.md': 'It defaults to Claude.\n', 'docs/a.md': 'x\n' }, { 'docs/a.md': 'y with `other_term`\n' });
  const result = sweep(p, '--term', 'defaults to claude');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /defaults to claude/i);
  assert.match(result.stdout, /README\.md:1\b.*defaults to Claude/);
});

test('a hit in a file marked as replaced by a newer Spec, or in the archive, is listed apart', () => {
  const p = project(
    {
      'docs/specs/old.md': '# Old\n\n_This was replaced by [new](new.md)._\n\nUse old_flag here.\n',
      'docs/specs/archive/ancient.md': 'old_flag is how it began.\n',
      'docs/current.md': 'Current text about old_flag.\n',
    },
    { 'docs/new.md': 'Use `new_flag` instead of `old_flag`.\n' },
  );
  const out = sweep(p).stdout;
  const [current, replaced] = out.split(/marked as replaced/i);
  assert.match(current, /docs\/current\.md:1/);
  assert.doesNotMatch(current, /docs\/specs\/old\.md/);
  assert.match(replaced, /docs\/specs\/old\.md:5/);
  assert.match(replaced, /docs\/specs\/archive\/ancient\.md:1/);
});

test('the sweep is read-only, strips control characters and never follows links', () => {
  const p = project({ 'docs/a.md': 'old_flag \u001b[2J here\n' }, { 'docs/b.md': 'now `new_flag`\n' });
  const before = git(p.worktree, 'status', '--porcelain');
  const result = sweep(p, '--term', 'old_flag');
  assert.doesNotMatch(result.stdout, /\u001b/);
  assert.match(result.stdout, /old_flag \?\[2J here/);
  assert.equal(git(p.worktree, 'status', '--porcelain'), before);
});

test('the output is bounded and says what was left out', () => {
  const files = {};
  for (let i = 0; i < 60; i += 1) files[`docs/f${i}.md`] = `${'x'.repeat(300)} common_term ${i}\n`;
  const p = project(files, { 'docs/z.md': 'adds `common_term`\n' });
  const out = sweep(p).stdout;
  const lines = out.split('\n').filter((l) => /^docs\/f\d+\.md:1/.test(l.trim()) || /^ +docs\/f\d+\.md:1/.test(l));
  assert.ok(lines.length <= 40, `${lines.length} hit lines for one term`);
  assert.ok(lines.every((l) => l.length <= 200), 'lines are cut');
  assert.match(out, /\d+ more hit/);
});

test('a Run whose diff has no terms says so and exits 0', () => {
  const p = project({ 'docs/a.md': 'text\n' }, { 'docs/a.md': 'text more words\n' });
  const result = sweep(p);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /no terms/i);
});

test('an unknown Run is refused', () => {
  const cwd = repo();
  const result = run(cwd, 'sweep', '--id', 'no-such-run');
  assert.notEqual(result.status, 0);
});

test('a term that occurs everywhere is not listed and says so', () => {
  const files = {};
  for (let i = 0; i < 120; i += 1) files[`docs/g${i}.md`] = 'shared_word appears here\n';
  const p = project(files, { 'docs/z.md': 'uses `shared_word`\n' });
  const out = sweep(p).stdout;
  assert.match(out, /== shared_word: 121 hit\(s\)/);
  assert.match(out, /too common to list \(121 hits\)/);
  assert.doesNotMatch(out, /docs\/g1\.md:1/);
});
