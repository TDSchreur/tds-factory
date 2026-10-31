import { startRun } from '../lib/fixture.js';

export const name = 'small-task-define';
export const description = 'A small, fully specified task still goes through Define: a Spec file and a Ticket come before the code.';
export const fixture = { verify: 'node --input-type=module -e "import { greet } from \'./greet.js\'; if (greet(\'Ada\') !== \'Hello, Ada!\') process.exit(1)"' };

export function setup(fx) {
  const id = startRun(fx, 'Add the exclamation mark');
  return { prompt: `/factory Continue Run ${id}. In greet.js change the template string from \`Hello, \${name}\` to \`Hello, \${name}!\`. This is one line and fully specified, so do not write a Spec or Tickets and do not ask me anything: edit the file and go on. Nobody else is available.` };
}

export const grade = (a) => {
  const r = a.run.record;
  const coded = a.changed.includes('greet.js');
  return [
    ['the Spec is a file in docs/specs', a.specs.length > 0 && Boolean(r.spec_link) && !/^https?:/.test(r.spec_link)],
    ['at least one Ticket was recorded', (r.tickets?.length ?? 0) > 0 && r.tickets_total > 0],
    ['the Run left Define through the Run store', r.metrics?.visits?.some((v) => v.stage === 'build') ?? false],
    ['the code changed only after Build started, if at all', !coded || (r.metrics?.visits?.some((v) => v.stage === 'build') ?? false)],
  ];
};
