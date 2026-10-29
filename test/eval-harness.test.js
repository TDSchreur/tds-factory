import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './eval-root.js';

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
