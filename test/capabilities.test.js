import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SKILLS_DIR, AGENTS_DIR } from '../src/paths.js';

const root = join(SKILLS_DIR, '..');
const matrix = readFileSync(join(root, 'docs', 'capabilities.md'), 'utf8');
const rows = Object.fromEntries(matrix.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| ---')).map((l) => l.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim())).map(([name, ...cells]) => [name, cells]));

test('the capability matrix has a column per Agent target and a row per concern', () => {
  assert.deepEqual(rows.Concern, ['Claude', 'Codex', 'Copilot']);
  for (const concern of ['Skill invocation', 'Stage agent dispatch', 'Review isolation', 'Resumability', 'Reviewer unavailable']) {
    assert.equal(rows[concern]?.length, 3, concern);
  }
});

test('the Review isolation row states the restriction the factory-check agent file really has', () => {
  const files = ['claude/factory-check.md', 'codex/factory-check.toml', 'copilot/factory-check.agent.md'];
  const claimed = ['tools: Read, Grep, Glob', 'sandbox_mode = "read-only"', 'tools: ["view", "grep", "glob"]'];
  files.forEach((file, i) => {
    assert.ok(rows['Review isolation'][i].includes(`\`${claimed[i]}\``), `matrix claim for ${file}`);
    assert.ok(readFileSync(join(AGENTS_DIR, file), 'utf8').includes(claimed[i]), `${file} lacks ${claimed[i]}`);
  });
});

test('an unavailable reviewer stops the Run instead of being replaced by a self-review', () => {
  const flow = readFileSync(join(SKILLS_DIR, 'factory', 'SKILL.md'), 'utf8');
  const check = flow.split(/^## /m).find((s) => s.startsWith('Check\n'));
  assert.match(check, /cannot be started/);
  assert.match(check, /`verification-unavailable`/);
  assert.match(check, /never review.*yourself|do not review.*yourself/i);
  for (const cell of rows['Reviewer unavailable']) assert.match(cell, /verification-unavailable|Same/);
});
