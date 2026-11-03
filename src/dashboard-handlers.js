/** @import http from 'node:http' */
/** @import { PrLookup } from './run-clean.js' */
/** @import { createPrViews } from './dashboard-pr-views.js' */
/** @import { openRunStore } from './run-store.js' */
/** @import { createProjectHub } from './dashboard-projects.js' */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { can, providerFor, remoteRepo } from './pr-provider.js';
import { gitAsync } from './git.js';
import { messageOf } from './narrow.js';
import { interpretRun, str } from './dashboard-view.js';
import { ghChecks, ghPrDetails } from './dashboard-pr-views.js';

/**
 * What every handler gets: the Dashboard's token and Projects and the request being answered. A handler of a Project route also gets that Project's services (`store` and the fields after it).
 * @typedef {object} DashboardContext
 * @property {string} token
 * @property {string} projectDir The Project the server was started for.
 * @property {ReturnType<typeof createProjectHub>} hub
 * @property {ReturnType<typeof openRunStore>} store
 * @property {ReturnType<typeof openRunStore>} mainStore Clean-up runs from the main checkout, also when the Dashboard was started inside a Run worktree.
 * @property {Set<string>} inFlight Ids of the Runs with an action under way; one Project's set, so equal Run ids in two Projects never block each other.
 * @property {(url: string, head: string) => Promise<unknown>} prMerge
 * @property {PrLookup | undefined} prInfo
 * @property {number} statusRefreshMs
 * @property {ReturnType<typeof createPrViews>} prViews
 * @property {http.IncomingMessage} req
 * @property {http.ServerResponse} res
 * @property {(status: number, type: string, body: string | undefined) => void} send
 * @property {string} target The request URL with its query string.
 * @property {string} path The request path without the query string.
 * @property {RegExpMatchArray} match The match of the route pattern on the path; on a Project route the Project id is left out, so group 1 is the first group after it.
 */
/** @typedef {(ctx: DashboardContext) => Promise<void> | void} Handler */

// One line on stderr for a failure the Dashboard turns into an error answer, so the cause is not lost.
/**
 * @param {string} what
 * @param {unknown} err
 */
export const logFailure = (what, err) =>
  console.error(
    `dashboard: ${what.replace(/[\x00-\x1f\x7f-\x9f]/g, '?')}: ${(err instanceof Error ? (err.stack ?? err.message) : String(err)).replace(/\n/g, '\n    ')}`,
  );
// The repository of the Run's origin, lowercased, for the check that a PR belongs to the Run.
/** @param {string} worktree */
const expectedRepo = async (worktree) => {
  const args = ['remote', 'get-url', 'origin'];
  const out = await gitAsync(worktree, args, { timeout: 10_000 });
  // The message execFile gave when it rejected: its own for a failure to start, else the command line and stderr.
  if (out.error) throw out.error;
  if (out.status !== 0) throw new Error(`Command failed: git ${args.join(' ')}\n${out.stderr}`);
  const origin = out.stdout.trim();
  const repo = remoteRepo(origin);
  if (!repo) throw new Error('cannot resolve the Run repository from origin');
  return `${repo.owner}/${repo.name}`.toLowerCase();
};
/** @param {DashboardContext} ctx */
const query = (ctx) => new URL(ctx.target, 'http://localhost').searchParams;

// Answers 400 and returns undefined when the id is not valid percent encoding.
/** @param {Pick<DashboardContext, 'send'>} ctx @param {string} raw */
const decodeId = (ctx, raw) => {
  try {
    return decodeURIComponent(raw);
  } catch {
    // A malformed percent escape: a bad request, not a failure of ours.
    ctx.send(400, 'text/plain', 'invalid id');
    return undefined;
  }
};
// One action at a time per Run: a second one is answered 409 instead of overlapping the first one's git calls. Released in finally.
/**
 * @param {DashboardContext} ctx
 * @param {string} id
 * @param {() => Promise<void> | void} work
 */
