import { spawnSync } from 'node:child_process';

// Never prompt and never wait forever: Preflight must answer even when the remote does not.
const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '' };

// The default branch of `origin`, read from the remote without fetching or writing anything.
export function originDefaultBranch(cwd) {
  const git = (...args) => spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 20000, env: gitEnv });
  const remoteHead = git('ls-remote', '--symref', 'origin', 'HEAD');
  const branch = remoteHead.status === 0 && remoteHead.stdout.match(/^ref: refs\/heads\/([^\s]+)\s+HEAD$/m)?.[1];
  if (remoteHead.error) return { error: `origin did not answer: ${remoteHead.error.message}` };
  if (!branch || branch.includes('@{') || git('check-ref-format', '--branch', branch).status !== 0)
    return { error: remoteHead.stderr.trim() || 'origin has no default branch' };
  return { branch };
}
