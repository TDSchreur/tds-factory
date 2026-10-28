import http from 'node:http';
import fs from 'node:fs';
import { interpretRun, withRunLock } from './run-record.js';
import { stages } from './flow.js';
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
<p>The Dashboard page is not installed. Run records are available at <a href="/api/runs">/api/runs</a>.</p>
`;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// Sort Stage summaries in Flow order, with numbered Check passes sorted numerically.
function stageOrder(name) {
  const base = name.replace(/\.md$/, '');
  const m = /^check-(\d+)$/.exec(base);
  const index = stages.indexOf(m ? 'check' : base);
  return [index < 0 ? stages.length : index, m ? Number(m[1]) : 0];
}
const byStage = (a, b) => {
  const [x, y] = [stageOrder(a), stageOrder(b)];
  return x[0] - y[0] || x[1] - y[1] || a.localeCompare(b);
};

// Names of the Markdown files directly inside a Run folder, in Stage order.
async function listMarkdown(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith('.md') && SEGMENT.test(e.name)).map((e) => e.name).sort(byStage);
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

// Deletes only a terminal Run in the project's own, unlinked storage.
function deleteRun(projectDir, id) {
  if (!id || id === '.' || id === '..' || /[\/\\\0]/.test(id)) return 400;
  const project = fs.realpathSync(projectDir);
  const factory = join(project, '.factory');
  const root = join(factory, 'runs');
  const dir = join(root, id);
  try {
    if (fs.realpathSync(factory) !== factory || fs.realpathSync(root) !== root) return 409;
    return withRunLock(root, id, () => {
    if (fs.realpathSync(dir) !== dir || fs.lstatSync(join(dir, 'run.json')).isSymbolicLink()) return 409;
    const record = JSON.parse(fs.readFileSync(join(dir, 'run.json'), 'utf8'));
    if (!record || !['done', 'abandoned'].includes(record.status)) return 409;
    fs.rmSync(dir, { recursive: true });
    return 200;
    });
  } catch (err) {
    if (err.code === 'ENOENT') return 404;
    if (err.code === 'EEXIST') return 409;
    if (err instanceof SyntaxError) return 409;
    throw err;
  }
}

// Serves the .factory/runs folder of projectDir on 127.0.0.1.
// Pass port 0 for a random free port. Resolves to { server, port, url, close }.
export async function startDashboard({ projectDir = process.cwd(), port = DEFAULT_PORT } = {}) {
  const runsDir = resolve(projectDir, '.factory', 'runs');

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
        const status = deleteRun(projectDir, id);
        return send(status, 'text/plain', status === 200 ? 'deleted' : 'cannot delete Run');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'text/plain', 'method not allowed');
      if (path === '/') {
        return send(200, 'text/html', await readFile(PAGE, 'utf8').catch(() => FALLBACK_PAGE));
      }
      if (path === '/api/info') return send(200, 'application/json', JSON.stringify({ project: resolve(projectDir) }));
      if (path === '/api/views') return send(200, 'application/json', JSON.stringify((await listRuns(runsDir)).map(interpretRun)));
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
