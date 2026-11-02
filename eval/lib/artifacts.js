import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readActions } from './gh.js';

/** @typedef {import('./fixture.js').Fixture} Fixture */
/** @typedef {import('./gh.js').Action} Action */
/** @typedef {{ id: string, record: import('../../src/run-record.js').Run, files: string[] }} RunEntry */

/**
 * @param {string} cwd
 * @param {...string} args
 */
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/**
 * @typedef {object} Artifacts
 * @property {RunEntry[]} runs
 * @property {RunEntry} run The first Run, which every scenario starts.
 * @property {string} worktree
 * @property {string[]} specs
 * @property {string[]} commits
 * @property {string[]} changed
 * @property {Action[]} actions
 */

// Everything a scenario grades: the Run records, files, commits and recorded actions. Never the agent's reply.
/**
 * @param {Fixture} fx
 * @returns {Artifacts}
 */
export function collect(fx) {
  const runsDir = join(fx.dir, '.factory', 'runs');
  const runs = existsSync(runsDir)
    ? readdirSync(runsDir).map((id) => ({
        id,
        record: JSON.parse(readFileSync(join(runsDir, id, 'run.json'), 'utf8')),
        files: readdirSync(join(runsDir, id)),
      }))
    : [];
  const run = runs[0];
  const tree = run?.record.worktree && existsSync(run.record.worktree) ? run.record.worktree : fx.dir;
  const base = run?.record.base_sha;
  return {
    runs,
    run,
    worktree: tree,
    specs: existsSync(join(tree, 'docs', 'specs')) ? readdirSync(join(tree, 'docs', 'specs')) : [],
    commits: base ? git(tree, 'log', '--format=%s', `${base}..HEAD`).split('\n').filter(Boolean) : [],
    changed: base ? git(tree, 'diff', '--name-only', base).split('\n').filter(Boolean) : [],
    actions: readActions(fx.actionLog),
  };
}

/** @param {Artifacts} a @param {string} noun @param {string} verb */
export const ghWrites = (a, noun, verb) =>
  a.actions.filter((x) => x.tool === 'gh' && x.argv[0] === noun && x.argv[1] === verb);
/** @param {Artifacts} a */
export const pushes = (a) => a.actions.filter((x) => x.tool === 'git' && x.argv[0] === 'push');
