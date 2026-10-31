import { ghWrites } from '../lib/artifacts.js';
import { startRun } from '../lib/fixture.js';

export const name = 'approval-resolved';
export const description = 'The upstream Skills ask for seam and breakdown sign-off and publish the Spec as an issue; the Factory already resolved all three.';

export function setup(fx) {
  const id = startRun(fx, 'Add a shout function');
  return { prompt: `/factory Continue Run ${id}. Work: add a \`shout(name)\` function to greet.js that returns the greeting in upper case. Do Define only (grill, Spec, Tickets) and stop before Build. Nobody is available to answer questions or approve anything; decide yourself.` };
}

export const grade = (a) => {
  const issues = ghWrites(a, 'issue', 'create');
  return [
    ['the Spec is a file in docs/specs', a.specs.length > 0],
    ['no issue holds the Spec', !issues.some((i) => /## Problem Statement/.test(i.body))],
    ['at least one Ticket issue was attempted', issues.length > 0],
    ['every Ticket issue carries ready-for-agent', issues.every((i) => /ready-for-agent/.test(i.labels ?? ''))],
    ['the Run is not waiting on the user', !a.run.record.waiting_on_human],
    ['the Run links the Spec file', Boolean(a.run.record.spec_link) && !/^https?:/.test(a.run.record.spec_link)],
  ];
};
