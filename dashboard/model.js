// Constants and pure helpers of the Dashboard page. No DOM access.

// The shape of one Run as the Dashboard reads it: the result of interpretRun in src/dashboard-view.js plus the PR lookups of the views route.
// It is declared here and not imported from src/, because this folder is checked without Node types (see dashboard/tsconfig.json).
// src/dashboard-view.js declares that interpretRun returns this shape, so the two cannot drift apart unnoticed.

/**
 * @typedef {object} UsageRowView
 * @property {string} label
 * @property {string} fresh
 * @property {string} input
 * @property {string} cacheRead
 * @property {string} cacheWrite
 * @property {string} output
 * @property {string | null} reasoning
 * @property {string} subagents
 */
/**
 * @typedef {object} UsageTileView
 * @property {number | null} ticket
 * @property {string | null} bucket
 * @property {string} fresh
 * @property {string[]} models
 * @property {{ model: string, fresh: string, input: string, cacheRead: string, cacheWrite: string, output: string }[]} breakdown
 */
/**
 * @typedef {object} MetricsView
 * @property {Record<string, string>} stages
 * @property {string} [track]
 * @property {string} reworks
 * @property {string} reworkCauses
 * @property {string} firstPass
 * @property {string} tokens
 * @property {{ tokens: string, rows: UsageRowView[], gaps: { label: string }[], tiles: UsageTileView[] }} usage
 * @property {string} cost
 */
/** @typedef {{ severity: string, description: string, location: string }} FindingView */
/** @typedef {{ id: string, name: string, verdict: string, reason: string, findings: FindingView[] }} ProjectReviewView */
/** @typedef {Record<string, string | number | boolean>} EventView */
/** @typedef {{ checking?: boolean, unavailable?: string, state?: string, draft?: boolean, checks?: { result?: string, failing?: string[] }, merge?: string, review?: string }} PrStatusData */
/**
 * @typedef {object} RunView
 * @property {string} id
 * @property {string} projectId The id of the Project the Run belongs to; Run ids are only unique within a Project.
 * @property {boolean} unreadable
 * @property {string} title
 * @property {string} activity
 * @property {string} agent
 * @property {boolean} waiting
 * @property {string} reason
 * @property {string} column The Stage key, or `done`.
 * @property {string} updated
 * @property {string[]} files
 * @property {{ label: string, href: string }[]} links
 * @property {string} status
 * @property {string} pr
 * @property {{ requested: string, effort: string, observed: string }} model
 * @property {string} lastSeen
 * @property {EventView[]} events
 * @property {number} eventsDamaged
 * @property {MetricsView} [metrics]
 * @property {'fast' | 'full'} [track]
 * @property {ProjectReviewView[]} [projectReviews]
 * @property {string[]} [tickets]
 * @property {number | null} [ticketsDone]
 * @property {number | null} [ticketsTotal]
 * @property {string} [standards]
 * @property {string} [spec]
 * @property {string} [security]
 * @property {string} [infrastructure]
 * @property {number | null} [loops]
 * @property {number} [loopCap]
 * @property {string} [prState]
 * @property {PrStatusData | null} [prStatus]
 * @property {string} [prHost]
 * @property {boolean} [prCanMerge]
 */
/** @type {{ key: string, label: string, help: string }[]} */
export const COLUMNS = [
  {
    key: 'define',
    label: 'Define',
    help: 'Settle what has to be done: the agent interviews you, writes a Spec and cuts it into Tickets.',
  },
  {
    key: 'build',
    label: 'Build',
    help: 'Implement the Tickets test-first, one commit per Ticket, running the verify command after each, then work through the Exit checklist.',
  },
  {
    key: 'check',
    label: 'Check',
    help: 'Independent reviewers check the changes on Standards, Spec, Security and Infrastructure. Only Blocking findings send the Run back to Build, at most four times, or more when you grant an extra loop.',
  },
  {
    key: 'finish',
    label: 'Finish',
    help: 'Write the pull request description, push the branch and open the pull request.',
  },
  {
    key: 'follow-up',
    label: 'Follow-up',
    help: 'Read PR checks and unresolved review threads; scoped Rework returns to Build under the shared loop limit.',
  },
  {
    key: 'done',
    label: 'Done',
    help: 'The Run is finished: its pull request is open, merged or closed, or the Run was abandoned.',
  },
];

