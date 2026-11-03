/** @import http from 'node:http' */
/** @import { PrLookup } from './run-clean.js' */
/** @import { createPrViews } from './dashboard-pr-views.js' */
/** @import { openRunStore } from './run-store.js' */
/** @import { createProjectHub } from './dashboard-projects.js' */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { messageOf, oneOf } from './narrow.js';
import { FOLLOW_UP_SCOPES } from './run-store.js';
import { interpretRun, str } from './dashboard-view.js';
import { SIZE_WAIT_REASON } from './run-size.js';
import { can, providerFor } from './pr-provider.js';

/**
 * What every handler gets: the Dashboard's token and Projects and the request being answered. A handler of a Project route also gets that Project's services (`store` and the fields after it).
 * @typedef {object} DashboardContext
 * @property {string} token
 * @property {string} projectDir The Project the server was started for.
 * @property {ReturnType<typeof createProjectHub>} hub
 * @property {ReturnType<typeof openRunStore>} store
 * @property {ReturnType<typeof openRunStore>} mainStore Clean-up runs from the main checkout, also when the Dashboard was started inside a Run worktree.
 * @property {Set<string>} inFlight Ids of the Runs with an action under way; one Project's set, so equal Run ids in two Projects never block each other.
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

// ADR 0034: the user's Fix starts a Follow-up scoped to one problem and leaves the Run waiting for an agent. The store refuses everything the Run's state does not allow, with how to resolve it; nothing bypasses that.
/** @param {DashboardContext} ctx @param {string} id @param {ReturnType<typeof interpretRun>} v */
async function fixRun(ctx, id, v) {
  const { send, store } = ctx;
  const params = query(ctx);
  if (['scope', 'updated', 'grant'].some((name) => params.getAll(name).length > 1))
    return send(400, 'text/plain', 'each query parameter may appear once');
  const [scope, updated, grant] = [params.get('scope'), params.get('updated'), params.get('grant')];
  if (!oneOf(FOLLOW_UP_SCOPES, scope))
    return send(400, 'text/plain', `invalid scope: use ${FOLLOW_UP_SCOPES.join(', ')}`);
  if (grant !== null && grant !== 'true') return send(400, 'text/plain', 'invalid grant option');
  if (updated === null) return send(409, 'text/plain', 'the request must name the Run record time you looked at');
  if (!can(v.pr, 'strictViewFlow'))
    return send(
      409,
      'text/plain',
      'Fix works for GitHub and Azure DevOps pull requests only; make the change in a new Run',
    );
  const outcome = await store.fixAsync(id, { scope: scope ?? undefined, updated: updated, grant: grant === 'true' });
  if (!outcome.started)
    return send(
      409,
      'text/plain',
      `${outcome.result}; there is nothing to fix for ${scope}; no Rework started and the snapshot was refreshed`,
    );
  send(200, 'text/plain', outcome.result);
}

// ADR 0035: the user's answer to a Run that outgrew the size limit, as the page showed it. A Run that changed since, or that waits for something else, is refused and nothing changes.
/** @param {DashboardContext} ctx @param {ReturnType<typeof interpretRun>} v @returns {string | undefined} The `updated` the user saw; undefined after the refusal is sent. */
function sizeAnswer(ctx, v) {
  const { send } = ctx;
  const updatedValues = query(ctx).getAll('updated');
  if (updatedValues.length > 1) return void send(400, 'text/plain', 'each query parameter may appear once');
  if (updatedValues.length === 0)
    return void send(409, 'text/plain', 'the request must name the Run record time you looked at');
  if (!v.waiting || v.column !== 'build' || v.reason !== SIZE_WAIT_REASON)
    return void send(409, 'text/plain', 'only a Run in Build that waits for the Run size answer can be answered');
  if (updatedValues[0] !== v.updated)
    return void send(409, 'text/plain', 'the Run changed since you looked at it; reload and look again');
  return updatedValues[0];
}

/** @param {DashboardContext} ctx @param {string} id @param {ReturnType<typeof interpretRun>} v */
function continueRun(ctx, id, v) {
  if (sizeAnswer(ctx, v) === undefined) return;
  ctx.store.size(id, { accept: true });
  ctx.send(200, 'text/plain', 'continued');
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
      if (action === 'follow-up') return await fixRun(ctx, id, v);
      if (action === 'continue') return continueRun(ctx, id, v);
      return await acceptCheck(ctx, id, v);
    } catch (err) {
      ctx.send(409, 'text/plain', messageOf(err).replace(/[\x00-\x1f\x7f-\x9f]/g, ' '));
    }
  });
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

// Check PR: a fresh read of the PR of a Done or Follow-up Run, never from or into the status cache.
/** @type {Handler} */
export async function prDetails(ctx) {
  const run = await findRun(ctx);
  if (!run) return;
  const v = run.view;
  if (v.unreadable || v.status === 'abandoned' || !['follow-up', 'done'].includes(v.column) || !providerFor(v.pr))
    return ctx.send(409, 'text/plain', 'only a Done or Follow-up Run with a pull request can be checked');
  ctx.send(200, 'application/json', JSON.stringify(await ctx.prViews.details(v.pr)));
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
