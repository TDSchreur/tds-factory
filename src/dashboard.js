import http from 'node:http';
import { openRunStore } from './run-store.js';
import { stages } from './flow.js';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const PR_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;
const ghPrMerge = (url) => promisify(execFile)('gh', ['pr', 'merge', url, '--squash'], { timeout: 30_000 });
const PR_CACHE_MS = 60_000;
const ghPrState = async (url) => JSON.parse((await promisify(execFile)('gh', ['pr', 'view', url, '--json', 'state'], { timeout: 10_000 })).stdout).state;
const HOST = '127.0.0.1';
// Each repo gets its own stable port in 4300-4999, derived from its main checkout path.
const repoPort = (dir) => 4300 + createHash('sha1').update(dir).digest().readUInt32BE(0) % 700;
const DASHBOARD_DIR = fileURLToPath(new URL('../dashboard/', import.meta.url));
// The only files served besides the page; a request never picks a path, only one of these names.
const JS = 'text/javascript';
const ASSETS = {
  '/style.css': 'text/css',
  '/app.js': JS, '/components.js': JS, '/model.js': JS, '/markdown.js': JS,
  '/vendor/preact.js': JS, '/vendor/hooks.js': JS, '/vendor/htm.js': JS,
};
const FALLBACK_PAGE = `<!doctype html>
<meta charset="utf-8">
<title>tds-factory dashboard</title>
<h1>tds-factory dashboard</h1>
<p>The Dashboard page is not installed. Run records are available at <a href="/api/runs">/api/runs</a>.</p>
`;
const str = (v) => typeof v === 'string' ? v.trim() : '';
const strList = (v) => Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : [];
export function interpretRun(entry) {
  const id = typeof entry?.id === 'string' ? entry.id : '', files = strList(entry?.files);
  if (!entry || entry.unreadable || !entry.record || typeof entry.record !== 'object') return { id, unreadable: true, title: id || 'Unknown run', activity: '', agent: '', waiting: false, reason: '', column: 'define', updated: '', files, links: [], status: '', pr: '' };
  const r = entry.record, status = str(r.status), stage = str(r.stage).toLowerCase();
  const num = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
  const verdict = (v, skip) => { v = str(v).toLowerCase(); return v === 'pass' || v === 'fail' || (skip && v === 'skipped') ? v : ''; };
  const links = [];
  for (const [label, values] of [['Spec', r.spec_link], ['Ticket', r.tickets], ['PR', r.pr]]) for (const value of Array.isArray(values) ? values : [values]) if (str(value)) links.push({ label, href: str(value) });
  return { id, unreadable: false, column: ['done', 'abandoned'].includes(status) ? 'done' : stages.includes(stage) ? stage : 'define', status, pr: str(r.pr), ticketsDone: num(r.tickets_done), ticketsTotal: num(r.tickets_total), standards: verdict(r.standards), spec: verdict(r.spec), security: verdict(r.security), infrastructure: verdict(r.infrastructure, true), loops: num(r.check_loops), waiting: !['done', 'abandoned'].includes(status) && (r.waiting_on_human === true || status === 'waiting'), reason: str(r.waiting_reason), title: str(r.title) || id || 'Untitled run', activity: str(r.activity), agent: str(r.agent), updated: str(r.updated), files, links };
}

