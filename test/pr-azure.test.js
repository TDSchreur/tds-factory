import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  launch,
  matches,
  name,
  parseStatus,
  repoOfRemote,
  stateAsync,
  statusAsync,
  view,
  viewAsync,
} from '../src/pr-azure.js';

// Recorded `az repos pr show` and `az repos pr policy list` output from the sandbox repository Kahoot (see the README of the fixtures folder).
const DIR = new URL('./fixtures/pr-status/azure/', import.meta.url);
/** @param {string} key */
const fixture = (key) => ({
  pr: JSON.parse(readFileSync(new URL(`${key}.pr.json`, DIR), 'utf8')),
  policies: JSON.parse(readFileSync(new URL(`${key}.policies.json`, DIR), 'utf8')),
});
/** @param {string} key */
const status = (key) => {
  const { pr, policies } = fixture(key);
  return parseStatus(pr, policies);
};
/** @param {string} key */
const link = (key) =>
  `https://dev.azure.com/example-org/Projects/_git/Kahoot/pullrequest/${fixture(key).pr.pullRequestId}`;
// An error from the adapter with this code, and optionally a message that matches.
/**
 * @param {string} code
 * @param {RegExp} [message]
 * @returns {(err: unknown) => boolean}
 */
const failsWith = (code, message) => (err) =>
  err instanceof Error && 'code' in err && err.code === code && (message?.test(err.message) ?? true);
// A stand-in for the `az` command that answers from the fixtures.
/**
 * @param {string} key
 * @param {{ pr?: Record<string, unknown>, policies?: unknown }} [overrides]
 */
const az =
  (key, { pr = {}, policies } = {}) =>
  /** @param {string[]} args */
  async (args) => {
    const f = fixture(key);
    if (args[2] === 'show') return { stdout: JSON.stringify({ ...f.pr, ...pr }) };
    if (args[2] === 'policy') return { stdout: JSON.stringify(policies ?? f.policies) };
    throw new Error('unexpected ' + args.join(' '));
  };

test('the recorded pull requests parse to the common status shape', () => {
  assert.deepEqual(status('passing'), {
    state: 'open',
    draft: false,
    checks: { result: 'passing', failing: [] },
    merge: 'mergeable',
    review: 'none',
  });
  assert.deepEqual(status('conflicts'), {
    state: 'open',
    draft: false,
    checks: { result: 'none', failing: [] },
    merge: 'conflicting',
    review: 'none',
  });
  assert.equal(status('draft').draft, true);
  assert.equal(status('completed').state, 'merged');
  assert.deepEqual([status('abandoned').state, status('abandoned').merge], ['closed', 'unknown']);
});

test('a policy that waits for reviewers is a review matter, not a check, and the creator vote does not satisfy it', () => {
  assert.deepEqual(status('review-required'), {
    state: 'open',
    draft: false,
    checks: { result: 'none', failing: [] },
    merge: 'mergeable',
    review: 'required',
  });
});

test('a rejected blocking policy is a failing check named by its policy', () => {
  assert.deepEqual(status('failing-policy').checks, { result: 'failing', failing: ['Comment requirements'] });
  const review = fixture('review-required');
  review.policies[0].status = 'rejected';
  assert.deepEqual(
    parseStatus(review.pr, review.policies).checks,
    { result: 'none', failing: [] },
    'a review policy is not a check',
  );
  const { pr, policies } = fixture('passing');
  policies[0].status = 'rejected';
  assert.deepEqual(parseStatus(pr, policies).checks, { result: 'failing', failing: ['Comment requirements'] });
  policies[0].status = 'running';
  assert.equal(parseStatus(pr, policies).checks.result, 'pending');
  policies[0].status = 'broken';
  assert.equal(parseStatus(pr, policies).checks.result, 'failing');
  policies[0].status = 'notApplicable';
  assert.equal(parseStatus(pr, policies).checks.result, 'none');
  policies[0].status = 'rejected';
  policies[0].configuration.isBlocking = false;
  assert.equal(parseStatus(pr, policies).checks.result, 'none', 'a policy that does not block is not a check');
  policies[0].configuration.isBlocking = true;
  policies[0].configuration.settings.displayName = 'Build validation';
  assert.deepEqual(
    parseStatus(pr, policies).checks.failing,
    ['Build validation'],
    'a build policy is named by its display name',
  );
});

test('the merge strategy policy is a completion setting, not a check', () => {
  // Recorded: Azure DevOps rejects it until an allowed merge strategy is chosen, which happens when the PR completes.
  assert.deepEqual(status('merge-strategy').checks, { result: 'none', failing: [] });
  const { policies } = fixture('passing');
  const { pr, policies: strategy } = fixture('merge-strategy');
  strategy[0].configuration.type.displayName = 'Zusammenführungsstrategie erforderlich';
  assert.deepEqual(
    parseStatus(pr, [...policies, ...strategy]).checks,
    { result: 'passing', failing: [] },
    'matched by its type id, not by its localised name',
  );
});

