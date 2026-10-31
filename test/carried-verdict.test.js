import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
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
function afterRework(initial = {}) {
  const cwd = repo();
  const started = run(cwd, 'start', '--data', JSON.stringify({ title: 'Carry', agent: 'codex', commands: 'true', conventions: [] }));
  assert.equal(started.status, 0, started.stderr);
  const id = started.stdout.trim();
  const worktree = read(cwd, id).worktree;
  for (const [name, text] of Object.entries(initial)) { mkdirSync(dirname(join(worktree, name)), { recursive: true }); writeFileSync(join(worktree, name), text); }
  if (Object.keys(initial).length) { git(worktree, 'add', '.'); git(worktree, 'commit', '-q', '-m', 'initial'); }
  force(cwd, id, { stage: 'check' });
  assert.equal(verdict(cwd, id, 'security', 'pass').status, 0);
  assert.equal(verdict(cwd, id, 'infrastructure', 'skipped').status, 0);
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

test('a carried verdict is refused when anything outside the allowlist changed', () => {
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

test('the allowed files are an allowlist: README, GLOSSARY, docs outside docs/agents and changelog fragments', () => {
  const { cwd, id, change } = afterRework();
  for (const name of ['README.md', 'GLOSSARY.md', 'CONTRIBUTING.md', 'docs/adr/0001-x.md', 'docs/specs/a.md', 'changelog.d/y.md']) change(name);
  assert.equal(verdict(cwd, id, 'security', 'pass', '--carried').status, 0);
});

test('instruction files and every Skill or agent folder are refused, in this repository and in an installed project', () => {
  for (const name of ['AGENTS.md', 'CLAUDE.md', '.github/copilot-instructions.md', 'docs/agents/domain.md', '.claude/skills/x/SKILL.md', '.agents/skills/x/SKILL.md', '.github/skills/x/SKILL.md', '.claude/agents/y.md', '.github/agents/y.agent.md', 'Skills/x.md', 'docs/Skills/x.MD', 'docs/CLAUDE.md', 'docs/AGENTS.md', 'docs/.claude/skills/x/SKILL.md', 'docs/Agents/x.md', 'docs/agents.md', 'docs/x/agents/y.md', 'docs/x.prompt.md', 'docs/AGENTS.override.md', 'docs/CLAUDE.local.md', 'docs/AGENT.md', 'docs/skills.md', 'docs/x.chatmode.md', 'docs/.hidden.md', 'docs/commands/x.md', 'docs/prompts/x.md', 'docs/instructions/x.md']) {
    const { cwd, id, change } = afterRework();
    change(name);
    const result = verdict(cwd, id, 'security', 'pass', '--carried');
    assert.notEqual(result.status, 0, name);
    assert.ok(result.stderr.includes(name), `${name}: ${result.stderr}`);
  }
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

test('a symlink, an executable or a deleted code file at or behind a Markdown path is refused', () => {
  const link = afterRework();
  mkdirSync(join(link.worktree, 'docs'), { recursive: true });
  symlinkSync('/etc/hosts', join(link.worktree, 'docs', 'link.md'));
  git(link.worktree, 'add', '.'); git(link.worktree, 'commit', '-q', '-m', 'link');
  const linked = verdict(link.cwd, link.id, 'security', 'pass', '--carried');
  assert.notEqual(linked.status, 0);
  assert.match(linked.stderr, /docs\/link\.md/);

  const exec = afterRework();
  mkdirSync(join(exec.worktree, 'docs'), { recursive: true });
  writeFileSync(join(exec.worktree, 'docs', 'run.md'), '#!/bin/sh\n');
  chmodSync(join(exec.worktree, 'docs', 'run.md'), 0o755);
  git(exec.worktree, 'add', '.'); git(exec.worktree, 'commit', '-q', '-m', 'exec');
  const executable = verdict(exec.cwd, exec.id, 'security', 'pass', '--carried');
  assert.notEqual(executable.status, 0);
  assert.match(executable.stderr, /docs\/run\.md/);

  const gone = afterRework({ 'src/old.js': 'x\n' });
  git(gone.worktree, 'rm', '-q', 'src/old.js');
  git(gone.worktree, 'commit', '-q', '-m', 'delete code');
  assert.match(verdict(gone.cwd, gone.id, 'security', 'pass', '--carried').stderr, /src\/old\.js/);
});

test('a fail recorded at the current head is not replaced by a carried pass', () => {
  const { cwd, id, change } = afterRework();
  change('docs/guide.md');
  assert.equal(verdict(cwd, id, 'security', 'fail').status, 0);
  const result = verdict(cwd, id, 'security', 'pass', '--carried');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /already failed at this head/);
});

test('a rename between two allowlisted documents still carries, and a fail on the record also blocks a carry', () => {
  const { cwd, id, worktree } = afterRework({ 'docs/a.md': 'text\n' });
  git(worktree, 'mv', 'docs/a.md', 'docs/b.md');
  git(worktree, 'commit', '-q', '-m', 'rename a document');
  assert.equal(verdict(cwd, id, 'security', 'pass', '--carried').status, 0);
  const again = afterRework();
  again.change('docs/guide.md');
  force(again.cwd, again.id, { security: 'fail', reviewed: { ...read(again.cwd, again.id).reviewed, security: { head: git(again.worktree, 'rev-parse', 'HEAD'), attempt: 2 } } });
  assert.match(verdict(again.cwd, again.id, 'security', 'pass', '--carried').stderr, /already failed at this head/);
});
