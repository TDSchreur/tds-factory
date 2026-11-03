/** @import { PrStatus } from './pr-provider.js' */
import { providerFor, providerWith } from './pr-provider.js';
import { codeOf, oneOf } from './narrow.js';
import { interpretRun } from './dashboard-view.js';

const PR_CACHE_MS = 60_000;
// PR status (ADR 0020): an open PR is looked up again after a minute, a merged or closed one after ten, a failed lookup after half a minute.
const PR_STATUS_MS = 60_000,
  PR_STATUS_FINAL_MS = 600_000,
  PR_STATUS_FAIL_MS = 30_000,
  PR_STATUS_MAX = 500;
export const PR_STATUS_REFRESH_MS = 5_000;
const STATUS_REASONS = [
  'gh-missing',
  'not-signed-in',
  'rate-limited',
  'az-missing',
  'az-extension-missing',
  'az-not-signed-in',
  'error',
];
// A PR link no provider handles, or one whose provider lacks the operation, throws here, as it always did.
/** @param {string} url */
export const ghPrState = (url) => providerWith(url, 'statusAsync').stateAsync(url);
/** @param {string} url */
export const ghPrStatus = (url) => providerWith(url, 'statusAsync').statusAsync(url);

/** @param {string} url */
export const ghPrDetails = (url) => providerWith(url, 'details').details(url);

/**
 * The PR state and status caches of one Dashboard.
 * @param {object} options
 * @param {(url: string) => Promise<string>} options.prState
 * @param {(url: string) => Promise<PrStatus>} options.prStatus
 * @param {(url: string) => Promise<unknown>} [options.prDetails]
 */
export function createPrViews({ prState, prStatus, prDetails = ghPrDetails }) {
  /** @type {Map<string, { at: number, state: Promise<string> }>} */
  const prCache = new Map();
  /** @param {string} url */
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
  /** @type {Map<string, { at?: number, value?: unknown, ttl?: number, pending?: Promise<unknown> }>} */
  const statusCache = new Map();
  /** @param {string} url */
  const fetchStatus = (url) => {
    const entry = statusCache.get(url) ?? {};
    if (entry.pending) return entry.pending;
    const pending = Promise.resolve()
      .then(() => prStatus(url))
      .then(
        (value) => ({ value, ttl: value?.state === 'open' ? PR_STATUS_MS : PR_STATUS_FINAL_MS }),
        (/** @type {unknown} */ err) => ({
          value: { unavailable: oneOf(STATUS_REASONS, codeOf(err)) ? codeOf(err) : 'error' },
          ttl: PR_STATUS_FAIL_MS,
        }),
      )
      .then(({ value, ttl }) => {
        statusCache.delete(url);
        statusCache.set(url, { at: Date.now(), value, ttl });
        const oldest = statusCache.keys().next().value;
        if (statusCache.size > PR_STATUS_MAX && oldest !== undefined) statusCache.delete(oldest);
        return value;
      });
    statusCache.set(url, { ...entry, pending });
    return pending;
  };
  /** @param {string} url */
  const statusOf = (url) => {
    const hit = statusCache.get(url);
    if (hit?.value && Date.now() - (hit.at ?? 0) < (hit.ttl ?? 0)) return hit.value;
    fetchStatus(url);
    return hit?.value ?? { checking: true };
  };
  // Whether a Run has a PR whose status the page shows: a GitHub PR link in Finish, Follow-up or Done, on a Run that is not abandoned.
  /** @param {ReturnType<typeof interpretRun>} v */
  const hasStatus = (v) =>
    !v.unreadable &&
    v.status !== 'abandoned' &&
    ['finish', 'follow-up', 'done'].includes(v.column) &&
    !!providerFor(v.pr);
  /** @param {any} entry The store entry, which interpretRun types and reads itself. */
  const view = async (entry) => {
    const v = interpretRun(entry);
    return {
      ...v,
      prState: v.column === 'done' && providerFor(v.pr) ? await lookup(v.pr) : '',
      prStatus: hasStatus(v) ? statusOf(v.pr) : null,
      prHost: providerFor(v.pr)?.name ?? '',
    };
  };
  // Check PR: a fresh read that never touches the status cache. A failure is an answer, with the host's setup steps when they help.
  /** @param {string} url */
  const details = async (url) => {
    try {
      return await prDetails(url);
    } catch (err) {
      const reason = oneOf(STATUS_REASONS, codeOf(err)) ? codeOf(err) : 'error';
      const setup = providerFor(url)?.setup;
      return { unavailable: reason, ...(setup && oneOf(setup.reasons, reason) ? { setup: setup.steps } : {}) };
    }
  };
  return { prCache, statusCache, fetchStatus, statusOf, hasStatus, details, view };
}
