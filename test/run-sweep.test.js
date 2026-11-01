import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
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
  assert.ok(lines.every((l) => l.split(': ').slice(1).join(': ').length <= 160), 'the text of each hit is cut to 160 characters');
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

test('the sweep never follows links, strips control characters from file names, and reads a blockquote replaced-by note', () => {
  const p = project({ 'docs/real.md': 'unique_marker_xyz is here\n', 'docs/we\u001bird.md': 'unique_marker_xyz again\n', 'docs/old.md': '# Old\n\n> Historical: superseded by [new](new.md).\n\nunique_marker_xyz\n' }, { 'docs/z.md': 'adds `unique_marker_xyz`\n' });
  symlinkSync(join(p.worktree, 'docs', 'real.md'), join(p.worktree, 'docs', 'link.md'));
  git(p.worktree, 'add', '.'); git(p.worktree, 'commit', '-q', '-m', 'link');
  const out = sweep(p).stdout;
  assert.doesNotMatch(out, /\u001b/);
  assert.doesNotMatch(out, /docs\/link\.md/);
  assert.match(out, /docs\/we\?ird\.md:1/);
  assert.match(out.split(/marked as replaced/i)[1], /docs\/old\.md:5/);
});

test('the total of listed hits is bounded and the rest is counted', () => {
  const files = {};
  for (let i = 0; i < 50; i += 1) files[`docs/t${i}.md`] = 'tm1_x tm2_x tm3_x tm4_x tm5_x tm6_x tm7_x tm8_x\n';
  const p = project(files, { 'docs/z.md': 'adds `tm1_x` `tm2_x` `tm3_x` `tm4_x` `tm5_x` `tm6_x` `tm7_x` `tm8_x`\n' });
  const out = sweep(p).stdout;
  const listed = out.split('\n').filter((l) => /^ {4}docs\/t\d+\.md:1:/.test(l));
  assert.ok(listed.length <= 250, `${listed.length} hits listed`);
  assert.match(out, /\d+ hit\(s\) left out in total/);
});

test('a Run without a usable base commit is refused', () => {
  const p = project({ 'docs/a.md': 'x\n' }, { 'docs/a.md': 'y `term_a`\n' });
  const file = join(p.cwd, '.factory', 'runs', p.id, 'run.json');
  const record = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...record, base_sha: '--output=/tmp/x' }));
  const result = sweep(p);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no usable base commit/);
});

test('a file name with a newline cannot add lines, and a non-ASCII name still gets the changed tag', () => {
  const p = project({ 'docs/x\n== fake header.md': 'shared_name_term in a odd file\n' }, { 'docs/\u00e9.md': 'adds `shared_name_term`\n' });
  const out = sweep(p).stdout;
  assert.doesNotMatch(out, /\n== fake header/);
  assert.match(out, /docs\/x\?== fake header\.md:1/);
  assert.match(out, /docs\/\u00e9\.md:1:.*\[changed\]/);
});

test('the sweep lists documents that still hold a number with a unit the diff removed', () => {
  const p = project(
    { 'docs/a.md': 'Keep the file under 21 KB.\n', 'docs/b.md': 'The cap is 21 KB.\nUp to 40 KB is fine.\n' },
    { 'docs/a.md': 'Keep the file under 18 KB.\n' },
  );
  const out = sweep(p).stdout;
  assert.match(out, /== 21 KB: 1 hit/);
  assert.match(out, /docs\/b\.md:1\b.*21 KB/);
  assert.doesNotMatch(out, /== 40 KB/);
});

test('a number that is still on an added line is not a stale number', () => {
  const p = project({ 'docs/a.md': 'Limit 21 KB.\n', 'docs/b.md': 'Limit 21 KB.\n' }, { 'docs/a.md': 'Limit 21 KB, see below.\nOther note.\n' });
  assert.doesNotMatch(sweep(p).stdout, /== 21 KB/);
});

test('the sweep lists a pointer to a heading the diff removed, by its text and by its anchor', () => {
  const p = project(
    { 'docs/a.md': '## Old section\n\nText.\n', 'docs/b.md': 'See [it](a.md#old-section) in the Old section.\n' },
    { 'docs/a.md': '## New section\n\nText.\n' },
  );
  const out = sweep(p).stdout;
  assert.match(out, /== #old-section: 1 hit/);
  assert.match(out, /== Old section: 1 hit/);
  assert.match(out, /docs\/b\.md:1\b/);
});

test('hostile input does not slow the sweep or add lines', () => {
  const p = project(
    { 'docs/a.md': `${'9'.repeat(200000)}\n${'#'.repeat(200000)}\n`, 'docs/b.md': 'x\n' },
    { 'docs/a.md': `1 KB\x1b[31m\n${'1'.repeat(200000)} KB\n` },
  );
  const started = Date.now();
  const result = sweep(p);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(Date.now() - started < 10000);
  assert.doesNotMatch(result.stdout, /\x1b/);
});

const sections = (out) => out.split('== lists that miss')[1] ?? '';

test('a list that misses a member the diff added is listed, and one that has it is not', () => {
  const p = project(
    {
      'docs/a.md': 'Checks: `cli`, `git`, `tracker`.\n',
      'docs/b.md': 'The report holds `cli`, `git` and `tracker` checks.\n',
      'docs/c.md': 'Also `cli`, `git`, `tracker` and `guides`.\n',
    },
    { 'docs/a.md': 'Checks: `cli`, `git`, `tracker`, `guides`.\n' },
  );
  const lists = sections(sweep(p).stdout);
  assert.match(lists, /added `guides`/);
  assert.match(lists, /docs\/b\.md:1\b/);
  assert.doesNotMatch(lists, /docs\/c\.md/);
});

test('a list that still holds a member the diff removed is listed', () => {
  const p = project(
    { 'docs/a.md': 'Checks: `cli`, `git`, `tracker`, `old`.\n', 'docs/b.md': 'Checks: `cli`, `git`, `tracker`, `old`.\n' },
    { 'docs/a.md': 'Checks: `cli`, `git`, `tracker`.\n' },
  );
  const lists = sections(sweep(p).stdout);
  assert.match(lists, /removed `old`/);
  assert.match(lists, /docs\/b\.md:1\b/);
});

test('added lines that claim linear or safe behaviour are listed, tests are not', () => {
  const p = project(
    { 'docs/a.md': 'x\n' },
    { 'src/m.js': '// matching is linear in the input\n', 'test/m.test.js': '// linear here\n', 'docs/a.md': 'plain\n' },
  );
  const out = sweep(p).stdout;
  assert.match(out, /claims in added lines/);
  assert.match(out, /src\/m\.js: \/\/ matching is linear/);
  assert.doesNotMatch(out, /test\/m\.test\.js/);
});

test('a line with thousands of backticks and a control character in a name stay bounded and clean', () => {
  const many = '`x` '.repeat(5000);
  const p = project(
    { 'docs/a.md': many + '\n`a`, `b`, `c`\n' },
    { 'docs/a.md': many + '\n`a`, `b`, `c`, `d\x1b[31m`\n' },
  );
  const started = Date.now();
  const result = sweep(p);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(Date.now() - started < 10000);
  assert.doesNotMatch(result.stdout, /\x1b/);
});
