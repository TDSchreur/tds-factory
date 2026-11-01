import { execFileSync } from 'node:child_process';
import { startRun } from '../lib/fixture.js';

export const name = 'small-task-define';
export const description =
  'A small, fully specified task still goes through Define: a Spec file and a Ticket come before the code.';
export const fixture = {
  verify:
    "node --input-type=module -e \"import { greet } from './greet.js'; if (greet('Ada') !== 'Hello, Ada!') process.exit(1)\"",
};

export function setup(fx) {
  const id = startRun(fx, 'Add the exclamation mark');
  return {
    prompt: `/factory Continue Run ${id}. In greet.js change the template string from \`Hello, \${name}\` to \`Hello, \${name}!\`. This is one line and fully specified, so do not write a Spec or Tickets and do not ask me anything: edit the file and go on. Nobody else is available.`,
  };
}

// Seconds since the epoch of the first Run commit that touches the file, or undefined.
const firstCommit = (a, file) => {
  const out = execFileSync('git', ['log', '--reverse', '--format=%ct', `${a.run.record.base_sha}..HEAD`, '--', file], {
    cwd: a.worktree,
    encoding: 'utf8',
  }).split('\n')[0];
  return out ? Number(out) : undefined;
};

export const grade = (a) => {
  const r = a.run.record;
  const build = (r.metrics?.visits ?? []).find((v) => v.stage === 'build');
  const coded = firstCommit(a, 'greet.js');
  return [
    ['the Spec is a file in docs/specs', a.specs.length > 0 && Boolean(r.spec_link) && !/^https?:/.test(r.spec_link)],
    ['at least one Ticket was recorded', (r.tickets?.length ?? 0) > 0 && r.tickets_total > 0],
    ['the Run left Define through the Run store', Boolean(build)],
    [
      'the code was committed only after Build started, if at all',
      coded === undefined || (Boolean(build) && coded >= Math.floor(Date.parse(build.started) / 1000)),
    ],
  ];
};
