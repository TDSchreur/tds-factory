// @ts-check
import fs from 'node:fs';
import path from 'node:path';

// Reads token Usage from the Claude Code session transcripts under ~/.claude/projects. Only the model, the token
// counts and the timestamp of each response are kept; no conversation text leaves this module.
// Every reader returns { entries, sessions } or { problem }. An entry is
// { ts, model, input, cache_read, cache_write, output, reasoning, subagent }; a field the log does not report is null.

const MAX_FILE_BYTES = 256 * 1024 * 1024;

/** @param {unknown} value */
const count = (value) => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null);

/**
 * Entries of one transcript. A response is written once per content block with the same usage, so a response counts once.
 * @param {string} text
 * @param {boolean} subagent
 * @param {Map<string, any>} seen
 */
function parse(text, subagent, seen) {
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"')) continue;
    let data;
    try {
      data = JSON.parse(line);
    } catch {
      continue;
    }
    const message = data?.message;
    const usage = message?.usage;
    const ts = typeof data?.timestamp === 'string' ? Date.parse(data.timestamp) : NaN;
    if (!usage || typeof usage !== 'object' || typeof message.model !== 'string' || !Number.isFinite(ts)) continue;
    if (message.model.startsWith('<')) continue;
    const entry = {
      ts,
      model: message.model,
      input: count(usage.input_tokens),
      cache_read: count(usage.cache_read_input_tokens),
      cache_write: count(usage.cache_creation_input_tokens),
      output: count(usage.output_tokens),
      reasoning: null,
      subagent,
    };
    if (entry.input === null && entry.output === null) continue;
    const key = `${subagent}|${message.id ?? data.uuid ?? ts}|${data.requestId ?? ''}`;
    const old = seen.get(key);
    // Streaming can rewrite a response with growing counts: keep the largest of each field.
    seen.set(
      key,
      old
        ? Object.fromEntries(
            Object.entries(entry).map(([k, v]) => [
              k,
              typeof v === 'number' ? Math.max(v, old[k] ?? 0) : (old[k] ?? v),
            ]),
          )
        : entry,
    );
  }
}

/** @param {string} file */
function readText(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
  return fs.readFileSync(file, 'utf8');
}

/**
 * @param {{ home: string, runId: string, sessions: string[], from: number, deadline: number }} input
 */
export function readClaudeUsage({ home, runId, sessions, from, deadline }) {
  const root = path.join(home, '.claude', 'projects');
  let slugs;
  try {
    slugs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return { problem: 'no Claude session logs found' };
  }
  /** @type {Map<string, any>} */
  const seen = new Map();
  const found = new Set();
  for (const slug of slugs) {
    let files;
    try {
      files = fs.readdirSync(path.join(root, slug.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;
      if (Date.now() > deadline) return { problem: 'reading the Claude session logs took too long' };
      const full = path.join(root, slug.name, file.name);
      const sessionId = file.name.slice(0, -'.jsonl'.length);
      try {
        // A session that stopped before the Run began cannot hold its Usage.
        if (fs.statSync(full).mtimeMs < from) continue;
        const text = readText(full);
        if (text === null) continue;
        if (!sessions.includes(sessionId) && !text.includes(runId)) continue;
        found.add(sessionId);
        parse(text, false, seen);
        const subDir = path.join(root, slug.name, sessionId, 'subagents');
        for (const sub of fs.existsSync(subDir) ? fs.readdirSync(subDir) : []) {
          if (!sub.endsWith('.jsonl')) continue;
          const subText = readText(path.join(subDir, sub));
          if (subText !== null) parse(subText, true, seen);
        }
      } catch {
        // An unreadable transcript is skipped; the others still count.
      }
    }
  }
  return { entries: [...seen.values()], sessions: [...found] };
}
