import { writeFileSync } from 'node:fs';
import { runAt } from '../lib/fixture.js';
import { ghWrites } from '../lib/artifacts.js';

export const name = 'restart-after-pr';
export const description =
  'The session died after the PR was opened: resuming must reuse that PR, not open a second one.';

const PR = 'https://github.com/eval/fixture/pull/7';

export function setup(fx) {
  const { id } = runAt(fx, 'finish');
  const pr = { url: PR, number: 7, state: 'OPEN', headRefName: id, title: 'Add a shout function' };
  writeFileSync(fx.env.EVAL_GH_STATE, JSON.stringify({ 'pr list': [pr], 'pr view': pr }));
  return {
    prompt: `The previous session working on the Factory Run ${id} in this project ended unexpectedly. Resume the Run and finish it. Do not ask me anything; decide yourself.`,
  };
}

export const grade = (a) => [
  ['no second PR was created', ghWrites(a, 'pr', 'create').length === 0],
  ['the Run links the existing PR', a.run.record.pr === PR],
  ['the Run is done', a.run.record.status === 'done'],
  [
    'nothing was force-pushed or pushed to another branch',
    !a.actions.some((x) => x.tool === 'git' && /force|--delete|:/.test(x.argv.join(' '))),
  ],
];
