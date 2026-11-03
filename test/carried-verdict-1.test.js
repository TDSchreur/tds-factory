import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git } from './git-repo.js';
import { openRunStore } from '../src/run-store.js';
import { metricsOf } from './run-view.js';
import { read, force, verdict, afterRework, POSIX_ONLY } from './carried-verdict-helpers.js';

/** @import { Run } from '../src/run-record.js' */

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
  assert.deepEqual(record.reviewed?.security, { head, attempt: 2, carried_from: first });
  assert.equal(record.reviewed?.infrastructure?.carried_from, first);
  assert.equal(metricsOf(record).verdicts.at(-1)?.carried_from, first);
  // Evidence sees a verdict for the current head and attempt, like any other.
  const problems = openRunStore(cwd).mergeEligibility(id).problems.join('\n');
  assert.doesNotMatch(problems, /security|infrastructure/);
  assert.match(problems, /standards has no verdict/);
});

test('only Security and Infrastructure can be carried, and a fail is never carried', () => {
  const { cwd, id, change } = afterRework();
  change('docs/guide.md');
  for (const axis of ['standards', 'spec'])
    assert.match(verdict(cwd, id, axis, 'pass', '--carried').stderr, /only security and infrastructure/i);
  assert.notEqual(verdict(cwd, id, 'security', 'fail', '--carried').status, 0);
});

test('the allowed files are an allowlist: README, GLOSSARY, docs outside docs/agents and changelog fragments', () => {
  const { cwd, id, change } = afterRework();
  for (const name of [
    'README.md',
    'GLOSSARY.md',
    'CONTRIBUTING.md',
    'docs/adr/0001-x.md',
    'docs/specs/a.md',
    'changelog.d/y.md',
  ])
    change(name);
  assert.equal(verdict(cwd, id, 'security', 'pass', '--carried').status, 0);
});

test('renaming code to a Markdown path is refused because both paths are listed', () => {
  const { cwd, id, worktree } = afterRework({ 'src/guard.js': 'export const guard = 1;\n' });
  mkdirSync(join(worktree, 'docs'), { recursive: true });
  git(worktree, 'mv', 'src/guard.js', 'docs/guard.md');
  git(worktree, 'commit', '-q', '-m', 'rename to markdown');
  const result = verdict(cwd, id, 'security', 'pass', '--carried');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /src\/guard\.js/);
});

test('a symlink at a Markdown path is refused', { skip: POSIX_ONLY }, () => {
  const link = afterRework();
  mkdirSync(join(link.worktree, 'docs'), { recursive: true });
  symlinkSync('/etc/hosts', join(link.worktree, 'docs', 'link.md'));
  git(link.worktree, 'add', '.');
  git(link.worktree, 'commit', '-q', '-m', 'link');
  const linked = verdict(link.cwd, link.id, 'security', 'pass', '--carried');
  assert.notEqual(linked.status, 0);
  assert.match(linked.stderr, /docs\/link\.md/);
});

test('an executable at a Markdown path is refused', { skip: POSIX_ONLY }, () => {
  const exec = afterRework();
  mkdirSync(join(exec.worktree, 'docs'), { recursive: true });
  writeFileSync(join(exec.worktree, 'docs', 'run.md'), '#!/bin/sh\n');
  chmodSync(join(exec.worktree, 'docs', 'run.md'), 0o755);
  git(exec.worktree, 'add', '.');
  git(exec.worktree, 'commit', '-q', '-m', 'exec');
  const executable = verdict(exec.cwd, exec.id, 'security', 'pass', '--carried');
  assert.notEqual(executable.status, 0);
  assert.match(executable.stderr, /docs\/run\.md/);
});

test('a rename between two allowlisted documents still carries, and a fail on the record also blocks a carry', () => {
  const { cwd, id, worktree } = afterRework({ 'docs/a.md': 'text\n' });
  git(worktree, 'mv', 'docs/a.md', 'docs/b.md');
  git(worktree, 'commit', '-q', '-m', 'rename a document');
  assert.equal(verdict(cwd, id, 'security', 'pass', '--carried').status, 0);
  const again = afterRework();
  again.change('docs/guide.md');
  force(again.cwd, again.id, {
    security: 'fail',
    reviewed: {
      ...read(again.cwd, again.id).reviewed,
      security: { head: git(again.worktree, 'rev-parse', 'HEAD'), attempt: 2 },
    },
  });
  assert.match(verdict(again.cwd, again.id, 'security', 'pass', '--carried').stderr, /already failed at this head/);
});
