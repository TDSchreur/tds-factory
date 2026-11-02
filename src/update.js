import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleepFor } from 'node:timers/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { messageOf, codeOf } from './narrow.js';
import { FactoryError } from './errors.js';

const REPO = 'TDSchreur/tds-factory';
const ASSET = 'tds-factory.tgz';
const ATTEMPTS = 3;
// How long one request may take, from the first byte sent to the last byte of the body. The tarball is much bigger than the rest.
const TIMEOUT_MS = 30_000;
const DOWNLOAD_FACTOR = 4;
const DOWNLOADS = `/${REPO}/releases/download/`;
const USER_AGENT = { 'User-Agent': 'tds-factory' };

/** @typedef {{ core: number[], pre: string | undefined }} Version */
/** @typedef {{ sleep: (ms: number) => Promise<unknown>, warn: (message: string) => void, timeoutMs: number }} Retry */

/**
 * @param {string} text
 * @returns {Version}
 */
function parseVersion(text) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(text);
  if (!m) throw new Error(`Cannot parse version '${text}'`);
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] };
}

// Negative when a < b, 0 when equal, positive when a > b. A prerelease sorts below its release; identifiers compare per semver.
/**
 * @param {string} a
 * @param {string} b
 */
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
/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ inherit?: boolean, cwd?: string }} [options]
 */
function defaultRun(cmd, args, { inherit = false, cwd } = {}) {
  const win = process.platform === 'win32';
  // cmd.exe looks in the current folder before PATH; this switch and the cwd the caller passes keep a file planted there from running.
  const env = win ? { ...process.env, NoDefaultCurrentDirectoryInExePath: '1' } : process.env;
  const result = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', stdio: inherit ? 'inherit' : 'pipe', shell: win });
  if (result.error) throw result.error;
  return result;
}

// Parsed, not prefix-matched: a URL with `..` or encoded separators must not resolve into another repository.
/** @param {string} text */
function isReleaseAsset(text) {
  try {
    const url = new URL(text);
    return (
      url.href === text &&
      url.origin === 'https://github.com' &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith(DOWNLOADS) &&
      !url.search &&
      !url.hash
    );
  } catch {
    // Text that is not a URL is not a Release asset.
    return false;
  }
}

// A rate limit or an error answer from the server may pass; any other status will not, so it is not worth waiting for.
/** @param {number} status */
const transient = (status) => status === 429 || status >= 500;

/**
 * @param {string} what
 * @param {number} status
 */
function statusError(what, status) {
  return new FactoryError(`${what} answered ${status}`, {
    code: transient(status) ? 'http-transient' : 'http-permanent',
  });
}

/**
 * Runs `action` up to ATTEMPTS times, each with a fresh signal that aborts after `ms`. A request that runs out of time is a
 * transient `timeout`, retried like a server error.
 * @template T
 * @param {string} what
 * @param {(signal: AbortSignal) => Promise<T>} action
 * @param {Retry} retry
 * @param {number} [ms]
 * @returns {Promise<T>}
 */
async function withRetry(what, action, { sleep, warn, timeoutMs }, ms = timeoutMs) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await action(AbortSignal.timeout(ms));
    } catch (raw) {
      const err =
        raw instanceof Error && raw.name === 'TimeoutError'
          ? new FactoryError(`${what} timed out after ${ms / 1000}s`, { code: 'timeout', cause: raw })
          : raw;
      if (attempt === ATTEMPTS || codeOf(err) === 'http-permanent') throw err;
      warn(`${what} failed (attempt ${attempt}/${ATTEMPTS}): ${messageOf(err)}`);
      await sleep(1000 * 2 ** attempt);
    }
  }
}

/**
 * @param {typeof fetch} fetchFn
 * @param {string} url
 * @param {RequestInit} options
 * @param {string} what
 */
async function fetchOk(fetchFn, url, options, what) {
  const response = await fetchFn(url, options);
  if (!response.ok) throw statusError(what, response.status);
  return response;
}

// The API is rate limited when unauthenticated, so fall back to where /releases/latest redirects to.
/**
 * @param {{ fetchFn: typeof fetch, env: NodeJS.ProcessEnv, retry: Retry }} options
 * @returns {Promise<{ version: Version, tag: string, url: string, hasChecksum: boolean }>}
 */
async function latestRelease({ fetchFn, env, retry }) {
  /** @type {Record<string, string>} */
  const headers = { ...USER_AGENT, Accept: 'application/vnd.github+json' };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  try {
    /** @type {any} The GitHub API answer: data, whose fields are checked below. */
    const release = await withRetry(
      'GitHub API',
      async (signal) =>
        (
          await fetchOk(
            fetchFn,
            `https://api.github.com/repos/${REPO}/releases/latest`,
            { headers, signal },
            'GitHub API',
          )
        ).json(),
      retry,
    );
    /** @type {{ name: string, browser_download_url: string }[] | undefined} */
    const assets = release.assets;
    const asset = assets?.find((a) => a.name === ASSET);
    if (!asset) throw new Error(`Release ${release.tag_name} has no asset '${ASSET}'`);
    // The API answer is data: only a download from this repository's Releases is ever fetched.
    if (!isReleaseAsset(asset.browser_download_url)) throw new Error(`the asset URL is not a Release asset of ${REPO}`);
    return {
      version: parseVersion(release.tag_name),
      tag: release.tag_name,
      url: asset.browser_download_url,
      hasChecksum: !!assets?.some((a) => a.name === `${ASSET}.sha256`),
    };
  } catch (err) {
    retry.warn(`API lookup failed (${messageOf(err)}); falling back to the release redirect`);
    const response = await withRetry(
      'redirect lookup',
      async (signal) => {
        const answer = await fetchFn(`https://github.com/${REPO}/releases/latest`, {
          method: 'HEAD',
          redirect: 'manual',
          headers: USER_AGENT,
          signal,
        });
        if (transient(answer.status)) throw statusError('redirect lookup', answer.status);
        return answer;
      },
      retry,
    );
    const tag = /\/tag\/([^/]+)$/.exec(response.headers.get('location') ?? '')?.[1];
    if (!tag) throw new Error(`Could not determine the latest Release (${messageOf(err)})`);
    return {
      version: parseVersion(tag),
      tag,
      url: `https://github.com${DOWNLOADS}${tag}/${ASSET}`,
      hasChecksum: false,
    };
  }
}

