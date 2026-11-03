// @ts-check
import { git as runGit } from './git.js';
import { readRun } from './run-folder.js';

export const MAX_DIFF_BYTES = 40 * 1024;
export const MAX_FILES = 15;
// The reason a Run waits on the user when it outgrows the limit during Build (ADR 0035); `run split` and `run size --accept` check for it.
export const SIZE_WAIT_REASON = 'Run size over the limit: split the remaining Tickets into a new Run?';

/** @param {{ files: number, bytes: number }} size */
export const overLimit = (size) => size.bytes > MAX_DIFF_BYTES || size.files > MAX_FILES;

const LOCKFILES = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  'Cargo.lock',
  'Gemfile.lock',
  'poetry.lock',
  'Pipfile.lock',
  'composer.lock',
  'go.sum',
  'packages.lock.json',
];
// Pathspecs: everything, minus what no reviewer reads. `**/name` matches at any depth, the root included.
const PATHSPEC = ['.', ...LOCKFILES.map((n) => `:(exclude,glob)**/${n}`), ':(exclude)test/fixtures'];

// The size of the committed work of a Run, base_sha..HEAD, in files and bytes of diff, without lockfiles and test/fixtures. Read-only. Undefined when the base is unknown or git fails, so nothing waits and nothing warns.
/**
 * @param {string} projectDir
 * @param {string | undefined} id
 * @returns {{ files: number, bytes: number } | undefined}
 */
export function runSize(projectDir, id) {
  const { record } = readRun(projectDir, id);
  const base = record.base_sha;
  if (!record.worktree || !base || !/^[0-9a-f]{40,64}$/.test(base)) return undefined;
  const plain = ['--no-ext-diff', '--no-textconv', '--no-color'];
  /** @param {...string} args */
  const git = (...args) => runGit(record.worktree ?? '', args, { maxBuffer: 256 * 1024 * 1024 });
  const diff = git('diff', ...plain, base, 'HEAD', '--', ...PATHSPEC);
  const names = git('diff', ...plain, '-z', '--name-only', base, 'HEAD', '--', ...PATHSPEC);
  if (diff.status !== 0 || names.status !== 0) return undefined;
  return { files: names.stdout.split('\0').filter(Boolean).length, bytes: Buffer.byteLength(diff.stdout) };
}

// Read-only. A Run whose diff is bigger than Check can read inline reaches Check in pieces, so it is flagged before Check; it never refuses the transition because the size is an estimate.
/**
 * @param {string} projectDir
 * @param {string | undefined} id
 */
export function sizeWarnings(projectDir, id) {
  const { record } = readRun(projectDir, id);
  const size = runSize(projectDir, id);
  const base = record.base_sha;
  if (!size || !record.worktree || !base) return [];
  const commits = runGit(record.worktree, ['rev-list', '--count', '--no-merges', `${base}..HEAD`]);
  if (commits.status !== 0) return [];
  /** @type {string[]} */
  const warnings = [];
  const { bytes, files } = size;
  // After the user accepted the size, the Run is not told again.
  if (!record.size_accepted && bytes > MAX_DIFF_BYTES)
    warnings.push(
      `the diff is ${Math.round(bytes / 1024)} KB, above about ${MAX_DIFF_BYTES / 1024} KB, so Check reviewers get it in pieces`,
    );
  if (!record.size_accepted && files > MAX_FILES)
    warnings.push(`the diff touches ${files} files, above about ${MAX_FILES}`);
  const made = Number(commits.stdout.trim());
  const total = record.tickets_total ?? 0;
  if (total > 1 && made < total)
    warnings.push(`the branch has ${made} commit(s) for ${total} Tickets; Build commits once per Ticket`);
  return warnings;
}
