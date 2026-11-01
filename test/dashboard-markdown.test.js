import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown } from '../dashboard/markdown.js';

const parse = (text) => JSON.parse(JSON.stringify(parseMarkdown(text)));
const t = (v) => ({ t: 'text', v });

test('headings, paragraphs and rules become blocks', () => {
  assert.deepEqual(parse('# Title\n\nfirst\nsecond\n\n---'), [
    { type: 'heading', level: 1, inline: [t('Title')] },
    { type: 'paragraph', inline: [t('first second')] },
    { type: 'rule' },
  ]);
});

test('an indented heading in a diff renders and parsing continues', () => {
  assert.deepEqual(parse('+Added line\n ## Switching between releases\n\n Next line'), [
    { type: 'paragraph', inline: [t('+Added line')] },
    { type: 'heading', level: 2, inline: [t('Switching between releases')] },
    { type: 'paragraph', inline: [t('Next line')] },
  ]);
});

test('bullet and numbered lists keep their kind', () => {
  assert.deepEqual(parse('- a\n- b'), [
    { type: 'list', ordered: false, items: [{ inline: [t('a')] }, { inline: [t('b')] }] },
  ]);
  assert.deepEqual(parse('1. a\n2. b'), [
    { type: 'list', ordered: true, items: [{ inline: [t('a')] }, { inline: [t('b')] }] },
  ]);
});

test('an indented list item nests one level under the item above it', () => {
  assert.deepEqual(parse('- a\n  1. x\n  2. y\n- b'), [
    {
      type: 'list',
      ordered: false,
      items: [
        { inline: [t('a')], sub: { ordered: true, items: [{ inline: [t('x')] }, { inline: [t('y')] }] } },
        { inline: [t('b')] },
      ],
    },
  ]);
});

test('a rule right after a text line is still a rule', () => {
  assert.deepEqual(
    parse('text\n---').map((b) => b.type),
    ['paragraph', 'rule'],
  );
});

test('asterisks around spaces are not emphasis', () => {
  assert.deepEqual(parse('2 * 3 * 4')[0].inline, [t('2 * 3 * 4')]);
});

test('inline bold, italic, code and http links', () => {
  assert.deepEqual(parse('a **b** *c* `d` [e](https://x.io/p)')[0].inline, [
    t('a '),
    { t: 'strong', c: [t('b')] },
    t(' '),
    { t: 'em', c: [t('c')] },
    t(' '),
    { t: 'code', v: 'd' },
    t(' '),
    { t: 'link', href: 'https://x.io/p', c: [t('e')] },
  ]);
});

test('a link with another scheme is plain text', () => {
  assert.deepEqual(parse('[x](javascript:alert(1))')[0].inline, [t('x')]);
});

test('HTML stays text', () => {
  assert.deepEqual(parse('<img src=x onerror=alert(1)>')[0].inline, [t('<img src=x onerror=alert(1)>')]);
});

test('fenced code keeps its lines, and an unterminated fence runs to the end', () => {
  assert.deepEqual(parse('```diff\n- a\n+ b\n```'), [{ type: 'code', text: '- a\n+ b' }]);
  assert.deepEqual(parse('```\nopen\nstill'), [{ type: 'code', text: 'open\nstill' }]);
});

test('block quotes and tables', () => {
  assert.deepEqual(parse('> q1\n> q2'), [{ type: 'quote', inline: [t('q1 q2')] }]);
  assert.deepEqual(parse('| A | B |\n| --- | --- |\n| 1 | **2** |'), [
    { type: 'table', head: [[t('A')], [t('B')]], rows: [[[t('1')], [{ t: 'strong', c: [t('2')] }]]] },
  ]);
});

test('empty input gives no blocks', () => {
  assert.deepEqual(parse(''), []);
});