test('reviewer votes: rejected or waiting for the author asks for changes, approvals approve', () => {
  const { pr, policies } = fixture('passing');
  /**
   * @param {number} n
   * @param {Record<string, unknown>} [extra]
   */
  const vote = (n, extra = {}) => parseStatus({ ...pr, reviewers: [{ vote: n, ...extra }] }, policies).review;
  assert.equal(vote(10), 'approved');
  assert.equal(vote(5), 'approved');
  assert.equal(vote(0), 'none');
  assert.equal(vote(-5), 'changes-requested');
  assert.equal(vote(-10), 'changes-requested');
  assert.equal(vote(0, { isRequired: true }), 'required');
  assert.equal(
    parseStatus({ ...pr, reviewers: [{ vote: 10 }, { vote: -10 }] }, policies).review,
    'changes-requested',
    'a rejection wins',
  );
});

test('malformed answers throw', () => {
  const { pr, policies } = fixture('passing');
  for (const bad of [null, [], 'x', {}, { ...pr, status: 'weird' }, { ...pr, reviewers: 'x' }])
    assert.throws(() => parseStatus(bad, policies), /incomplete Azure DevOps PR status/);
  for (const bad of [
    null,
    {},
    [null],
    [{ status: 'approved' }],
    [{ status: 'weird', configuration: { isBlocking: true, type: { displayName: 'x' } } }],
  ])
    assert.throws(() => parseStatus(pr, bad), /incomplete Azure DevOps PR status/);
});

test('only a pull request link of dev.azure.com is an Azure DevOps link', () => {
  assert.equal(name, 'azure-devops');
  for (const url of [
    'https://dev.azure.com/o/p/_git/r/pullrequest/12',
    'https://dev.azure.com/my-org/My%20Project/_git/My%20Repo/pullrequest/1',
    'https://dev.azure.com/o.x/p/_git/r.y/pullrequest/999999',
  ])
    assert.equal(matches(url), true, url);
  for (const url of [
    'https://dev.azure.com/o/p/_git/r/pullrequest/0',
    'https://dev.azure.com/o/p/_git/r/pullrequest/01',
    'https://dev.azure.com/o/p/_git/r/pullrequest/1e3',
    'https://dev.azure.com/o/p/_git/r/pullrequest/12?x=1',
    'https://dev.azure.com/o/p/_git/r/pullrequest/12#c',
    'https://dev.azure.com/o/p/_git/r/pullrequest/12/',
    'http://dev.azure.com/o/p/_git/r/pullrequest/12',
    'https://dev.azure.com@evil.test/o/p/_git/r/pullrequest/1',
    'https://evil.test/dev.azure.com/o/p/_git/r/pullrequest/1',
    'https://o.visualstudio.com/p/_git/r/pullrequest/1',
    'https://dev.azure.com/o/p/_git/r/pullrequest/1\n',
    'https://dev.azure.com/o/p%2Fq/_git/r/pullrequest/1',
    'https://dev.azure.com/o/p/_git/r%00/pullrequest/1',
    'https://dev.azure.com/-x/p/_git/r/pullrequest/1',
    'https://dev.azure.com/o/p/_git/r/pullrequest/' + '9'.repeat(20),
    'https://github.com/o/r/pull/1',
    '',
    undefined,
    null,
    7,
  ])
    assert.equal(matches(url), false, String(url));
  assert.equal(matches('https://dev.azure.com/' + 'a'.repeat(100000) + '/p/_git/r/pullrequest/1'), false);
});

test('a git remote of Azure DevOps resolves to organisation and project, and repository', () => {
  for (const remote of [
    'https://dev.azure.com/o/p/_git/r',
    'https://user@dev.azure.com/o/p/_git/r',
    'git@ssh.dev.azure.com:v3/o/p/r',
    'ssh://git@ssh.dev.azure.com/v3/o/p/r',
  ])
    assert.deepEqual(repoOfRemote(remote), { owner: 'o/p', name: 'r' }, remote);
  assert.deepEqual(repoOfRemote('https://dev.azure.com/o/My%20Project/_git/My%20Repo'), {
    owner: 'o/My Project',
    name: 'My Repo',
  });
  for (const remote of [
    '',
    'https://github.com/o/r',
    'https://dev.azure.com/o',
    'https://dev.azure.com/o/p/_git',
    'git@ssh.dev.azure.com:v3/o/p',
    'https://evil.test/dev.azure.com/o/p/_git/r',
    'file:///tmp/r',
  ])
    assert.equal(repoOfRemote(remote), undefined, remote);
});

