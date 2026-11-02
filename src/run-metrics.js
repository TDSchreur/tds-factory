import { stages } from './flow.js';
import { trackOf } from './run-record.js';
/** @import { Run, Metrics, Stage } from './run-record.js' */
import { summarizeUsage, formatUsage } from './run-usage.js';

// Metrics record observations independently of current Evidence. Missing or damaged
// metrics on an older record are never backfilled from its current state.
// Why Check sent a Run back to Build: a fixed list, so the causes can be counted. A Rework without one is unknown.
export const REWORK_CAUSES = ['stale-doc', 'test-gap', 'spec-gap', 'security', 'bug', 'size', 'other'];
/** @param {unknown} causes @returns {string[]} */
const ownCauses = (causes) => REWORK_CAUSES.filter((cause) => Array.isArray(causes) && causes.includes(cause));

/** @param {string} at @returns {Metrics} */
export const newMetrics = (at) => ({
  version: 1,
  visits: [{ stage: 'define', started: at }],
  verdicts: [],
  usage: { tokens: 'not tracked', cost: 'not tracked' },
});
/** @param {Metrics | undefined | null} metrics @returns {metrics is Metrics} */
const usable = (metrics) =>
  !!metrics && metrics.version === 1 && Array.isArray(metrics.visits) && Array.isArray(metrics.verdicts);

/**
 * @param {Run} record
 * @param {Stage | null} stage
 * @param {string} [at]
 * @returns {Run}
 */
export function moveVisit(record, stage, at = new Date().toISOString()) {
  if (!usable(record.metrics)) return record;
  const visits = record.metrics.visits.map((v, i, all) =>
    i === all.length - 1 && v && !v.ended ? { ...v, ended: at } : v,
  );
  if (stage)
    visits.push({ stage, started: at, ...(stage === 'check' ? { attempt: (record.check_loops ?? 0) + 1 } : {}) });
  return { ...record, metrics: { ...record.metrics, visits } };
}
// Stores the causes given for one Rework, next to the Rework itself; none given stores nothing and counts as unknown.
/**
 * @param {Run} record
 * @param {string[]} causes
 * @param {number} attempt
 * @returns {Run}
 */
export function recordCauses(record, causes, attempt) {
  if (!usable(record.metrics) || !causes.length) return record;
  const old = Array.isArray(record.metrics.rework_causes) ? record.metrics.rework_causes : [];
  const entry = { attempt, causes: ownCauses(causes), at: new Date().toISOString() };
  return { ...record, metrics: { ...record.metrics, rework_causes: [...old, entry] } };
}
/**
 * @param {Run} record
 * @param {Omit<import('./run-record.js').VerdictEvent, 'at'>} event
 * @returns {Run}
 */
export function recordVerdict(record, event) {
  if (!usable(record.metrics)) return record;
  return {
    ...record,
    metrics: { ...record.metrics, verdicts: [...record.metrics.verdicts, { ...event, at: new Date().toISOString() }] },
  };
}
/**
 * @param {Run} record
 * @param {boolean} clean
 * @returns {Run}
 */
export function firstCheck(record, clean) {
  if (!usable(record.metrics) || record.metrics.first_check !== undefined || record.check_loops !== 0) return record;
  return { ...record, metrics: { ...record.metrics, first_check: clean ? 'clean' : 'unclean' } };
}

/** @param {unknown} value */
const date = (value) => (typeof value === 'string' ? Date.parse(value) : NaN);
/** @param {number | null} ms @param {boolean} [ongoing] */
const duration = (ms, ongoing = false) => {
  if (ms === null) return 'no data';
  const seconds = Math.floor(ms / 1000),
    h = Math.floor(seconds / 3600),
    m = Math.floor((seconds % 3600) / 60),
    s = seconds % 60;
  return `${h ? `${h}h ` : ''}${m ? `${m}m ` : ''}${s}s${ongoing ? ' (ongoing)' : ''}`;
};
/** @param {number} clean @param {number} observed */
const rate = (clean, observed) =>
  observed ? `${Math.round((clean / observed) * 1000) / 10}% (${clean}/${observed})` : 'no data';

// Invalid optional observations are ignored, never used to hide the rest of a Run.
/**
 * @typedef {object} MetricsSummary
 * @property {import('./run-record.js').Track} [track]
 * @property {Record<string, { ms: number | null, ongoing: boolean }>} stages
 * @property {number | null} reworks
 * @property {{ counts: Record<string, number>, unknown: number }} causes
 * @property {number} clean
 * @property {number} observed
 * @property {ReturnType<typeof summarizeUsage>} [usage]
 */
