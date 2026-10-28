import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { install } from '../src/install.js';
import { SKILLS_DIR, MARKER } from '../src/paths.js';

const flow = readFileSync(join(SKILLS_DIR, 'factory', 'SKILL.md'), 'utf8');

function section(name) {
  const found = flow.split(/^## /m).find((s) => s.startsWith(`${name}\n`));
  if (!found) throw new Error(`SKILL.md has no "## ${name}" section`);
  return found;
}

const check = section('Check');
const invoked = [...flow.matchAll(/Invoke `([a-z-]+)`/g)].map((m) => m[1]);

test('the factory invokes exactly the skills we expect', () => {
  const expected = ['code-review', 'grill-with-docs', 'implement-spec', 'ponytail', 'pr', 'security-scan', 'to-spec', 'to-tickets', 'unslop'];
  assert.deepEqual([...new Set(invoked)].sort(), expected);
});

test('Prepare runs ponytail in lite mode', () => {
  assert.match(section('Prepare'), /Invoke `ponytail` in lite mode \(`lite` as its argument\)/);
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
  assert.match(flow, /ask once/i);
  assert.match(flow, /Not run/);
  assert.match(flow, /`check-N\.md`/);
  assert.match(section('Waiting on the user'), /Preflight/);
  assert.match(flow, /\| `commands` \|/);
  assert.match(flow, /\| `conventions` \|/);
});

test('Build refuses to start without a Spec and Tickets, and Check needs every axis verdict', () => {
  const build = section('Build');
  assert.match(build, /`spec_link`/);
  assert.match(build, /`tickets`/);
  assert.match(build, /`stage` to `define`/);
  assert.match(build, /continue Define/i);
  assert.match(check, /no verdict in `run\.json`/);
  assert.match(check, /every axis/i);
  assert.match(check, /run that axis again/i);
  assert.doesNotMatch(check, /go back to Build and run it again/);
  assert.equal(check.split('on every Run').length, 2);
});

test('Check feeds project rules to Standards and Security', () => {
  assert.match(check, /`applyTo`/);
  assert.match(check, /Universal safeguards/);
  assert.match(check, /canonical spec/i);
  assert.match(check, /stale/i);
  assert.match(check, /no guides or safeguards/i);
});

test('Check runs an Infrastructure axis without a new Skill', () => {
  assert.match(check, /Infrastructure/);
  assert.match(check, /bicep lint/);
  assert.match(check, /not validated/i);
  assert.match(check, /never deploy/i);
  assert.match(check, /`skipped`/);
  assert.match(flow, /^\| `infrastructure` \|/m);
});

test('Check continues to Finish only when clean, otherwise it asks the user first', () => {
  assert.match(check, /clean/i);
  assert.match(check, /`pass`/);
  assert.match(check, /`skipped`/);
  assert.match(check, /LOW and INFO/);
  assert.match(check, /no verdict/i);
  assert.match(check, /not validated/i);
  assert.match(check, /loop cap/i);
  assert.match(check, /no problem worth fixing is left/i);
  assert.match(check, /not clean or problems worth fixing are still open/);
  assert.match(check, /no verdict, or .*not validated.*counts as `fail`/);
  assert.match(check, /`waiting`/);
  assert.match(check, /explicit yes/i);
  assert.match(check, /`finish\.md`/);
  assert.match(check, /`abandoned`/);
  assert.match(flow, /`fail`, never `pass`/);
  assert.match(section('Waiting on the user'), /Check: .*`fail`.*loop cap/);
});

test('Finish has no gate of its own and still fills in the PR checklists', () => {
  const finish = section('Finish');
  assert.doesNotMatch(finish, /`waiting`/);
  assert.doesNotMatch(finish, /explicit yes|go-ahead|approval/i);
  assert.match(finish, /push the branch and open the PR/i);
  assert.doesNotMatch(finish, /accept the risk/i);
  assert.match(finish, /Infrastructure checklist/);
  assert.match(finish, /Documentation checklist/);
  assert.doesNotMatch(section('Waiting on the user'), /Finish:/);
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

test('the factory works in the Run worktree that run start creates', () => {
  assert.doesNotMatch(section('Build'), /Start on a branch/);
  assert.match(section('Run record'), /Run worktree/);
  assert.match(section('Run record'), /`worktree`/);
  assert.match(section('Build'), /Run worktree/);
  assert.match(section('Build'), /missing dependencies/);
});

test('the README describes the Run worktree, the shared Run store and cleanup', () => {
  const readme = readFileSync(join(SKILLS_DIR, '..', 'README.md'), 'utf8');
  assert.match(readme, /\.factory\/worktrees/);
  assert.match(readme, /main checkout/);
  assert.match(readme, /uncommitted changes/);
});
