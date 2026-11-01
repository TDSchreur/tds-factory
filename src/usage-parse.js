// @ts-check
// Pieces the session log readers share. A reader returns { entries, sessions } or { problem }; an entry is
// { ts, model, input, cache_read, cache_write, output, reasoning, subagent } and a field the log does not report is null.

export const MAX_FILE_BYTES = 256 * 1024 * 1024;

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
