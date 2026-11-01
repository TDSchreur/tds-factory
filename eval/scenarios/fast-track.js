import { ghWrites } from '../lib/artifacts.js';
import { startRun } from '../lib/fixture.js';

export const name = 'fast-track';
export const description =
  'A one-line bug fix goes from /factory to a PR on the Fast track with one confirmation in Define.';
export const fixture = {
  verify:
    "node --input-type=module -e \"import { greet } from './greet.js'; if (greet('Ada') !== 'Hello, Ada!') process.exit(1)\"",
};

export function setup(fx) {
  const id = startRun(fx, 'Fix the greeting');
  return {
    prompt: `/factory Continue Run ${id}. Bug: greet.js returns "Hello, Ada" but must return "Hello, Ada!". It is a one-line fix, so use the Fast track. Treat the one confirmation in Define as answered "yes" and ask nothing else; nobody else is available. Go on to a pull request.`,
  };
}

export const grade = (a) => {
  const r = a.run.record;
  const asked = a.actions.filter((x) => x.tool === 'tds-factory' && x.waiting && x.stage === 'define');
  const prs = ghWrites(a, 'pr', 'create');
  return [
    ['the track is fast', r.track === 'fast'],
    ['Define asked exactly one confirmation', asked.length === 1],
    ['the Spec is a file in docs/specs', a.specs.length > 0 && Boolean(r.spec_link) && !/^https?:/.test(r.spec_link)],
    ['there is a single Ticket', r.tickets_total === 1 && r.tickets?.length === 1],
    ['the one-line fix is in the Run commits', a.changed.includes('greet.js')],
    ['Standards and Security were reviewed before Finish', r.standards === 'pass' && r.security === 'pass'],
    [
      'one PR was opened and linked, closing the Ticket',
      prs.length === 1 && Boolean(r.pr) && /Closes #\d+/.test(prs[0].body),
    ],
  ];
};