/** @type {Record<string, string>} */
export const CHIP_HELP = {
  tickets: 'Tickets finished out of the Tickets cut from the Spec.',
  standards: 'Check verdict: does the code follow the project conventions?',
  track: 'The track of this Run: Fast (bug fixes and tiny changes, one Ticket) or Full.',
  spec: 'Check verdict: does the code match what the Spec asked for? Skipped on the Fast track.',
  security: 'Check verdict: no open critical, high or medium security findings.',
  infrastructure: 'Check verdict for Bicep and pipeline changes; skipped when none changed.',
  loops:
    'Times Check or Follow-up sent the Run back to Build to fix Blocking findings or feedback. The maximum is 4, or the lower cap the project set.',
};

export const POLL_MS = 2000;
export const STALE_MS = 10 * 60 * 1000;
export const OLD_MS = 7 * 24 * 60 * 60 * 1000;

// Lenient reader: any field may be missing or of the wrong type.
/** @param {unknown} v */
export const str = (v) => (typeof v === 'string' ? v.trim() : '');

// Age in ms of an ISO timestamp, or null when missing or unparseable.
/** @param {unknown} iso */
export function ageMs(iso) {
  const t = Date.parse(String(iso));
  return Number.isNaN(t) ? null : Date.now() - t;
}

