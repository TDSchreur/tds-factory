import http from 'node:http';
import { openRunStore, summarizeMetrics, formatMetrics, trackOf, loopCap } from './run-store.js';
import { stages } from './flow.js';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { can, providerFor, remoteRepo } from './pr-provider.js';

const exec = promisify(execFile);
// The repository of the Run's origin, lowercased, for the check that a PR belongs to the Run.
const expectedRepo = async (worktree) => {
  const origin = (await exec('git', ['remote', 'get-url', 'origin'], { cwd: worktree, timeout: 10_000 })).stdout.trim();
  const repo = remoteRepo(origin);
  if (!repo) throw new Error('cannot resolve the Run repository from origin');
  return `${repo.owner}/${repo.name}`.toLowerCase();
};
const PR_CACHE_MS = 60_000;
// PR status (ADR 0020): an open PR is looked up again after a minute, a merged or closed one after ten, a failed lookup after half a minute.
// A refresh asked for by the user may not repeat a lookup more often than every few seconds.
const PR_STATUS_MS = 60_000,
  PR_STATUS_FINAL_MS = 600_000,
  PR_STATUS_FAIL_MS = 30_000,
  PR_STATUS_REFRESH_MS = 5_000,
  PR_STATUS_MAX = 500;
const STATUS_REASONS = [
  'gh-missing',
  'not-signed-in',
  'rate-limited',
  'az-missing',
  'az-extension-missing',
  'az-not-signed-in',
  'error',
];
const ghPrState = (url) => providerFor(url).stateAsync(url);
const ghPrMerge = (url, head) => providerFor(url).merge(url, head);
const ghPrDetails = (url) => providerFor(url).viewAsync(url);
const ghChecks = (url) => providerFor(url).checksSummary(url);
const ghPrStatus = (url) => providerFor(url).statusAsync(url);
const HOST = '127.0.0.1';
// Each repo gets its own stable port in 4300-4999, derived from its main checkout path.
const repoPort = (dir) => 4300 + (createHash('sha1').update(dir).digest().readUInt32BE(0) % 700);
const DASHBOARD_DIR = fileURLToPath(new URL('../dashboard/', import.meta.url));
// The only files served besides the page; a request never picks a path, only one of these names.
const JS = 'text/javascript';
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
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const strList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []);
export function interpretRun(entry) {
  const id = typeof entry?.id === 'string' ? entry.id : '',
    files = strList(entry?.files);
  if (!entry || entry.unreadable || !entry.record || typeof entry.record !== 'object')
    return {
      id,
      unreadable: true,
      title: id || 'Unknown run',
      activity: '',
      agent: '',
      waiting: false,
      reason: '',
      column: 'define',
      updated: '',
      files,
      links: [],
      status: '',
      pr: '',
      model: { requested: '', effort: '', observed: '' },
      lastSeen: '',
      events: [],
      eventsDamaged: 0,
    };
  const r = entry.record,
    status = str(r.status),
    stage = str(r.stage).toLowerCase();
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
  const verdict = (v, skip) => {
    v = str(v).toLowerCase();
    return v === 'pass' || v === 'fail' || (skip && v === 'skipped') ? v : '';
  };
  const projectReviews = (Array.isArray(r.project_reviews) ? r.project_reviews : [])
    .filter((x) => x && typeof x === 'object' && str(x.id) && str(x.name))
    .map((x) => {
      const result = r.project_results?.[x.id] ?? {};
      const findings = (Array.isArray(result.findings) ? result.findings : [])
        .filter((f) => f && typeof f === 'object')
        .map((f) => ({ severity: str(f.severity), description: str(f.description), location: str(f.location) }));
      return {
        id: str(x.id),
        name: str(x.name),
        verdict: verdict(result.verdict, true),
        reason: str(result.reason),
        findings,
      };
    });
  const links = [];
  for (const [label, values] of [
    ['Spec', r.spec_link],
    ['Ticket', r.tickets],
    ['PR', r.pr],
  ])
    for (const value of Array.isArray(values) ? values : [values])
      if (str(value)) links.push({ label, href: str(value) });
  // Only the plain, known fields of an event reach the page, and the last 50 of them.
  const eventKeys = [
    'type',
    'at',
    'from',
    'to',
    'reason',
    'status',
    'done',
    'total',
    'loops',
    'granted',
    'limit',
    'fast',
    'exit_code',
    'duration_ms',
    'head',
    'signal',
  ];
  const events = (Array.isArray(entry.events?.events) ? entry.events.events : [])
    .filter((e) => e && typeof e === 'object')
    .slice(-50)
    .map((e) =>
      Object.fromEntries(
        eventKeys.filter((k) => ['string', 'number', 'boolean'].includes(typeof e[k])).map((k) => [k, e[k]]),
      ),
    );
  const model = { requested: str(r.requested_model), effort: str(r.requested_effort), observed: str(r.observed_model) };
  return {
    id,
    unreadable: false,
    model,
    lastSeen: str(r.last_seen),
    events,
    eventsDamaged: num(entry.events?.damaged) ?? 0,
    metrics: formatMetrics(summarizeMetrics(r)),
    track: trackOf(r),
    projectReviews,
    column: ['done', 'abandoned'].includes(status) ? 'done' : stages.includes(stage) ? stage : 'define',
    status,
    pr: str(r.pr),
    tickets: strList(r.tickets),
    ticketsDone: num(r.tickets_done),
    ticketsTotal: num(r.tickets_total),
    standards: verdict(r.standards),
    spec: verdict(r.spec, true),
    security: verdict(r.security),
    infrastructure: verdict(r.infrastructure, true),
    loops: num(r.check_loops),
    loopCap: loopCap(r),
    waiting: !['done', 'abandoned'].includes(status) && (r.waiting_on_human === true || status === 'waiting'),
    reason: str(['verification-unavailable', 'interrupted'].includes(status) ? r.status_reason : r.waiting_reason),
    title: str(r.title) || id || 'Untitled run',
    activity: str(r.activity),
    agent: str(r.agent),
    updated: str(r.updated),
    files,
    links,
  };
}

