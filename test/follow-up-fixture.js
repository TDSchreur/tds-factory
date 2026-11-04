import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cliWith } from './cli-runner.js';
import { repo, git } from './git-repo.js';
import { envWith, fakeCommand } from './fake-command.js';

/** @import { Run } from '../src/run-record.js' */

// A finished Run with a worktree at its PR head and a fake `gh` that answers from gh.json; shared by the Follow-up and Fix tests.
/**
 * @param {unknown[]} nodes
 * @param {boolean} [next]
 * @param {string | null} [cursor]
 */
export const page = (nodes, next = false, cursor = null) => ({
  nodes,
  pageInfo: { hasNextPage: next, endCursor: cursor },
});
/**
 * @param {string} cwd
 * @param {...string} args
 */
export const run = (cwd, ...args) =>
  cliWith({ env: envWith(join(cwd, 'fake-bin'), { FAKE_GH: join(cwd, 'gh.json') }) }, cwd, 'run', ...args);
export async function fixture() {
  const cwd = repo();
  mkdirSync(join(cwd, 'fake-bin'));
  fakeCommand(
    join(cwd, 'fake-bin'),
    'gh',
    `const fs = require('fs');\nconst s = JSON.parse(fs.readFileSync(process.env.FAKE_GH));\nconst args = process.argv.slice(2);\nfs.appendFileSync(process.env.FAKE_GH + '.log', JSON.stringify(args) + '\\n');\nif (s.error) { process.exit(1); }\nif (args[0] === 'pr') console.log(JSON.stringify(s.pr));\nelse { const q = args.find(x => x.startsWith('query=')) || ''; const key = q.includes('FollowUpChecks') ? 'checks' : q.includes('FollowUpThreads') ? 'threads' : 'comments'; const cursor = (args.find(x => x.startsWith('cursor=')) || 'cursor=').slice(7); const id = (args.find(x => x.startsWith('thread=')) || 'thread=').slice(7); console.log(JSON.stringify((s[key][id ? id + ':' + cursor : cursor]))); }\n`,
  );
  const out = await run(
    cwd,
    'start',
    '--data',
    JSON.stringify({ title: 'PR follow up', agent: 'codex', commands: 'true', conventions: [] }),
  );
  assert.equal(out.status, 0, out.stderr);
  const id = out.stdout.trim(),
    file = join(cwd, '.factory', 'runs', id, 'run.json');
  const record = JSON.parse(readFileSync(file, 'utf8'));
  const head = git(record.worktree, 'rev-parse', 'HEAD');
  const pr = 'https://github.com/o/r/pull/7';
  Object.assign(record, {
    stage: 'finish',
    status: 'done',
    pr,
    tickets_total: 1,
    tickets_done: 1,
    standards: 'pass',
    spec: 'pass',
    security: 'pass',
    infrastructure: 'skipped',
    verify: { head },
    reviewed: { standards: { head, attempt: 1 } },
    accepted: { head },
    project_results: { accessibility: { head } },
  });
  writeFileSync(file, JSON.stringify(record));
  // The fake GitHub answers: free-form JSON, so any, because each test edits it at the path it needs.
  /** @type {Record<string, any>} */
  const state = {
    pr: { state: 'OPEN', headRefOid: head },
    checks: {
      '': {
        data: {
          repository: {
            pullRequest: {
              headRefOid: head,
              mergeable: 'MERGEABLE',
              commits: {
                nodes: [
                  {
                    commit: {
                      statusCheckRollup: {
                        contexts: page([
                          {
                            __typename: 'CheckRun',
                            name: 'unit',
                            status: 'COMPLETED',
                            conclusion: 'FAILURE',
                            detailsUrl: 'https://github.com/o/r/actions/1',
                          },
                        ]),
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
    threads: {
      '': {
        data: {
          repository: {
            pullRequest: {
              headRefOid: head,
              reviewThreads: page([
                {
                  id: 'T1',
                  isResolved: false,
                  path: 'src/a.js',
                  comments: page([{ body: 'Fix this', url: 'https://github.com/o/r/pull/7#discussion_r1' }]),
                },
              ]),
            },
          },
        },
      },
    },
    comments: {},
  };
  const save = () => writeFileSync(join(cwd, 'gh.json'), JSON.stringify(state));
  /** @returns {Run} */
  const read = () => JSON.parse(readFileSync(file, 'utf8'));
  save();
  return { cwd, id, file, pr, head, state, save, read };
}
