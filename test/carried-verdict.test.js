import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { git, repo } from './git-repo.js';
import { openRunStore } from '../src/run-store.js';

const cli = resolve('bin/tds-factory.js');
const run = (cwd, ...args) => spawnSync(process.execPath, [cli, 'run', ...args], { cwd, encoding: 'utf8' });
const file = (cwd, id) => join(cwd, '.factory', 'runs', id, 'run.json');
const read = (cwd, id) => JSON.parse(readFileSync(file(cwd, id), 'utf8'));
const force = (cwd, id, data) => writeFileSync(file(cwd, id), JSON.stringify({ ...read(cwd, id), ...data }));
const verdict = (cwd, id, axis, value, ...more) => run(cwd, 'verdict', '--id', id, '--axis', axis, '--value', value, ...more);

// A Run in Check whose first pass gave Security pass and Infrastructure skipped; a Rework then sent it back and returned it to Check.
function afterRework() {
  const cwd = repo();
  const started = run(cwd, 'start', '--data', JSON.stringify({ title: 'Carry', agent: 'codex', commands: 'true', conventions: [] }));
  assert.equal(started.status, 0, started.stderr);
  const id = started.stdout.trim();
  force(cwd, id, { stage: 'check' });
  assert.equal(verdict(cwd, id, 'security', 'pass').status, 0);
  assert.equal(verdict(cwd, id, 'infrastructure', 'skipped').status, 0);
  const worktree = read(cwd, id).worktree;
  const first = git(worktree, 'rev-parse', 'HEAD');
  assert.equal(run(cwd, 'rework', '--id', id).status, 0);
  force(cwd, id, { stage: 'check' });
  const change = (name, text = 'text\n') => { mkdirSync(dirname(join(worktree, name)), { recursive: true }); writeFileSync(join(worktree, name), text); git(worktree, 'add', '.'); git(worktree, 'commit', '-q', '-m', `edit ${name}`); };
  return { cwd, id, worktree, first, change };
}

test('a text-only Rework carries Security and Infrastructure, and records where they came from', () => {
  const { cwd, id, worktree, first, change } = afterRework();
  change('docs/guide.md');
  change('changelog.d/x.md');
  const security = verdict(cwd, id, 'security', 'pass', '--carried');
  assert.equal(security.status, 0, security.stderr);
  assert.equal(verdict(cwd, id, 'infrastructure', 'skipped', '--carried').status, 0);
  const record = read(cwd, id);
  const head = git(worktree, 'rev-parse', 'HEAD');
  assert.equal(record.security, 'pass');
  assert.deepEqual(record.reviewed.security, { head, attempt: 2, carried_from: first });
  assert.equal(record.reviewed.infrastructure.carried_from, first);
  assert.equal(record.metrics.verdicts.at(-1).carried_from, first);
  // Evidence sees a verdict for the current head and attempt, like any other.
  const problems = openRunStore(cwd).mergeEligibility(id).problems.join('\n');
  assert.doesNotMatch(problems, /security|infrastructure/);
  assert.match(problems, /standards has no verdict/);
});

test('a carried verdict is refused when anything but Markdown outside skills and agents changed', () => {
  for (const [name, why] of [['src/a.js', 'code'], ['test/a.test.js', 'a test'], ['skills/factory/SKILL.md', 'a Skill'], ['agents/claude/factory-check.md', 'an agent'], ['docs/notes.txt', 'a non-Markdown file']]) {
    const { cwd, id, change } = afterRework();
    change('docs/guide.md');
    change(name);
    const result = verdict(cwd, id, 'security', 'pass', '--carried');
    assert.notEqual(result.status, 0, why);
    assert.ok(result.stderr.includes(name), `${why}: ${result.stderr}`);
    assert.equal(read(cwd, id).security, undefined, `${why}: nothing recorded`);
  }
});

test('a carried verdict needs an earlier verdict with the same value, an ancestor head and a clean worktree', () => {
  let r = afterRework();
  r.change('docs/guide.md');
  assert.notEqual(verdict(r.cwd, r.id, 'infrastructure', 'pass', '--carried').status, 0, 'the earlier value was skipped');
  assert.match(verdict(r.cwd, r.id, 'infrastructure', 'pass', '--carried').stderr, /same value|skipped/);
  writeFileSync(join(r.worktree, 'docs', 'dirty.md'), 'x\n');
  assert.match(verdict(r.cwd, r.id, 'security', 'pass', '--carried').stderr, /uncommitted/);

  r = afterRework();
  git(r.worktree, 'commit', '-q', '--allow-empty', '--amend', '-m', 'rewritten');
  const rebased = verdict(r.cwd, r.id, 'security', 'pass', '--carried');
  assert.notEqual(rebased.status, 0);
  assert.match(rebased.stderr, /ancestor/);

  const cwd = repo();
  const id = run(cwd, 'start', '--data', JSON.stringify({ title: 'None', agent: 'codex', commands: 'true', conventions: [] })).stdout.trim();
  force(cwd, id, { stage: 'check' });
  assert.match(verdict(cwd, id, 'security', 'pass', '--carried').stderr, /no earlier/);
});

test('only Security and Infrastructure can be carried, and a fail is never carried', () => {
  const { cwd, id, change } = afterRework();
  change('docs/guide.md');
  for (const axis of ['standards', 'spec']) assert.match(verdict(cwd, id, axis, 'pass', '--carried').stderr, /only security and infrastructure/i);
  assert.notEqual(verdict(cwd, id, 'security', 'fail', '--carried').status, 0);
});
