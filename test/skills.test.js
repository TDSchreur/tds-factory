import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { install } from '../src/install.js';
import { SKILLS_DIR, MARKER } from '../src/paths.js';

const flow = readFileSync(join(SKILLS_DIR, 'factory', 'SKILL.md'), 'utf8');
const invoked = [...flow.matchAll(/Invoke `([a-z-]+)`/g)].map((m) => m[1]);

test('the factory invokes exactly the skills we expect', () => {
  const expected = ['code-review', 'grill-with-docs', 'implement-spec', 'ponytail', 'pr', 'security-scan', 'to-spec', 'to-tickets', 'unslop'];
  assert.deepEqual([...new Set(invoked)].sort(), expected);
});

test('the factory follows the configured tracker and the repo PR template', () => {
  assert.doesNotMatch(flow, /GitHub Issues/);
  assert.doesNotMatch(flow, /\. The PR body lists `Closes #N`/);
  assert.match(flow, /docs\/agents\/issue-tracker\.md/);
  for (const path of ['.github/pull_request_template.md', '.azuredevops/pull_request_template.md', 'docs/pull_request_template.md']) {
    assert.ok(flow.includes(path), path);
  }
});

test('Preflight reads project conventions and Build runs the verify command', () => {
  assert.match(flow, /## Commands/);
  assert.match(flow, /AGENTS\.md/);
  assert.match(flow, /ask the user once/i);
  assert.match(flow, /Not run/);
  assert.match(flow, /\| `commands` \|/);
  assert.match(flow, /\| `conventions` \|/);
});

function section(name) {
  return flow.split(/^## /m).find((s) => s.startsWith(name));
}

test('Build refuses to start without a Spec and Tickets, and Check needs every axis verdict', () => {
  const build = section('Build');
  assert.match(build, /`spec_link`/);
  assert.match(build, /`tickets`/);
  assert.match(build, /`stage` to `define`/);
  assert.match(build, /continue Define/i);
  const check = section('Check');
  assert.match(check, /no verdict in `run\.json`/);
  assert.match(check, /every axis/i);
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