/**
 * @param {Run | undefined | null} record
 * @param {number} [now]
 * @returns {MetricsSummary}
 */
export function summarizeMetrics(record, now = Date.now()) {
  /** @type {MetricsSummary['stages']} */
  const values = Object.fromEntries(stages.map((stage) => [stage, { ms: null, ongoing: false }]));
  const metrics = record?.metrics;
  if (usable(metrics))
    for (const visit of metrics.visits) {
      if (!visit || typeof visit.stage !== 'string' || !Object.hasOwn(values, visit.stage)) continue;
      const start = date(visit.started),
        open = visit.ended === undefined,
        end = open ? now : date(visit.ended);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
      const value = values[visit.stage];
      value.ms = (value.ms ?? 0) + end - start;
      value.ongoing ||= open;
    }
  const checkLoops = record?.check_loops;
  const reworks = checkLoops !== undefined && Number.isSafeInteger(checkLoops) && checkLoops >= 0 ? checkLoops : null;
  const outcome =
    usable(metrics) && metrics.first_check && ['clean', 'unclean'].includes(metrics.first_check)
      ? metrics.first_check
      : null;
  /** @type {Record<string, number>} */
  const counts = {};
  let withCause = 0;
  if (usable(metrics) && Array.isArray(metrics.rework_causes))
    for (const entry of metrics.rework_causes) {
      const own = ownCauses(entry?.causes);
      if (!own.length) continue;
      withCause++;
      for (const cause of own) counts[cause] = (counts[cause] ?? 0) + 1;
    }
  return {
    track: trackOf(record),
    stages: values,
    reworks,
    causes: { counts, unknown: reworks === null ? 0 : Math.max(0, reworks - withCause) },
    clean: outcome === 'clean' ? 1 : 0,
    observed: outcome ? 1 : 0,
    usage: summarizeUsage(usable(metrics) ? metrics.usage : undefined, record),
  };
}
/** @param {MetricsSummary} summary */
const causeText = (summary) => {
  if (summary.reworks === null) return 'no data';
  if (summary.reworks === 0) return 'none';
  const { counts = {}, unknown = 0 } = summary.causes ?? {};
  const parts = REWORK_CAUSES.filter((cause) => counts[cause]).map((cause) => `${cause} ${counts[cause]}`);
  if (unknown) parts.push(`unknown ${unknown}`);
  return parts.join(', ') || 'none';
};
/** @param {MetricsSummary} summary */
export function formatMetrics(summary) {
  return {
    stages: Object.fromEntries(
      stages.map((stage) => [stage, duration(summary.stages[stage].ms, summary.stages[stage].ongoing)]),
    ),
    ...(summary.track ? { track: summary.track === 'fast' ? 'Fast' : 'Full' } : {}),
    reworks: summary.reworks === null ? 'no data' : String(summary.reworks),
    reworkCauses: causeText(summary),
    firstPass: rate(summary.clean, summary.observed),
    ...(() => {
      const usage = formatUsage(summary.usage ?? summarizeUsage(undefined));
      return { tokens: usage.tokens, usage };
    })(),
    cost: 'not tracked',
  };
}
/**
 * @param {MetricsSummary[]} summaries
 * @returns {MetricsSummary}
 */
export function totalMetrics(summaries) {
  /** @type {MetricsSummary} */
  const total = {
    stages: Object.fromEntries(stages.map((stage) => [stage, { ms: null, ongoing: false }])),
    reworks: null,
    causes: { counts: {}, unknown: 0 },
    clean: 0,
    observed: 0,
  };
  for (const summary of summaries) {
    for (const stage of stages) {
      const value = summary.stages[stage],
        sum = total.stages[stage];
      if (value.ms !== null) sum.ms = (sum.ms ?? 0) + value.ms;
      sum.ongoing ||= value.ongoing;
    }
    if (summary.reworks !== null) total.reworks = (total.reworks ?? 0) + summary.reworks;
    for (const [cause, n] of Object.entries(summary.causes?.counts ?? {}))
      total.causes.counts[cause] = (total.causes.counts[cause] ?? 0) + n;
    total.causes.unknown += summary.causes?.unknown ?? 0;
    total.clean += summary.clean;
    total.observed += summary.observed;
  }
  return total;
}
