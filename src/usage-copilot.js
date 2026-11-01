// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { count, keepLargest, mentionsRun, modelName, readLog } from './usage-parse.js';

// Reads token Usage from the Copilot session event files under ~/.copilot/session-state/<session>/events.jsonl. Only
// the model, the token counts and the timestamp of each call are kept. Copilot counts cache reads and cache writes
// inside inputTokens, so both are taken out of input; reasoning tokens are part of output.

/**
 * @param {string} text
 * @param {Map<string, any>} seen
 * @param {string} session
 */
function parse(text, seen, session) {
  for (const line of text.split('\n')) {
    if (!line.includes('"session.usage_record"')) continue;
    let data;
    try {
      data = JSON.parse(line);
    } catch {
      continue;
    }
    const usage = data?.type === 'session.usage_record' ? data.data?.usage : null;
    const ts = typeof data?.timestamp === 'string' ? Date.parse(data.timestamp) : NaN;
    if (!usage || typeof usage !== 'object' || !modelName(usage.model) || !Number.isFinite(ts)) continue;
    const input = count(usage.inputTokens);
    const output = count(usage.outputTokens);
    if (input === null && output === null) continue;
    const cacheRead = count(usage.cacheReadTokens);
    const cacheWrite = count(usage.cacheWriteTokens);
    const key = `${session}|${typeof usage.apiCallId === 'string' ? usage.apiCallId : `${ts}|${input}|${output}`}`;
    keepLargest(seen, key, {
      ts,
      model: usage.model,
      input: input === null ? null : Math.max(0, input - (cacheRead ?? 0) - (cacheWrite ?? 0)),
      cache_read: cacheRead,
      cache_write: cacheWrite,
      output,
      reasoning: count(usage.reasoningTokens),
      subagent: usage.initiator === 'sub-agent',
    });
  }
}

/**
 * @param {{ home: string, runId: string, sessions: string[], from: number, deadline: number }} input
 */
export function readCopilotUsage({ home, runId, sessions, from, deadline }) {
  const root = path.join(home, '.copilot', 'session-state');
  let dirs;
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return { problem: 'no Copilot session logs found' };
  }
  /** @type {Map<string, any>} */
  const seen = new Map();
  const found = new Set();
  for (const dir of dirs) {
    if (Date.now() > deadline) return { problem: 'reading the Copilot session logs took too long' };
    const file = path.join(root, dir.name, 'events.jsonl');
    try {
      if (fs.lstatSync(file).mtimeMs < from) continue;
      const text = readLog(fs, file);
      if (text === null) continue;
      if (!sessions.includes(dir.name) && !mentionsRun(text, runId)) continue;
      found.add(dir.name);
      parse(text, seen, dir.name);
    } catch {
      // An unreadable session is skipped; the others still count.
    }
  }
  return { entries: [...seen.values()], sessions: [...found] };
}
