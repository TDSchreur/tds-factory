// @ts-check
// Runs each unit test file a pull request changed several times, to catch a test that is only sometimes red.
// Usage: node scripts/repeat-changed-tests.js [--repeat N] [<git diff args>]   (default: HEAD^1 HEAD, the merge commit CI checks out)
//        node scripts/repeat-changed-tests.js [--repeat N] --files <path>...    (the changed paths are given)
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * @param {string[]} paths
 * @returns {string[]} The unit test files among the paths, with forward slashes.
 */
export function pickUnitTests(paths) {
  return paths
    .map((p) => p.replaceAll('\\', '/'))
    .filter((p) => /^test\/[^/]+\.test\.js$/.test(p) && !p.endsWith('-browser.test.js'));
}

function main() {
  const args = process.argv.slice(2);
  let repeat = 3;
  const at = args.indexOf('--repeat');
  if (at !== -1) {
    repeat = Number(args[at + 1]);
    args.splice(at, 2);
    if (!Number.isInteger(repeat) || repeat < 1) throw new Error('--repeat needs a positive whole number');
  }
  /** @type {string[]} */
  let changed;
  if (args[0] === '--files') changed = args.slice(1);
  else {
    const diff = spawnSync(
      'git',
      ['diff', '--name-only', '--diff-filter=d', ...(args.length ? args : ['HEAD^1', 'HEAD'])],
      {
        encoding: 'utf8',
      },
    );
    if (diff.status !== 0) throw new Error(`git diff failed: ${diff.stderr}`);
    changed = diff.stdout.split('\n').filter(Boolean);
  }
  const files = pickUnitTests(changed);
  if (files.length === 0) {
    console.log('No changed unit test file to repeat.');
    return;
  }
  for (let round = 1; round <= repeat; round++) {
    console.log(`Repeat ${round}/${repeat}: ${files.join(' ')}`);
    const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      console.error(`A changed test failed in repeat ${round}/${repeat}: it is flaky or broken.`);
      process.exitCode = result.status ?? 1;
      return;
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
