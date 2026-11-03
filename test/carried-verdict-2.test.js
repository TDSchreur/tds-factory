import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, repo } from './git-repo.js';
import { run, read, force, verdict, afterRework } from './carried-verdict-helpers.js';

/** @import { Run } from '../src/run-record.js' */

test('a carried verdict is refused when anything outside the allowlist changed', () => {
  const { cwd, id, change, reset } = afterRework();
  for (const [name, why] of [
    ['src/a.js', 'code'],
    ['test/a.test.js', 'a test'],
    ['skills/factory/SKILL.md', 'a Skill'],
    ['agents/claude/factory-check.md', 'an agent'],
    ['docs/notes.txt', 'a non-Markdown file'],
  ]) {
    change('docs/guide.md');
    change(name);
    const result = verdict(cwd, id, 'security', 'pass', '--carried');
    assert.notEqual(result.status, 0, why);
    assert.ok(result.stderr.includes(name), `${why}: ${result.stderr}`);
    assert.equal(read(cwd, id).security, undefined, `${why}: nothing recorded`);
    reset();
  }
});

test('a carried verdict needs an earlier verdict with the same value, an ancestor head and a clean worktree', () => {
  let r = afterRework();
  r.change('docs/guide.md');
  assert.notEqual(
    verdict(r.cwd, r.id, 'infrastructure', 'pass', '--carried').status,
    0,
    'the earlier value was skipped',
  );
  assert.match(verdict(r.cwd, r.id, 'infrastructure', 'pass', '--carried').stderr, /same value|skipped/);
  writeFileSync(join(r.worktree, 'docs', 'dirty.md'), 'x\n');
  assert.match(verdict(r.cwd, r.id, 'security', 'pass', '--carried').stderr, /uncommitted/);

  r = afterRework();
  git(r.worktree, 'commit', '-q', '--allow-empty', '--amend', '-m', 'rewritten');
  const rebased = verdict(r.cwd, r.id, 'security', 'pass', '--carried');
  assert.notEqual(rebased.status, 0);
  assert.match(rebased.stderr, /ancestor/);

  const cwd = repo();
  const id = run(
    cwd,
    'start',
    '--data',
    JSON.stringify({ title: 'None', agent: 'codex', commands: 'true', conventions: [] }),
  ).stdout.trim();
  force(cwd, id, { stage: 'check' });
  assert.match(verdict(cwd, id, 'security', 'pass', '--carried').stderr, /no earlier/);
});

test('instruction files and every Skill or agent folder are refused, in this repository and in an installed project', () => {
  const { cwd, id, change, reset } = afterRework();
  for (const name of [
    'AGENTS.md',
    'CLAUDE.md',
    '.github/copilot-instructions.md',
    'docs/agents/domain.md',
    '.claude/skills/x/SKILL.md',
    '.agents/skills/x/SKILL.md',
    '.github/skills/x/SKILL.md',
    '.claude/agents/y.md',
    '.github/agents/y.agent.md',
    'Skills/x.md',
    'docs/Skills/x.MD',
    'docs/CLAUDE.md',
    'docs/AGENTS.md',
    'docs/.claude/skills/x/SKILL.md',
    'docs/Agents/x.md',
    'docs/agents.md',
    'docs/x/agents/y.md',
    'docs/x.prompt.md',
    'docs/AGENTS.override.md',
    'docs/CLAUDE.local.md',
    'docs/AGENT.md',
    'docs/skills.md',
    'docs/x.chatmode.md',
    'docs/.hidden.md',
    'docs/commands/x.md',
    'docs/prompts/x.md',
    'docs/instructions/x.md',
  ]) {
    change(name);
    const result = verdict(cwd, id, 'security', 'pass', '--carried');
    assert.notEqual(result.status, 0, name);
    assert.ok(result.stderr.includes(name), `${name}: ${result.stderr}`);
    reset();
  }
});

test('a deleted code file behind a Markdown path is refused', () => {
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