/** @param {number} ms */
export function ago(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.floor(m / 60)} h ago`;
  return `${Math.floor(m / 1440)} d ago`;
}

// Only http(s) links become anchors.
/** @param {unknown} v */
export function safeUrl(v) {
  const u = str(v);
  return /^https?:\/\//i.test(u) ? u : '';
}

// The chips of a card, in display order: { key, cls, text, tip }.
/** @type {Record<string, string>} */
const VERDICT_ICON = { pass: '✓', fail: '✗', skipped: '⊘' };

// One row per fact of the Run: an icon, a label and a value. `cls` colours the row and `text` is its plain reading.
/** @param {string} key @param {string} cls @param {string} icon @param {string} label @param {string} value @param {string} tip */
const row = (key, cls, icon, label, value, tip) => ({ key, cls, icon, label, value, text: `${label} ${value}`, tip });

/** @param {RunView} run */
export function chipsOf(run) {
  /** @type {ReturnType<typeof row>[]} */
  const chips = [];
  if (run.track)
    chips.push(
      row(
        'track',
        'accent',
        run.track === 'fast' ? '⚡' : '◆',
        'Track',
        run.track === 'fast' ? 'Fast' : 'Full',
        CHIP_HELP.track,
      ),
    );
  if (run.ticketsTotal)
    chips.push(
      row(
        'tickets',
        'accent',
        '▣',
        'Tickets',
        `${Math.min(run.ticketsDone || 0, run.ticketsTotal)}/${run.ticketsTotal}`,
        CHIP_HELP.tickets,
      ),
    );
  /** @type {['standards' | 'spec' | 'security' | 'infrastructure', string][]} */
  const verdictKeys = [
    ['standards', 'Standards'],
    ['spec', 'Spec'],
    ['security', 'Security'],
    ['infrastructure', 'Infrastructure'],
  ];
  for (const [key, label] of verdictKeys) {
    if (run[key]) chips.push(row(key, run[key], VERDICT_ICON[run[key]] ?? '•', label, run[key], CHIP_HELP[key]));
  }
  for (const review of run.projectReviews ?? []) {
    if (review.verdict)
      chips.push(
        row(
          `project-${review.id}`,
          review.verdict,
          VERDICT_ICON[review.verdict] ?? '•',
          review.name,
          review.verdict,
          review.reason || `Project review: ${review.name}`,
        ),
      );
  }
  if (typeof run.loops === 'number')
    chips.push(
      row(
        'loops',
        'neutral',
        '↻',
        'Check loops',
        `${run.loops}/${Number.isSafeInteger(run.loopCap) ? run.loopCap : 4}`,
        CHIP_HELP.loops,
      ),
    );
  return chips;
}

// Short label of a Ticket link: "#111" for an issue URL, the file name for a path.
/** @param {unknown} link */
export const ticketLabel = (link) => {
  const last =
    str(link)
      .replace(/[?#].*$/, '')
      .split(/[\\/]/)
      .filter(Boolean)
      .pop() || str(link);
  return /^\d+$/.test(last) ? '#' + last : last;
};

// The Tickets of a card with their state: Tickets finish in order, so the first ticketsDone are done and the next is active during Build.
/** @param {RunView} run */
export function ticketsOf(run) {
  const done = Math.min(run.ticketsDone || 0, (run.tickets || []).length);
  return (run.tickets || []).map((href, i) => ({
    href,
    label: ticketLabel(href),
    state: i < done ? 'done' : i === done && run.column === 'build' ? 'active' : 'todo',
    /** @type {UsageTileView | null} */
    usage: null,
  }));
}

// The Tickets with their Usage tile (a todo Ticket has none), and the Rework bucket as a tile of its own at the end.
/** @param {RunView} run */
export function ticketTilesOf(run) {
  const tiles = run.metrics?.usage && Array.isArray(run.metrics.usage.tiles) ? run.metrics.usage.tiles : [];
  const tickets = ticketsOf(run).map((t, i) => ({
    ...t,
    key: t.href,
    usage: t.state === 'todo' ? null : (tiles.find((tile) => tile.ticket === i + 1) ?? null),
  }));
  const rework = tiles.find((tile) => tile.bucket === 'rework');
  return rework
    ? [...tickets, { key: 'rework', href: null, label: 'Rework', state: 'rework', usage: rework }]
    : tickets;
}

// The last segment of a project path, with either kind of separator; empty when there is none.
/** @param {unknown} path */
export const folderName = (path) =>
  String(path ?? '')
    .split(/[\\/]/)
    .filter(Boolean)
    .pop() ?? '';

// Ticket progress of a card: null without a positive Ticket total, so an old Run shows no bar.
/** @param {RunView} run */
export function progressOf(run) {
  const { ticketsTotal, ticketsDone } = run;
  const total =
    typeof ticketsTotal === 'number' && Number.isSafeInteger(ticketsTotal) && ticketsTotal > 0 ? ticketsTotal : 0;
  if (!total) return null;
  const done =
    typeof ticketsDone === 'number' && Number.isSafeInteger(ticketsDone) && ticketsDone > 0 ? ticketsDone : 0;
  return { done: Math.min(done, total), total };
}

// The model line of a card. A request is labelled "requested"; only an agent-reported observed model is labelled "observed".
/** @param {RunView} run */
export function modelOf(run) {
  /** @type {Partial<RunView['model']>} */
  const m = run.model && typeof run.model === 'object' ? run.model : {};
  const requested = str(m.requested),
    effort = str(m.effort),
    observed = str(m.observed);
  if (observed)
    return {
      label: `Model (observed): ${observed}`,
      observed: true,
      ...(requested ? { title: `Requested: ${requested}` } : {}),
    };
  if (requested)
    return { label: `Model (requested): ${requested}${effort ? `, effort ${effort}` : ''}`, observed: false };
  if (effort) return { label: `Effort (requested): ${effort}`, observed: false };
  return null;
}

// The agent has been quiet for this long.
export const QUIET_MS = 10 * 60 * 1000;

// "Last seen" of a card. Only a running Run can be quiet; a waiting Run shows the time without a warning; a finished or unreadable Run, or one without a last-seen time, shows nothing.
/**
 * @param {RunView} run
 * @param {number} [now]
 */
export function lastSeenOf(run, now = Date.now()) {
  if (run.unreadable || !['running', 'waiting', 'verification-unavailable', 'interrupted'].includes(run.status))
    return null;
  const at = Date.parse(str(run.lastSeen));
  if (Number.isNaN(at)) return null;
  const age = Math.max(0, now - at);
  const quiet = run.status === 'running' && age >= QUIET_MS;
  return { text: `Last seen ${ago(age)}${quiet ? ', quiet' : ''}`, quiet };
}

/** @param {number} ms */
function duration(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** @param {EventView} e */
function describe(e) {
  const fast = e.fast === true ? 'Fast ' : '';
  switch (e.type) {
    case 'stage':
      return e.from && e.to ? `Moved from ${e.from} to ${e.to}` : 'stage';
    case 'ticket-done':
      return Number.isSafeInteger(e.done) && Number.isSafeInteger(e.total)
        ? `Ticket ${e.done} of ${e.total} done`
        : 'Ticket done';
    case 'verify-start':
      return `${fast}Verify started`;
    case 'verify': {
      const took = typeof e.duration_ms === 'number' ? ` in ${duration(e.duration_ms)}` : '';
      return `${fast}Verify ${e.exit_code === 0 ? 'passed' : 'failed'}${took}`;
    }
    case 'waiting':
      return e.reason ? `Waiting: ${e.reason}` : 'Waiting';
    case 'released':
      return 'Released';
    case 'extra-loop':
      return Number.isSafeInteger(e.limit)
        ? `Extra Check loop granted, limit now ${e.limit}`
        : 'Extra Check loop granted';
    case 'rework':
      return Number.isSafeInteger(e.loops) ? `Rework, loop ${e.loops}` : 'Rework';
    case 'status':
      return e.status ? `Status: ${e.status}` : 'status';
    default:
      return e.type;
  }
}

// The event timeline of the Run detail, oldest first: { text, when } with a relative time, or '' when the event has no usable time.
/**
 * @param {RunView} run
 * @param {number} [now]
 */
export function timelineOf(run, now = Date.now()) {
  if (!Array.isArray(run.events)) return [];
  return run.events
    .filter((e) => e && typeof e === 'object' && typeof e.type === 'string')
    .map((e) => {
      const at = Date.parse(str(e.at));
      return { text: describe(e), when: Number.isNaN(at) ? '' : ago(Math.max(0, now - at)) };
    });
}

// When the current wait began, in ms, or null when the event log cannot tell: the latest waiting event counts only if nothing released the Run or changed its status after it.
/** @param {RunView} run */
export function waitingSince(run) {
  if (!Array.isArray(run.events)) return null;
  for (let i = run.events.length - 1; i >= 0; i--) {
    const e = run.events[i];
    if (!e || typeof e !== 'object') continue;
    if (e.type === 'released' || e.type === 'status') return null;
    if (e.type === 'waiting') {
      const t = Date.parse(str(e.at));
      return Number.isNaN(t) ? null : t;
    }
  }
  return null;
}

// "waiting 12 min" for a Run that waits on the user and whose wait start is known; otherwise null, never a guess.
/**
 * @param {RunView} run
 * @param {number} [now]
 */
export function waitAgeOf(run, now = Date.now()) {
  if (run.waiting !== true) return null;
  const since = waitingSince(run);
  if (since === null) return null;
  const m = Math.floor(Math.max(0, now - since) / 60000);
  return {
    text: `waiting ${m < 1 ? 'less than a minute' : m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 1440)} d`}`,
  };
}

