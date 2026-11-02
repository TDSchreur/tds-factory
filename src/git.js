// @ts-check
import { execFile, spawnSync } from 'node:child_process';

/** @typedef {{ timeout?: number, env?: NodeJS.ProcessEnv, maxBuffer?: number, input?: string }} GitOptions */

// Runs `git` in `cwd` and returns the spawnSync result with text output; a failure to start or a timeout is in `error`.
/**
 * @param {string} cwd
 * @param {readonly string[]} args
 * @param {GitOptions} [options]
 */
export const git = (cwd, args, options = {}) => spawnSync('git', args, { cwd, encoding: 'utf8', ...options });

// The same call without blocking the event loop. It never rejects: a non-zero exit or a failure to start is in the result.
/**
 * @param {string} cwd
 * @param {readonly string[]} args
 * @param {GitOptions} [options]
 * @returns {Promise<{ status: number | null, stdout: string, stderr: string, error?: Error }>}
 */
export const gitAsync = (cwd, args, options = {}) =>
  new Promise((resolve) => {
    const { input, ...rest } = options;
    const child = execFile('git', args, { cwd, encoding: 'utf8', ...rest }, (error, stdout, stderr) => {
      if (!error) return resolve({ status: 0, stdout, stderr });
      const code = /** @type {{ code?: unknown }} */ (error).code;
      if (typeof code === 'number') return resolve({ status: code, stdout, stderr });
      resolve({ status: null, stdout, stderr, error });
    });
    // spawnSync gives the child no input and closes its stdin; execFile leaves it open, so a command that reads stdin would hang.
    if (input !== undefined) child.stdin?.end(input);
    else child.stdin?.end();
  });

// A flow is written once as a generator that yields its git calls and locks (`yield* gitStep(...)`), and runs
// blocking for the CLI (runSync) or without blocking the event loop for the Dashboard (runAsync).
/**
 * @typedef {{ git: [string, readonly string[], GitOptions] } | { call: () => unknown }} Step
 * @typedef {Generator<Step, any, any>} Flow The answers of a step differ per step, so a flow cannot type them.
 */
/**
 * @param {string} cwd
 * @param {readonly string[]} args
 * @param {GitOptions} [options]
 * @returns {Generator<Step, ReturnType<typeof git>, any>} `any` is what a flow sends back in; the answer is a git result
 */
export function* gitStep(cwd, args, options = {}) {
  return yield { git: [cwd, args, options] };
}
// Any other blocking call of a flow, such as taking a lock; runAsync also awaits what it returns.
/**
 * @template T
 * @param {() => T} call
 * @returns {Generator<Step, Awaited<T>, any>}
 */
export function* callStep(call) {
  return yield { call };
}
// A flow that makes no calls, for a plain function used where a flow is expected.
/**
 * @template T
 * @param {T} value
 * @returns {Generator<Step, T, any>}
 */
// eslint-disable-next-line require-yield -- a flow with no steps still has to be a generator
export function* immediate(value) {
  return value;
}
/** @param {Step} step */
const performSync = (step) => ('git' in step ? git(...step.git) : step.call());
/** @param {Step} step */
const performAsync = async (step) => ('git' in step ? gitAsync(...step.git) : step.call());

/**
 * @template T
 * @param {Generator<Step, T, any>} flow
 * @returns {T}
 */
export function runSync(flow) {
  let next = flow.next();
  while (!next.done) {
    let answer;
    try {
      answer = performSync(next.value);
    } catch (err) {
      next = flow.throw(err);
      continue;
    }
    next = flow.next(answer);
  }
  return next.value;
}
/**
 * @template T
 * @param {Generator<Step, T, any>} flow
 * @returns {Promise<T>}
 */
export async function runAsync(flow) {
  let next = flow.next();
  while (!next.done) {
    let answer;
    try {
      answer = await performAsync(next.value);
    } catch (err) {
      next = flow.throw(err);
      continue;
    }
    next = flow.next(answer);
  }
  return next.value;
}