const exclusive = async ({ inFlight, send }, id, work) => {
  if (inFlight.has(id)) return send(409, 'text/plain', 'another action on this Run is already running');
  inFlight.add(id);
  try {
    await work();
  } finally {
    inFlight.delete(id);
  }
};
// The Run of the path's id and its interpretation; a missing Run is answered with 404.
/** @param {DashboardContext} ctx */
const findRun = async (ctx) => {
  const id = decodeId(ctx, ctx.match[1]);
  if (id === undefined) return undefined;
  const entry = (await ctx.store.list()).find((e) => e.id === id);
  if (!entry) {
    ctx.send(404, 'text/plain', 'not found');
    return undefined;
  }
  return { id, view: interpretRun(entry) };
};

/** @type {Record<string, number>} */
const DELETE_STATUSES = {
  deleted: 200,
  invalid: 400,
  'not-found': 404,
  'not-allowed': 409,
  'worktree-refused': 409,
  'dirty-worktree': 409,
};

/** @type {Handler} */
export async function deleteRun(ctx) {
  const id = decodeId(ctx, ctx.match[1]);
  if (id === undefined) return;
  await exclusive(ctx, id, () => removeRun(ctx, id));
}

/** @param {DashboardContext} ctx @param {string} id */
async function removeRun(ctx, id) {
  const { send, store, res } = ctx;
  const params = query(ctx);
  const options = [...params.entries()];
  if (
    options.some(
      ([key, value]) =>
        !['discardChanges', 'doneOnly'].includes(key) || value !== 'true' || params.getAll(key).length !== 1,
    )
  )
    return send(400, 'text/plain', 'invalid delete option');
  /** @type {string | undefined} */
  let reason;
  const outcome = await store.removeAsync(
    id,
    (text) => {
      reason = text;
    },
    { discardChanges: params.has('discardChanges'), doneOnly: params.has('doneOnly') },
  );
  const status = DELETE_STATUSES[outcome] ?? 500;
  if (outcome === 'dirty-worktree') res.setHeader('x-factory-error', outcome);
  /** @type {Record<string, string | undefined>} */
  const texts = { deleted: 'deleted', 'worktree-refused': reason, 'dirty-worktree': reason };
  send(status, 'text/plain', texts[outcome] ?? 'cannot delete Run');
}

// The PR of a Run that passed the Evidence checks must be this Run's repository, open, and at the head the Evidence names.
/** @param {DashboardContext} ctx @param {ReturnType<typeof interpretRun>} v @param {{ worktree: string, head: string }} eligibility @returns {Promise<boolean>} whether the merge may go on */
async function prMatchesRun({ send }, v, eligibility) {
  let repo;
  try {
    repo = await expectedRepo(eligibility.worktree);
  } catch (err) {
    send(409, 'text/plain', messageOf(err));
    return false;
  }
  const prRepo = new URL(v.pr).pathname.split('/').slice(1, 3).join('/').toLowerCase();
  if (repo !== prRepo) {
    send(409, 'text/plain', 'the PR does not belong to the Run repository');
    return false;
  }
  let details;
  try {
    details = await ghPrDetails(v.pr);
  } catch (err) {
    logFailure('GitHub PR state and head', err);
    send(502, 'text/plain', 'GitHub PR state and head are unavailable');
    return false;
  }
  if (!details || typeof details !== 'object' || typeof details.state !== 'string') {
    send(502, 'text/plain', 'GitHub PR state and head are unavailable');
    return false;
  }
  if (String(details.state).toLowerCase() !== 'open') {
    send(409, 'text/plain', 'the PR is not open');
    return false;
  }
  if (typeof details.headRefOid !== 'string' || !/^[a-f0-9]{40,64}$/i.test(details.headRefOid)) {
    send(502, 'text/plain', 'GitHub PR head is unavailable');
    return false;
  }
  if (details.headRefOid.toLowerCase() !== eligibility.head.toLowerCase()) {
    send(409, 'text/plain', 'the PR head does not match the Run Evidence');
    return false;
  }
  return true;
}

/** @type {Handler} */
export async function mergeRun(ctx) {
  const id = decodeId(ctx, ctx.match[1]);
  if (id === undefined) return;
  await exclusive(ctx, id, async () => {
    const run = await findRun(ctx);
    if (run) await mergeChecked(ctx, run.id, run.view);
  });
}

