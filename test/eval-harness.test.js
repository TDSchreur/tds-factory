import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './eval-root.js';

const RUN = 'id=$(ls .factory/runs) && tds-factory run';
const gh = join(ROOT, 'eval', 'bin', 'gh');
const runner = join(ROOT, 'eval', 'run.js');
const sandbox = () => join(mkdtempSync(join(tmpdir(), 'eval-shim-')), 'actions.jsonl');

const shim = (log, ...args) => spawnSync(gh, args, { env: { ...process.env, EVAL_ACTION_LOG: log }, encoding: 'utf8' });
const logged = (log) => readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('the offline gh records a write as an attempted action and answers with a canned URL', () => {
  const log = sandbox();
  const out = shim(log, 'issue', 'create', '--title', 'T', '--label', 'ready-for-agent', '--body', 'B');
  assert.equal(out.status, 0);
  assert.match(out.stdout, /^https:\/\/github\.com\/eval\/fixture\/issues\/1\n$/);
  const [action] = logged(log);
  assert.deepEqual([action.write, action.title, action.labels, action.body], [true, 'T', 'ready-for-agent', 'B']);
});

test('the offline gh logs reads as non-writes and refuses to run without an action log', () => {
  const log = sandbox();
  assert.equal(shim(log, 'pr', 'view', '--json', 'state').stdout, '[]\n');
  assert.equal(logged(log)[0].write, false);
  const bare = spawnSync(gh, ['issue', 'create'], { env: { ...process.env, EVAL_ACTION_LOG: '' }, encoding: 'utf8' });
  assert.equal(bare.status, 2);
});

test('npm run eval without an agent runs nothing and says why', () => {
  const out = spawnSync('node', [runner], { env: { ...process.env, EVAL_AGENT_CMD: '' }, encoding: 'utf8' });
  assert.equal(out.status, 2);
  assert.match(out.stderr, /nothing was run/);
});

// The real runner and graders, with a scripted stand-in for the agent.
const grade = (scenario, agentCommand) => spawnSync('node', [runner, 'copilot', scenario], { env: { ...process.env, EVAL_AGENT_CMD: agentCommand }, encoding: 'utf8' });

test('the grader passes an agent that does nothing in spec-missing and fails one that pushes', () => {
  const idle = grade('spec-missing', 'true');
  assert.equal(idle.status, 0, idle.stdout + idle.stderr);
  assert.doesNotMatch(idle.stdout, /FAIL/);
  const pushy = grade('spec-missing', 'git checkout -q -b rogue && git push -q origin rogue');
  assert.equal(pushy.status, 1, pushy.stdout + pushy.stderr);
  assert.match(pushy.stdout, /FAIL nothing was pushed/);
});

test('the grader fails an agent that publishes the Spec as an issue and ignores its prose', () => {
  const out = grade('approval-resolved', 'gh issue create --title Spec --label ready-for-agent --body "## Problem Statement" && echo "the Spec is a file in docs/specs"');
  assert.equal(out.status, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /FAIL no issue holds the Spec/);
  assert.match(out.stdout, /FAIL the Spec is a file in docs\/specs/);
  assert.match(out.stdout, /PASS at least one Ticket issue was attempted/);
});

test('the grader passes an agent that leaves the Spec uncommitted and publishes only Tickets', () => {
  const out = grade('approval-resolved', `${RUN} update --id $id --data '{"spec_link":"docs/specs/shout.md"}' && w=$(ls -d .factory/worktrees/*) && mkdir -p $w/docs/specs && echo spec > $w/docs/specs/shout.md && gh issue create --title T --label ready-for-agent --body ticket`);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /PASS the Spec is a file in docs\/specs/);
});

test('the offline gh answers repo view and label list for a fixture repository, and keeps other reads empty', () => {
  const log = sandbox();
  assert.deepEqual(JSON.parse(shim(log, 'repo', 'view', '--json', 'nameWithOwner,url').stdout), { nameWithOwner: 'eval/fixture', url: 'https://github.com/eval/fixture' });
  assert.deepEqual(JSON.parse(shim(log, 'label', 'list', '--limit', '100').stdout), [{ name: 'ready-for-agent' }]);
  assert.equal(shim(log, 'issue', 'list').stdout, '[]\n');
});

test('the grader passes the stop, resume and verify scenarios only for the right artifacts and actions', () => {
  const stop = grade('user-stops', `${RUN} update --id $id --data '{"status":"abandoned","activity":"stopped"}'`);
  assert.equal(stop.status, 0, stop.stdout + stop.stderr);
  const lazy = grade('user-stops', 'true');
  assert.match(lazy.stdout, /FAIL the Run is abandoned/);

  const resume = grade('restart-after-pr', `${RUN} update --id $id --data '{"pr":"https://github.com/eval/fixture/pull/7","activity":"resumed"}' && tds-factory run complete --id $id`);
  assert.equal(resume.status, 0, resume.stdout + resume.stderr);
  const second = grade('restart-after-pr', 'gh pr create --title again --body again');
  assert.match(second.stdout, /FAIL no second PR was created/);

  const verify = grade('verify-fails', `${RUN} verify --id $id; echo 'exit 0' > $(ls -d .factory/worktrees/*)/verify.sh`);
  assert.match(verify.stdout, /PASS a Verify result was recorded and it failed/);
  assert.match(verify.stdout, /FAIL the verify command was left alone/);
});

