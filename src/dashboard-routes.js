/** @import { Handler } from './dashboard-handlers.js' */
import * as h from './dashboard-handlers.js';

/**
 * @typedef {object} Route
 * @property {string[]} methods
 * @property {RegExp} pattern Matched on the request path; capture groups reach the handler as `ctx.match`.
 * @property {Handler} handler
 */

// The first route whose method and pattern match answers, so the order is part of the contract.
/** @type {Route[]} */
export const ROUTES = [
  { methods: ['DELETE'], pattern: /^\/api\/runs\/[\s\S]*$/, handler: h.deleteRun },
  { methods: ['POST'], pattern: /^\/api\/runs\/([^/]+)\/merge$/, handler: h.mergeRun },
  { methods: ['POST'], pattern: /^\/api\/runs\/([^/]+)\/(sync|clean|accept|extra-loop)$/, handler: h.runAction },
  { methods: ['GET'], pattern: /^\/api\/runs\/([^/]+)\/merge-checks$/, handler: h.mergeChecks },
  { methods: ['GET'], pattern: /^\/api\/runs\/([^/]+)\/pr-status$/, handler: h.prStatus },
  { methods: ['GET', 'HEAD'], pattern: /^\/api\/info$/, handler: h.info },
  { methods: ['GET', 'HEAD'], pattern: /^\/api\/views$/, handler: h.views },
  { methods: ['GET', 'HEAD'], pattern: /^\/api\/runs$/, handler: h.runs },
  { methods: ['GET', 'HEAD'], pattern: /^\/files\/[\s\S]*$/, handler: h.runFile },
];

/**
 * @param {string | undefined} method
 * @param {string} path
 */
export function matchRoute(method, path) {
  for (const route of ROUTES) {
    const match = method !== undefined && route.methods.includes(method) ? path.match(route.pattern) : null;
    if (match) return { handler: route.handler, match };
  }
  return undefined;
}