// Whether the Run waits on the user in Check at its loop limit, so that the user may grant an extra loop (ADR 0024).
/** @param {RunView} run */
export const canGrantLoop = (run) =>
  !run.unreadable &&
  run.waiting === true &&
  run.column === 'check' &&
  typeof run.loops === 'number' &&
  Number.isSafeInteger(run.loops) &&
  typeof run.loopCap === 'number' &&
  Number.isSafeInteger(run.loopCap) &&
  run.loops >= run.loopCap;

// Waiting Runs first, the longest wait first and unknown starts after known ones; the other Runs keep their order. Returns a new list.
/** @param {RunView[]} runs */
export function sortWaitingFirst(runs) {
  const waiting = runs.filter((r) => r.waiting).map((r) => ({ r, since: waitingSince(r) ?? Infinity }));
  waiting.sort((a, b) => (a.since === b.since ? 0 : a.since < b.since ? -1 : 1));
  return [...waiting.map((x) => x.r), ...runs.filter((r) => !r.waiting)];
}

/** @type {Record<string, string>} */
const HOSTS = { 'azure-devops': 'Azure DevOps' };
/** @param {RunView} run */
const hostOf = (run) => HOSTS[run.prHost ?? ''] ?? 'GitHub';
/** @type {Record<string, (run: RunView) => string>} */
const UNAVAILABLE = {
  'gh-missing': () => 'the gh command is not installed',
  'not-signed-in': () => 'gh is not signed in (run gh auth login)',
  'az-missing': () => 'the az command is not installed (install the Azure CLI)',
  'az-extension-missing': () => 'the Azure DevOps extension is missing (run az extension add --name azure-devops)',
  'az-not-signed-in': () => 'az is not signed in (run az login)',
  'rate-limited': (run) => hostOf(run) + ' rate limit reached',
};

