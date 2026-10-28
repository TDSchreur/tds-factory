import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

class Element {
  constructor(tag) { this.tag = tag; this.childNodes = []; this.dataset = {}; this.classList = { add() {} }; this.handlers = {}; this.textContent = ''; }
  appendChild(child) { this.childNodes.push(child); }
  replaceChildren(...children) { this.childNodes = children; }
  setAttribute() {}
  addEventListener(name, fn) { this.handlers[name] = fn; }
  focus() {}
}
const descendants = (node) => [node, ...node.childNodes.flatMap(descendants)];
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('bulk confirmation includes hidden Done Runs and reports partial failures', async () => {
  const elements = Object.fromEntries(['older', 'board', 'status', 'detail', 'project', 'dialog', 'dialog-title', 'dialog-message', 'dialog-cancel', 'dialog-confirm'].map((id) => [id, new Element(id)]));
  const requests = [];
  elements.dialog.showModal = function () { this.open = true; };
  elements.dialog.close = function (value) { this.open = false; this.returnValue = value; this.handlers.close(); };
  const runs = [
    { id: 'new', title: 'New', column: 'done', updated: new Date().toISOString(), files: [], links: [] },
    { id: 'old', title: 'Old', column: 'done', updated: '2020-01-01T00:00:00Z', files: [], links: [] },
    { id: 'active', title: 'Active', column: 'build', updated: new Date().toISOString(), files: [], links: [] },
  ];
  const fetch = async (url, options = {}) => {
    if (options.method === 'DELETE') { requests.push(url); return { ok: !url.endsWith('/old'), text: async () => 'refused' }; }
    return { ok: true, json: async () => url === '/api/info' ? { project: 'test' } : runs };
  };
  const html = readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  runInNewContext(script, { document: { title: 'Dashboard', getElementById: (id) => elements[id], createElement: (tag) => new Element(tag) }, window: {}, fetch, setInterval() {}, Date, encodeURIComponent, isNaN });
  await flush();
  const button = descendants(elements.board).find((e) => e.tag === 'button' && e.textContent === 'Delete all');
  assert.ok(button);
  button.handlers.click();
  await flush();
  assert.match(elements['dialog-message'].textContent, /2 Done Runs.*hidden older Runs/);
  elements['dialog-cancel'].handlers.click();
  await flush();
  assert.deepEqual(requests, []);
  button.handlers.click();
  await flush();
  elements['dialog-confirm'].handlers.click();
  await flush();
  assert.deepEqual(requests, ['/api/runs/new', '/api/runs/old']);
  assert.match(elements['dialog-message'].textContent, /Old.*refused/);
  elements['dialog-confirm'].handlers.click();
});
