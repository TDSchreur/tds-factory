import http from 'node:http';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PORT = 4317;
const HOST = '127.0.0.1';
const PAGE = fileURLToPath(new URL('../dashboard.html', import.meta.url));
const FALLBACK_PAGE = `<!doctype html>
<meta charset="utf-8">
<title>tds-factory dashboard</title>
<h1>tds-factory dashboard</h1>
<p>The board page is not installed. Run records are available at <a href="/api/runs">/api/runs</a>.</p>
`;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// Names of the Markdown files directly inside a Run folder, sorted.
async function listMarkdown(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith('.md') && SEGMENT.test(e.name)).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

async function listRuns(runsDir) {
  let entries;
  try {
    entries = await readdir(runsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const runs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const files = await listMarkdown(join(runsDir, entry.name));
    try {
      const record = JSON.parse(await readFile(join(runsDir, entry.name, 'run.json'), 'utf8'));
      if (record === null || typeof record !== 'object' || Array.isArray(record)) throw new Error('not an object');
      runs.push({ id: entry.name, unreadable: false, record, files });
    } catch {
      runs.push({ id: entry.name, unreadable: true, record: null, files });
    }
  }
  return runs.sort((a, b) => a.id.localeCompare(b.id));
}

// Returns file contents, or null if the path is not a Markdown file inside a Run folder.
async function readRunFile(runsDir, rawPath) {
  let parts;
  try {
    parts = rawPath.split('/').map(decodeURIComponent);
  } catch {
    return null;
  }
  if (parts.length !== 2 || !parts.every((p) => SEGMENT.test(p) && !p.startsWith('..'))) return null;
  if (!parts[1].endsWith('.md')) return null;
  try {
    const root = await realpath(runsDir);
    const file = await realpath(resolve(root, ...parts));
    if (!file.startsWith(root + sep)) return null;
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

// Serves the .factory/runs folder of projectDir, read-only, on 127.0.0.1.
// Pass port 0 for a random free port. Resolves to { server, port, url, close }.
export async function startDashboard({ projectDir = process.cwd(), port = DEFAULT_PORT } = {}) {
  const runsDir = resolve(projectDir, '.factory', 'runs');

  const server = http.createServer(async (req, res) => {
    const send = (status, type, body) => {
      res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
      res.end(body);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'text/plain', 'method not allowed');
    const path = (req.url ?? '/').split('?')[0];
    try {
      if (path === '/') {
        return send(200, 'text/html', await readFile(PAGE, 'utf8').catch(() => FALLBACK_PAGE));
      }
      if (path === '/api/runs') return send(200, 'application/json', JSON.stringify(await listRuns(runsDir)));
      if (path.startsWith('/files/')) {
        const body = await readRunFile(runsDir, path.slice('/files/'.length));
        return body === null ? send(404, 'text/plain', 'not found') : send(200, 'text/markdown', body);
      }
      send(404, 'text/plain', 'not found');
    } catch {
      send(500, 'text/plain', 'internal error');
    }
  });

  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, HOST, ok);
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
