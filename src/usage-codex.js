// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { count, keepLargest, modelName, readLog } from './usage-parse.js';

// Reads token Usage from the Codex rollout files under ~/.codex/sessions/YYYY/MM/DD. Only the model, the token counts
// and the timestamp of each response are kept. Codex counts cached input inside input, so the cached part is moved to
// cache read; reasoning tokens are part of output and are only reported beside it.

const DAY = 24 * 60 * 60 * 1000;

/** @param {string} dir */
const listDir = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

/** The rollout files of the days that can hold the Run. @param {string} root @param {number} from */
function rolloutFiles(root, from) {
  const earliest = new Date(from - DAY).toISOString().slice(0, 10);
  /** @type {string[]} */
  const files = [];
  for (const year of listDir(root).filter((d) => d.isDirectory() && /^\d{4}$/.test(d.name)))
    for (const month of listDir(path.join(root, year.name)).filter((d) => d.isDirectory() && /^\d{2}$/.test(d.name)))
      for (const day of listDir(path.join(root, year.name, month.name)).filter(
        (d) => d.isDirectory() && /^\d{2}$/.test(d.name),
      )) {
        if (`${year.name}-${month.name}-${day.name}` < earliest) continue;
        const dir = path.join(root, year.name, month.name, day.name);
        for (const file of listDir(dir))
          if (file.isFile() && /^rollout-.*\.jsonl$/.test(file.name)) files.push(path.join(dir, file.name));
      }
  return files;
}

/**
 * What one rollout holds: its ids and the usage of each response.
 * @param {string} text
 */
function parse(text) {
  /** @type {{ id?: string, root?: string, subagent: boolean }} */
  const meta = { subagent: false };
  /** @type {Map<string, string>} */
  const models = new Map();
  let lastModel = '';
  /** @type {any[]} */
  const uses = [];
  for (const line of text.split('\n')) {
    const wanted = ['"session_meta"', '"turn_context"', '"token_usage_record"'].find((tag) => line.includes(tag));
    if (!wanted) continue;
    let data;
    try {
      data = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = data?.payload;
    if (!payload || typeof payload !== 'object') continue;
    if (data.type === 'session_meta' && typeof payload.id === 'string') {
      meta.id = payload.id;
      meta.root = typeof payload.session_id === 'string' ? payload.session_id : payload.id;
      meta.subagent = Boolean(payload.source?.subagent) || (meta.root !== undefined && meta.root !== payload.id);
    } else if (data.type === 'turn_context' && modelName(payload.model)) {
      lastModel = payload.model;
      if (typeof payload.turn_id === 'string') models.set(payload.turn_id, payload.model);
    } else if (data.type === 'token_usage_record') {
      const ts = typeof data.timestamp === 'string' ? Date.parse(data.timestamp) : NaN;
      const usage = payload.usage;
      if (!usage || typeof usage !== 'object' || !Number.isFinite(ts)) continue;
      const input = count(usage.input_tokens);
      const cached = count(usage.cached_input_tokens);
      const output = count(usage.output_tokens);
      if (input === null && output === null) continue;
      const model = models.get(payload.turn_id) ?? lastModel;
      if (!model) continue;
      uses.push({
        key: typeof payload.response_id === 'string' ? payload.response_id : `${ts}|${input}|${output}`,
        entry: {
          ts,
          model,
          input: input === null ? null : Math.max(0, input - (cached ?? 0)),
          cache_read: cached,
          cache_write: count(usage.cache_write_input_tokens),
          output,
          reasoning: count(usage.reasoning_output_tokens),
        },
      });
    }
  }
  return { meta, uses };
}

/**
 * @param {{ home: string, runId: string, sessions: string[], from: number, deadline: number }} input
 */
export function readCodexUsage({ home, runId, sessions, from, deadline }) {
  const root = path.join(home, '.codex', 'sessions');
  if (!listDir(root).length) return { problem: 'no Codex session logs found' };
  /** @type {{ meta: any, uses: any[], direct: boolean }[]} */
  const rollouts = [];
  for (const file of rolloutFiles(root, from)) {
    if (Date.now() > deadline) return { problem: 'reading the Codex session logs took too long' };
    try {
      if (fs.lstatSync(file).mtimeMs < from) continue;
      const text = readLog(fs, file);
      if (text === null) continue;
      const { meta, uses } = parse(text);
      rollouts.push({
        meta,
        uses,
        direct: text.includes(runId) || (meta.id !== undefined && sessions.includes(meta.id)),
      });
    } catch {
      // An unreadable rollout is skipped; the others still count.
    }
  }
  // A subagent rollout names the Run only through its root session, so the roots of the matching rollouts decide.
  const roots = new Set(rollouts.filter((r) => r.direct && r.meta.root).map((r) => r.meta.root));
  /** @type {Map<string, any>} */
  const seen = new Map();
  const found = new Set();
  for (const r of rollouts) {
    if (!(r.direct || (r.meta.root && roots.has(r.meta.root)))) continue;
    if (r.meta.id) found.add(r.meta.id);
    for (const use of r.uses) keepLargest(seen, `${r.meta.id}|${use.key}`, { ...use.entry, subagent: r.meta.subagent });
  }
  return { entries: [...seen.values()], sessions: [...found] };
}
