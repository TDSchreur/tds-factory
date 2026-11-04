// Gives a browser test a short Dashboard poll interval without a test hook in the Dashboard: the stub server serves
// dashboard/model.js with the value of POLL_MS replaced. The shipped file and its 2000 ms stay as they are.
const POLL_LINE = /^export const POLL_MS = \d+;$/gm;

/**
 * @param {string} source The text of dashboard/model.js.
 * @param {number} ms The poll interval of the test.
 * @returns {string} The same text with the interval replaced.
 */
export function withPollMs(source, ms) {
  if (!Number.isSafeInteger(ms) || ms <= 0)
    throw new Error(`pollMs must be a positive whole number of milliseconds, not ${ms}`);
  const found = source.match(POLL_LINE)?.length ?? 0;
  // Fail loudly: serving the long interval silently would make a renamed constant look like a slow test.
  if (found !== 1) {
    throw new Error(
      `dashboard/model.js must hold the line "export const POLL_MS = <number>;" exactly once, it holds it ${found} times`,
    );
  }
  return source.replace(POLL_LINE, `export const POLL_MS = ${ms};`);
}
