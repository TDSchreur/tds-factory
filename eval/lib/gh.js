import { appendFileSync, readFileSync, existsSync } from 'node:fs';

const READS = new Set(['view', 'list', 'status', 'diff', 'checks']);

// A gh call is a write unless its verb is a plain read; unknown verbs count as writes so they are logged as attempts.
export const isWrite = (argv) => !argv.slice(0, 3).some((a) => READS.has(a)) && !(argv[0] === 'auth');

export function option(argv, ...names) {
  for (let i = 0; i < argv.length; i++) {
    for (const name of names) {
      if (argv[i] === name) return argv[i + 1];
      if (argv[i].startsWith(`${name}=`)) return argv[i].slice(name.length + 1);
    }
  }
  return undefined;
}

export const readActions = (log) => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

// What a fixture repository on GitHub answers when gh-state.json says nothing. Without it the agent sees no repository, publishes nothing and the Ticket checks cannot grade.
const DEFAULTS = {
  'repo view': { nameWithOwner: 'eval/fixture', url: 'https://github.com/eval/fixture' },
  'label list': [{ name: 'ready-for-agent' }],
};

// Records the call and answers from canned state. It never contacts GitHub.
export function handle(argv, { log, state, cwd = process.cwd() }) {
  const body = option(argv, '--body-file', '-F');
  const text = body && existsSync(body) ? readFileSync(body, 'utf8') : option(argv, '--body', '-b') ?? '';
  const write = isWrite(argv);
  const n = readActions(log).filter((a) => a.tool === 'gh' && a.write).length + 1;
  appendFileSync(log, `${JSON.stringify({ tool: 'gh', argv, cwd, write, title: option(argv, '--title', '-t'), labels: option(argv, '--label', '-l'), body: text })}\n`);
  const [noun, verb] = argv;
  if (write && verb === 'create') return `https://github.com/eval/fixture/${noun === 'pr' ? 'pull' : 'issues'}/${n}\n`;
  if (!write) {
    const canned = existsSync(state ?? '') ? JSON.parse(readFileSync(state, 'utf8')) : {};
    return `${JSON.stringify(canned[`${noun} ${verb}`] ?? DEFAULTS[`${noun} ${verb}`] ?? [])}\n`;
  }
  return '';
}
