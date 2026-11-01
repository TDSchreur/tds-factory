import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { install } from '../src/install.js';
import { SKILLS_DIR } from '../src/paths.js';

// /factory stops at Preflight without this skill, so a colleague must get it from the one install.
const NAME = 'setup-matt-pocock-skills';

test('the manifest lists the project setup skill and the synced copy is committed', () => {
  const manifest = JSON.parse(readFileSync(join(SKILLS_DIR, '..', 'skills.manifest.json'), 'utf8'));
  assert.ok(
    manifest.skills.some((s) => (typeof s === 'string' ? s : s.path).endsWith('/' + NAME)),
    'manifest entry',
  );
  assert.ok(existsSync(join(SKILLS_DIR, NAME, 'SKILL.md')), 'skills/ copy');
});

test('install puts the project setup skill in the directory of every Agent target', () => {
  const project = mkdtempSync(join(tmpdir(), 'tds-setup-skill-'));
  const cwd = process.cwd();
  process.chdir(project);
  try {
    install({ agent: 'all', project: true, force: false });
    install({ agent: 'copilot', project: true, force: false });
  } finally {
    process.chdir(cwd);
  }
  for (const dir of ['.claude/skills', '.agents/skills', '.github/skills']) {
    assert.ok(existsSync(join(project, dir, NAME, 'SKILL.md')), dir);
  }
});
