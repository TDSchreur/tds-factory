import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, symlinkSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { startDashboard } from '../src/dashboard.js';
import { createLinkedTitles, titleOf } from '../src/run-folder.js';
import { repo, tempDir } from './git-repo.js';

/** @typedef {Awaited<ReturnType<typeof startDashboard>>} Dash */
/** @type {Dash} */
let dash;
/** @type {string} */
let main;
/** @type {string} */
let wt;
/** @type {string} */
let outside;

const RUN = '2026-03-03-titles';
const ARCHIVED_RUN = '2026-03-04-archived';
const SPEC = 'docs/specs/spec.md';
const TICKETS = [
  '.scratch/f/issues/01-a.md',
  '.scratch/f/issues/02-main.md',
  '.scratch/f/issues/03-none.md',
  '.scratch/f/issues/04-link.md',
  '.scratch/f/issues/05-missing.md',
  '.scratch/f/issues/plain.md',
  'https://github.com/o/r/issues/7',
];

/** @param {string} root @param {string} rel @param {string} body */
function put(root, rel, body) {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), body);
}

/** @param {string} id @param {Record<string, unknown>} record */
function writeRun(id, record) {
  const dir = join(main, '.factory', 'runs', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ title: 'T', stage: 'build', status: 'running', ...record }));
}

/** @param {string} id */
async function titlesOf(id) {
  const res = await fetch(`http://127.0.0.1:${dash.port}/api/views`);
  const { projects } = /** @type {{ projects: any[] }} */ (await res.json());
  return projects[0].runs.find((/** @type {{ id: string }} */ r) => r.id === id).titles;
}

before(async () => {
  main = repo();
  wt = tempDir('titles-worktree-');
  outside = tempDir('titles-outside-');
  put(outside, 'leak.md', '# Leaked\n');
  writeRun(RUN, { worktree: wt, spec_link: SPEC, tickets: [...TICKETS, '/etc/passwd.md', '../x.md'] });
  writeRun(ARCHIVED_RUN, { stage: 'finish', status: 'done', worktree: wt, spec_link: 'docs/specs/archived.md' });
  put(wt, SPEC, '# Worktree Spec\n');
  put(main, SPEC, '# Main Spec\n');
  put(wt, '.scratch/f/issues/01-a.md', '# Skeleton and gh wrapper\n\nbody\n');
  put(main, '.scratch/f/issues/02-main.md', '# From main\n');
  put(wt, '.scratch/f/issues/03-none.md', 'No heading here\n\n## Level two\n');
  put(wt, '.scratch/f/issues/plain.md', '# Plain\n');
  put(main, 'unlisted.md', '# Unlisted\n');
  put(main, 'docs/specs/archive/archived.md', '# Archived Spec\n');
  try {
    symlinkSync(join(outside, 'leak.md'), join(wt, '.scratch/f/issues/04-link.md'));
  } catch {
    // The symlink test skips itself when the platform cannot create one.
  }
  dash = await startDashboard({ projectDir: main, port: 0 });
});

