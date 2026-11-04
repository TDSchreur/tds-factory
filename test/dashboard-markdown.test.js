import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
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

// A worker runs the parse, so a parser that does not finish fails after the budget instead of hanging the test run.
const PARSE_BUDGET_MS = 5000;
/** @param {string} text */
function parseWithin(text) {
  const url = new URL('../dashboard/markdown.js', import.meta.url).href;
  const worker = new Worker(
    "const { parentPort, workerData } = require('node:worker_threads'); import(workerData.url).then((m) => { m.parseMarkdown(workerData.text); parentPort.postMessage('done'); });",
    { eval: true, workerData: { url, text } },
  );
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error(`the parser did not finish within ${PARSE_BUDGET_MS} ms`));
    }, PARSE_BUDGET_MS);
    worker.once('message', () => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(undefined);
    });
    worker.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

const MIB = 1024 * 1024;
const SP = ' '.repeat(MIB);
const ENDS = ['', '\r', '\u2028', '\u2029'];
/** @type {[string, string][]} */
const HOSTILE = [
  ['spaces inside a heading', `# a${' '.repeat(200_000)}b`],
  ['spaces then hashes then text', `# a${' '.repeat(100_000)}${'#'.repeat(100_000)}x`],
  ['one huge closing sequence', `# a ${'#'.repeat(300_000)}`],
  ['many fence lines', '~~~\n```\n'.repeat(50_000)],
  ['many unclosed fences of growing length', Array.from({ length: 3000 }, (_, i) => '`'.repeat(i + 3)).join('\n')],
  ['a very long fence line', `${'~'.repeat(300_000)} info`],
  ['many headings', '# a ##\n'.repeat(50_000)],
  ['many lines of one space', ' \n'.repeat(MIB / 2)],
  ['a thematic break of many dashes then text', `${'-'.repeat(MIB)}x`],
  ['spaces then dashes', `${' '.repeat(MIB / 2)}${'-'.repeat(MIB / 2)}x`],
  ['control characters and NUL in a heading', '# a\u0000\u001b[31m b ##\r\n# c\u2028d'],
  ['a quote of many spaces', `>${SP}x`],
  ['spaces before a quote marker', `${SP}x`],
  ['a long number then no dot', `${'9'.repeat(MIB)}x`],
  ['many numbered lines', '1. a\n'.repeat(MIB / 6)],
  ['many bullet lines', '- a\n'.repeat(MIB / 4)],
  ['deeply indented bullet lines', Array.from({ length: 1500 }, (_, i) => `${' '.repeat(i)}- a`).join('\n')],
  ['many table rows', '| a | b |\n|---|---|\n'.repeat(MIB / 20)],
  ['a table separator of many cells', `a|b\n${'|---'.repeat(MIB / 4)}x`],
  ['a table separator of many colons and dashes', `a|b\n${':-'.repeat(MIB / 2)}x`],
  ['a link bracket run', '['.repeat(MIB)],
  ['a bracket run then a link tail', `${'['.repeat(MIB / 2)}a](${'x'.repeat(MIB / 2)}`],
  ['many link starts sharing one long target', `${'[a'.repeat(MIB / 4)}](${'x'.repeat(MIB / 2)}`],
  ['many unclosed link targets', '[a](x'.repeat(MIB / 5)],
  ['many link targets with open parentheses', '[a]( ('.repeat(MIB / 6)],
  ['a link target of many parenthesis pairs', `[a](${'(x)'.repeat(MIB / 3)}`],
  ['bracket and star pairs', '[*'.repeat(MIB / 2)],
  ['star and bracket pairs', '*['.repeat(MIB / 2)],
  ['unclosed emphasis stars', '*a '.repeat(300_000)],
  ['unclosed strong marks', '**a '.repeat(250_000)],
  ['star runs', '*'.repeat(MIB)],
  ['a long strong span with no end', `**${'x'.repeat(MIB)}`],
  ['many code span starts', '`a'.repeat(MIB / 2)],
  ['a backtick run', '`'.repeat(MIB)],
  ['bold and italic mixed', '***a** *b* '.repeat(MIB / 12)],
];
for (const end of ENDS) {
  const shown = JSON.stringify(end);
  HOSTILE.push(
    [`hash, spaces, then ${shown}`, `#${' '.repeat(200_000)}${end}x`],
    [`indent, hash, spaces, then ${shown}`, `   ###${' '.repeat(200_000)}${end}`],
    [`many backticks, then ${shown}`, `${'`'.repeat(200_000)}${end}x`],
    [`many tildes, then ${shown}`, `${'~'.repeat(200_000)}${end}x`],
    [`a closing fence of many backticks then ${shown}`, `\`\`\`\n${'`'.repeat(200_000)}${end}`],
    [`a table separator line of spaces then ${shown}`, `|\n${SP}x${end}`],
    [`a table separator of dashes then spaces then ${shown}`, `a|b\n|---${SP}x${end}`],
    [`a bullet line of spaces then ${shown}`, `- ${SP}x${end}y`],
    [`a numbered line of spaces then ${shown}`, `1.${SP}x${end}y`],
    [`a nested bullet of spaces then ${shown}`, `- a\n  - ${SP}x${end}y`],
    [`a quote of spaces then ${shown}`, `>${SP}${end}x`],
    [`a thematic break of spaces then ${shown}`, `---${SP}${end}x`],
    [`unclosed emphasis stars with ${shown} between`, `*a${end} `.repeat(250_000)],
    [`unclosed strong marks with ${shown} between`, `**a${end}`.repeat(300_000)],
    [`emphasis that must cross ${shown}`, `*a${end}b `.repeat(150_000)],
  );
}
for (const [name, text] of HOSTILE)
  test(`hostile input stays linear and does not throw: ${name}`, () => parseWithin(text));

/** @param {string} unit */
const document = (unit) => unit.repeat(Math.ceil(MIB / unit.length));
for (const end of ENDS) {
  const shown = JSON.stringify(end);
  for (const [name, unit] of /** @type {[string, string][]} */ ([
    ['hash and space lines', `#${' '.repeat(1000)}${end}x\n`],
    ['bullet lines', `- ${' '.repeat(1000)}x${end}y\n`],
    ['table lines', `a|b\n|---${' '.repeat(1000)}x${end}\n`],
    ['link and emphasis lines', `[a](x${end}*b ${end}**c\n`],
  ]))
    test(`a document of about 1 MiB of ${name} with ${shown} parses within the budget`, () =>
      parseWithin(document(unit)));
}

test('a bullet line holding a lone CR ends in a list, not in a loop', () => {
  assert.deepEqual(types('- a\rb\n- c'), ['list']);
  assert.deepEqual(types('1. a\u2028b'), ['list']);
});

test('a closing sequence is removed in one linear pass from a heading of many spaces', () => {
  assert.deepEqual(headings(`# a${' '.repeat(50_000)}b ##`), [`a${' '.repeat(50_000)}b`]);
});

test('a line terminator character other than newline is kept as heading text', () => {
  assert.deepEqual(headings('# a\rb'), ['a\rb']);
});
