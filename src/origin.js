import { spawnSync } from 'node:child_process';

// The default branch of `origin`, read from the remote without fetching or writing anything.
export function originDefaultBranch(cwd) {
  const git = (...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  const remoteHead = git('ls-remote', '--symref', 'origin', 'HEAD');
  const branch = remoteHead.status === 0 && remoteHead.stdout.match(/^ref: refs\/heads\/([^\s]+)\s+HEAD$/m)?.[1];
  if (!branch || git('check-ref-format', '--branch', branch).status !== 0) return { error: remoteHead.stderr.trim() || 'origin has no default branch' };
  return { branch };
}
