// Headers a Dashboard page sends with a write: its own Origin and the session token from /api/info (ADR 0017).
export async function writeHeaders(dash, origin = dash.url) {
  const { token } = await (await fetch(`${dash.url}/api/info`)).json();
  return { Origin: origin, 'X-Factory-Token': token };
}
