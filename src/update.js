import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = 'TDSchreur/tds-factory';
const ASSET = 'tds-factory.tgz';
const ATTEMPTS = 3;

export function parseVersion(text) {
  const m = /(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(text);
  if (!m) throw new Error(`Cannot parse version '${text}'`);
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] };
}

// Negative when a < b, 0 when equal, positive when a > b. A prerelease sorts below its release; identifiers compare per semver.
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  if (!x.pre || !y.pre) return (x.pre ? 0 : 1) - (y.pre ? 0 : 1);
  const [p, q] = [x.pre.split('.'), y.pre.split('.')];
  for (let i = 0; i < Math.min(p.length, q.length); i++) {
    if (p[i] === q[i]) continue;
    const [n, m] = [/^\d+$/.test(p[i]), /^\d+$/.test(q[i])];
    if (n && m) return Number(p[i]) - Number(q[i]);
    if (n !== m) return n ? -1 : 1;
    return p[i] < q[i] ? -1 : 1;
  }
  return p.length - q.length;
}

// npm and tds-factory are .cmd shims on Windows, which spawn only runs through a shell.
function defaultRun(cmd, args, { inherit = false } = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', stdio: inherit ? 'inherit' : 'pipe', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  return result;
}

async function withRetry(what, action, { sleep, warn }) {
  for (let attempt = 1; ; attempt++) {
    try { return await action(); } catch (err) {
      if (attempt === ATTEMPTS) throw err;
      warn(`${what} failed (attempt ${attempt}/${ATTEMPTS}): ${err.message}`);
      await sleep(1000 * 2 ** attempt);
    }
  }
}

async function ok(fetchFn, url, options, what) {
  const response = await fetchFn(url, options);
  if (!response.ok) throw new Error(`${what} answered ${response.status}`);
  return response;
}

// The API is rate limited when unauthenticated, so fall back to where /releases/latest redirects to.
async function latestRelease({ fetchFn, env, retry }) {
  const headers = { 'User-Agent': 'tds-factory', Accept: 'application/vnd.github+json' };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  try {
    const release = await withRetry('GitHub API', async () => (await ok(fetchFn, `https://api.github.com/repos/${REPO}/releases/latest`, { headers }, 'GitHub API')).json(), retry);
    const asset = release.assets?.find((a) => a.name === ASSET);
    if (!asset) throw new Error(`Release ${release.tag_name} has no asset '${ASSET}'`);
    return { version: parseVersion(release.tag_name), tag: release.tag_name, url: asset.browser_download_url };
  } catch (err) {
    retry.warn(`API lookup failed (${err.message}); falling back to the release redirect`);
    const response = await withRetry('redirect lookup', () => fetchFn(`https://github.com/${REPO}/releases/latest`, { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': 'tds-factory' } }), retry);
    const tag = /\/tag\/([^/]+)$/.exec(response.headers.get('location') ?? '')?.[1];
    if (!tag) throw new Error(`Could not determine the latest Release (${err.message})`);
    return { version: parseVersion(tag), tag, url: `https://github.com/${REPO}/releases/download/${tag}/${ASSET}` };
  }
}

const formatVersion = ({ core, pre }) => core.join('.') + (pre ? `-${pre}` : '');
const exitText = (what, result) => `'${what}' failed with exit code ${result.status}`;

// Installs the latest Release when the installed version is older, then refreshes the Skills and Stage agents with the
// freshly installed code, so the two always match. Everything that touches the world is a parameter, for tests.
export async function update({
  installed,
  force = true,
  fetchFn = fetch,
  run = defaultRun,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  tmpdir = os.tmpdir(),
  env = process.env,
  log = console.log,
  warn = console.warn,
}) {
  const retry = { sleep, warn };
  const latest = await latestRelease({ fetchFn, env, retry });
  const compared = compareVersions(installed, latest.tag);
  log(`installed ${installed}, latest Release ${formatVersion(latest.version)}`);

  if (compared > 0) {
    log(`installed version ${installed} is newer than the latest Release (${formatVersion(latest.version)}); nothing to do`);
    return;
  }
  if (compared === 0) log(`already on the latest version (${installed}); skipping npm install`);
  else {
    const dir = fs.mkdtempSync(path.join(tmpdir, 'tds-factory-'));
    try {
      const file = path.join(dir, ASSET);
      await withRetry('download', async () => {
        fs.writeFileSync(file, Buffer.from(await (await ok(fetchFn, latest.url, { headers: { 'User-Agent': 'tds-factory' } }, 'download')).arrayBuffer()));
        if (fs.statSync(file).size < 1024) throw new Error('downloaded file is suspiciously small');
      }, retry);
      log(`installing ${latest.tag} with npm`);
      const npm = run('npm', ['install', '-g', file], { inherit: true });
      if (npm.status !== 0) throw new Error(exitText(`npm install -g ${ASSET}`, npm));
      const now = (run('tds-factory', ['--version']).stdout ?? '').trim();
      if (compareVersions(now, latest.tag) !== 0) throw new Error(`installed version is '${now}', expected ${formatVersion(latest.version)}`);
      log(`installed ${now}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  if (force) warn('using --force: edited agent files are replaced with the defaults (use --no-force to keep them)');
  const args = force ? ['install', '--force'] : ['install'];
  const skills = run('tds-factory', args, { inherit: true });
  if (skills.status !== 0) throw new Error(exitText(`tds-factory ${args.join(' ')}`, skills));
}
