import { spawnSync } from 'node:child_process';
import { readRun } from './run-folder.js';

export const MAX_DIFF_BYTES = 40 * 1024;
export const MAX_FILES = 15;

// Read-only. A Run whose diff is bigger than Check can read inline reaches Check in pieces, so it is flagged before Check; it never refuses the transition because the size is an estimate.
export function sizeWarnings(projectDir, id) {
  const { record } = readRun(projectDir, id);
  if (!record.worktree || !/^[0-9a-f]{40,64}$/.test(record.base_sha ?? '')) return [];
  const git = (...args) => spawnSync('git', args, { cwd: record.worktree, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const plain = ['--no-ext-diff', '--no-textconv', '--no-color'];
  const diff = git('diff', ...plain, record.base_sha, 'HEAD');
  const names = git('diff', ...plain, '-z', '--name-only', record.base_sha, 'HEAD');
  const commits = git('rev-list', '--count', '--no-merges', `${record.base_sha}..HEAD`);
  if ([diff, names, commits].some((r) => r.status !== 0)) return [];
  const warnings = [];
  const bytes = Buffer.byteLength(diff.stdout);
  const files = names.stdout.split('\0').filter(Boolean).length;
  if (bytes > MAX_DIFF_BYTES) warnings.push(`the diff is ${Math.round(bytes / 1024)} KB, above about ${MAX_DIFF_BYTES / 1024} KB, so Check reviewers get it in pieces`);
  if (files > MAX_FILES) warnings.push(`the diff touches ${files} files, above about ${MAX_FILES}`);
  const made = Number(commits.stdout.trim());
  if (record.tickets_total > 1 && made < record.tickets_total) warnings.push(`the branch has ${made} commit(s) for ${record.tickets_total} Tickets; Build commits once per Ticket`);
  return warnings;
}
