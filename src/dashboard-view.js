/** @import { RunView } from '../dashboard/model.js' */
/** @import { ProjectResult } from './run-record.js' */
/** @import { ReadableEntry, UnreadableEntry } from './run-folder.js' */
import { summarizeMetrics, formatMetrics, trackOf, loopCap } from './run-store.js';
import { isStage } from './flow.js';

/** @param {unknown} v */
export const str = (v) => (typeof v === 'string' ? v.trim() : '');
/** @param {unknown} v @returns {string[]} */
const strList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []);
/**
 * @param {ReadableEntry | UnreadableEntry} entry An entry of the Run store. Its record is read from disk and may have any shape, so every field is checked as it is read.
 * @returns {Omit<RunView, 'projectId' | 'prState' | 'prStatus' | 'prHost' | 'prCanMerge'>}
 */
export function interpretRun(entry) {
  const id = typeof entry?.id === 'string' ? entry.id : '',
    files = strList(entry?.files);
  if (!entry || entry.unreadable || !entry.record || typeof entry.record !== 'object')
    return {
      id,
      unreadable: true,
      title: id || 'Unknown run',
      activity: '',
      agent: '',
      waiting: false,
      reason: '',
      column: 'define',
      updated: '',
      files,
      links: [],
      status: '',
      pr: '',
      model: { requested: '', effort: '', observed: '' },
      lastSeen: '',
      events: [],
      eventsDamaged: 0,
    };
  const r = entry.record,
    status = str(r.status),
    stage = str(r.stage).toLowerCase();
  /** @param {unknown} v */
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
  /**
   * @param {unknown} value
   * @param {boolean} [skip]
   */
  const verdict = (value, skip) => {
    const v = str(value).toLowerCase();
    return v === 'pass' || v === 'fail' || (skip && v === 'skipped') ? v : '';
  };
  // The record is untrusted data: the `any` parameters below are checked field by field.
  const projectReviews = (Array.isArray(r.project_reviews) ? r.project_reviews : [])
    .filter((/** @type {any} */ x) => x && typeof x === 'object' && str(x.id) && str(x.name))
    .map((/** @type {any} */ x) => {
      /** @type {Partial<ProjectResult>} */
      const result = r.project_results?.[x.id] ?? {};
      const findings = (Array.isArray(result.findings) ? result.findings : [])
        .filter((/** @type {any} */ f) => f && typeof f === 'object')
        .map((/** @type {any} */ f) => ({
          severity: str(f.severity),
          description: str(f.description),
          location: str(f.location),
        }));
      return {
        id: str(x.id),
        name: str(x.name),
        verdict: verdict(result.verdict, true),
        reason: str(result.reason),
        findings,
      };
    });
  /** @type {{ label: string, href: string }[]} */
  const links = [];
  /** @type {[string, unknown][]} */
  const linkSources = [
    ['Spec', r.spec_link],
    ['Ticket', r.tickets],
    ['PR', r.pr],
  ];
  for (const [label, values] of linkSources)
    for (const value of Array.isArray(values) ? values : [values])
      if (str(value)) links.push({ label, href: str(value) });
  // Only the plain, known fields of an event reach the page, and the last 50 of them.
  const eventKeys = [
    'type',
    'at',
    'from',
    'to',
    'reason',
    'status',
    'done',
    'total',
    'loops',
    'granted',
    'limit',
    'fast',
    'exit_code',
    'duration_ms',
    'head',
    'signal',
  ];
  const events = (Array.isArray(entry.events?.events) ? entry.events.events : [])
    .filter((/** @type {any} */ e) => e && typeof e === 'object')
    .slice(-50)
    .map((/** @type {any} */ e) =>
      Object.fromEntries(
        eventKeys.filter((k) => ['string', 'number', 'boolean'].includes(typeof e[k])).map((k) => [k, e[k]]),
      ),
    );
  const model = { requested: str(r.requested_model), effort: str(r.requested_effort), observed: str(r.observed_model) };
  return {
    id,
    unreadable: false,
    model,
    lastSeen: str(r.last_seen),
    events,
    eventsDamaged: num(entry.events?.damaged) ?? 0,
    metrics: formatMetrics(summarizeMetrics(r)),
    track: trackOf(r),
    projectReviews,
    column: ['done', 'abandoned'].includes(status) ? 'done' : isStage(stage) ? stage : 'define',
    status,
    pr: str(r.pr),
    tickets: strList(r.tickets),
    ticketsDone: num(r.tickets_done),
    ticketsTotal: num(r.tickets_total),
    standards: verdict(r.standards),
    spec: verdict(r.spec, true),
    security: verdict(r.security),
    infrastructure: verdict(r.infrastructure, true),
    loops: num(r.check_loops),
    loopCap: loopCap(r),
    waiting: !['done', 'abandoned'].includes(status) && (r.waiting_on_human === true || status === 'waiting'),
    reason: str(['verification-unavailable', 'interrupted'].includes(status) ? r.status_reason : r.waiting_reason),
    title: str(r.title) || id || 'Untitled run',
    activity: str(r.activity),
    agent: str(r.agent),
    updated: str(r.updated),
    files,
    links,
  };
}
