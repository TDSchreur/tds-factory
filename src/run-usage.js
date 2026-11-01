// @ts-check
import os from 'node:os';
import { stages } from './flow.js';
import { readEvents } from './run-events.js';
import { readClaudeUsage } from './usage-claude.js';
import { readCodexUsage } from './usage-codex.js';
import { readCopilotUsage } from './usage-copilot.js';

// Token Usage of a Run (ADR 0026): counts per Stage, model and Ticket, read from the Agent session logs at each Stage
// change and at completion. Unknown is never zero: a Run without a readable log is "not tracked" and a Stage without
// entries is "no data".

const BUDGET_MS = 5000;
const FIELDS = ['input', 'cache_read', 'cache_write', 'output', 'reasoning'];
const readers = /** @type {Record<string, Function>} */ ({
  claude: readClaudeUsage,
  codex: readCodexUsage,
  copilot: readCopilotUsage,
});
const SESSION_ID = /^[A-Za-z0-9._-]{1,100}$/;

/** @param {any} metrics */
const usable = (metrics) => metrics && metrics.version === 1 && Array.isArray(metrics.visits);
/** @param {any} value */
const num = (value) => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null);
/** @param {number|null} a @param {number|null} b */
const add = (a, b) => (a === null ? b : b === null ? a : a + b);

/** The fresh tokens of a row: input plus cache write plus output. Cache reads are shown beside it, never inside it. */
export function fresh(/** @type {any} */ row) {
  const parts = [num(row.input), num(row.cache_write), num(row.output)];
  return parts.every((p) => p === null) ? null : parts.reduce((/** @type {number} */ sum, p) => sum + (p ?? 0), 0);
}

/**
 * Records the agent session that is working on the Run, so the reader can match it exactly.
 * @param {any} record
 */
export function noteSession(record) {
  const id = process.env.CLAUDE_CODE_SESSION_ID;
  if (record.agent !== 'claude' || !id || !SESSION_ID.test(id) || !usable(record.metrics)) return record;
  const sessions = Array.isArray(record.metrics.sessions) ? record.metrics.sessions : [];
  if (sessions.includes(id) || sessions.length >= 20) return record;
  return { ...record, metrics: { ...record.metrics, sessions: [...sessions, id] } };
}

/**
 * Puts the entries of the logs into the Stage visits of the Run. The first Build visit is cut at the `ticket-done`
 * events (Ticket N is the Nth Ticket); its work after the last one is the wrap-up; later Build visits are Rework.
 * @param {any[]} entries
 * @param {any} record
 * @param {any[]} doneEvents
 * @param {number} now
 */
export function attribute(entries, record, doneEvents, now) {
  const visits = record.metrics.visits
    .map((/** @type {any} */ v) => ({
      stage: v?.stage,
      start: Date.parse(v?.started),
      end: v?.ended ? Date.parse(v.ended) : null,
    }))
    .filter((/** @type {any} */ v) => stages.includes(v.stage) && Number.isFinite(v.start));
  const firstBuild = visits.findIndex((/** @type {any} */ v) => v.stage === 'build');
  const done = doneEvents
    .map((e) => ({ at: Date.parse(e.at), ticket: e.done }))
    .filter((e) => Number.isFinite(e.at) && Number.isSafeInteger(e.ticket) && e.ticket > 0)
    .sort((a, b) => a.at - b.at);
  /** @type {Map<string, any>} */
  const rows = new Map();
  for (const entry of entries) {
    const index = visits.findIndex(
      (/** @type {any} */ v) =>
        entry.ts >= v.start && entry.ts < (v.end === null || !Number.isFinite(v.end) ? now + 1 : v.end),
    );
    if (index < 0) continue;
    const stage = visits[index].stage;
    let ticket = null;
    let bucket = null;
    if (stage === 'build') {
      if (index !== firstBuild) bucket = 'rework';
      else {
        const upTo = done.find((e) => entry.ts <= e.at);
        if (upTo) ticket = upTo.ticket;
        else bucket = 'wrap-up';
      }
    }
    const key = [stage, entry.model, ticket, bucket].join('|');
    const row = rows.get(key) ?? {
      stage,
      model: entry.model,
      ticket,
      bucket,
      input: null,
      cache_read: null,
      cache_write: null,
      output: null,
      reasoning: null,
      subagent_fresh: 0,
    };
    for (const field of FIELDS) row[field] = add(row[field], num(entry[field]));
    if (entry.subagent) row.subagent_fresh += fresh(entry) ?? 0;
    rows.set(key, row);
  }
  return sortRows([...rows.values()]);
}

/** @param {any[]} rows */
function sortRows(rows) {
  const rank = (/** @type {any} */ r) => [
    stages.indexOf(r.stage),
    r.ticket ?? (r.bucket === 'wrap-up' ? 1e6 : r.bucket ? 2e6 : 0),
    r.model,
  ];
  return rows.sort((a, b) => {
    const [x, y] = [rank(a), rank(b)];
    return x[0] - y[0] || x[1] - y[1] || String(x[2]).localeCompare(String(y[2]));
  });
}

/**
 * The Usage of a Run as it stands in its logs, or the earlier Usage when the logs can no longer be read.
 * Best-effort: it never throws and stays within a time budget.
 * @param {any} record the Run record after the change
 * @param {string} dir the Run folder
 * @param {{ home?: string, now?: number, budgetMs?: number }} [options]
 */
