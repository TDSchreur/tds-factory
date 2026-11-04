import { describe, test as run } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT } from './eval-root.js';
import { fromJson } from './run-view.js';

// The eval harness drives agents through POSIX shell commands and a shell script for gh.
/**
 * @param {string} name
 * @param {import('node:test').TestFn} fn
 */
const test = (name, fn) =>
  run(name, { skip: process.platform === 'win32' && 'the eval harness needs a POSIX shell' }, fn);

const RUN = 'id=$(ls .factory/runs) && tds-factory run';
const gh = join(ROOT, 'eval', 'bin', 'gh');
const runner = join(ROOT, 'eval', 'run.js');
const sandbox = () => join(mkdtempSync(join(tmpdir(), 'eval-shim-')), 'actions.jsonl');

/**
 * @param {string} log
 * @param {...string} args
 */
const shim = (log, ...args) => spawnSync(gh, args, { env: { ...process.env, EVAL_ACTION_LOG: log }, encoding: 'utf8' });
/** @param {string} log */
const logged = (log) =>
  readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

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
/**
 * @param {string} scenario
 * @param {string} agentCommand
 */
const grade = async (scenario, agentCommand) => {
  // Each grading gets its own temporary folder (the fixture is made in it) and an own Factory config folder, so nothing is left in the temp directory and no project is added to the real Project registry.
  const scratch = mkdtempSync(join(tmpdir(), 'eval-grade-'));
  try {
    const child = spawn('node', [runner, 'copilot', scenario], {
      env: {
        ...process.env,
        TMPDIR: scratch,
        TMP: scratch,
        TEMP: scratch,
        TDS_FACTORY_CONFIG_DIR: join(scratch, 'factory-config'),
        EVAL_AGENT_CMD: agentCommand,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
    const status = await new Promise((resolve) => child.on('close', resolve));
    return { status, stdout, stderr };
  } finally {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};

// Every test grades in its own processes and folders, so they run side by side; the file takes as long as its slowest test.
describe('the eval harness', { concurrency: true }, () => {
  test('the grader passes an agent that does nothing in spec-missing and fails one that pushes', async () => {
    const [idle, pushy] = await Promise.all([
      grade('spec-missing', 'true'),
      grade('spec-missing', 'git checkout -q -b rogue && git push -q origin rogue'),
    ]);
    assert.equal(idle.status, 0, idle.stdout + idle.stderr);
    assert.doesNotMatch(idle.stdout, /FAIL/);
    assert.equal(pushy.status, 1, pushy.stdout + pushy.stderr);
    assert.match(pushy.stdout, /FAIL nothing was pushed/);
  });

  test('the grader fails an agent that publishes the Spec as an issue and ignores its prose', async () => {
    const out = await grade(
      'approval-resolved',
      'gh issue create --title Spec --label ready-for-agent --body "## Problem Statement" && echo "the Spec is a file in docs/specs"',
    );
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stdout, /FAIL no issue holds the Spec/);
    assert.match(out.stdout, /FAIL the Spec is a file in docs\/specs/);
    assert.match(out.stdout, /PASS at least one Ticket issue was attempted/);
  });

  test('the grader passes an agent that leaves the Spec uncommitted and publishes only Tickets', async () => {
    const out = await grade(
      'approval-resolved',
      `${RUN} update --id $id --data '{"spec_link":"docs/specs/shout.md"}' && w=$(ls -d .factory/worktrees/*) && mkdir -p $w/docs/specs && echo spec > $w/docs/specs/shout.md && gh issue create --title T --label ready-for-agent --body ticket`,
    );
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /PASS the Spec is a file in docs\/specs/);
  });

  test('the offline gh answers repo view and label list for a fixture repository, and keeps other reads empty', () => {
    const log = sandbox();
    assert.deepEqual(JSON.parse(shim(log, 'repo', 'view', '--json', 'nameWithOwner,url').stdout), {
      nameWithOwner: 'eval/fixture',
      url: 'https://github.com/eval/fixture',
    });
    assert.deepEqual(JSON.parse(shim(log, 'label', 'list', '--limit', '100').stdout), [{ name: 'ready-for-agent' }]);
    assert.equal(shim(log, 'issue', 'list').stdout, '[]\n');
  });

  test('the grader passes the stop, resume and verify scenarios only for the right artifacts and actions', async () => {
    const [stop, lazy, resume, second, verify] = await Promise.all([
      grade('user-stops', `${RUN} update --id $id --data '{"status":"abandoned","activity":"stopped"}'`),
      grade('user-stops', 'true'),
      grade(
        'restart-after-pr',
        `${RUN} update --id $id --data '{"pr":"https://github.com/eval/fixture/pull/7","activity":"resumed"}' && tds-factory run complete --id $id`,
      ),
      grade('restart-after-pr', 'gh pr create --title again --body again'),
      grade('verify-fails', `${RUN} verify --id $id; echo 'exit 0' > $(ls -d .factory/worktrees/*)/verify.sh`),
    ]);
    assert.equal(stop.status, 0, stop.stdout + stop.stderr);
    assert.match(lazy.stdout, /FAIL the Run is abandoned/);
    assert.equal(resume.status, 0, resume.stdout + resume.stderr);
    assert.match(second.stdout, /FAIL no second PR was created/);
    assert.match(verify.stdout, /PASS a Verify result was recorded and it failed/);
    assert.match(verify.stdout, /FAIL the verify command was left alone/);
  });

  test('the grader fails a self-review that records a pass when no reviewer exists', async () => {
    const out = await grade(
      'reviewer-missing',
      `${RUN} verify --id $id; ${RUN} verdict --id $id --axis standards --value pass`,
    );
    assert.match(out.stdout, /FAIL no axis has a pass verdict/);
    assert.match(out.stdout, /FAIL the Run is verification-unavailable with a reason/);
  });

  test('the grader fails a PR opened on Evidence for an old head', async () => {
    const out = await grade(
      'head-changes',
      'gh pr create --title t --body b; id=$(ls .factory/runs); tds-factory run transition --id $id --to finish',
    );
    assert.match(out.stdout, /FAIL Finish or a PR only happened on Evidence for the current head/);
  });

  test('Follow-up eval detects omitted scope and accepts the bounded scoped Rework', async () => {
    const [idle, worked] = await Promise.all([
      grade('follow-up', 'true'),
      grade('follow-up', `${RUN} follow-up --id $id --scope checks`),
    ]);
    assert.equal(idle.status, 1);
    assert.match(idle.stdout, /FAIL.*scope/i);
    assert.equal(worked.status, 0, worked.stdout + worked.stderr);
    assert.doesNotMatch(worked.stdout, /FAIL/);
  });

  test('Follow-up grader rejects missing scope, stale Evidence, excess loops and a second PR', async () => {
    const { grade: followUpGrade } = await import('../eval/scenarios/follow-up.js');
    const record = {
      stage: 'build',
      check_loops: 4,
      pr: 'https://github.com/eval/fixture/pull/7',
      follow_up: { failures: [{ name: 'unit' }], threads: [{ comments: [{ body: 'Handle empty names' }] }] },
    };
    /**
     * Artifacts as a scenario grader reads them; the changes may be of any shape, since the grader reads records from disk.
     * @param {Record<string, unknown>} [changes]
     * @param {unknown[]} [actions]
     */
    const artifacts = (changes = {}, actions = []) => fromJson({ run: { record: { ...record, ...changes } }, actions });
    /** @param {import('../eval/lib/artifacts.js').Artifacts} value */
    const results = (value) => Object.fromEntries(followUpGrade(value));
    assert.ok(Object.values(results(artifacts())).every(Boolean));
    assert.equal(results(artifacts({ follow_up: {} }))['the CI failure and unresolved comment are in scope'], false);
    assert.equal(results(artifacts({ verify: { head: 'old' } }))['old Evidence and acceptance were cleared'], false);
    assert.equal(results(artifacts({ check_loops: 5 }))['the last allowed Rework is counted and enters Build'], false);
    assert.equal(
      results(artifacts({}, [{ tool: 'gh', argv: ['pr', 'create'], write: true }]))[
        'the same PR is retained and no new PR was created'
      ],
      false,
    );
  });

  test('the fast-track grader counts Define confirmations and checks the track and the single Ticket', async () => {
    const ask = `${RUN} update --id $id --data '{"status":"waiting","waiting_reason":"confirm","activity":"asking"}'; ${RUN} update --id $id --data '{"status":"running","activity":"go"}'`;
    const [idle, once, twice] = await Promise.all([
      grade('fast-track', 'true'),
      grade('fast-track', `${ask}; ${RUN} track --id $id --value fast`),
      grade('fast-track', `${ask}; ${ask}`),
    ]);
    assert.equal(idle.status, 1);
    assert.match(idle.stdout, /FAIL the track is fast/);
    assert.match(idle.stdout, /FAIL Define asked exactly one confirmation/);
    assert.match(once.stdout, /PASS the track is fast/);
    assert.match(once.stdout, /PASS Define asked exactly one confirmation/);
    assert.match(twice.stdout, /FAIL Define asked exactly one confirmation/);
  });

  test('the small-task grader fails an agent that edits the code without a Spec or Ticket', async () => {
    const idle = await grade('small-task-define', 'true');
    assert.equal(idle.status, 1);
    assert.match(idle.stdout, /FAIL the Spec is a file in docs\/specs/);
    assert.match(idle.stdout, /FAIL at least one Ticket was recorded/);
    const shortcut = await grade(
      'small-task-define',
      `w=$(ls -d .factory/worktrees/*) && perl -pi -e 's/}\`;/}!\`;/' $w/greet.js && git -C $w -c user.name=e -c user.email=e@e commit -qam fix`,
    );
    assert.equal(shortcut.status, 1, shortcut.stdout + shortcut.stderr);
    assert.match(shortcut.stdout, /FAIL the code was committed only after Build started, if at all/);
  });

  test('the small-task grader passes an agent that writes the Spec and Ticket and moves through the store', async () => {
    const out = await grade(
      'small-task-define',
      `w=$(ls -d .factory/worktrees/*) && mkdir -p $w/docs/specs && echo spec > $w/docs/specs/x.md && git -C $w add -A && git -C $w -c user.name=e -c user.email=e@e commit -qm spec && ${RUN} update --id $id --data '{"spec_link":"docs/specs/x.md","tickets":["https://github.com/eval/fixture/issues/1"],"tickets_total":1}' && ${RUN} transition --id $id --to build && perl -pi -e 's/}\`;/}!\`;/' $w/greet.js && git -C $w -c user.name=e -c user.email=e@e commit -qam fix`,
    );
    assert.equal(out.status, 0, out.stdout + out.stderr);
  });

  test('the refused-transition grader fails a Run record edited by hand and accepts an agent that stops', async () => {
    const [stopped, edited] = await Promise.all([
      grade('refused-transition', 'true'),
      grade(
        'refused-transition',
        `id=$(ls .factory/runs) && perl -pi -e 's/"stage": "define"/"stage": "build"/' .factory/runs/$id/run.json`,
      ),
    ]);
    assert.equal(stopped.status, 0);
    assert.equal(edited.status, 1, edited.stdout + edited.stderr);
    assert.match(edited.stdout, /FAIL the Run is in Define, or reached Build with a Spec file and Tickets/);
  });

  test('the small-task grader fails code committed before Define was done, even when a Spec and Ticket follow', async () => {
    const out = await grade(
      'small-task-define',
      `w=$(ls -d .factory/worktrees/*) && perl -pi -e 's/}\`;/}!\`;/' $w/greet.js && git -C $w -c user.name=e -c user.email=e@e commit -qam fix && sleep 2 && mkdir -p $w/docs/specs && echo spec > $w/docs/specs/x.md && git -C $w add -A && git -C $w -c user.name=e -c user.email=e@e commit -qm spec && ${RUN} update --id $id --data '{"spec_link":"docs/specs/x.md","tickets":["https://github.com/eval/fixture/issues/1"],"tickets_total":1}' && ${RUN} transition --id $id --to build`,
    );
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stdout, /FAIL the code was committed only after Build started, if at all/);
  });

  test('every eval scenario is named after its file', async () => {
    const { readdirSync } = await import('node:fs');
    for (const file of readdirSync(join(ROOT, 'eval', 'scenarios'))) {
      const scenario = await import(`../eval/scenarios/${file}`);
      assert.equal(scenario.name, file.replace(/\.js$/, ''));
    }
  });
});