// What the PR status block shows for a Run: null without a status, otherwise { kind, lines, text } where kind is checking,
// unavailable (text says why), closed (a merged or closed PR: the state badge says the rest) or open (lines hold the facts).
/** @param {RunView} run */
export function prStatusOf(run) {
  const s = run.prStatus;
  if (!s || typeof s !== 'object') return null;
  if (s.checking === true) return { kind: 'checking', lines: [] };
  if (typeof s.unavailable === 'string')
    return {
      kind: 'unavailable',
      lines: [],
      text: UNAVAILABLE[s.unavailable]?.(run) ?? hostOf(run) + ' could not be read',
    };
  if (s.state === 'merged' || s.state === 'closed') return { kind: 'closed', lines: [] };
  if (s.state !== 'open') return null;
  /** @type {NonNullable<PrStatusData['checks']>} */
  const checks = s.checks && typeof s.checks === 'object' ? s.checks : {};
  const failing = Array.isArray(checks.failing) ? checks.failing.filter((n) => typeof n === 'string' && n) : [];
  /** @type {string[]} */
  const lines = [];
  if (s.draft === true) lines.push('Draft');
  /** @type {Record<string, string>} */
  const checkText = {
    passing: 'passing',
    failing: 'failing' + (failing.length ? ': ' + failing.join(', ') : ''),
    pending: 'pending',
  };
  /** @type {Record<string, string>} */
  const mergeText = { mergeable: 'no conflicts', conflicting: 'conflicts with the base branch' };
  /** @type {Record<string, string>} */
  const reviewText = { approved: 'approved', 'changes-requested': 'changes requested', required: 'review required' };
  lines.push('Checks: ' + (checkText[checks.result ?? ''] ?? 'none reported'));
  lines.push('Merge: ' + (mergeText[s.merge ?? ''] ?? 'unknown'));
  lines.push('Review: ' + (reviewText[s.review ?? ''] ?? 'none yet'));
  return { kind: 'open', lines, failing: checks.result === 'failing', conflicting: s.merge === 'conflicting' };
}

/** @typedef {{ id: string, name: string, missing: boolean, runs: RunView[] }} ProjectView */

