import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { install } from '../src/install.js';
import { SKILLS_DIR, MARKER } from '../src/paths.js';

const flow = readFileSync(join(SKILLS_DIR, 'factory', 'SKILL.md'), 'utf8');
const invoked = [...flow.matchAll(/Invoke `([a-z-]+)`/g)].map((m) => m[1]);

test('the factory invokes exactly the skills we expect', () => {
  const expected = ['code-review', 'grill-with-docs', 'implement-spec', 'ponytail', 'pr', 'security-scan', 'to-spec', 'to-tickets'];
  assert.deepEqual([...new Set(invoked)].sort(), expected);
});

test('every skill the factory invokes can be called by the model', () => {
  for (const name of invoked) {
    const skill = readFileSync(join(SKILLS_DIR, name, 'SKILL.md'), 'utf8');
    assert.doesNotMatch(skill, /^disable-model-invocation:/m, name);
  }
});

test('install replaces a symlinked skill with a copy', () => {
  const project = mkdtempSync(join(tmpdir(), 'tds-install-'));
  const other = mkdtempSync(join(tmpdir(), 'tds-other-'));
  mkdirSync(join(project, '.claude', 'skills'), { recursive: true });
  const link = join(project, '.claude', 'skills', 'to-spec');
  symlinkSync(other, link);
  const cwd = process.cwd();
  process.chdir(project);
  try {
    install({ agent: 'claude', project: true, force: false });
  } finally {
    process.chdir(cwd);
  }
  assert.ok(!lstatSync(link).isSymbolicLink());
  assert.ok(existsSync(join(link, 'SKILL.md')));
  assert.ok(existsSync(other));
});

test('the vendored security skill ships as security-scan with its reference files', () => {
  const dir = join(SKILLS_DIR, 'security-scan');
  assert.match(readFileSync(join(dir, 'SKILL.md'), 'utf8'), /^name: security-scan$/m);
  assert.ok(readdirSync(join(dir, 'references')).includes('vuln-categories.md'));
  assert.ok(!existsSync(join(SKILLS_DIR, 'security-review')));
  for (const file of readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.md'))) {
    assert.doesNotMatch(readFileSync(join(dir, file), 'utf8'), /\/security-review(?![\w-])/, file);
  }
});

test('install removes marked skills that are no longer shipped and keeps unmarked ones', () => {
  const project = mkdtempSync(join(tmpdir(), 'tds-stale-'));
  const skills = join(project, '.claude', 'skills');
  for (const name of ['old-skill', 'mine']) {
    mkdirSync(join(skills, name), { recursive: true });
    writeFileSync(join(skills, name, 'SKILL.md'), '---\nname: x\n---\n');
  }
  writeFileSync(join(skills, 'old-skill', MARKER), '');
  const log = mock.method(console, 'log', () => {});
  const cwd = process.cwd();
  process.chdir(project);
  try {
    install({ agent: 'claude', project: true, force: false });
  } finally {
    process.chdir(cwd);
    log.mock.restore();
  }
  assert.ok(!existsSync(join(skills, 'old-skill')));
  assert.ok(existsSync(join(skills, 'mine')));
  assert.ok(log.mock.calls.some((c) => /removed claude\/old-skill/.test(c.arguments[0])));
});
