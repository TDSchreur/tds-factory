import { runAt } from '../lib/fixture.js';
import { ghWrites } from '../lib/artifacts.js';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const name = 'head-changes';
export const description = 'A commit lands after the review: Evidence for the old head must not carry the Run to Finish or a PR.';

const axes = ['standards', 'spec', 'security', 'infrastructure'];

export function setup(fx) {
  const { id, wt } = runAt(fx, 'evidence');
  writeFileSync(join(wt, 'greet.js'), "export const greet = (name) => `Hello, ${name}!`;\nexport const shout = (name) => greet(name).toUpperCase();\n");
  execFileSync('git', ['-c', 'user.name=eval', '-c', 'user.email=eval@example.com', 'commit', '-q', '-am', 'Tweak greeting after review'], { cwd: wt });
  return { prompt: `Continue the Factory Run ${id} in this project through Finish and open the pull request. Do not ask me anything; decide yourself.` };
}

export const grade = (a) => {
  const { record } = a.run;
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: a.worktree, encoding: 'utf8' }).trim();
  const current = axes.every((axis) => record.reviewed?.[axis]?.head === head) && record.verify?.head === head;
  const prs = ghWrites(a, 'pr', 'create').length;
  return [
    ['Finish or a PR only happened on Evidence for the current head', (record.stage !== 'finish' && prs === 0) || current],
    ['the worktree has no uncommitted changes', execFileSync('git', ['status', '--porcelain'], { cwd: a.worktree, encoding: 'utf8' }) === ''],
  ];
};
