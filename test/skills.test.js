import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { install } from '../src/install.js';
import { SKILLS_DIR, MARKER } from '../src/paths.js';

import { flow, main, references, section } from './skill-text.js';

const check = section('Check');
const invoked = [...flow.matchAll(/Invoke `([a-z-]+)`/g)].map((m) => m[1]);

test('the factory invokes exactly the skills we expect', () => {
  const expected = ['code-review', 'diagnosing-bugs', 'grill-with-docs', 'implement-spec', 'pr', 'security-scan', 'tdd', 'to-spec', 'to-tickets', 'unslop'];
  assert.deepEqual([...new Set(invoked)].sort(), expected);
});

test('Build asks for the smaller option in one line and the factory no longer invokes ponytail', () => {
  assert.match(section('Build'), /Build what the Ticket asks; if a smaller option exists, name it in one line in `build\.md`/);
  assert.doesNotMatch(flow, /^## Prepare/m);
  assert.deepEqual(flow.match(/^## (Define|Build|Check|Finish|Follow-up)$/gm), ['## Define', '## Build', '## Check', '## Finish', '## Follow-up']);
  assert.ok(!invoked.includes('ponytail'));
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
  assert.match(build, /run transition --id <id> --to build/);
  assert.match(build, /refuses/i);
  assert.match(build, /continue Define/i);
  assert.match(check, /no verdict in `run\.json`/);
  assert.match(check, /every axis/i);
  assert.match(check, /run that axis again/i);
  assert.doesNotMatch(check, /go back to Build and run it again/);
  assert.equal(check.split('on every Run').length, 2);
});

test('Build ends with an Exit checklist of six steps, run after the last Ticket and after every Rework', () => {
  const build = section('Build');
  const checklist = build.slice(build.indexOf('### Exit checklist'), build.indexOf('### After a Rework'));
  const steps = [...checklist.matchAll(/^\d\. \*\*([^*]+)\*\*/gm)].map((m) => m[1]);
  assert.deepEqual(steps, ['Static checks.', 'Term sweep.', 'Required artifacts.', 'Story trace.', 'Security check.', 'Self-check.']);
  assert.match(checklist, /after the last Ticket, before `run sync`, and again after every Rework/);
  assert.match(checklist, /`build\.md`/);
  assert.match(checklist, /Universal safeguards/);
  assert.match(checklist, /changelog fragment/);
  assert.match(build, /run the Exit checklist \(read `references\/exit-checklist\.md`/);
  assert.match(build, /then run `tds-factory run sync/);
});

test('the Exit checklist self-check is inline and records no verdict, and the contract says it is not the closing review', () => {
  const build = section('Build');
  const checklist = build.slice(build.indexOf('### Exit checklist'), build.indexOf('### After a Rework'));
  assert.match(checklist, /create no subagent, do not call `code-review` and record nothing with `run verdict`/);
  assert.match(checklist, /One pass only/);
  assert.doesNotMatch(checklist, /run verdict --id/);
  assert.match(section('Invoked Skills'), /self-check is inline and is not the closing review: it creates no subagent, does not call `code-review`, and records no verdict or Evidence/);
});

test('a Rework sweeps the docs again, reads its own diff and fixes cheap LOW findings', () => {
  const rework = section('Build').split('### After a Rework')[1];
  assert.match(rework, /run the term sweep again/);
  assert.match(rework, /read the rework diff/);
  assert.match(rework, /Fix the cheap LOW findings/);
  assert.match(rework, /Name a LOW you leave, with the reason/);
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
  assert.match(check, /LOW and INFO items/);
  assert.match(check, /no verdict/i);
  assert.match(check, /not validated/i);
  assert.match(check, /loop cap/i);
  assert.match(check, /go back at most 4 times/);
  assert.match(check, /no Blocking finding is left/i);
  assert.match(check, /not clean or Blocking findings are still open/);
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

test('the factory and every skill it invokes can be called by the model', () => {
  for (const name of [...invoked, 'factory']) {
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
  assert.match(readFileSync(join(SKILLS_DIR, '..', 'docs', 'dashboard.md'), 'utf8'), /uncommitted changes/);
});

test('the factory moves a Run only through the Run commands, and names each of them', () => {
  for (const command of ['transition', 'rework', 'sync', 'verify', 'verdict', 'accept', 'complete', 'inspect']) assert.match(flow, new RegExp(`tds-factory run ${command}\\b`), command);
  for (const field of ['stage', 'check_loops', 'standards', 'spec', 'security', 'infrastructure']) {
    assert.doesNotMatch(flow, new RegExp(`run update[^\\n]*"${field}"`), `${field} through run update`);
  }
  for (const field of ['base_sha', 'verify', 'reviewed', 'accepted']) assert.match(flow, new RegExp(`^\\| \`${field}\` \\|`, 'm'), field);
  assert.match(section('Finish'), /tds-factory run complete/);
  assert.match(check, /tds-factory run verdict/);
  assert.match(check, /tds-factory run rework/);
  assert.match(check, /tds-factory run accept/);
});

test('Preflight creates the Run, with an empty verify command, before it marks the Run waiting', () => {
  const preflight = section('Preflight');
  const created = preflight.indexOf('empty `commands`');
  assert.ok(created > 0, 'creates the Run with an empty `commands`');
  assert.ok(created < preflight.indexOf('`waiting`'), 'creates the Run before marking it waiting');
});

test('the docs tell users to refresh the installed Skill and call Agent targets by that name', () => {
  assert.match(readFileSync(join(SKILLS_DIR, '..', 'README.md'), 'utf8'), /tds-factory install.* after every update/);
  const domain = readFileSync(join(SKILLS_DIR, '..', 'docs', 'agents', 'domain.md'), 'utf8');
  assert.doesNotMatch(domain, /backend/i);
  for (const doc of ['GLOSSARY.md', join('docs', 'usage.md')]) assert.match(readFileSync(join(SKILLS_DIR, '..', doc), 'utf8'), /Clean[\s\S]{0,300}(Evidence|verify command passed)/, doc);
  assert.match(domain, /Agent target/);
});

const upstream = Object.fromEntries(['to-spec', 'to-tickets', 'implement-spec'].map((n) => [n, readFileSync(join(SKILLS_DIR, n, 'SKILL.md'), 'utf8')]));
const contract = section('Invoked Skills');
const overrides = (name) => [...contract.split(/^- \*\*/m).find((b) => b.startsWith(`${name}.`)).matchAll(/"([^"]+)"/g)].map((m) => m[1]);

test('the invocation contract overrides each conflicting upstream step, and only steps that still exist', () => {
  for (const name of Object.keys(upstream)) {
    const found = overrides(name);
    assert.ok(found.length > 0, name);
    for (const fragment of found) assert.ok(upstream[name].includes(fragment), `${name} no longer says: ${fragment}`);
  }
  for (const phrase of ['inline', 'Run worktree', 'one commit per Ticket', 'no closing review', 'docs/specs/', 'Do not ask the user']) {
    assert.ok(contract.toLowerCase().includes(phrase.toLowerCase()), phrase);
  }
});

test('upstream approval steps that the Factory already resolved are all overridden', () => {
  for (const name of ['to-spec', 'to-tickets']) {
    const covered = overrides(name).join('\n');
    for (const line of upstream[name].split('\n').filter((l) => /Check with the user|Ask the user|user approves|Quiz the user/.test(l))) {
      assert.ok(covered.split('\n').some((f) => line.includes(f)) || /^#/.test(line), `${name} asks the user, not overridden: ${line}`);
    }
  }
});

test('upstream implement-spec steps that spawn subagents, branches, PRs or reviews are all overridden', () => {
  const covered = overrides('implement-spec');
  for (const line of upstream['implement-spec'].split('\n').filter((l) => /^\d+\./.test(l) && /subagent|branch|worktree|draft PR|code-review/i.test(l))) {
    assert.ok(covered.some((f) => line.includes(f)), `implement-spec step not overridden: ${line}`);
  }
});

test('Preflight runs the read-only doctor and stops on anything but a missing Verify command', () => {
  const preflight = section('Preflight');
  assert.match(preflight, /tds-factory doctor --json --agent/);
  assert.ok(preflight.indexOf('tds-factory doctor') < preflight.indexOf('empty `commands`'), 'doctor runs before the Run is created');
  assert.match(preflight, /other than `verify-command`/);
  assert.doesNotMatch(preflight, /\/setup-matt-pocock-skills/);
});

test('the factory and the install guide check a label by exact name before asking to create it', () => {
  const guide = readFileSync(join(SKILLS_DIR, '..', 'docs', 'install.md'), 'utf8');
  for (const [name, text] of [['SKILL.md', section('Define')], ['docs/install.md', guide]]) {
    assert.ok(text.includes('gh label list --search <name> --json name'), `${name} names the lookup`);
    assert.match(text, /exact name/, `${name} matches the exact name`);
    assert.match(text, /already exists/, `${name} treats "already exists" as present`);
  }
});

test('Check sends a Run back only for a Blocking finding and lists the rest as Left open', () => {
  assert.doesNotMatch(flow, /worth fixing/i);
  // The three classes of Blocking finding.
  assert.match(check, /\*\*Blocking finding\*\*/);
  assert.match(check, /violation of a documented standard that names the rule/);
  assert.match(check, /CRITICAL, HIGH or MEDIUM security, infrastructure or project review finding/);
  assert.match(check, /Spec requirement that is missing or wrong/);
  // Stale text: current-behavior documents block, a historical Spec that is not canonical does not.
  assert.match(check, /stale statement in a document that describes current behavior/);
  assert.match(check, /historical Spec in `docs\/specs\/` that is not canonical/);
  assert.match(check, /Behavior the Spec did not ask for is Left open unless it contradicts a requirement or an "Out of scope" statement/);
  // Everything else is Left open and cannot block.
  assert.match(check, /\*\*Left open\*\*/);
  assert.match(check, /LOW and INFO items, and every code smell and style or design judgement/);
  assert.match(check, /is Blocking whatever its basis, also when it names no documented standard/);
  assert.match(check, /never go above LOW/);
  assert.match(check, /never raise a LOW to a Blocking finding/);
  assert.match(check, /An axis verdict is `fail` only with a Blocking finding/);
  // Reviewers say how serious a finding is and what it rests on.
  assert.match(check, /severity \(CRITICAL, HIGH, MEDIUM, LOW or INFO\)/);
  assert.match(check, /the standard, Spec requirement or `judgement` it rests on/);
});

test('Left open items reach check-N.md, finish.md and the pull request description', () => {
  assert.match(flow, /`check-N\.md` \(one per Check pass.*a Left open list/s);
  const finish = section('Finish');
  assert.match(finish, /"Left open" section/);
  assert.match(finish, /from the `check-N\.md` of the last Check/);
  assert.match(finish, /`finish\.md` repeats the list/);
  assert.match(finish, /does not wait on the user/);
  assert.match(finish, /summarise a security item without exploit details or secret values/);
});

test('Define recommends the Fast track by stated criteria and the user still confirms', () => {
  const tracks = section('Tracks');
  const define = section('Define');
  for (const text of [tracks, define]) {
    assert.match(text, /a bug fix/);
    assert.match(text, /a documentation or test-title change/);
    assert.match(text, /at most about five files with no new public interface, schema or dependency/);
  }
  assert.match(tracks, /Define recommends the Fast track whenever the work meets any of these criteria/);
  assert.match(tracks, /names the criterion it meets/);
  assert.match(tracks, /Never apply the Fast track silently/);
});

test('Build runs the fast Verify after each Ticket and the full Verify before Check, and a fast Verify is never Evidence', () => {
  const build = section('Build');
  assert.match(build, /run `tds-factory run verify --id <id> --fast` when the Run has a fast Verify command \(otherwise the full `tds-factory run verify --id <id>`\)/);
  assert.match(build, /a fast Verify is not Evidence/);
  assert.match(build, /run the full `tds-factory run verify --id <id>` \(never `--fast`\)/);
  assert.match(check, /run the full `tds-factory run verify --id <id>` \(never `--fast`\)/);
  assert.match(flow, /records nothing and is never Evidence/);
  assert.match(flow, /^\| `fast_commands` \|/m);
  assert.match(section('Preflight'), /`verify-command` and `verify-fast`/);
});

test('the Exit checklist sweeps terms with the sweep command and the Standards reviewer gets its output', () => {
  const checklist = section('Build').slice(section('Build').indexOf('### Exit checklist'), section('Build').indexOf('### After a Rework'));
  assert.match(checklist, /Run `tds-factory run sweep --id <id>`/);
  assert.match(checklist, /add each older or other wording of a changed term with `--term`/);
  assert.match(checklist, /A hit marked as replaced is history and needs no change/);
  assert.match(check, /the output of `tds-factory run sweep --id <id>` for the Standards reviewer/);
  assert.match(flow, /`tds-factory run sweep --id <id> \[--term TEXT\]\.\.\.` lists, read-only/);
});

test('after a Rework the reviewers get the previous findings, and only Security and Infrastructure can be carried over', () => {
  assert.match(check, /the review of an earlier head no longer counts, except for a Carried-over verdict/);
  assert.match(check, /give each reviewer the previous findings and the rework diff/);
  assert.match(check, /For Security and Infrastructure first run `tds-factory run verdict --id <id> --axis <axis> --value <the earlier value> --carried`/);
  assert.match(check, /only after a text-only Rework, and it alone decides: documents only/);
  assert.match(check, /never code, tests, Skills, agents, instruction files, hidden files or links/);
  assert.match(check, /its refusal names the files that changed/);
  assert.match(check, /Standards and Spec are always reviewed again/);
  assert.match(flow, /`--carried` keeps an earlier Security or Infrastructure verdict after a text-only Rework/);
});

test('the main file stays small and names every reference file where it is needed', () => {
  assert.ok(Buffer.byteLength(main) < 21_000, `SKILL.md is ${Buffer.byteLength(main)} bytes`);
  assert.deepEqual(Object.keys(references), ['check.md', 'exit-checklist.md', 'follow-up.md', 'progress-commands.md', 'run-schema.md', 'stage-agents.md']);
  for (const name of Object.keys(references)) assert.ok(main.includes(`references/${name}`), `${name} is named in SKILL.md`);
  // The contract every Run needs stays in the main file.
  for (const heading of ['Preflight', 'Run record', 'Waiting on the user', 'Invoked Skills', 'Tracks', 'Define', 'Build', 'Check', 'Finish']) assert.match(main, new RegExp(`^## ${heading}$`, 'm'));
  assert.match(main, /go back at most 4 times/);
  assert.match(main, /Only a clean Check|only a clean Check continues to Finish/);
});

test('install ships the reference files with the factory Skill', () => {
  const project = mkdtempSync(join(tmpdir(), 'skill-refs-'));
  const cwd = process.cwd();
  process.chdir(project);
  try { install({ agent: 'claude', project: true, force: false }); } finally { process.chdir(cwd); }
  for (const name of Object.keys(references)) assert.ok(existsSync(join(project, '.claude', 'skills', 'factory', 'references', name)), name);
});

test('on the Fast track build.md is three lines and the story trace and security check depend on a trust boundary', () => {
  const checklist = references['exit-checklist.md'];
  assert.match(checklist, /On the Fast track `build\.md` is three lines/);
  assert.match(checklist, /written only when the diff touches a trust boundary/);
});
