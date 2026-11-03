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
export const gitAsync = (cwd, args, options = {}) => commandAsync('git', cwd, args, options);

// Any other command a flow runs, such as the PR provider's `gh` (the adapters name the command; this module does not).
/**
 * @param {string} file
 * @param {string | undefined} cwd
 * @param {readonly string[]} args
 * @param {GitOptions} [options]
 */
export const command = (file, cwd, args, options = {}) => spawnSync(file, args, { cwd, encoding: 'utf8', ...options });
/**
 * @param {string} file
 * @param {string | undefined} cwd
 * @param {readonly string[]} args
 * @param {GitOptions} [options]
 * @returns {Promise<{ status: number | null, stdout: string, stderr: string, error?: Error }>}
 */
export const commandAsync = (file, cwd, args, options = {}) =>
  new Promise((resolve) => {
    const { input, ...rest } = options;
    const child = execFile(file, args, { cwd, encoding: 'utf8', ...rest }, (error, stdout, stderr) => {
      if (!error) return resolve({ status: 0, stdout, stderr });
      const code = /** @type {{ code?: unknown }} */ (error).code;
      if (typeof code === 'number') return resolve({ status: code, stdout, stderr });
      // A real timeout is marked; a maxBuffer overflow also kills the child but keeps its own code.
      const failure = /** @type {Error & { killed?: boolean, signal?: string | null, timedOut?: boolean }} */ (error);
      if (failure.killed === true && failure.signal === 'SIGTERM' && code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
        failure.timedOut = true;
      resolve({ status: null, stdout, stderr, error });
    });
    // spawnSync gives the child no input and closes its stdin; execFile leaves it open, so a command that reads stdin would hang.
    if (input !== undefined) child.stdin?.end(input);
    else child.stdin?.end();
  });

// A flow is written once as a generator that yields its git calls and locks (`yield* gitStep(...)`), and runs
// blocking for the CLI (runSync) or without blocking the event loop for the Dashboard (runAsync).
/**
 * @typedef {{ git: [string, readonly string[], GitOptions] } | { command: [string, string | undefined, readonly string[], GitOptions] } | { call: () => unknown }} Step
 * @typedef {Generator<Step, any, unknown>} Flow The answers of a step differ per step, so a flow cannot type them.
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
// A command other than git in a flow, with the same result as a git call.
/**
 * @param {string} file
 * @param {string | undefined} cwd
 * @param {readonly string[]} args
 * @param {GitOptions} [options]
 * @returns {Generator<Step, ReturnType<typeof command>, any>}
 */
export function* commandStep(file, cwd, args, options = {}) {
  return yield { command: [file, cwd, args, options] };
}
// Any other blocking call of a flow, such as taking a lock; runAsync also awaits what it returns.
/**
 * @template T
 * @param {() => T} call
 * @returns {Generator<Step, Awaited<T>, any>} `any` is what a flow sends back in; the runner answers with the call's awaited result
 */
export function* callStep(call) {
  return yield { call };
}
// A flow that makes no calls, for a plain function used where a flow is expected.
/**
 * @template T
 * @param {T} value
 * @returns {Generator<Step, T, unknown>}
 */
// eslint-disable-next-line require-yield -- a flow with no steps still has to be a generator
export function* immediate(value) {
  return value;
}
/** @param {Step} step */
const performSync = (step) =>
  'git' in step ? git(...step.git) : 'command' in step ? command(...step.command) : step.call();
/** @param {Step} step */
const performAsync = async (step) =>
  'git' in step ? gitAsync(...step.git) : 'command' in step ? commandAsync(...step.command) : step.call();

/**
 * @template T
 * @param {Generator<Step, T, unknown>} flow
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
 * @param {Generator<Step, T, unknown>} flow
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
