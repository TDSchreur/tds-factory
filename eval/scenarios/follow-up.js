import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runAt } from '../lib/fixture.js';
import { ghWrites } from '../lib/artifacts.js';

export const name = 'follow-up';
export const description = 'A published PR has a failing check and an unresolved review thread at the last available Rework.';
const PR = 'https://github.com/eval/fixture/pull/7';
const page = (nodes) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });

export function setup(fx) {
  const { id, wt } = runAt(fx, 'check');
  for (let i = 0; i < 3; i++) {
    fx.factory('run', 'rework', '--id', id);
    fx.factory('run', 'transition', '--id', id, '--to', 'check');
  }
  fx.factory('run', 'verify', '--id', id);
  for (const [axis, value] of [['standards', 'pass'], ['spec', 'pass'], ['security', 'pass'], ['infrastructure', 'skipped']]) fx.factory('run', 'verdict', '--id', id, '--axis', axis, '--value', value);
  fx.factory('run', 'transition', '--id', id, '--to', 'finish');
  execFileSync('git', ['push', '-q', 'origin', id], { cwd: wt });
  fx.factory('run', 'update', '--id', id, '--data', JSON.stringify({ pr: PR, activity: 'published' }));
  fx.factory('run', 'complete', '--id', id);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: wt, encoding: 'utf8' }).trim();
  const state = { 'pr view': { state: 'OPEN', headRefOid: head },
    'graphql Checks': { '': { data: { repository: { pullRequest: { headRefOid: head, commits: { nodes: [{ commit: { statusCheckRollup: { contexts: page([{ __typename: 'CheckRun', name: 'unit', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://github.com/eval/fixture/actions/1' }]) } } }] } } } } } },
    'graphql Threads': { '': { data: { repository: { pullRequest: { headRefOid: head, reviewThreads: page([{ id: 'T1', isResolved: false, path: 'greet.js', comments: page([{ body: 'Handle empty names', url: `${PR}#discussion_r1` }]) }]) } } } } } };
  writeFileSync(fx.env.EVAL_GH_STATE, JSON.stringify(state));
  return { prompt: `Use Follow-up on Factory Run ${id}, then stop once the scoped Rework has started. Do not open a new PR.` };
}

export const grade = (a) => {
  const r = a.run.record, scope = r.follow_up;
  return [
    ['the CI failure and unresolved comment are in scope', Boolean(scope?.failures?.some((c) => c.name === 'unit') && scope?.threads?.some((t) => t.comments.some((c) => c.body === 'Handle empty names')))],
    ['the last allowed Rework is counted and enters Build', r.stage === 'build' && r.check_loops === 4],
    ['old Evidence and acceptance were cleared', ['verify', 'reviewed', 'standards', 'spec', 'security', 'infrastructure', 'project_results', 'accepted'].every((key) => !(key in r))],
    ['the same PR is retained and no new PR was created', r.pr === PR && ghWrites(a, 'pr', 'create').length === 0],
  ];
};
