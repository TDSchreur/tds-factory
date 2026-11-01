import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDashboard } from '../src/dashboard.js';

// The files the page loads, worked out the way a browser does (#368: a module missing from the server's allowlist stopped the whole page),
// asked from the real server, not from a stub.
const DIR = fileURLToPath(new URL('../dashboard/', import.meta.url));
const TYPE = { '.js': /^text\/javascript/, '.css': /^text\/css/, '.svg': /^image\/svg\+xml/ };
const read = (path) => readFileSync(join(DIR, path), 'utf8');

// Absolute paths a document names: script src, link href and the URLs of an import map.
function pagePaths(html) {
  const paths = [...html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="(\/[^"]*)"/g)].map((m) => m[1]);
  for (const map of html.matchAll(/<script type="importmap">([\s\S]*?)<\/script>/g))
    paths.push(...Object.values(JSON.parse(map[1]).imports));
  return paths;
}
// Paths of the relative imports and re-exports of a module, resolved against the module's own path.
function importsOf(path) {
  const found = [...read(path).matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => m[1]);
  return found.map((rel) => posix.normalize(posix.join(posix.dirname('/' + path), rel)));
}
function loadedFiles() {
  const queue = pagePaths(read('index.html')),
    seen = new Set();
  while (queue.length) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    if (path.endsWith('.js')) queue.push(...importsOf(path.slice(1)));
  }
  return [...seen].sort();
}
const ownFiles = (dir = '') =>
  readdirSync(join(DIR, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? e.name === 'vendor'
        ? []
        : ownFiles(join(dir, e.name))
      : /\.(js|css)$/.test(e.name)
        ? ['/' + join(dir, e.name)]
        : [],
  );

test('the page loads the files this test expects to find', () => {
  const loaded = loadedFiles();
  for (const path of [
    '/app.js',
    '/components.js',
    '/model.js',
    '/markdown.js',
    '/help.js',
    '/style.css',
    '/favicon.svg',
    '/vendor/preact.js',
    '/vendor/hooks.js',
    '/vendor/htm.js',
  ])
    assert.ok(loaded.includes(path), path);
});

test('the real server serves every file the page loads, with the right content type', async () => {
  const project = mkdtempSync(join(tmpdir(), 'dash-assets-'));
  const dash = await startDashboard({ projectDir: project, port: 0 });
  try {
    const page = await fetch(dash.url + '/');
    assert.equal(page.status, 200);
    for (const path of loadedFiles()) {
      const res = await fetch(dash.url + path);
      assert.equal(res.status, 200, `${path} is not served (add it to ASSETS in src/dashboard.js)`);
      assert.match(res.headers.get('content-type'), TYPE[path.slice(path.lastIndexOf('.'))], path);
      await res.arrayBuffer();
    }
  } finally {
    await dash.close();
    rmSync(project, { recursive: true, force: true });
  }
});

test('every script and stylesheet of the Dashboard is reached from the page', () => {
  const loaded = loadedFiles();
  assert.deepEqual(
    ownFiles().filter((path) => !loaded.includes(path)),
    [],
    'a file nothing imports is either dead or not wired into the page',
  );
});

test('the import and path readers see what a browser would', () => {
  assert.deepEqual(
    pagePaths(
      '<link rel="icon" href="/a.svg"><script src="/b.js"></script><script type="importmap">{"imports":{"x":"/v/x.js"}}</script><a href="/not-a-resource">',
    ),
    ['/a.svg', '/b.js', '/v/x.js'],
  );
});