// A Run id is only unique within its Project, so everything the page remembers about a Run is keyed by both.
/** @param {{ id: string, projectId: string }} run */
export const runKey = (run) => run.projectId + '/' + run.id;

// The routes of one Run and of one of its files; they name the Project, since a Run id is only unique within one.
/** @param {{ id: string, projectId: string }} run */
export const runPath = (run) =>
  '/api/projects/' + encodeURIComponent(run.projectId) + '/runs/' + encodeURIComponent(run.id);
/** @param {{ id: string, projectId: string }} run @param {string} name */
export const filePath = (run, name) =>
  '/files/' + encodeURIComponent(run.projectId) + '/' + encodeURIComponent(run.id) + '/' + encodeURIComponent(name);

// The Project rows in a stable alphabetical order, the linked Project first. Returns a new list.
/**
 * @param {ProjectView[]} projects
 * @param {string} [first] the id of the Project that comes first
 */
export const sortProjects = (projects, first = '') =>
  [...projects].sort(
    (a, b) =>
      Number(b.id === first) - Number(a.id === first) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );

/** @param {RunView} run A Run that has not been touched for a week and waits on nobody. */
export const isOlder = (run) => {
  const age = ageMs(run.updated);
  return age !== null && age > OLD_MS && !run.waiting;
};

// The Runs of one Project the page shows: older ones only with showOlder, newest first, waiting Runs first.
/** @param {ProjectView} project @param {boolean} showOlder */
export const shownOf = (project, showOlder) =>
  sortWaitingFirst(
    project.runs
      .filter((r) => showOlder || !isOlder(r))
      .sort((a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id)),
  );

/** @typedef {'missing' | 'empty' | 'collapsed' | 'open'} RowKind */
/**
 * @typedef {object} RowView One Project row as the page shows it.
 * @property {ProjectView} project
 * @property {RowKind} kind A missing Project has no Runs to show, an empty one has none at all, a collapsed one shows only its summary.
 * @property {RunView[]} cards The Runs of the open row, in order, narrowed by Needs you.
 * @property {RunView[]} counted The Runs the collapsed summary counts: the shown Runs, never narrowed by Needs you.
 * @property {number} doneCount The Done Runs of the Project, for Delete all.
 */

// The rows of the page, in order. Needs you narrows the cards of a row; it never expands a row or changes what its summary counts.
/**
 * @param {ProjectView[]} projects
 * @param {object} view
 * @param {string} view.linked the id of the Project that comes first
 * @param {boolean} view.showOlder
 * @param {boolean} view.onlyWaiting
 * @param {Set<string>} view.opened ids of Projects the user expanded on this page
 * @param {Record<string, boolean>} view.saved the saved collapse choices
 * @returns {RowView[]}
 */
export const projectRows = (projects, { linked, showOlder, onlyWaiting, opened, saved }) =>
  sortProjects(projects, linked).map((project) => {
    const counted = shownOf(project, showOlder);
    /** @type {RowKind} */
    let kind = 'open';
    if (project.missing) kind = 'missing';
    else if (project.runs.length === 0) kind = 'empty';
    else if (!opened.has(project.id) && saved[project.id] === true) kind = 'collapsed';
    return {
      project,
      kind,
      cards: onlyWaiting ? counted.filter((r) => r.waiting) : counted,
      counted,
      doneCount: project.runs.filter((r) => r.column === 'done').length,
    };
  });

export const COLLAPSE_KEY = 'dashboard-collapsed-projects';

// The saved collapse choices: { [projectId]: boolean }. Missing, blocked or corrupt storage gives no choices.
/** @returns {Record<string, boolean>} */
export function loadCollapsed() {
  try {
    const data = JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '{}');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).filter(([, value]) => typeof value === 'boolean'));
  } catch {
    return {};
  }
}

/** @param {Record<string, boolean>} choices */
export function saveCollapsed(choices) {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify(choices));
  } catch {
    /* storage unavailable: the choice still applies to this page */
  }
}
