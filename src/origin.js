// @ts-check
/** @import { Step } from './git.js' */
import { gitStep, runSync } from './git.js';

const TIMEOUT_MS = 20000;
// Never prompt and never wait forever: Preflight must answer even when the remote does not. Git Credential Manager
// ignores GIT_TERMINAL_PROMPT and opens its own browser or dialog, so it gets GCM_INTERACTIVE=never and fails fast.
const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '', GCM_INTERACTIVE: 'never' };

// The default branch of `origin`, read from the remote without fetching or writing anything.
/**
 * @param {string} cwd
 * @returns {Generator<Step, { branch?: string, error?: string }, any>}
 */
export function* originDefaultBranchFlow(cwd) {
  /** @param {...string} args */
  const git = (...args) => gitStep(cwd, args, { timeout: TIMEOUT_MS, env: gitEnv });
  const remoteHead = yield* git('ls-remote', '--symref', 'origin', 'HEAD');
  const branch = remoteHead.status === 0 && remoteHead.stdout.match(/^ref: refs\/heads\/([^\s]+)\s+HEAD$/m)?.[1];
  if (remoteHead.error) {
    const failure = /** @type {NodeJS.ErrnoException & { killed?: boolean }} */ (remoteHead.error);
    // spawnSync reports a timeout as ETIMEDOUT, execFile as a killed child.
    const timedOut = failure.code === 'ETIMEDOUT' || failure.killed === true;
    return {
      error: timedOut
        ? `origin did not answer within ${TIMEOUT_MS / 1000}s; check the network, or a credential helper waiting for a login`
        : `origin did not answer: ${remoteHead.error.message}`,
    };
  }
  if (!branch || branch.includes('@{') || (yield* git('check-ref-format', '--branch', branch)).status !== 0)
    return { error: remoteHead.stderr.trim() || 'origin has no default branch' };
  return { branch };
}
/** @param {string} cwd */
export const originDefaultBranch = (cwd) => runSync(originDefaultBranchFlow(cwd));