// Serves the .factory/runs folder of the main checkout of projectDir's repository on 127.0.0.1.
// Without a port, uses the repo's own port and falls back to a free one when it is busy. An explicit port is used exactly; 0 means a random free port. Resolves to { server, port, url, close }.
// prState(url) resolves to OPEN, MERGED or CLOSED; prMerge(url, head) squash-merges the specified head.
// prStatus(url) resolves to the parsed PR status of src/pr-github.js and rejects with a `reason` when the provider fails.
// statusRefreshMs is the shortest time between two lookups the user's refresh may start for one PR.
// prInfo(url) resolves to { state, head } for Run clean-up; it defaults to GitHub through gh.
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
  // Clean-up must run from the main checkout, also when the Dashboard was started inside a Run worktree.
  const mainStore = openRunStore(store.projectDir);
  const token = randomBytes(32).toString('hex');
  const digest = (value) => createHash('sha256').update(value).digest();
  const tokenOk = (given) => typeof given === 'string' && timingSafeEqual(digest(given), digest(token)); // equal-length digests, so any header value compares safely
  const prCache = new Map();
  const lookup = (url) => {
    const hit = prCache.get(url);
    if (hit && Date.now() - hit.at < PR_CACHE_MS) return hit.state;
    const state = Promise.resolve()
      .then(() => prState(url))
      .then((v) => String(v).toLowerCase())
      .then(
        (v) => (['open', 'merged', 'closed'].includes(v) ? v : ''),
        () => '',
      );
    prCache.set(url, { at: Date.now(), state });
    return state;
  };
  // PR status never blocks a poll: a lookup runs in the background, one at a time per PR, and the views answer from the cache.
  const statusCache = new Map();
  const fetchStatus = (url) => {
    const entry = statusCache.get(url) ?? {};
    if (entry.pending) return entry.pending;
    const pending = Promise.resolve()
      .then(() => prStatus(url))
      .then(
        (value) => ({ value, ttl: value?.state === 'open' ? PR_STATUS_MS : PR_STATUS_FINAL_MS }),
        (err) => ({
          value: { unavailable: STATUS_REASONS.includes(err?.reason) ? err.reason : 'error' },
          ttl: PR_STATUS_FAIL_MS,
        }),
      )
      .then(({ value, ttl }) => {
        statusCache.delete(url);
        statusCache.set(url, { at: Date.now(), value, ttl });
        if (statusCache.size > PR_STATUS_MAX) statusCache.delete(statusCache.keys().next().value);
        return value;
      });
    statusCache.set(url, { ...entry, pending });
    return pending;
  };
  const statusOf = (url) => {
    const hit = statusCache.get(url);
    if (hit?.value && Date.now() - hit.at < hit.ttl) return hit.value;
    fetchStatus(url);
    return hit?.value ?? { checking: true };
  };
  // Whether a Run has a PR whose status the page shows: a GitHub PR link in Finish, Follow-up or Done, on a Run that is not abandoned.
  const hasStatus = (v) =>
    !v.unreadable &&
    v.status !== 'abandoned' &&
    ['finish', 'follow-up', 'done'].includes(v.column) &&
    !!providerFor(v.pr);
  const view = async (entry) => {
    const v = interpretRun(entry);
    return {
      ...v,
      prState: v.column === 'done' && providerFor(v.pr) ? await lookup(v.pr) : '',
      prStatus: hasStatus(v) ? statusOf(v.pr) : null,
      prHost: providerFor(v.pr)?.name ?? '',
      prCanMerge: can(v.pr, 'merge'),
    };
  };

  const server = http.createServer(async (req, res) => {
    const send = (status, type, body) => {
      res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
      res.end(body);
    };
    // Only our own loopback names, so a web page can't reach us through DNS rebinding.
    const { port: own } = server.address();
    if (![`127.0.0.1:${own}`, `localhost:${own}`].includes(req.headers.host))
      return send(403, 'text/plain', 'forbidden');
    const path = (req.url ?? '/').split('?')[0];
    // Every write passes the same guard (ADR 0017): own Origin and a per-session token; the Host check above covers all routes.
    if (
      req.method !== 'GET' &&
      req.method !== 'HEAD' &&
      (req.headers.origin !== `http://${req.headers.host}` || !tokenOk(req.headers['x-factory-token']))
    )
      return send(403, 'text/plain', 'forbidden');
    try {
      if (req.method === 'DELETE' && path.startsWith('/api/runs/')) {
        let id;
        try {
          id = decodeURIComponent(path.slice('/api/runs/'.length));
        } catch {
          return send(400, 'text/plain', 'invalid id');
        }
        const query = new URL(req.url, 'http://localhost').searchParams;
        const options = [...query.entries()];
        if (
          options.some(
            ([key, value]) =>
              !['discardChanges', 'doneOnly'].includes(key) || value !== 'true' || query.getAll(key).length !== 1,
          )
        )
          return send(400, 'text/plain', 'invalid delete option');
        let reason;
        const outcome = store.remove(
          id,
          (text) => {
            reason = text;
          },
          { discardChanges: query.has('discardChanges'), doneOnly: query.has('doneOnly') },
        );
        const status = {
          deleted: 200,
          invalid: 400,
          'not-found': 404,
          'not-allowed': 409,
          'worktree-refused': 409,
          'dirty-worktree': 409,
        }[outcome];
        if (outcome === 'dirty-worktree') res.setHeader('x-factory-error', outcome);
        const text =
          { deleted: 'deleted', 'worktree-refused': reason, 'dirty-worktree': reason }[outcome] ?? 'cannot delete Run';
        return send(status, 'text/plain', text);
      }
      const merge = req.method === 'POST' && path.match(/^\/api\/runs\/([^/]+)\/merge$/);
      if (merge) {
        let id;
        try {
          id = decodeURIComponent(merge[1]);
        } catch {
          return send(400, 'text/plain', 'invalid id');
        }
        const entry = (await store.list()).find((e) => e.id === id);
        if (!entry) return send(404, 'text/plain', 'not found');
        const v = interpretRun(entry);
        if (v.status !== 'done' || !providerFor(v.pr)) return send(409, 'text/plain', 'cannot merge this Run');
        if (!can(v.pr, 'merge'))
          return send(409, 'text/plain', `${providerFor(v.pr).title} cannot merge from the Dashboard`);
        let eligibility;
        try {
          eligibility = store.mergeEligibility(id);
        } catch (err) {
          return send(409, 'text/plain', `cannot check Run Evidence: ${err.message}`);
        }
        if (eligibility.problems.length)
          return send(409, 'text/plain', `Run needs a clean or Accepted Check: ${eligibility.problems.join('; ')}`);
        let repo;
        try {
          repo = await expectedRepo(eligibility.worktree);
        } catch (err) {
          return send(409, 'text/plain', err.message);
        }
        const prRepo = new URL(v.pr).pathname.split('/').slice(1, 3).join('/').toLowerCase();
        if (repo !== prRepo) return send(409, 'text/plain', 'the PR does not belong to the Run repository');
        let details;
        try {
          details = await ghPrDetails(v.pr);
        } catch {
          return send(502, 'text/plain', 'GitHub PR state and head are unavailable');
        }
        if (!details || typeof details !== 'object' || typeof details.state !== 'string')
          return send(502, 'text/plain', 'GitHub PR state and head are unavailable');
        if (String(details.state).toLowerCase() !== 'open') return send(409, 'text/plain', 'the PR is not open');
        if (typeof details.headRefOid !== 'string' || !/^[a-f0-9]{40,64}$/i.test(details.headRefOid))
          return send(502, 'text/plain', 'GitHub PR head is unavailable');
        if (details.headRefOid.toLowerCase() !== eligibility.head.toLowerCase())
          return send(409, 'text/plain', 'the PR head does not match the Run Evidence');
        try {
          await prMerge(v.pr, eligibility.head);
        } catch {
          return send(502, 'text/plain', 'gh could not merge the PR');
        } finally {
          prCache.delete(v.pr);
        }
        return send(200, 'text/plain', 'merged');
      }
      const action = req.method === 'POST' && path.match(/^\/api\/runs\/([^/]+)\/(sync|clean|accept|extra-loop)$/);
      if (action) {
        let id;
        try {
          id = decodeURIComponent(action[1]);
        } catch {
          return send(400, 'text/plain', 'invalid id');
        }
        const entry = (await store.list()).find((e) => e.id === id);
        if (!entry) return send(404, 'text/plain', 'not found');
        const v = interpretRun(entry);
        if (v.unreadable) return send(409, 'text/plain', 'the Run record cannot be read');
        try {
          if (action[2] === 'sync') {
            store.sync(id);
            return send(200, 'text/plain', 'synced');
          }
          if (action[2] === 'clean') {
            const { outcome, reason } = mainStore.clean(id, { prState: prInfo });
            return send(outcome === 'kept' ? 409 : 200, 'text/plain', reason ? `${outcome}: ${reason}` : outcome);
          }
          if (action[2] === 'extra-loop') {
            // ADR 0024: the user's own decision, as the page showed the Run. The store refuses everything but a Run in Check that waits at its limit.
            const updated = new URL(req.url, 'http://localhost').searchParams.get('updated');
            if (updated === null)
              return send(409, 'text/plain', 'the request must name the Run record time you looked at');
            if (!v.waiting || v.column !== 'check')
              return send(409, 'text/plain', 'only a Run in Check that waits on you can be granted an extra loop');
            if (typeof v.loops === 'number' && v.loops < v.loopCap)
              return send(409, 'text/plain', `the Check loop limit of ${v.loopCap} is not reached`);
            store.grantLoop(id, { updated });
            return send(200, 'text/plain', 'granted');
          }
          if (!v.waiting || v.column !== 'check')
            return send(409, 'text/plain', 'only a Run in Check that waits on you can be accepted');
          // The user decided on the Run as the page showed it; a change since then needs a new look.
          if (new URL(req.url, 'http://localhost').searchParams.get('updated') !== v.updated)
            return send(409, 'text/plain', 'the Run changed since you looked at it; reload and look again');
          const { problems } = store.mergeEligibility(id);
          if (!problems.length) return send(409, 'text/plain', 'the Check is already clean or accepted');
          // A Run changes only while running, so the answer to the wait first releases it, as the Factory Skill does.
          const reason = v.reason || 'accept the Check or send it back to Build';
          store.update(id, { status: 'running', activity: 'The user accepted the Check on the Dashboard' });
          try {
            store.accept(id, {
              findings: problems.join('; '),
              decision: 'Continue to Finish with the open findings. Accepted by the user on the Dashboard.',
            });
          } catch (err) {
            store.update(id, { status: 'waiting', waiting_reason: reason });
            throw err;
          }
          return send(200, 'text/plain', 'accepted');
        } catch (err) {
          return send(409, 'text/plain', String(err.message).replace(/[\x00-\x1f\x7f-\x9f]/g, ' '));
        }
      }
      const checks = req.method === 'GET' && path.match(/^\/api\/runs\/([^/]+)\/merge-checks$/);
      if (checks) {
        let id;
        try {
          id = decodeURIComponent(checks[1]);
        } catch {
          return send(400, 'text/plain', 'invalid id');
        }
        const entry = (await store.list()).find((e) => e.id === id);
        if (!entry) return send(404, 'text/plain', 'not found');
        const v = interpretRun(entry);
        if (v.status !== 'done' || !can(v.pr, 'checksSummary')) return send(409, 'text/plain', 'cannot check this Run');
        let status;
        try {
          status = await ghChecks(v.pr);
        } catch {
          status = 'GitHub checks: unavailable';
        }
        return send(200, 'text/plain', status);
      }
      const statusRoute = req.method === 'GET' && path.match(/^\/api\/runs\/([^/]+)\/pr-status$/);
      if (statusRoute) {
        let id;
        try {
          id = decodeURIComponent(statusRoute[1]);
        } catch {
          return send(400, 'text/plain', 'invalid id');
        }
        const entry = (await store.list()).find((e) => e.id === id);
        if (!entry) return send(404, 'text/plain', 'not found');
        const v = interpretRun(entry);
        if (!hasStatus(v)) return send(409, 'text/plain', 'this Run has no PR status');
        const hit = statusCache.get(v.pr);
        const fresh = hit?.value && Date.now() - hit.at < statusRefreshMs;
        const refresh = new URL(req.url, 'http://localhost').searchParams.get('refresh') === '1';
        return send(
          200,
          'application/json',
          JSON.stringify(refresh && !fresh ? await fetchStatus(v.pr) : statusOf(v.pr)),
        );
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'text/plain', 'method not allowed');
      if (path === '/') {
        return send(
          200,
          'text/html',
          await readFile(join(dashboardDir, 'index.html'), 'utf8').catch(() => FALLBACK_PAGE),
        );
      }
      if (Object.hasOwn(ASSETS, path)) {
        const body = await readFile(join(dashboardDir, path.slice(1)), 'utf8').catch(() => null);
        return body === null ? send(404, 'text/plain', 'not found') : send(200, ASSETS[path], body);
      }
      if (path === '/api/info') {
        const version = await readFile(new URL('../package.json', import.meta.url), 'utf8')
          .then((data) => str(JSON.parse(data).version))
          .catch(() => '');
        return send(
          200,
          'application/json',
          JSON.stringify({ project: resolve(projectDir), token, ...(version ? { version } : {}) }),
        );
      }
      if (path === '/api/views')
        return send(200, 'application/json', JSON.stringify(await Promise.all((await store.list()).map(view))));
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

  const listen = (p) =>
    new Promise((ok, fail) => {
      server.once('error', fail);
      server.listen(p, HOST, ok);
    });
  if (port !== undefined) await listen(port);
  else
    await listen(repoPort(store.projectDir)).catch((err) => {
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
