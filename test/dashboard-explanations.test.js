import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

class Element {
  constructor(tag) { this.tag = tag; this.childNodes = []; this.dataset = {}; this.classList = { add() {} }; this.handlers = {}; this.textContent = ''; this.attrs = {}; }
  appendChild(child) { this.childNodes.push(child); }
  replaceChildren(...children) { this.childNodes = children; }
  setAttribute(name, value) { this.attrs[name] = value; }
  addEventListener(name, fn) { this.handlers[name] = fn; }
  focus() {}
}
const descendants = (node) => [node, ...node.childNodes.flatMap(descendants)];
const flush = () => new Promise((resolve) => setImmediate(resolve));

const html = readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');

test('page has a collapsed introduction to the Factory', () => {
  assert.match(html, /<details id="intro"(?![^>]*\bopen\b)[^>]*>\s*<summary>What is this\?/);
});

test('Stage headings and chips carry tooltips', async () => {
  const elements = Object.fromEntries(['older', 'board', 'status', 'detail', 'project', 'dialog', 'dialog-title', 'dialog-message', 'dialog-cancel', 'dialog-confirm'].map((id) => [id, new Element(id)]));
  const runs = [{ id: 'a', title: 'A', column: 'check', updated: new Date().toISOString(), files: [], links: [], ticketsTotal: 2, ticketsDone: 1, standards: 'pass', spec: 'pass', security: 'fail', infrastructure: 'skipped', loops: 1 }];
  const fetch = async (url) => ({ ok: true, json: async () => url === '/api/info' ? { project: 'test' } : runs });
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  runInNewContext(script, { document: { title: 'Dashboard', getElementById: (id) => elements[id], createElement: (tag) => new Element(tag) }, window: {}, fetch, setInterval() {}, Date, encodeURIComponent, isNaN });
  await flush();
  const all = descendants(elements.board);
  const headings = all.filter((e) => e.tag === 'h2');
  assert.equal(headings.length, 6);
  for (const h of headings) {
    assert.ok(h.title && h.title.length > 20, `${h.textContent} has a tooltip`);
    assert.equal(h.attrs.tabindex, '0');
  }
  const chips = all.filter((e) => /\bchip\b/.test(e.className || ''));
  assert.equal(chips.length, 6);
  for (const c of chips) assert.ok(c.title && c.title.length > 10, `${c.textContent} has a tooltip`);
});