after(async () => {
  await dash.close();
  for (const dir of [main, wt, outside]) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('the Run view carries a title per listed local document, the worktree winning over the main checkout', async () => {
  const titles = await titlesOf(RUN);
  assert.equal(titles[SPEC], 'Worktree Spec');
  assert.equal(titles['.scratch/f/issues/01-a.md'], '01 Skeleton and gh wrapper');
  assert.equal(titles['.scratch/f/issues/02-main.md'], '02 From main');
  assert.equal(titles['.scratch/f/issues/plain.md'], 'Plain');
});

test('a Spec that moved to docs/specs/archive/ keeps its title', async () => {
  assert.equal((await titlesOf(ARCHIVED_RUN))['docs/specs/archived.md'], 'Archived Spec');
});

test('no heading, a missing file, a remote link and an unlisted path carry no title', async () => {
  const titles = await titlesOf(RUN);
  assert.deepEqual(Object.keys(titles).sort(), [
    '.scratch/f/issues/01-a.md',
    '.scratch/f/issues/02-main.md',
    '.scratch/f/issues/plain.md',
    SPEC,
  ]);
});

test(
  'a symlink that leads outside both folders carries no title',
  { skip: process.platform === 'win32' && 'symlinks need privilege on Windows' },
  async () => {
    assert.equal((await titlesOf(RUN))['.scratch/f/issues/04-link.md'], undefined);
  },
);

test('a changed file shows its new title on the next view', async () => {
  put(wt, '.scratch/f/issues/plain.md', '# Plain\n');
  assert.equal((await titlesOf(RUN))['.scratch/f/issues/plain.md'], 'Plain');
  put(wt, '.scratch/f/issues/plain.md', '# Plain, renamed\n');
  assert.equal((await titlesOf(RUN))['.scratch/f/issues/plain.md'], 'Plain, renamed');
  // Same size, different modification time.
  put(wt, '.scratch/f/issues/plain.md', '# Plain, RENAMED\n');
  utimesSync(join(wt, '.scratch/f/issues/plain.md'), new Date(2001, 0, 1), new Date(2001, 0, 1));
  assert.equal((await titlesOf(RUN))['.scratch/f/issues/plain.md'], 'Plain, RENAMED');
});

/** @param {string} body */
async function oneTitle(body) {
  const dir = tempDir('titles-unit-');
  try {
    put(dir, 'a.md', body);
    const titles = createLinkedTitles();
    return (await titles.of(dir, { spec_link: 'a.md' }))['a.md'];
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

test('a file is read again only when its size or modification time changes', async () => {
  const dir = tempDir('titles-cache-');
  try {
    put(dir, 'a.md', '# One\n');
    /** @type {string[]} */
    const reads = [];
    const titles = createLinkedTitles({
      read: async (file) => {
        reads.push(file);
        return '# One\n';
      },
    });
    const record = { spec_link: 'a.md' };
    await titles.of(dir, record);
    await titles.of(dir, record);
    assert.equal(reads.length, 1);
    put(dir, 'a.md', '# One!\n');
    await titles.of(dir, record);
    assert.equal(reads.length, 2);
    utimesSync(join(dir, 'a.md'), new Date(2002, 0, 1), new Date(2002, 0, 1));
    await titles.of(dir, record);
    assert.equal(reads.length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('the cache stays within its bound and drops the oldest entry first', async () => {
  const dir = tempDir('titles-bound-');
  try {
    const rels = ['a.md', 'b.md', 'c.md', 'd.md'];
    for (const rel of rels) put(dir, rel, `# ${rel}\n`);
    /** @type {string[]} */
    const reads = [];
    const titles = createLinkedTitles({
      max: 2,
      read: async (file) => {
        reads.push(file);
        return '# x\n';
      },
    });
    await titles.of(dir, { tickets: rels });
    assert.equal(titles.size(), 2);
    reads.length = 0;
    await titles.of(dir, { tickets: ['d.md'] });
    assert.equal(reads.length, 0, 'the newest entry is kept');
    await titles.of(dir, { tickets: ['a.md'] });
    assert.equal(reads.length, 1, 'the oldest entry was dropped');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

const NO_TITLE = [
  ['no heading', 'just text\n'],
  ['a level 2 heading', '## Two\n'],
  ['a Setext heading', 'Title\n=====\n'],
  ['# without a space', '#Title\n'],
  ['a hashtag', '#hashtag\n'],
  ['a heading in a fence', '```sh\n# a shell comment\n```\n'],
  ['a fence open at the cut', `\`\`\`\n${'x\n'.repeat(3000)}# late\n`],
  ['an empty heading', '#   \n'],
  ['only empty headings', '# \n# #\n#\n'],
  ['a heading in a tilde fence', '~~~sh\n# a shell comment\n~~~\n'],
  ['a heading indented four spaces', '    # Code\n'],
  ['a heading after 4 KB', `${'a'.repeat(4096)}\n# Late\n`],
  ['a line far over 4 KB', `${'a'.repeat(100_000)}\n# Late\n`],
  ['4 KB without a newline', 'a'.repeat(4096)],
  ['NUL bytes only', '\0\0\0\0'],
];
for (const [name, body] of NO_TITLE)
  test(`no title: ${name}`, async () => {
    assert.equal(await oneTitle(body), undefined);
  });

const TITLES = [
  ['CRLF line endings', '# Windows title\r\nbody\r\n', 'Windows title'],
  ['a heading after a fence', '```\n# no\n```\n# Yes\n', 'Yes'],
  [
    'inline code, emphasis and a link',
    '# The `code` and **bold** *em* [link](https://x.y/z)\n',
    'The code and bold em link',
  ],
  ['a local link', '# See [this](docs/x.md)\n', 'See this'],
  ['control characters', '# A\u0007B\u0000C​D‮E\n', 'A B C D E'],
  [
    'HTML kept as text',
    '# <img src=x onerror=alert(1)> <script>x</script>\n',
    '<img src=x onerror=alert(1)> <script>x</script>',
  ],
  ['a very long title', `# ${'long '.repeat(500)}\n`, `${'long '.repeat(24)}`.trim()],
  ['an empty first heading gives the next one', '# \n\n# #\n# Next\n', 'Next'],
  ['a closing sequence', '# Title ##\n', 'Title'],
  ['a heading after a tilde fence', '~~~\n# no\n~~~\n# Yes\n', 'Yes'],
  ['a heading near the 4 KB cut', `${'\n'.repeat(4000)}# Near\n`, 'Near'],
];
for (const [name, body, expected] of TITLES)
  test(`title: ${name}`, async () => {
    assert.equal(await oneTitle(body), expected);
  });

/** @param {string} name */
async function labelOf(name) {
  const dir = tempDir('titles-digits-');
  try {
    put(dir, name, '# Title\n');
    return (await createLinkedTitles().of(dir, { tickets: [name] }))[name];
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

test('the digit prefix of a file name has 1 to 6 digits', async () => {
  assert.equal(await labelOf('123456-a.md'), '123456 Title');
  assert.equal(await labelOf('1234567-a.md'), 'Title');
});

test('a long heading line is cut at a fixed length and the work stays small', () => {
  const started = process.hrtime.bigint();
  const title = titleOf(`# ${'*a '.repeat(1400)}\n`);
  assert.ok(title.length <= 120);
  // A generous bound that only a runaway regular expression breaks.
  assert.ok(Number(process.hrtime.bigint() - started) / 1e9 < 5);
});

test('many unclosed emphasis marks in 4 KB do not hang the parser', () => {
  const started = process.hrtime.bigint();
  titleOf(`# ${'*'.repeat(4000)}\n`);
  titleOf(`# ${'[a]('.repeat(800)}\n`);
  titleOf(`# ${'`'.repeat(4000)}\n`);
  assert.ok(Number(process.hrtime.bigint() - started) / 1e9 < 5);
});
