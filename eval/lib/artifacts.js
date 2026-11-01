import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readActions } from './gh.js';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

// Everything a scenario grades: the Run records, files, commits and recorded actions. Never the agent's reply.
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

export const ghWrites = (a, noun, verb) =>
  a.actions.filter((x) => x.tool === 'gh' && x.argv[0] === noun && x.argv[1] === verb);
export const pushes = (a) => a.actions.filter((x) => x.tool === 'git' && x.argv[0] === 'push');
