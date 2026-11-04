import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown } from '../dashboard/markdown.js';

/** @param {string} text */
const parse = (text) => JSON.parse(JSON.stringify(parseMarkdown(text)));
/** @param {string} v */
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
    parse('text\n---').map((/** @type {{ type: string }} */ b) => b.type),
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

/** @param {string} text */
const types = (text) => parse(text).map((/** @type {{ type: string }} */ b) => b.type);
/** @param {string} text */
const headings = (text) =>
  parse(text)
    .filter((/** @type {{ type: string }} */ b) => b.type === 'heading')
    .map((/** @type {{ inline: { v?: string }[] }} */ b) => b.inline.map((s) => s.v).join(''));

const FENCES = [
  ['a tilde fence hides a shell comment', '~~~sh\n# comment\n~~~\n# Real', ['code', 'heading']],
  ['a tilde line inside a backtick block does not close it', '```\n~~~\n# in\n```\n# Out', ['code', 'heading']],
  ['a backtick line inside a tilde block does not close it', '~~~\n```\n# in\n~~~\n# Out', ['code', 'heading']],
  ['a shorter closer does not close a longer fence', '````\n```\n# in\n````\n# Out', ['code', 'heading']],
  ['a longer closer closes', '```\n# in\n`````\n# Out', ['code', 'heading']],
  ['a closer of the other character does not close', '~~~\n# in\n```\n# still in', ['code']],
  ['a closer with trailing text does not close', '```\n# in\n``` x\n# still in\n```\n# Out', ['code', 'heading']],
  ['a closer with trailing spaces closes', '```\n# in\n```   \n# Out', ['code', 'heading']],
  ['an unclosed fence runs to the end', '~~~\n# a\n# b', ['code']],
  ['mixed blocks one after another', '```\n# a\n```\n~~~\n# b\n~~~\n# Out', ['code', 'code', 'heading']],
  ['a backtick fence info string with a backtick is no fence', '``` a`b\n# Out', ['paragraph', 'heading']],
  ['a tilde fence interrupts a paragraph', 'text\n~~~\n# in\n~~~', ['paragraph', 'code']],
];
for (const [name, text, expected] of FENCES)
  test(`fence: ${name}`, () => {
    assert.deepEqual(types(String(text)), expected);
  });

test('a fence keeps its body as code text', () => {
  assert.deepEqual(parse('~~~sh\na\n# b\n~~~'), [{ type: 'code', text: 'a\n# b' }]);
});

const HEADINGS = [
  ['3 spaces of indent', '   # T', ['T']],
  ['4 spaces of indent is code, not a heading', '    # T', []],
  ['a tab indent is not a heading', '\t# T', []],
  ['a closing sequence', '# Title ##', ['Title']],
  ['a single closing hash', '# Title #', ['Title']],
  ['only hashes', '# #', ['']],
  ['only many hashes', '# ##', ['']],
  ['an empty heading', '#', ['']],
  ['a closing hash glued to the text stays', '# Title#', ['Title#']],
  ['an escaped hash stays', '# Title \\#', ['Title \\#']],
  ['text after the hashes stays', '# Title # x', ['Title # x']],
  ['spaces after the closing sequence', '# Title ##   ', ['Title']],
  ['a tab after the closing sequence', '# Title ##\t', ['Title']],
  ['a tab after the opening hash', '#\tTitle', ['Title']],
  ['a hashtag is no heading', '#hashtag', []],
  ['more than six hashes is no heading', '####### T', []],
];
for (const [name, text, expected] of HEADINGS)
  test(`heading: ${name}`, () => {
    assert.deepEqual(headings(String(text)), expected);
  });

test('an indented hash line does not end a paragraph', () => {
  assert.deepEqual(types('text\n    # more'), ['paragraph']);
});

const HOSTILE = [
  ['spaces inside a heading', `# a${' '.repeat(200_000)}b`],
  ['spaces then hashes then text', `# a${' '.repeat(100_000)}${'#'.repeat(100_000)}x`],
  ['one huge closing sequence', `# a ${'#'.repeat(300_000)}`],
  ['many fence lines', '~~~\n```\n'.repeat(50_000)],
  ['many unclosed fences of growing length', Array.from({ length: 3000 }, (_, i) => '`'.repeat(i + 3)).join('\n')],
  ['a very long fence line', `${'~'.repeat(300_000)} info`],
  ['many headings', '# a ##\n'.repeat(50_000)],
  ['control characters and NUL in a heading', '# a\u0000\u001b[31m b ##\r\n# c\u2028d'],
];
for (const [name, text] of HOSTILE)
  test(`hostile input stays linear and does not throw: ${name}`, () => {
    const started = process.hrtime.bigint();
    parseMarkdown(text);
    // A generous bound that only a quadratic regular expression breaks.
    assert.ok(Number(process.hrtime.bigint() - started) / 1e9 < 5);
  });

test('a closing sequence is removed in one linear pass from a heading of many spaces', () => {
  assert.deepEqual(headings(`# a${' '.repeat(50_000)}b ##`), [`a${' '.repeat(50_000)}b`]);
});
