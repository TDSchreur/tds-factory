import './git-repo.js'; // keeps the Factory config folder of the tests apart from the user's, and drops injected git settings
import { main } from '../src/cli.js';
import { waitUntil } from './wait-until.js';

/**
 * @typedef {object} CliResult
 * @property {number} status The exit code, as `spawnSync` reports it.
 * @property {string} stdout
 * @property {string} stderr
 */

/** A sink that keeps what is written to it. */
function collector() {
  /** @type {string[]} */
  const chunks = [];
  return { write: (/** @type {string} */ chunk) => chunks.push(chunk), text: () => chunks.join('') };
}

// A spawned process takes tens of milliseconds, so the timestamps a command writes never equal those of the files a test writes around it.
// In process a command can run inside one millisecond, and Usage and the Stage durations order events by timestamp, so every call starts and ends on a clock tick of its own.
async function nextMillisecond() {
  const start = Date.now();
  await waitUntil(() => Date.now() > start, { intervalMs: 1, message: 'the clock did not advance' });
}

/**
 * Runs `tds-factory` in process, in `cwd`, with the environment of the test process plus `env`, and resolves to what a spawned process would have given.
 * A test that checks how a real process ends (its exit code and streams, signals, the Dashboard launch) spawns `bin/tds-factory.js` itself.
 * @param {{ env?: NodeJS.ProcessEnv }} options
 * @param {string} cwd
 * @param {...string} args
 * @returns {Promise<CliResult>}
 */
export async function cliWith({ env = {} }, cwd, ...args) {
  const stdout = collector();
  const stderr = collector();
  await nextMillisecond();
  const status = await main(args, { cwd, env: { ...process.env, ...env }, stdout, stderr });
  await nextMillisecond();
  return { status, stdout: stdout.text(), stderr: stderr.text() };
}

/**
 * @param {string} cwd
 * @param {...string} args
 * @returns {Promise<CliResult>}
 */
export const cli = (cwd, ...args) => cliWith({}, cwd, ...args);
