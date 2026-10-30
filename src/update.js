import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const REPO = 'TDSchreur/tds-factory';
const ASSET = 'tds-factory.tgz';
const ATTEMPTS = 3;
const DOWNLOADS = `https://github.com/${REPO}/releases/download/`;
const USER_AGENT = { 'User-Agent': 'tds-factory' };

function parseVersion(text) {
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
function defaultRun(cmd, args, { inherit = false, cwd } = {}) {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', stdio: inherit ? 'inherit' : 'pipe', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  return result;
}

// A rate limit or an error answer from the server may pass; any other status will not, so it is not worth waiting for.
function statusError(what, status) {
  const err = new Error(`${what} answered ${status}`);
  err.permanent = status !== 429 && status < 500;
  return err;
}

async function withRetry(what, action, { sleep, warn }) {
  for (let attempt = 1; ; attempt++) {
    try { return await action(); } catch (err) {
      if (attempt === ATTEMPTS || err.permanent) throw err;
      warn(`${what} failed (attempt ${attempt}/${ATTEMPTS}): ${err.message}`);
      await sleep(1000 * 2 ** attempt);
    }
  }
}

async function fetchOk(fetchFn, url, options, what) {
  const response = await fetchFn(url, options);
  if (!response.ok) throw statusError(what, response.status);
  return response;
}

// The API is rate limited when unauthenticated, so fall back to where /releases/latest redirects to.
async function latestRelease({ fetchFn, env, retry }) {
  const headers = { ...USER_AGENT, Accept: 'application/vnd.github+json' };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  try {
    const release = await withRetry('GitHub API', async () => (await fetchOk(fetchFn, `https://api.github.com/repos/${REPO}/releases/latest`, { headers }, 'GitHub API')).json(), retry);
    const asset = release.assets?.find((a) => a.name === ASSET);
    if (!asset) throw new Error(`Release ${release.tag_name} has no asset '${ASSET}'`);
    // The API answer is data: only a download from this repository's Releases is ever fetched.
    if (!asset.browser_download_url?.startsWith(DOWNLOADS)) throw new Error(`the asset URL is not a Release asset of ${REPO}`);
    return { version: parseVersion(release.tag_name), tag: release.tag_name, url: asset.browser_download_url, hasChecksum: release.assets.some((a) => a.name === `${ASSET}.sha256`) };
  } catch (err) {
    retry.warn(`API lookup failed (${err.message}); falling back to the release redirect`);
    const response = await withRetry('redirect lookup', async () => {
      const answer = await fetchFn(`https://github.com/${REPO}/releases/latest`, { method: 'HEAD', redirect: 'manual', headers: USER_AGENT });
      if (answer.status === 429 || answer.status >= 500) throw statusError('redirect lookup', answer.status);
      return answer;
    }, retry);
    const tag = /\/tag\/([^/]+)$/.exec(response.headers.get('location') ?? '')?.[1];
    if (!tag) throw new Error(`Could not determine the latest Release (${err.message})`);
    return { version: parseVersion(tag), tag, url: `${DOWNLOADS}${tag}/${ASSET}`, hasChecksum: false };
  }
}

// The Release's `<asset>.sha256` holds the hash and file name as `sha256sum` prints them. Releases from before the file
// existed answer 404; those warn instead of failing. Anything else wrong with the file stops the update.
async function expectedHash(url, required, { fetchFn, retry }) {
  const response = await withRetry('checksum download', async () => {
    const answer = await fetchFn(url, { headers: USER_AGENT });
    if (!answer.ok && answer.status !== 404) throw statusError('checksum download', answer.status);
    return answer;
  }, retry);
  if (response.status === 404) {
    // A Release that lists the file but does not serve it is broken or tampered with, so that never passes as "no checksum".
    if (required) throw new Error('the Release lists a checksum file but it could not be downloaded');
    return undefined;
  }
  const hash = /^([0-9a-f]{64})(?:\s|$)/i.exec((await response.text()).trim())?.[1];
  if (!hash) throw new Error('the checksum file is not a sha256 hash');
  return hash.toLowerCase();
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
        fs.writeFileSync(file, Buffer.from(await (await fetchOk(fetchFn, latest.url, { headers: USER_AGENT }, 'download')).arrayBuffer()));
        if (fs.statSync(file).size < 1024) throw new Error('downloaded file is suspiciously small');
      }, retry);
      const expected = await expectedHash(`${latest.url}.sha256`, latest.hasChecksum, { fetchFn, retry });
      if (!expected) warn(`this Release has no checksum file; the download was not verified`);
      else {
        const actual = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
        if (actual !== expected) throw new Error(`checksum mismatch: expected ${expected}, got ${actual}`);
        log('checksum ok');
      }
      log(`installing ${latest.tag} with npm`);
      // A relative name inside the download folder: on Windows a shell would split a temp path that contains spaces.
      const npm = run('npm', ['install', '-g', ASSET], { inherit: true, cwd: dir });
      if (npm.status !== 0) throw new Error(exitText(`npm install -g ${ASSET}`, npm));
      const now = (run('tds-factory', ['--version']).stdout ?? '').trim();
      if (compareVersions(now, latest.tag) !== 0) throw new Error(`installed version is '${now}', expected ${formatVersion(latest.version)}`);
      log(`installed ${now}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  if (force) warn('using --force: edited agent files, and skills with the same names that tds-factory did not install, are replaced (use --no-force to keep them)');
  const args = force ? ['install', '--force'] : ['install'];
  const skills = run('tds-factory', args, { inherit: true });
  if (skills.status !== 0) throw new Error(exitText(`tds-factory ${args.join(' ')}`, skills));
}
