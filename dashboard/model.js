// Constants and pure helpers of the Dashboard page. No DOM access.
export const COLUMNS = [
  { key: 'define', label: 'Define', help: 'Settle what has to be done: the agent interviews you, writes a Spec and cuts it into Tickets.' },
  { key: 'build', label: 'Build', help: 'Implement the Tickets test-first, one commit per Ticket, running the verify command after each, then work through the Exit checklist.' },
  { key: 'check', label: 'Check', help: 'Independent reviewers check the changes on Standards, Spec, Security and Infrastructure. Only Blocking findings send the Run back to Build, at most four times.' },
  { key: 'finish', label: 'Finish', help: 'Write the pull request description, push the branch and open the pull request.' },
  { key: 'follow-up', label: 'Follow-up', help: 'Read PR checks and unresolved review threads; scoped Rework returns to Build under the shared loop limit.' },
  { key: 'done', label: 'Done', help: 'The Run is finished: its pull request is open, merged or closed, or the Run was abandoned.' },
];

export const CHIP_HELP = {
  tickets: 'Tickets finished out of the Tickets cut from the Spec.',
  standards: 'Check verdict: does the code follow the project conventions?',
  track: 'The track of this Run: Fast (bug fixes and tiny changes, one Ticket) or Full.',
  spec: 'Check verdict: does the code match what the Spec asked for? Skipped on the Fast track.',
  security: 'Check verdict: no open critical, high or medium security findings.',
  infrastructure: 'Check verdict for Bicep and pipeline changes; skipped when none changed.',
  loops: 'Times Check or Follow-up sent the Run back to Build to fix Blocking findings or feedback. The maximum is 4, or the lower cap the project set.',
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
  if (run.track) chips.push({ key: 'track', cls: '', text: run.track === 'fast' ? 'Fast' : 'Full', tip: CHIP_HELP.track });
  if (run.ticketsTotal) chips.push({ key: 'tickets', cls: '', text: `${Math.min(run.ticketsDone || 0, run.ticketsTotal)}/${run.ticketsTotal} tickets`, tip: CHIP_HELP.tickets });
  for (const [key, label] of [['standards', 'Standards'], ['spec', 'Spec'], ['security', 'Security'], ['infrastructure', 'Infrastructure']]) {
    if (run[key]) chips.push({ key, cls: run[key], text: `${label} ${run[key]}`, tip: CHIP_HELP[key] });
  }
  for (const review of run.projectReviews ?? []) {
    if (review.verdict) chips.push({ key: `project-${review.id}`, cls: review.verdict, text: `${review.name} ${review.verdict}`, tip: review.reason || `Project review: ${review.name}` });
  }
  if (typeof run.loops === 'number') chips.push({ key: 'loops', cls: '', text: `loop ${run.loops}/${Number.isSafeInteger(run.loopCap) ? run.loopCap : 4}`, tip: CHIP_HELP.loops });
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

// Ticket progress of a card: null without a positive Ticket total, so an old Run shows no bar.
export function progressOf(run) {
  const total = Number.isSafeInteger(run.ticketsTotal) && run.ticketsTotal > 0 ? run.ticketsTotal : 0;
  if (!total) return null;
  const done = Number.isSafeInteger(run.ticketsDone) && run.ticketsDone > 0 ? run.ticketsDone : 0;
  return { done: Math.min(done, total), total };
}

// The model line of a card. A request is labelled "requested"; only an agent-reported observed model is labelled "observed".
export function modelOf(run) {
  const m = run.model && typeof run.model === 'object' ? run.model : {};
  const requested = str(m.requested), effort = str(m.effort), observed = str(m.observed);
  if (observed) return { label: `Model (observed): ${observed}`, observed: true, ...(requested ? { title: `Requested: ${requested}` } : {}) };
  if (requested) return { label: `Model (requested): ${requested}${effort ? `, effort ${effort}` : ''}`, observed: false };
  if (effort) return { label: `Effort (requested): ${effort}`, observed: false };
  return null;
}

// The agent has been quiet for this long.
export const QUIET_MS = 10 * 60 * 1000;

// "Last seen" of a card. Only a running Run can be quiet; a waiting Run shows the time without a warning; a finished or unreadable Run shows nothing.
export function lastSeenOf(run, now = Date.now()) {
  if (run.unreadable || !['running', 'waiting', 'verification-unavailable', 'interrupted'].includes(run.status)) return null;
  const at = Date.parse(str(run.lastSeen) || str(run.updated));
  if (Number.isNaN(at)) return null;
  const age = Math.max(0, now - at);
  const quiet = run.status === 'running' && age >= QUIET_MS;
  return { text: `Last seen ${ago(age)}${quiet ? ', quiet' : ''}`, quiet };
}

function duration(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function describe(e) {
  const fast = e.fast === true ? 'Fast ' : '';
  switch (e.type) {
    case 'stage': return e.from && e.to ? `Moved from ${e.from} to ${e.to}` : 'stage';
    case 'ticket-done': return Number.isSafeInteger(e.done) && Number.isSafeInteger(e.total) ? `Ticket ${e.done} of ${e.total} done` : 'Ticket done';
    case 'verify-start': return `${fast}Verify started`;
    case 'verify': {
      const took = typeof e.duration_ms === 'number' ? ` in ${duration(e.duration_ms)}` : '';
      return `${fast}Verify ${e.exit_code === 0 ? 'passed' : 'failed'}${took}`;
    }
    case 'waiting': return e.reason ? `Waiting: ${e.reason}` : 'Waiting';
    case 'released': return 'Released';
    case 'rework': return Number.isSafeInteger(e.loops) ? `Rework, loop ${e.loops}` : 'Rework';
    case 'status': return e.status ? `Status: ${e.status}` : 'status';
    default: return e.type;
  }
}

// The event timeline of the Run detail, oldest first: { text, when } with a relative time, or '' when the event has no usable time.
export function timelineOf(run, now = Date.now()) {
  if (!Array.isArray(run.events)) return [];
  return run.events.filter((e) => e && typeof e === 'object' && typeof e.type === 'string').map((e) => {
    const at = Date.parse(str(e.at));
    return { text: describe(e), when: Number.isNaN(at) ? '' : ago(Math.max(0, now - at)) };
  });
}