// The Release's `<asset>.sha256` holds the hash and file name as `sha256sum` prints them. Releases from before the file
// existed answer 404; those warn instead of failing. Anything else wrong with the file stops the update.
/**
 * @param {string} url
 * @param {boolean} required
 * @param {{ fetchFn: typeof fetch, retry: Retry }} options
 */
async function expectedHash(url, required, { fetchFn, retry }) {
  const response = await withRetry(
    'checksum download',
    async (signal) => {
      const answer = await fetchFn(url, { headers: USER_AGENT, signal });
      if (!answer.ok && answer.status !== 404) throw statusError('checksum download', answer.status);
      // The body is read here, inside the bound, so a server that stalls after the headers also ends.
      return { status: answer.status, text: answer.status === 404 ? '' : await answer.text() };
    },
    retry,
  );
  if (response.status === 404) {
    // A Release that lists the file but does not serve it is broken or tampered with, so that never passes as "no checksum".
    if (required) throw new Error('the Release lists a checksum file but it could not be downloaded');
    return undefined;
  }
  const hash = /^([0-9a-f]{64})(?:\s|$)/i.exec(response.text.trim())?.[1];
  if (!hash) throw new Error('the checksum file is not a sha256 hash');
  return hash.toLowerCase();
}

/** @param {Version} version */
const formatVersion = ({ core, pre }) => core.join('.') + (pre ? `-${pre}` : '');
/** @param {string} what @param {{ status: number | null }} result */
const exitText = (what, result) => `'${what}' failed with exit code ${result.status}`;

// Installs the latest Release when the installed version is older, then refreshes the Skills and Stage agents with the
// freshly installed code, so the two always match. Everything that touches the world is a parameter, for tests.
/**
 * @param {object} options
 * @param {string} options.installed
 * @param {boolean} [options.force]
 * @param {typeof fetch} [options.fetchFn]
 * @param {(cmd: string, args: string[], options?: { inherit?: boolean, cwd?: string }) => { status: number | null, stdout?: string | null }} [options.run]
 * @param {(ms: number) => Promise<unknown>} [options.sleep]
 * @param {string} [options.tmpdir]
 * @param {string} [options.home]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {(message: string) => void} [options.log]
 * @param {(message: string) => void} [options.warn]
 * @param {number} [options.timeoutMs] How long one small request may take; the download may take four times as long.
 */
export async function update({
  installed,
  force = true,
  fetchFn = fetch,
  run = defaultRun,
  sleep = sleepFor,
  tmpdir = os.tmpdir(),
  home = os.homedir(),
  env = process.env,
  log = console.log,
  warn = console.warn,
  timeoutMs = TIMEOUT_MS,
}) {
  const retry = { sleep, warn, timeoutMs };
  const latest = await latestRelease({ fetchFn, env, retry });
  const compared = compareVersions(installed, latest.tag);
  log(`installed ${installed}, latest Release ${formatVersion(latest.version)}`);

  if (compared > 0) {
    log(
      `installed version ${installed} is newer than the latest Release (${formatVersion(latest.version)}); nothing to do`,
    );
    return;
  }
  if (compared === 0) log(`already on the latest version (${installed}); skipping npm install`);
  else {
    using tmp = fs.mkdtempDisposableSync(path.join(tmpdir, 'tds-factory-'));
    const dir = tmp.path;
    const file = path.join(dir, ASSET);
    await withRetry(
      'download',
      async (signal) => {
        fs.writeFileSync(
          file,
          Buffer.from(
            await (await fetchOk(fetchFn, latest.url, { headers: USER_AGENT, signal }, 'download')).arrayBuffer(),
          ),
        );
        if (fs.statSync(file).size < 1024) throw new Error('downloaded file is suspiciously small');
      },
      retry,
      retry.timeoutMs * DOWNLOAD_FACTOR,
    );
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
    const now = (run('tds-factory', ['--version'], { cwd: home }).stdout ?? '').trim();
    if (compareVersions(now, latest.tag) !== 0)
      throw new Error(`installed version is '${now}', expected ${formatVersion(latest.version)}`);
    log(`installed ${now}`);
  }

  if (force)
    warn(
      'using --force: edited agent files and skills, and same-named skills that tds-factory did not install, are replaced (use --no-force to keep them)',
    );
  const args = force ? ['install', '--force'] : ['install'];
  const skills = run('tds-factory', args, { inherit: true, cwd: home });
  if (skills.status !== 0) throw new Error(exitText(`tds-factory ${args.join(' ')}`, skills));
}
