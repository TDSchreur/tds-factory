/** @import { PrStatus } from './pr-provider.js' */
/** @import { PrLookup } from './run-clean.js' */
/** @import { DashboardContext } from './dashboard-handlers.js' */
import http from 'node:http';
import { once } from 'node:events';
import { openRunStore } from './run-store.js';
import { readFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { codeOf, oneOf } from './narrow.js';
import { interpretRun } from './dashboard-view.js';
import { createPrViews, ghPrState, ghPrMerge, ghPrStatus, PR_STATUS_REFRESH_MS } from './dashboard-pr-views.js';
import { logFailure } from './dashboard-handlers.js';
import { matchRoute } from './dashboard-routes.js';

export { interpretRun };

const HOST = '127.0.0.1';
/** @param {http.Server} server */
const addressPort = (server) => {
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the Dashboard is not listening on a port');
  return address.port;
};
export const DEFAULT_PORT = 4300;
const DASHBOARD_DIR = join(import.meta.dirname, '..', 'dashboard') + sep;
// The only files served besides the page; a request never picks a path, only one of these names.
const JS = 'text/javascript';
/** @type {Record<string, string>} */
const ASSETS = {
  '/style.css': 'text/css',
  '/favicon.svg': 'image/svg+xml',
  '/app.js': JS,
  '/components.js': JS,
  '/model.js': JS,
  '/markdown.js': JS,
  '/help.js': JS,
  '/vendor/preact.js': JS,
  '/vendor/hooks.js': JS,
  '/vendor/htm.js': JS,
};
const FALLBACK_PAGE = `<!doctype html>
<meta charset="utf-8">
<title>TDS Factory</title>
<h1>TDS Factory</h1>
<p>The Dashboard page is not installed. Run records are available at <a href="/api/runs">/api/runs</a>.</p>
`;
// The page, its files and the 404 for everything else; a request never picks a path, only one of the ASSETS.
/** @param {string} dashboardDir @param {string} path @param {DashboardContext['send']} send */
async function serveStatic(dashboardDir, path, send) {
  if (path === '/')
    return send(200, 'text/html', await readFile(join(dashboardDir, 'index.html'), 'utf8').catch(() => FALLBACK_PAGE));
  if (Object.hasOwn(ASSETS, path)) {
    const body = await readFile(join(dashboardDir, path.slice(1)), 'utf8').catch(() => null);
    return body === null ? send(404, 'text/plain', 'not found') : send(200, ASSETS[path], body);
  }
  send(404, 'text/plain', 'not found');
}

// Serves the .factory/runs folder of the main checkout of projectDir's repository on 127.0.0.1.
// Without a port, uses 4300 and falls back to a free one when it is busy. An explicit port is used exactly; 0 means a random free port. Resolves to { server, port, url, close }.
// prState(url) resolves to OPEN, MERGED or CLOSED; prMerge(url, head) squash-merges the specified head.
// prStatus(url) resolves to the parsed PR status of src/pr-github.js and rejects with a FactoryError whose `code` is the reason when the provider fails.
// statusRefreshMs is the shortest time between two lookups the user's refresh may start for one PR.
// prInfo(url) resolves to { state, head } for Run clean-up; it defaults to GitHub through gh.
/**
 * @param {object} [options]
 * @param {string} [options.projectDir]
 * @param {number} [options.port] An explicit port is used exactly; 0 is a random free port.
 * @param {(url: string) => Promise<string>} [options.prState]
 * @param {(url: string, head: string) => Promise<unknown>} [options.prMerge]
 * @param {PrLookup} [options.prInfo]
 * @param {(url: string) => Promise<PrStatus>} [options.prStatus]
 * @param {number} [options.statusRefreshMs]
 * @param {string} [options.dashboardDir]
 */
export async function startDashboard({
  projectDir = process.cwd(),
  port,
  prState = ghPrState,
  prMerge = ghPrMerge,
  prInfo,
  prStatus = ghPrStatus,
  statusRefreshMs = PR_STATUS_REFRESH_MS,
  dashboardDir = DASHBOARD_DIR,
} = {}) {
  const store = openRunStore(projectDir);
  const token = randomBytes(32).toString('hex');
  /** @param {string} value */
  const digest = (value) => createHash('sha256').update(value).digest();
  /** @param {unknown} given */
  const tokenOk = (given) => typeof given === 'string' && timingSafeEqual(digest(given), digest(token)); // equal-length digests, so any header value compares safely
  const services = {
    store,
    // Clean-up must run from the main checkout, also when the Dashboard was started inside a Run worktree.
    mainStore: openRunStore(store.projectDir),
    /** @type {Set<string>} */
    inFlight: new Set(),
    token,
    projectDir,
    prMerge,
    prInfo,
    statusRefreshMs,
    prViews: createPrViews({ prState, prStatus }),
  };

  const server = http.createServer(async (req, res) => {
    /** @param {number} status @param {string} type @param {string | undefined} body */
    const send = (status, type, body) => {
      res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
      res.end(body);
    };
    // Only our own loopback names, so a web page can't reach us through DNS rebinding.
    const own = addressPort(server);
    if (!oneOf([`127.0.0.1:${own}`, `localhost:${own}`], req.headers.host)) return send(403, 'text/plain', 'forbidden');
    const target = req.url ?? '/';
    const path = target.split('?')[0];
    const isRead = req.method === 'GET' || req.method === 'HEAD';
    // Every write passes the same guard (ADR 0017): own Origin and a per-session token; the Host check above covers all routes.
    if (!isRead && (req.headers.origin !== `http://${req.headers.host}` || !tokenOk(req.headers['x-factory-token'])))
      return send(403, 'text/plain', 'forbidden');
    try {
      const route = matchRoute(req.method, path);
      if (route) return await route.handler({ ...services, req, res, send, target, path, match: route.match });
      if (!isRead) return send(405, 'text/plain', 'method not allowed');
      await serveStatic(dashboardDir, path, send);
    } catch (err) {
      // The client only learns that it failed; the cause goes to the log, without the query string, which may hold a token.
      logFailure(`${req.method} ${path}`, err);
      send(500, 'text/plain', 'internal error');
    }
  });

  /**
   * @param {number} p
   * @returns {Promise<void>}
   */
  const listen = async (p) => {
    const listening = once(server, 'listening');
    server.listen(p, HOST);
    await listening;
  };
  if (port !== undefined) await listen(port);
  else
    await listen(DEFAULT_PORT).catch((err) => {
      if (codeOf(err) !== 'EADDRINUSE') throw err;
      return listen(0);
    });
  const actual = addressPort(server);
  return {
    server,
    port: actual,
    url: `http://${HOST}:${actual}`,
    close: async () => {
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}