test('statusAsync asks az for the pull request and its policies, read-only, and parses the answers', async () => {
  /** @type {string[][]} */
  const calls = [];
  /** @param {string[]} args */
  const run = async (args) => {
    calls.push(args);
    return az('passing')(args);
  };
  assert.equal((await statusAsync(link('passing'), { run })).state, 'open');
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((c) => c.slice(0, 3)),
    [
      ['repos', 'pr', 'show'],
      ['repos', 'pr', 'policy'],
    ],
  );
  for (const call of calls) {
    assert.ok(
      call.includes('--organization') &&
        call[call.indexOf('--organization') + 1] === 'https://dev.azure.com/example-org',
    );
    assert.equal(call[call.indexOf('--id') + 1], '525');
    assert.ok(call.includes('--only-show-errors'));
  }
});

test('a link that points at another repository than the pull request is refused', async () => {
  await assert.rejects(
    statusAsync('https://dev.azure.com/example-org/Projects/_git/Other/pullrequest/525', { run: az('passing') }),
    failsWith('error', /does not belong/),
  );
  await assert.rejects(
    statusAsync('https://dev.azure.com/example-org/Elsewhere/_git/Kahoot/pullrequest/525', { run: az('passing') }),
    failsWith('error'),
  );
  assert.equal(
    (
      await statusAsync('https://dev.azure.com/example-org/projects/_git/kahoot/pullrequest/525', {
        run: az('passing'),
      })
    ).state,
    'open',
    'names compare case-insensitively',
  );
});

test('failures carry a code that names what to fix', async () => {
  /** @param {unknown} err */
  const fail = (err) => async () => {
    throw err;
  };
  /** @param {unknown} err */
  const reason = async (err) => {
    try {
      await statusAsync(link('passing'), { run: fail(err) });
    } catch (e) {
      return e instanceof Error && 'code' in e ? e.code : undefined;
    }
  };
  assert.equal(await reason(Object.assign(new Error('x'), { code: 'ENOENT' })), 'az-missing');
  assert.equal(
    await reason(
      Object.assign(new Error('x'), {
        code: 9009,
        stderr: "'az.cmd' is not recognized as an internal or external command,\r\noperable program or batch file.",
      }),
    ),
    'az-missing',
  );
  // A Windows with another language gives no English text, only the exit code of cmd.exe.
  assert.equal(
    await reason(Object.assign(new Error('x'), { code: 9009, stderr: 'wordt niet herkend als een interne opdracht' })),
    'az-missing',
  );
  assert.equal(await reason(Object.assign(new Error('x'), { code: 'EINVAL' })), 'error');
  assert.equal(
    await reason(
      Object.assign(new Error('x'), { stderr: "ERROR: 'repos' is misspelled or not recognized by the system." }),
    ),
    'az-extension-missing',
  );
  assert.equal(
    await reason(Object.assign(new Error('x'), { stderr: "ERROR: Please run 'az login' to setup account." })),
    'az-not-signed-in',
  );
  assert.equal(
    await reason(
      Object.assign(new Error('x'), { stderr: 'TF400813: The user is not authorized to access this resource.' }),
    ),
    'az-not-signed-in',
  );
  assert.equal(
    await reason(Object.assign(new Error('x'), { stderr: 'ERROR: AADSTS70043: The refresh token has expired' })),
    'az-not-signed-in',
  );
  assert.equal(
    await reason(
      Object.assign(new Error('x'), { stderr: 'TF400733: The request has been canceled: rate limit exceeded (429)' }),
    ),
    'rate-limited',
  );
  assert.equal(await reason(Object.assign(new Error('x'), { stderr: 'something else' })), 'error');
  await assert.rejects(statusAsync(link('passing'), { run: async () => ({ stdout: 'not json' }) }), failsWith('error'));
  await assert.rejects(statusAsync('https://github.com/o/r/pull/1', { run: az('passing') }), failsWith('error'));
});

test('stateAsync and view give the state the callers use and the head commit', async () => {
  assert.equal(await stateAsync(link('completed'), { run: az('completed') }), 'MERGED');
  assert.equal(await stateAsync(link('abandoned'), { run: az('abandoned') }), 'CLOSED');
  assert.equal(await stateAsync(link('passing'), { run: az('passing') }), 'OPEN');
  /** @type {string[][]} */
  const calls = [];
  const out = view(link('passing'), {
    run: (args) => {
      calls.push(args);
      return { status: 0, stdout: JSON.stringify(fixture('passing').pr), stderr: '' };
    },
  });
  assert.deepEqual(out, { state: 'OPEN', headRefOid: fixture('passing').pr.lastMergeSourceCommit.commitId });
  assert.deepEqual(calls[0].slice(0, 3), ['repos', 'pr', 'show']);
  assert.throws(() => view(link('passing'), { run: () => ({ status: 1, stdout: '', stderr: 'boom' }) }), /boom/);
});

