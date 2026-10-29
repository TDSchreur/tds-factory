// Installs the CLI and skills as they are on the default branch of origin, for developers of the Factory.
// Usage: node scripts/dev-install.js
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

let tmp;
try {
  git('fetch', '--quiet', 'origin');
  git('remote', 'set-head', 'origin', '--auto');
  const ref = git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD');
  tmp = mkdtempSync(join(tmpdir(), 'tds-factory-'));
  const archive = join(tmp, 'tds-factory.tgz');
  git('archive', '--format=tgz', '--prefix=package/', '-o', archive, ref);
  execFileSync('npm', ['install', '-g', archive], { stdio: 'inherit', shell: process.platform === 'win32' });
  console.log(`\nInstalled ${ref} at ${git('rev-parse', '--short', ref)}. Next, refresh the skills: tds-factory install`);
} catch (err) {
  console.error(`error: ${err.message.split('\n')[0]}`);
  process.exitCode = 1;
} finally {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
}
