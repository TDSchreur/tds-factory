// Constants and pure helpers of the Dashboard page. No DOM access.
export const COLUMNS = [
  { key: 'define', label: 'Define', help: 'Settle what has to be done: the agent interviews you, writes a Spec and cuts it into Tickets.' },
  { key: 'build', label: 'Build', help: 'Implement the Tickets test-first, one commit per Ticket, running the verify command after each.' },
  { key: 'check', label: 'Check', help: 'Independent reviewers check the changes on Standards, Spec, Security and Infrastructure. Problems send the Run back to Build, at most four times.' },
  { key: 'finish', label: 'Finish', help: 'Write the pull request description, push the branch and open the pull request.' },
  { key: 'done', label: 'Done', help: 'The Run is finished: its pull request is open, merged or closed, or the Run was abandoned.' },
];

export const CHIP_HELP = {
  tickets: 'Tickets finished out of the Tickets cut from the Spec.',
  standards: 'Check verdict: does the code follow the project conventions?',
  spec: 'Check verdict: does the code match what the Spec asked for?',
  security: 'Check verdict: no open critical, high or medium security findings.',
  infrastructure: 'Check verdict for Bicep and pipeline changes; skipped when none changed.',
  loops: 'Times Check sent the Run back to Build to fix problems. The maximum is 4.',
};

export const POLL_MS = 2000;
export const STALE_MS = 10 * 60 * 1000;
export const OLD_MS = 7 * 24 * 60 * 60 * 1000;

// Lenient reader: any field may be missing or of the wrong type.
export const str = (v) => (typeof v === 'string' ? v.trim() : '');

// Age in ms of an ISO timestamp, or null when missing or unparseable.
export function ageMs(iso) {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Date.now() - t;
}

export function ago(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.floor(m / 60)} h ago`;
  return `${Math.floor(m / 1440)} d ago`;
}

// Only http(s) links become anchors.
export function safeUrl(v) {
  const u = str(v);
  return /^https?:\/\//i.test(u) ? u : '';
}

// The chips of a card, in display order: { key, cls, text, tip }.
export function chipsOf(run) {
  const chips = [];
  if (run.ticketsTotal) chips.push({ key: 'tickets', cls: '', text: `${Math.min(run.ticketsDone || 0, run.ticketsTotal)}/${run.ticketsTotal} tickets`, tip: CHIP_HELP.tickets });
  for (const [key, label] of [['standards', 'Standards'], ['spec', 'Spec'], ['security', 'Security'], ['infrastructure', 'Infrastructure']]) {
    if (run[key]) chips.push({ key, cls: run[key], text: `${label} ${run[key]}`, tip: CHIP_HELP[key] });
  }
  if (typeof run.loops === 'number') chips.push({ key: 'loops', cls: '', text: `loop ${run.loops}/4`, tip: CHIP_HELP.loops });
  return chips;
}

// Short label of a Ticket link: "#111" for an issue URL, the file name for a path.
export const ticketLabel = (link) => {
  const last = str(link).replace(/[?#].*$/, '').split(/[\\/]/).filter(Boolean).pop() || str(link);
  return /^\d+$/.test(last) ? '#' + last : last;
};

// The Tickets of a card with their state: Tickets finish in order, so the first ticketsDone are done and the next is active during Build.
export function ticketsOf(run) {
  const done = Math.min(run.ticketsDone || 0, (run.tickets || []).length);
  return (run.tickets || []).map((href, i) => ({ href, label: ticketLabel(href), state: i < done ? 'done' : i === done && run.column === 'build' ? 'active' : 'todo' }));
}

// The last segment of a project path, with either kind of separator; empty when there is none.
export const folderName = (path) => String(path ?? '').split(/[\\/]/).filter(Boolean).pop() ?? '';
