// Metrics record observations independently of current Evidence. Missing or damaged
// metrics on an older record are never backfilled from its current state.
export const newMetrics = (at) => ({ version: 1, visits: [{ stage: 'define', started: at }], verdicts: [], usage: { tokens: 'not tracked', cost: 'not tracked' } });
const usable = (metrics) => metrics && metrics.version === 1 && Array.isArray(metrics.visits) && Array.isArray(metrics.verdicts);

export function moveVisit(record, stage, at = new Date().toISOString()) {
  if (!usable(record.metrics)) return record;
  const visits = record.metrics.visits.map((v, i, all) => i === all.length - 1 && v && !v.ended ? { ...v, ended: at } : v);
  if (stage) visits.push({ stage, started: at, ...(stage === 'check' ? { attempt: (record.check_loops ?? 0) + 1 } : {}) });
  return { ...record, metrics: { ...record.metrics, visits } };
}
export function recordVerdict(record, event) {
  if (!usable(record.metrics)) return record;
  return { ...record, metrics: { ...record.metrics, verdicts: [...record.metrics.verdicts, { ...event, at: new Date().toISOString() }] } };
}
export function firstCheck(record, clean) {
  if (!usable(record.metrics) || record.metrics.first_check !== undefined || record.check_loops !== 0) return record;
  return { ...record, metrics: { ...record.metrics, first_check: clean ? 'clean' : 'unclean' } };
}

const stages = ['define', 'build', 'check', 'finish'];
const date = (value) => typeof value === 'string' ? Date.parse(value) : NaN;
const duration = (ms, ongoing = false) => {
  if (ms === null) return 'no data';
  const seconds = Math.floor(ms / 1000), h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
  return `${h ? `${h}h ` : ''}${m ? `${m}m ` : ''}${s}s${ongoing ? ' (ongoing)' : ''}`;
};
const rate = (clean, observed) => observed ? `${Math.round(clean / observed * 1000) / 10}% (${clean}/${observed})` : 'no data';

// Invalid optional observations are ignored, never used to hide the rest of a Run.
export function summarizeMetrics(record, now = Date.now()) {
  const values = Object.fromEntries(stages.map(stage => [stage, { ms: null, ongoing: false }]));
  const metrics = record?.metrics;
  if (usable(metrics)) for (const visit of metrics.visits) {
    if (!visit || typeof visit.stage !== 'string' || !Object.hasOwn(values, visit.stage)) continue;
    const start = date(visit.started), open = visit.ended === undefined, end = open ? now : date(visit.ended);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    const value = values[visit.stage];
    value.ms = (value.ms ?? 0) + end - start;
    value.ongoing ||= open;
  }
  const reworks = Number.isSafeInteger(record?.check_loops) && record.check_loops >= 0 ? record.check_loops : null;
  const outcome = usable(metrics) && ['clean', 'unclean'].includes(metrics.first_check) ? metrics.first_check : null;
  return { stages: values, reworks, clean: outcome === 'clean' ? 1 : 0, observed: outcome ? 1 : 0 };
}
export function formatMetrics(summary) {
  return {
    stages: Object.fromEntries(stages.map(stage => [stage, duration(summary.stages[stage].ms, summary.stages[stage].ongoing)])),
    reworks: summary.reworks === null ? 'no data' : String(summary.reworks),
    firstPass: rate(summary.clean, summary.observed), tokens: 'not tracked', cost: 'not tracked',
  };
}
export function totalMetrics(summaries) {
  const total = { stages: Object.fromEntries(stages.map(stage => [stage, { ms: null, ongoing: false }])), reworks: null, clean: 0, observed: 0 };
  for (const summary of summaries) {
    for (const stage of stages) {
      const value = summary.stages[stage], sum = total.stages[stage];
      if (value.ms !== null) sum.ms = (sum.ms ?? 0) + value.ms;
      sum.ongoing ||= value.ongoing;
    }
    if (summary.reworks !== null) total.reworks = (total.reworks ?? 0) + summary.reworks;
    total.clean += summary.clean; total.observed += summary.observed;
  }
  return total;
}
