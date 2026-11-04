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

/** @typedef {{ files: number, bytes: number, reason?: 'timeout' | 'overflow' }} RunSize */
/** @typedef {(cwd: string, args: readonly string[], options?: import('./git.js').GitOptions) => { status: number | null, stdout: string, stderr: string, error?: Error }} GitRunner */
/** @typedef {{ maxBuffer?: number, timeout?: number, git?: GitRunner }} SizeOptions */

// A git call that takes longer than this is cut off and the Run counts as over the limit (two calls, so up to twice this).
export const GIT_TIMEOUT_MS = 60_000;

// The size of the committed work of a Run, base_sha..HEAD, in files and bytes of diff, without lockfiles and test/fixtures. Read-only. Undefined when the base is unknown or git fails, so nothing waits and nothing warns. A diff that overflows the output buffer and a git call that times out are not unknown: they count as over the limit, with the `reason`, because failing open would let a huge or hung Run pass the size gate.
/**
 * @param {string} projectDir
 * @param {string | undefined} id
 * @param {SizeOptions} [options] `maxBuffer`, `timeout` and `git` are for tests
 * @returns {RunSize | undefined}
 */
export function runSize(
  projectDir,
  id,
  { maxBuffer = 256 * 1024 * 1024, timeout = GIT_TIMEOUT_MS, git: run = runGit } = {},
) {
  const { record } = readRun(projectDir, id);
  const base = record.base_sha;
  if (!record.worktree || !base || !/^[0-9a-f]{40,64}$/.test(base)) return undefined;
  const plain = ['--no-ext-diff', '--no-textconv', '--no-color'];
  /** @param {...string} args */
  const git = (...args) => run(record.worktree ?? '', args, { maxBuffer, timeout });
  const diff = git('diff', ...plain, base, 'HEAD', '--', ...PATHSPEC);
  const names = git('diff', ...plain, '-z', '--name-only', base, 'HEAD', '--', ...PATHSPEC);
  const failed = (/** @type {RegExp} */ code) => (/** @type {{ error?: Error }} */ r) =>
    code.test(String(/** @type {any} */ (r.error)?.code));
  const timedOut = failed(/^ETIMEDOUT$/);
  const overflowed = failed(/^(ENOBUFS|ERR_CHILD_PROCESS_STDIO_MAXBUFFER)$/);
  const reason = [diff, names].some(timedOut) ? 'timeout' : [diff, names].some(overflowed) ? 'overflow' : undefined;
  if (reason)
    return {
      files: names.status === 0 ? names.stdout.split('\0').filter(Boolean).length : MAX_FILES + 1,
      bytes: Math.max(maxBuffer, MAX_DIFF_BYTES) + 1,
      reason,
    };
  if (diff.status !== 0 || names.status !== 0) return undefined;
  return { files: names.stdout.split('\0').filter(Boolean).length, bytes: Buffer.byteLength(diff.stdout) };
}

const UNKNOWN_SIZE = 'size unknown: git timed out (or its output was too large), counted as over the limit';

// What `run size` prints: the numbers, or the reason instead of the sentinel numbers of a measurement that counted as over the limit.
/** @param {RunSize} size */
export const describeSize = (size) =>
  size.reason ? UNKNOWN_SIZE : `${size.files} file${size.files === 1 ? '' : 's'}, ${Math.round(size.bytes / 1024)} KB`;

// Read-only. A Run whose diff is bigger than Check can read inline reaches Check in pieces, so it is flagged before Check; it never refuses the transition because the size is an estimate.
/**
 * @param {string} projectDir
 * @param {string | undefined} id
 * @param {SizeOptions} [options]
 */
export function sizeWarnings(projectDir, id, options) {
  const { record } = readRun(projectDir, id);
  const size = runSize(projectDir, id, options);
  const base = record.base_sha;
  if (!size || !record.worktree || !base) return [];
  const commits = runGit(record.worktree, ['rev-list', '--count', '--no-merges', `${base}..HEAD`]);
  if (commits.status !== 0) return [];
  /** @type {string[]} */
  const warnings = [];
  const { bytes, files } = size;
  // After the user accepted the size, the Run is not told again.
  if (!record.size_accepted && size.reason)
    warnings.push('the Run size is unknown (git timed out or its output was too large), counted as over the limit');
  else if (!record.size_accepted && bytes > MAX_DIFF_BYTES)
    warnings.push(
      `the diff is ${Math.round(bytes / 1024)} KB, above about ${MAX_DIFF_BYTES / 1024} KB, so Check reviewers get it in pieces`,
    );
  if (!record.size_accepted && !size.reason && files > MAX_FILES)
    warnings.push(`the diff touches ${files} files, above about ${MAX_FILES}`);
  const made = Number(commits.stdout.trim());
  const total = record.tickets_total ?? 0;
  if (total > 1 && made < total)
    warnings.push(`the branch has ${made} commit(s) for ${total} Tickets; Build commits once per Ticket`);
  return warnings;
}