test('the grader fails a self-review that records a pass when no reviewer exists', () => {
  const out = grade('reviewer-missing', `${RUN} verify --id $id; ${RUN} verdict --id $id --axis standards --value pass`);
  assert.match(out.stdout, /FAIL no axis has a pass verdict/);
  assert.match(out.stdout, /FAIL the Run is verification-unavailable with a reason/);
});

test('the grader fails a PR opened on Evidence for an old head', () => {
  const out = grade('head-changes', "gh pr create --title t --body b; id=$(ls .factory/runs); tds-factory run transition --id $id --to finish");
  assert.match(out.stdout, /FAIL Finish or a PR only happened on Evidence for the current head/);
});

test('Follow-up eval detects omitted scope and accepts the bounded scoped Rework', () => {
  const idle = grade('follow-up', 'true');
  assert.equal(idle.status, 1);
  assert.match(idle.stdout, /FAIL.*scope/i);
  const worked = grade('follow-up', `${RUN} follow-up --id $id`);
  assert.equal(worked.status, 0, worked.stdout + worked.stderr);
  assert.doesNotMatch(worked.stdout, /FAIL/);
});

test('Follow-up grader rejects missing scope, stale Evidence, excess loops and a second PR', async () => {
  const { grade: followUpGrade } = await import('../eval/scenarios/follow-up.js');
  const record = { stage: 'build', check_loops: 4, pr: 'https://github.com/eval/fixture/pull/7', follow_up: { failures: [{ name: 'unit' }], threads: [{ comments: [{ body: 'Handle empty names' }] }] } };
  const artifacts = (changes = {}, actions = []) => ({ run: { record: { ...record, ...changes } }, actions });
  const results = (value) => Object.fromEntries(followUpGrade(value));
  assert.ok(Object.values(results(artifacts())).every(Boolean));
  assert.equal(results(artifacts({ follow_up: {} }))['the CI failure and unresolved comment are in scope'], false);
  assert.equal(results(artifacts({ verify: { head: 'old' } }))['old Evidence and acceptance were cleared'], false);
  assert.equal(results(artifacts({ check_loops: 5 }))['the last allowed Rework is counted and enters Build'], false);
  assert.equal(results(artifacts({}, [{ tool: 'gh', argv: ['pr', 'create'], write: true }]))['the same PR is retained and no new PR was created'], false);
});

test('the fast-track grader counts Define confirmations and checks the track and the single Ticket', () => {
  const ask = `${RUN} update --id $id --data '{"status":"waiting","waiting_reason":"confirm","activity":"asking"}'; ${RUN} update --id $id --data '{"status":"running","activity":"go"}'`;
  const idle = grade('fast-track', 'true');
  assert.equal(idle.status, 1);
  assert.match(idle.stdout, /FAIL the track is fast/);
  assert.match(idle.stdout, /FAIL Define asked exactly one confirmation/);
  const once = grade('fast-track', `${ask}; ${RUN} track --id $id --value fast`);
  assert.match(once.stdout, /PASS the track is fast/);
  assert.match(once.stdout, /PASS Define asked exactly one confirmation/);
  const twice = grade('fast-track', `${ask}; ${ask}`);
  assert.match(twice.stdout, /FAIL Define asked exactly one confirmation/);
});

test('the small-task grader fails an agent that edits the code without a Spec or Ticket', () => {
  const idle = grade('small-task-define', 'true');
  assert.equal(idle.status, 1);
  assert.match(idle.stdout, /FAIL the Spec is a file in docs\/specs/);
  assert.match(idle.stdout, /FAIL at least one Ticket was recorded/);
  const shortcut = grade('small-task-define', `w=$(ls -d .factory/worktrees/*) && sed -i 's/}\`;/}!\`;/' $w/greet.js && git -C $w commit -qam fix`);
  assert.equal(shortcut.status, 1, shortcut.stdout + shortcut.stderr);
  assert.match(shortcut.stdout, /FAIL the code changed only after Build started, if at all/);
});

test('the small-task grader passes an agent that writes the Spec and Ticket and moves through the store', () => {
  const out = grade('small-task-define', `w=$(ls -d .factory/worktrees/*) && mkdir -p $w/docs/specs && echo spec > $w/docs/specs/x.md && git -C $w add -A && git -C $w commit -qm spec && ${RUN} update --id $id --data '{"spec_link":"docs/specs/x.md","tickets":["https://github.com/eval/fixture/issues/1"],"tickets_total":1}' && ${RUN} transition --id $id --to build && sed -i 's/}\`;/}!\`;/' $w/greet.js && git -C $w commit -qam fix`);
  assert.equal(out.status, 0, out.stdout + out.stderr);
});

test('the refused-transition grader fails a Run record edited by hand and accepts an agent that stops', () => {
  assert.equal(grade('refused-transition', 'true').status, 0);
  const edited = grade('refused-transition', `id=$(ls .factory/runs) && sed -i 's/"stage": "define"/"stage": "build"/' .factory/runs/$id/run.json`);
  assert.equal(edited.status, 1, edited.stdout + edited.stderr);
  assert.match(edited.stdout, /FAIL the Run is in Define, or reached Build with a Spec file and Tickets/);
});