// Serves the .factory/runs folder of the main checkout of projectDir's repository on 127.0.0.1.
// Without a port, uses the repo's own port and falls back to a free one when it is busy. An explicit port is used exactly; 0 means a random free port. Resolves to { server, port, url, close }.
// prState(url) resolves to OPEN, MERGED or CLOSED and prMerge(url) squash-merges; both default to the `gh` CLI.
export async function startDashboard({ projectDir = process.cwd(), port, prState = ghPrState, prMerge = ghPrMerge, dashboardDir = DASHBOARD_DIR } = {}) {
  const store = openRunStore(projectDir);
  const prCache = new Map();
  const lookup = (url) => {
    const hit = prCache.get(url);
    if (hit && Date.now() - hit.at < PR_CACHE_MS) return hit.state;
    const state = Promise.resolve().then(() => prState(url)).then((v) => String(v).toLowerCase()).then((v) => ['open', 'merged', 'closed'].includes(v) ? v : '', () => '');
    prCache.set(url, { at: Date.now(), state });
    return state;
  };
  const view = async (entry) => {
    const v = interpretRun(entry);
    return { ...v, prState: v.column === 'done' && PR_URL.test(v.pr) ? await lookup(v.pr) : '' };
  };

  const server = http.createServer(async (req, res) => {
    const send = (status, type, body) => {
      res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
      res.end(body);
    };
    // Only our own loopback names, so a web page can't reach us through DNS rebinding.
    const { port: own } = server.address();
    if (![`127.0.0.1:${own}`, `localhost:${own}`].includes(req.headers.host)) return send(403, 'text/plain', 'forbidden');
    const path = (req.url ?? '/').split('?')[0];
    try {
      if (req.method === 'DELETE' && path.startsWith('/api/runs/')) {
        if (req.headers.origin !== `http://${req.headers.host}`) return send(403, 'text/plain', 'forbidden');
        let id;
        try { id = decodeURIComponent(path.slice('/api/runs/'.length)); } catch { return send(400, 'text/plain', 'invalid id'); }
        const outcome = store.remove(id);
        const status = { deleted: 200, invalid: 400, 'not-found': 404, 'not-allowed': 409, 'worktree-refused': 409 }[outcome];
        const text = { deleted: 'deleted', 'worktree-refused': 'the Run worktree has uncommitted changes or cannot be removed; commit or discard them first' }[outcome] ?? 'cannot delete Run';
        return send(status, 'text/plain', text);
      }
      const merge = req.method === 'POST' && path.match(/^\/api\/runs\/([^/]+)\/merge$/);
      if (merge) {
        if (req.headers.origin !== `http://${req.headers.host}`) return send(403, 'text/plain', 'forbidden');
        let id;
        try { id = decodeURIComponent(merge[1]); } catch { return send(400, 'text/plain', 'invalid id'); }
        const entry = (await store.list()).find((e) => e.id === id);
        if (!entry) return send(404, 'text/plain', 'not found');
        const v = interpretRun(entry);
        if (v.status !== 'done' || !PR_URL.test(v.pr)) return send(409, 'text/plain', 'cannot merge this Run');
        if (String(await Promise.resolve().then(() => prState(v.pr)).catch(() => '')).toLowerCase() !== 'open') return send(409, 'text/plain', 'the PR is not open');
        try { await prMerge(v.pr); } catch { return send(502, 'text/plain', 'gh could not merge the PR'); } finally { prCache.delete(v.pr); }
        return send(200, 'text/plain', 'merged');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'text/plain', 'method not allowed');
      if (path === '/') {
        return send(200, 'text/html', await readFile(join(dashboardDir, 'index.html'), 'utf8').catch(() => FALLBACK_PAGE));
      }
      if (Object.hasOwn(ASSETS, path)) {
        const body = await readFile(join(dashboardDir, path.slice(1)), 'utf8').catch(() => null);
        return body === null ? send(404, 'text/plain', 'not found') : send(200, ASSETS[path], body);
      }
      if (path === '/api/info') return send(200, 'application/json', JSON.stringify({ project: resolve(projectDir) }));
      if (path === '/api/views') return send(200, 'application/json', JSON.stringify(await Promise.all((await store.list()).map(view))));
      if (path === '/api/runs') return send(200, 'application/json', JSON.stringify(await store.list()));
      if (path.startsWith('/files/')) {
        const body = await store.readFile(path.slice('/files/'.length));
        return body === null ? send(404, 'text/plain', 'not found') : send(200, 'text/markdown', body);
      }
      send(404, 'text/plain', 'not found');
    } catch {
      send(500, 'text/plain', 'internal error');
    }
  });

  const listen = (p) => new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(p, HOST, ok);
  });
  if (port !== undefined) await listen(port);
  else await listen(repoPort(store.projectDir)).catch((err) => {
    if (err.code !== 'EADDRINUSE') throw err;
    return listen(0);
  });
  const actual = server.address().port;
  return {
    server,
    port: actual,
    url: `http://${HOST}:${actual}`,
    close: () =>
      new Promise((ok) => {
        server.close(ok);
        server.closeAllConnections();
      }),
  };
}