/** @param {DashboardContext} ctx @param {string} id @param {ReturnType<typeof interpretRun>} v */
async function mergeChecked(ctx, id, v) {
  const { send, store, prViews, prMerge } = ctx;
  const provider = providerFor(v.pr);
  if (v.status !== 'done' || !provider) return send(409, 'text/plain', 'cannot merge this Run');
  if (!can(v.pr, 'merge')) return send(409, 'text/plain', `${provider.title} cannot merge from the Dashboard`);
  let eligibility;
  try {
    eligibility = await store.mergeEligibilityAsync(id);
  } catch (err) {
    return send(409, 'text/plain', `cannot check Run Evidence: ${messageOf(err)}`);
  }
  if (eligibility.problems.length)
    return send(409, 'text/plain', `Run needs a clean or Accepted Check: ${eligibility.problems.join('; ')}`);
  if (!(await prMatchesRun(ctx, v, eligibility))) return;
  try {
    await prMerge(v.pr, eligibility.head);
  } catch (err) {
    logFailure('PR merge', err);
    return send(502, 'text/plain', 'gh could not merge the PR');
  } finally {
    prViews.prCache.delete(v.pr);
  }
  send(200, 'text/plain', 'merged');
}

/** @param {DashboardContext} ctx @param {string} id */
async function syncRun({ store, send }, id) {
  await store.syncAsync(id);
  send(200, 'text/plain', 'synced');
}

/** @param {DashboardContext} ctx @param {string} id */
async function cleanRun({ mainStore, prInfo, send }, id) {
  const { outcome, reason } = await mainStore.cleanAsync(id, { prState: prInfo });
  send(outcome === 'kept' ? 409 : 200, 'text/plain', reason ? `${outcome}: ${reason}` : outcome);
}

// ADR 0024: the user's own decision, as the page showed the Run. The store refuses everything but a Run in Check that waits at its limit.
/** @param {DashboardContext} ctx @param {string} id @param {ReturnType<typeof interpretRun>} v */
function grantExtraLoop(ctx, id, v) {
  const { send, store } = ctx;
  const updated = query(ctx).get('updated');
  if (updated === null) return send(409, 'text/plain', 'the request must name the Run record time you looked at');
  if (!v.waiting || v.column !== 'check')
    return send(409, 'text/plain', 'only a Run in Check that waits on you can be granted an extra loop');
  if (typeof v.loops === 'number' && v.loopCap !== undefined && v.loops < v.loopCap)
    return send(409, 'text/plain', `the Check loop limit of ${v.loopCap} is not reached`);
  store.grantLoop(id, { updated });
  send(200, 'text/plain', 'granted');
}

/** @param {DashboardContext} ctx @param {string} id @param {ReturnType<typeof interpretRun>} v */
async function acceptCheck(ctx, id, v) {
  const { send, store } = ctx;
  if (!v.waiting || v.column !== 'check')
    return send(409, 'text/plain', 'only a Run in Check that waits on you can be accepted');
  // The user decided on the Run as the page showed it; a change since then needs a new look.
  if (query(ctx).get('updated') !== v.updated)
    return send(409, 'text/plain', 'the Run changed since you looked at it; reload and look again');
  const { problems } = await store.mergeEligibilityAsync(id);
  if (!problems.length) return send(409, 'text/plain', 'the Check is already clean or accepted');
  // A Run changes only while running, so the answer to the wait first releases it, as the Factory Skill does.
  const reason = v.reason || 'accept the Check or send it back to Build';
  store.update(id, { status: 'running', activity: 'The user accepted the Check on the Dashboard' });
  try {
    await store.acceptAsync(id, {
      findings: problems.join('; '),
      decision: 'Continue to Finish with the open findings. Accepted by the user on the Dashboard.',
    });
  } catch (err) {
    try {
      store.update(id, { status: 'waiting', waiting_reason: reason });
    } catch (rollback) {
      // The user still gets the accept's own error; the cause of the failed rollback goes to the console.
      logFailure('putting the Run back to waiting after a failed accept', rollback);
    }
    throw err;
  }
  send(200, 'text/plain', 'accepted');
}