export function readUsage(record, dir, { home = os.homedir(), now = Date.now(), budgetMs = BUDGET_MS } = {}) {
  const kept = record.metrics.usage;
  const untracked = (/** @type {string} */ reason) =>
    kept?.status === 'tracked' ? kept : { status: 'not tracked', reason };
  try {
    const id = record.id ?? dir.split(/[\\/]/).pop();
    if (record.project_config?.usage === false)
      return { status: 'not tracked', reason: 'switched off in the project config' };
    const reader = readers[record.agent];
    if (!reader) return untracked(`Usage is not read for ${record.agent} yet`);
    const from = Date.parse(record.created);
    const result = reader({
      home,
      runId: id,
      sessions: Array.isArray(record.metrics.sessions) ? record.metrics.sessions : [],
      from: Number.isFinite(from) ? from : 0,
      deadline: now + budgetMs,
    });
    if (result.problem) return untracked(result.problem);
    const events = readEvents(dir).events.filter((/** @type {any} */ e) => e?.type === 'ticket-done');
    const rows = attribute(result.entries, record, events, now);
    if (!rows.length)
      return untracked(
        `no usage found for this Run in the ${record.agent[0].toUpperCase()}${record.agent.slice(1)} session logs`,
      );
    return { status: 'tracked', read_at: new Date(now).toISOString(), sessions: result.sessions, rows };
  } catch {
    return untracked('the session logs could not be read');
  }
}

/**
 * Applies a read to the Run after a Stage change or completion, and notes the current session on every change.
 * @param {any} next
 * @param {any} previous
 * @param {string} dir
 */
export function withUsage(next, previous, dir) {
  if (!usable(next.metrics)) return next;
  let record = noteSession(next);
  const stageChanged = record.stage !== previous.stage;
  const completed = record.status === 'done' && previous.status !== 'done';
  if (stageChanged || completed) record = { ...record, metrics: { ...record.metrics, usage: readUsage(record, dir) } };
  return record;
}

// What a stored Usage says, tolerant of damaged or legacy values: those read as not tracked.
/** @param {any} usage @param {any} [record] */
export function summarizeUsage(usage, record) {
  if (!usage || usage.status !== 'tracked' || !Array.isArray(usage.rows))
    return {
      tracked: false,
      reason: typeof usage?.reason === 'string' ? usage.reason : '',
      rows: [],
      fresh: null,
      noData: [],
    };
  const rows = usage.rows
    .filter((/** @type {any} */ r) => r && stages.includes(r.stage) && typeof r.model === 'string')
    .map((/** @type {any} */ r) => ({
      stage: r.stage,
      model: r.model,
      ticket: Number.isSafeInteger(r.ticket) ? r.ticket : null,
      bucket: r.bucket === 'rework' || r.bucket === 'wrap-up' ? r.bucket : null,
      input: num(r.input),
      cache_read: num(r.cache_read),
      cache_write: num(r.cache_write),
      output: num(r.output),
      reasoning: num(r.reasoning),
      subagent_fresh: num(r.subagent_fresh) ?? 0,
    }));
  const visited = new Set((record?.metrics?.visits ?? []).map((/** @type {any} */ v) => v?.stage));
  const withRows = new Set(rows.map((/** @type {any} */ r) => r.stage));
  return {
    tracked: true,
    reason: '',
    rows: sortRows(rows),
    fresh: rows.reduce((/** @type {number|null} */ sum, /** @type {any} */ r) => add(sum, fresh(r)), null),
    noData: stages.filter((s) => visited.has(s) && !withRows.has(s)),
  };
}

/** @param {number|null} n */
export function tokenText(n) {
  if (n === null) return 'n/a';
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1e6).toFixed(1)}M`;
}

/** @param {any} row */
export function rowLabel(row) {
  const stage = row.stage[0].toUpperCase() + row.stage.slice(1);
  const where = row.ticket
    ? ` · Ticket ${row.ticket}`
    : row.bucket === 'rework'
      ? ' · Rework'
      : row.bucket === 'wrap-up'
        ? ' · wrap-up'
        : '';
  return `${stage}${where} · ${row.model}`;
}

/** The lines `run stats` and the Dashboard show, built from one place so their labels match. @param {ReturnType<typeof summarizeUsage>} summary */
export function formatUsage(summary) {
  if (!summary.tracked) return { tokens: summary.reason ? `not tracked (${summary.reason})` : 'not tracked', rows: [] };
  const rows = summary.rows.map((/** @type {any} */ r) => ({
    label: rowLabel(r),
    fresh: tokenText(fresh(r)),
    input: tokenText(r.input),
    cacheRead: tokenText(r.cache_read),
    cacheWrite: tokenText(r.cache_write),
    output: tokenText(r.output),
    reasoning: r.reasoning === null ? null : tokenText(r.reasoning),
    subagent_fresh: r.subagent_fresh,
    subagents: tokenText(r.subagent_fresh),
    stage: r.stage,
    model: r.model,
    ticket: r.ticket,
    bucket: r.bucket,
  }));
  const gaps = summary.noData.map((s) => ({ label: `${s[0].toUpperCase()}${s.slice(1)}`, noData: true }));
  return { tokens: `${tokenText(summary.fresh)} fresh`, rows, gaps };
}

/** One printable line per row. @param {any} row */
export function rowLine(row) {
  const parts = [
    `${row.label}  fresh ${row.fresh}`,
    `input ${row.input}`,
    `cache read ${row.cacheRead}`,
    `cache write ${row.cacheWrite}`,
    `output ${row.output}`,
  ];
  if (row.reasoning !== null) parts.push(`of which reasoning ${row.reasoning}`);
  if (row.subagent_fresh > 0) parts.push(`subagents ${row.subagents}`);
  return parts.join('  ');
}
