/** @import { startDashboard } from '../src/dashboard.js' */

// Headers a Dashboard page sends with a write: its own Origin and the session token from /api/info (ADR 0017).
/**
 * @param {Pick<Awaited<ReturnType<typeof startDashboard>>, 'url'>} dash
 * @param {string} [origin]
 */
export async function writeHeaders(dash, origin = dash.url) {
  const { token } = /** @type {{ token: string }} */ (await (await fetch(`${dash.url}/api/info`)).json()); // /api/info always answers with the token
  return { Origin: origin, 'X-Factory-Token': token };
}
