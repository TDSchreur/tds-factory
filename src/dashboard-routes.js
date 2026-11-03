/** @import { Handler } from './dashboard-handlers.js' */
import * as h from './dashboard-handlers.js';

/**
 * @typedef {object} Route
 * @property {string[]} methods
 * @property {RegExp} pattern Matched on the request path; capture groups reach the handler as `ctx.match`.
 * @property {Handler} handler
 * @property {boolean} [scoped] The first capture group is the Project id; the server answers 404 for an id the Dashboard does not serve and hands the handler that Project's services and a `ctx.match` without the id.
 */

// The first route whose method and pattern match answers, so the order is part of the contract.
/** @type {Route[]} */
export const ROUTES = [
  { methods: ['DELETE'], pattern: /^\/api\/projects\/missing$/, handler: h.removeMissingProjects },
  { methods: ['DELETE'], pattern: /^\/api\/projects\/([^/]+)$/, handler: h.removeProject },
  { methods: ['DELETE'], pattern: /^\/api\/projects\/([^/]+)\/runs\/([\s\S]*)$/, handler: h.deleteRun, scoped: true },
  { methods: ['POST'], pattern: /^\/api\/projects\/([^/]+)\/runs\/([^/]+)\/merge$/, handler: h.mergeRun, scoped: true },
  {
    methods: ['POST'],
    pattern: /^\/api\/projects\/([^/]+)\/runs\/([^/]+)\/(sync|clean|accept|extra-loop)$/,
    handler: h.runAction,
    scoped: true,
  },
  {
    methods: ['GET'],
    pattern: /^\/api\/projects\/([^/]+)\/runs\/([^/]+)\/merge-checks$/,
    handler: h.mergeChecks,
    scoped: true,
  },
  {
    methods: ['GET'],
    pattern: /^\/api\/projects\/([^/]+)\/runs\/([^/]+)\/pr-status$/,
    handler: h.prStatus,
    scoped: true,
  },
  { methods: ['GET', 'HEAD'], pattern: /^\/api\/info$/, handler: h.info },
  { methods: ['GET', 'HEAD'], pattern: /^\/api\/views$/, handler: h.views },
  { methods: ['GET', 'HEAD'], pattern: /^\/api\/projects\/([^/]+)\/runs$/, handler: h.runs, scoped: true },
  { methods: ['GET', 'HEAD'], pattern: /^\/files\/([^/]+)\/([\s\S]*)$/, handler: h.runFile, scoped: true },
];

/**
 * @param {string | undefined} method
 * @param {string} path
 */
export function matchRoute(method, path) {
  for (const route of ROUTES) {
    const match = method !== undefined && route.methods.includes(method) ? path.match(route.pattern) : null;
    if (match) return { handler: route.handler, match, scoped: route.scoped === true };
  }
  return undefined;
}
