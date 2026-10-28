import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

class Element {
  constructor(tag) { this.tag = tag; this.childNodes = []; this.dataset = {}; this.attributes = {}; this.handlers = {}; this.textContent = ''; this.className = ''; this.hidden = false; this.classList = { add() {} }; }
  appendChild(child) { this.childNodes.push(child); }
  replaceChildren(...children) { this.childNodes = children; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, fn) { this.handlers[name] = fn; }
}
const descendants = (node) => [node, ...node.childNodes.flatMap(descendants)];
const flush = () => new Promise((resolve) => setImmediate(resolve));
const now = () => new Date().toISOString();

async function page(runs) {
  const elements = Object.fromEntries(['older', 'board', 'status', 'detail', 'project'].map((id) => [id, new Element(id)]));
  const fetch = async (url) => ({ ok: true, json: async () => (url === '/api/info' ? { project: 'test' } : runs) });
  const html = readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  runInNewContext(script, { document: { title: 'Dashboard', getElementById: (id) => elements[id], createElement: (tag) => new Element(tag) }, window: { confirm: () => false, alert() {} }, fetch, setInterval() {}, Date, encodeURIComponent, isNaN });
  await flush();
  const card = (title) => descendants(elements.board).find((e) => e.tag === 'li' && descendants(e).some((c) => c.textContent === title));
  return { card };
}
const done = { id: 'd', title: 'Done run', column: 'done', status: 'done', updated: now(), agent: 'claude', standards: 'pass', pr: 'https://example.com/pr/1', files: [], links: [] };
const active = { id: 'a', title: 'Active run', column: 'build', status: 'running', updated: now(), agent: 'codex', standards: 'pass', files: [], links: [] };
const toggle = (li) => descendants(li).find((e) => e.tag === 'button' && e.attributes['aria-expanded'] !== undefined);
const details = (li) => descendants(li).find((e) => e.className === 'details');

test('Done cards start collapsed and other columns do not', async () => {
  const { card } = await page([done, active]);
  const li = card('Done run');
  assert.equal(toggle(li).attributes['aria-expanded'], 'false');
  assert.equal(details(li).hidden, true);
  assert.ok(descendants(li).some((e) => /^Updated:/.test(e.textContent)));
  assert.equal(toggle(card('Active run')), undefined);
  assert.equal(details(card('Active run')), undefined);
});

test('the toggle flips a Done card in place without selecting it', async () => {
  const { card } = await page([done]);
  const li = card('Done run');
  let selected = false;
  li.handlers.click = () => { selected = true; };
  let stopped = 0;
  const event = { stopPropagation() { stopped++; } };
  toggle(li).handlers.click(event);
  assert.equal(selected, false);
  assert.equal(toggle(li).attributes['aria-expanded'], 'true');
  assert.equal(details(li).hidden, false);
  assert.ok(descendants(details(li)).some((e) => e.textContent === 'Delete'));
  toggle(li).handlers.click(event);
  assert.equal(details(li).hidden, true);
  toggle(li).handlers.keydown(event);
  assert.equal(stopped, 3);
});

test('an expanded card stays expanded after the board is rebuilt', async () => {
  const { card } = await page([done]);
  toggle(card('Done run')).handlers.click({ stopPropagation() {} });
  card('Done run').handlers.click(); // selecting a card rebuilds the board
  assert.equal(toggle(card('Done run')).attributes['aria-expanded'], 'true');
  assert.equal(details(card('Done run')).hidden, false);
});

test('a Run id like __proto__ starts collapsed', async () => {
  const { card } = await page([{ ...done, id: '__proto__' }]);
  assert.equal(details(card('Done run')).hidden, true);
});

test('a collapsed abandoned card still says it was abandoned', async () => {
  const { card } = await page([{ ...done, status: 'abandoned' }]);
  const li = card('Done run');
  assert.ok(li.childNodes.some((e) => e.textContent === 'Abandoned'));
});
