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
    if (input !== undefined) child.stdin?.end(input);
  });