/** @type {Handler} */
export async function runAction(ctx) {
  const id = decodeId(ctx, ctx.match[1]);
  if (id === undefined) return;
  // The guard comes first and the Run is read inside it, so every check below sees the state after any earlier action.
  await exclusive(ctx, id, async () => {
    const run = await findRun(ctx);
    if (!run) return;
    const v = run.view;
    if (v.unreadable) return ctx.send(409, 'text/plain', 'the Run record cannot be read');
    try {
      const action = ctx.match[2];
      if (action === 'sync') return await syncRun(ctx, id);
      if (action === 'clean') return await cleanRun(ctx, id);
      if (action === 'extra-loop') return grantExtraLoop(ctx, id, v);
      return await acceptCheck(ctx, id, v);
    } catch (err) {
      ctx.send(409, 'text/plain', messageOf(err).replace(/[\x00-\x1f\x7f-\x9f]/g, ' '));
    }
  });
}

/** @type {Handler} */
export async function mergeChecks(ctx) {
  const run = await findRun(ctx);
  if (!run) return;
  const v = run.view;
  if (v.status !== 'done' || !can(v.pr, 'checksSummary')) return ctx.send(409, 'text/plain', 'cannot check this Run');
  let status;
  try {
    status = await ghChecks(v.pr);
  } catch (err) {
    logFailure('GitHub checks', err);
    status = 'GitHub checks: unavailable';
  }
  ctx.send(200, 'text/plain', status);
}

/** @type {Handler} */
export async function prStatus(ctx) {
  const { send, prViews, statusRefreshMs } = ctx;
  const run = await findRun(ctx);
  if (!run) return;
  const v = run.view;
  if (!prViews.hasStatus(v)) return send(409, 'text/plain', 'this Run has no PR status');
  const hit = prViews.statusCache.get(v.pr);
  const fresh = hit?.value && hit.at !== undefined && Date.now() - hit.at < statusRefreshMs;
  const refresh = query(ctx).get('refresh') === '1';
  send(
    200,
    'application/json',
    JSON.stringify(refresh && !fresh ? await prViews.fetchStatus(v.pr) : prViews.statusOf(v.pr)),
  );
}

/** @type {Handler} */
export async function info({ send, token, projectDir, hub }) {
  const version = await readFile(new URL('../package.json', import.meta.url), 'utf8')
    .then((data) => str(JSON.parse(data).version))
    .catch(() => '');
  send(
    200,
    'application/json',
    JSON.stringify({
      project: resolve(projectDir),
      token,
      pid: process.pid,
      shared: hub.shared,
      ...(version ? { version } : {}),
    }),
  );
}

// Every Project, in registry order. A Project whose folder is gone is reported as missing with no Runs; each Run carries its Project id.
/** @type {Handler} */
export async function views({ send, hub }) {
  const projects = await Promise.all(
    hub.list().map(async ({ id, name, missing, path }) => {
      if (missing) return { id, name, path, missing, runs: [] };
      const { store, prViews } = hub.servicesOf({ id, path });
      const viewed = await Promise.all((await store.list()).map(prViews.view));
      return { id, name, path, missing, runs: viewed.map((view) => ({ ...view, projectId: id })) };
    }),
  );
  send(200, 'application/json', JSON.stringify({ projects }));
}

/** @type {Handler} */
export async function runs({ send, store }) {
  send(200, 'application/json', JSON.stringify(await store.list()));
}

/** @type {Handler} */
export async function runFile({ send, store, match }) {
  const body = await store.readFile(match[1]);
  if (body === null) send(404, 'text/plain', 'not found');
  else send(200, 'text/markdown', body);
}

// Removes a Project from the registry by an id the registry holds; the folder and its Runs stay.
/** @type {Handler} */
export async function removeProject({ send, hub, match }) {
  const id = decodeId({ send }, match[1]);
  if (id === undefined) return;
  const removed = await hub.remove(id);
  if (removed === 'not-found') return send(404, 'text/plain', 'not found');
  if (removed === 'own-not-registered')
    return send(
      409,
      'text/plain',
      'this Project is not in the registry, so there is nothing to remove; it is still served because the Dashboard was started in it',
    );
  send(200, 'text/plain', 'removed');
}

/** @type {Handler} */
export async function removeMissingProjects({ send, hub }) {
  const removed = await hub.removeMissing();
  send(200, 'application/json', JSON.stringify({ removed }));
}
