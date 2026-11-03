// @ts-check
import { DEFAULT_PORT, startDashboard } from './dashboard.js';
import { openProjectRegistry, projectId } from './project-registry.js';
import { mainCheckout } from './run-folder.js';
import { compareVersions } from './update.js';
import { codeOf } from './narrow.js';

const HOST = '127.0.0.1';
const PROBE_TIMEOUT_MS = 1500;
const INFO_MAX_BYTES = 64 * 1024;
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** @param {unknown} value */
const semver = (value) => (typeof value === 'string' && value.length <= 64 && SEMVER.test(value) ? value : undefined);

/**
 * @param {Response} res
 * @param {number} maxBytes
 */
async function readLimitedText(res, maxBytes) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let seen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += value.byteLength;
    if (seen > maxBytes) {
      await reader.cancel('response too large');
      throw new Error('response too large');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** The pid and Factory version of the Dashboard that answers /api/info on a port, or undefined when nothing that looks like a shared (registry-backed) one does; a standalone --port server is a busy port. @param {number} port */
async function probe(port) {
  try {
    const res = await fetch(`http://${HOST}:${port}/api/info`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (res.status !== 200) return undefined;
    const body = await readLimitedText(res, INFO_MAX_BYTES);
    const info =
      /** @type {{ token?: unknown, project?: unknown, shared?: unknown, pid?: unknown, version?: unknown } | null} */ (
        JSON.parse(body)
      );
    if (typeof info?.token !== 'string' || typeof info?.project !== 'string' || info.shared !== true) return undefined;
    return {
      pid: typeof info?.pid === 'number' ? info.pid : undefined,
      version: semver(info?.version),
    };
  } catch {
    // nothing answered in time, so there is no Dashboard to reuse
    return undefined;
  }
}

/** @param {string} running @param {string} own */
const isOlder = (running, own) => {
  try {
    return compareVersions(running, own) < 0;
  } catch {
    // a version that is not semver is never reported as older
    return false;
  }
};

// The flow of `tds-factory dashboard`. With an explicit port it starts a standalone server. Otherwise it registers the Project and reuses the Dashboard that already answers (the state file, then the preferred port after a lost bind), or becomes that Dashboard.
// Resolves to { url, port, reused, close }; close stops the server this call started and is a no-op when it reused one.
/**
 * @param {object} options
 * @param {string} options.projectDir
 * @param {string} options.version The Factory version of this CLI.
 * @param {number} [options.port] An explicit port: standalone, no registry and no state file.
 * @param {number} [options.preferredPort]
 * @param {ReturnType<typeof openProjectRegistry>} [options.registry]
 * @param {(message: string) => void} [options.warn]
 */
export async function launchDashboard({
  projectDir,
  version,
  port,
  preferredPort = DEFAULT_PORT,
  warn = console.error,
  registry = openProjectRegistry({ warn: (m) => warn(`warning: ${m}`) }),
}) {
  if (port !== undefined) {
    const standalone = await startDashboard({ projectDir, port });
    return { url: standalone.url, port: standalone.port, reused: false, close: standalone.close };
  }
  const main = mainCheckout(projectDir).dir;
  const project = registry.join(projectDir);
  const id = project?.id ?? projectId(main);
  const collision = !project && registry.list().some((p) => p.path !== main && p.id === id);
  /** @param {number} onPort */
  const urlOn = (onPort) => `http://${HOST}:${onPort}/${collision ? '' : `?project=${id}`}`;
  /** @param {number} onPort @param {string | undefined} running */
  const reuse = (onPort, running) => {
    if (running && isOlder(running, version))
      warn(
        `warning: the running Dashboard is Factory ${running}, older than this CLI (${version}); stop it and run tds-factory dashboard again to update it`,
      );
    return { url: urlOn(onPort), port: onPort, reused: true, close: async () => {} };
  };

  const state = registry.readState();
  if (state) {
    const answer = await probe(state.port);
    if (answer && answer.pid === state.pid) return reuse(state.port, answer.version ?? semver(state.version));
  }

  /** @type {Awaited<ReturnType<typeof startDashboard>>} */
  let server;
  try {
    server = await startDashboard({ projectDir, port: preferredPort, registry });
  } catch (err) {
    if (codeOf(err) !== 'EADDRINUSE') throw err;
    const winner = await probe(preferredPort);
    if (winner) return reuse(preferredPort, winner.version);
    server = await startDashboard({ projectDir, port: 0, registry });
  }
  registry.writeState({ pid: process.pid, port: server.port, version });
  return {
    url: urlOn(server.port),
    port: server.port,
    reused: false,
    close: async () => {
      registry.clearState(process.pid);
      await server.close();
    },
  };
}
