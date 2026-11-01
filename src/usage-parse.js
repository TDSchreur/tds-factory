// @ts-check
// Pieces the session log readers share. A reader returns { entries, sessions } or { problem }; an entry is
// { ts, model, input, cache_read, cache_write, output, reasoning, subagent } and a field the log does not report is null.

// The largest log read: real session logs are a few MB, so a bigger file is skipped rather than slurped.
export const MAX_FILE_BYTES = 64 * 1024 * 1024;

/** A model name safe to store and print: a log is written by another program, so any other name is dropped. @param {unknown} value */
export const modelName = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,99}$/.test(value);

/**
 * The text of a regular log file, or null for a link, a special file or one that is too big. A link is never followed.
 * @param {typeof import('node:fs')} fs
 * @param {string} file
 */
export function readLog(fs, file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
  return fs.readFileSync(file, 'utf8');
}

const RUN_ID = /^[a-z0-9][a-z0-9-]*$/;
const ID_CHAR = /[a-z0-9-]/;
const LINE_BREAK_LETTER = /[ntr]/;

/**
 * Whether a log names the Run: the id as a whole, not as the start of a longer Run id. An id of another shape never matches.
 * @param {string} text
 * @param {string} runId
 */
export function mentionsRun(text, runId) {
  if (!RUN_ID.test(runId)) return false;
  for (let at = text.indexOf(runId); at !== -1; at = text.indexOf(runId, at + 1)) {
    const before = text[at - 1];
    const after = text[at + runId.length];
    // In the raw text of a JSON log a line break is a backslash and a letter; that letter is not part of the id.
    const afterBreak = text[at - 2] === '\\' && before !== undefined && LINE_BREAK_LETTER.test(before);
    if ((afterBreak || !(before && ID_CHAR.test(before))) && !(after && ID_CHAR.test(after))) return true;
  }
  return false;
}

/** A token count from a log, or null when the log does not hold a usable one. @param {unknown} value */
export const count = (value) => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null);

/**
 * Keeps one entry per response. A response can be written more than once, sometimes with growing counts: the largest of each field wins.
 * @param {Map<string, any>} seen
 * @param {string} key
 * @param {any} entry
 */
export function keepLargest(seen, key, entry) {
  const old = seen.get(key);
  seen.set(
    key,
    old
      ? Object.fromEntries(
          Object.entries(entry).map(([k, v]) => [k, typeof v === 'number' ? Math.max(v, old[k] ?? 0) : (old[k] ?? v)]),
        )
      : entry,
  );
}