test('only the Azure DevOps adapter runs az, and it runs no write subcommand', () => {
  const callers = readdirSync('src').filter((file) =>
    /exec\('az'|execFile\('az'|spawnSync\('az'|'az',\s*(?:\[|argv)|az\.cmd/.test(
      readFileSync(join('src', file), 'utf8'),
    ),
  );
  assert.deepEqual(callers, ['pr-azure.js']);
  const source = readFileSync('src/pr-azure.js', 'utf8');
  assert.doesNotMatch(
    source,
    /'(create|update|complete|delete|set-vote|abandon|reactivate|policy-create|set|add|remove)'/,
  );
  assert.doesNotMatch(source, /Aanvragen|develop/i);
  assert.equal(source.match(/'(show|list)'/g)?.length, 2);
});

test('launch starts az through cmd.exe on Windows and directly elsewhere', () => {
  const argv = [
    'repos',
    'pr',
    'show',
    '--id',
    '525',
    '--organization',
    'https://dev.azure.com/example-org',
    '--output',
    'json',
    '--only-show-errors',
  ];
  const [file, args, options] = launch(argv, 'win32');
  assert.equal(file, process.env.ComSpec || 'cmd.exe');
  assert.deepEqual(args, ['/d', '/s', '/c', `az.cmd ${argv.join(' ')}`]);
  assert.equal(options.windowsVerbatimArguments, true);
  assert.equal(options.env.NoDefaultCurrentDirectoryInExePath, '1');
  assert.equal(options.env.AZURE_CORE_NO_COLOR, '1');
  assert.equal(options.env.AZURE_CORE_COLLECT_TELEMETRY, 'false');

  const [direct, directArgs, directOptions] = launch(argv, 'linux');
  assert.equal(direct, 'az');
  assert.deepEqual(directArgs, argv);
  assert.equal(directOptions.windowsVerbatimArguments, false);
  assert.equal(directOptions.env.NoDefaultCurrentDirectoryInExePath, process.env.NoDefaultCurrentDirectoryInExePath);
});

test('launch refuses an argument cmd.exe could read as more than a word', () => {
  for (const arg of ['a&whoami', 'a b', 'a"b', '%PATH%', 'a^b', 'a|b', 'a>b', ''])
    assert.throws(() => launch(['show', arg], 'win32'), /unsafe argument/);
  assert.doesNotThrow(() => launch(['show', 'a&whoami'], 'linux'));
});

test('a link with shell characters never reaches the runner', async () => {
  /** @returns {never} */
  const fail = () => assert.fail('the runner must not be called');
  await assert.rejects(
    statusAsync('https://dev.azure.com/o&whoami/p/_git/r/pullrequest/1', { run: async () => fail() }),
  );
  assert.throws(() => view('https://dev.azure.com/o/p/_git/r/pullrequest/1&whoami', { run: fail }));
});

test('no source or test file names the production repository', () => {
  const files = [
    ...readdirSync('src').map((f) => join('src', f)),
    ...readdirSync('test')
      .filter((f) => f.endsWith('.js'))
      .map((f) => join('test', f)),
  ];
  const named = files.filter((f) => /Aanvragen[ -]?App/i.test(readFileSync(f, 'utf8')));
  assert.deepEqual(named, []);
});

test('a status that is a prototype key is not a state', () => {
  const { pr, policies } = fixture('passing');
  for (const value of ['constructor', '__proto__', 'toString'])
    assert.throws(() => parseStatus({ ...pr, status: value }, policies), /incomplete Azure DevOps PR status/, value);
  assert.equal(parseStatus({ ...pr, mergeStatus: 'constructor' }, policies).merge, 'unknown');
  assert.throws(
    () =>
      view(link('passing'), {
        run: () => ({ status: 0, stdout: JSON.stringify({ ...pr, status: 'constructor' }), stderr: '' }),
      }),
    /incomplete Azure DevOps PR state/,
  );
});

test('viewAsync gives the same state and head as view, from the injected run', async () => {
  const wanted = { state: 'OPEN', headRefOid: fixture('passing').pr.lastMergeSourceCommit.commitId };
  assert.deepEqual(await viewAsync(link('passing'), { run: az('passing') }), wanted);
  assert.equal((await viewAsync(link('completed'), { run: az('completed') })).state, 'MERGED');
  await assert.rejects(viewAsync('https://github.com/o/r/pull/1', { run: az('passing') }), /not an Azure DevOps/);
  await assert.rejects(viewAsync(link('passing'), { run: az('passing', { pr: { status: 'weird' } }) }), /incomplete/);
});
