import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, symlinkSync, rmSync, utimesSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { startDashboard } from '../src/dashboard.js';
import { createLinkedTitles, locateLinkedDocument, titleOf } from '../src/run-folder.js';
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

/**
 * @template T
 * @param {string} prefix
 * @param {(dir: string) => Promise<T>} body
 */
async function withDir(prefix, body) {
  const dir = tempDir(prefix);
  try {
    return await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

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
  wt = join(main, '.factory', 'worktrees', 'titles-wt');
  mkdirSync(wt, { recursive: true });
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
  for (const dir of [main, outside]) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
function oneTitle(body) {
  return withDir('titles-unit-', async (dir) => {
    put(dir, 'a.md', body);
    return (await createLinkedTitles().of(dir, { spec_link: 'a.md' }))['a.md'];
  });
}

test('a file is read again only when its size or modification time changes', () =>
  withDir('titles-cache-', async (dir) => {
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
  }));

test('the cache stays within its bound and drops the oldest entry first', () =>
  withDir('titles-bound-', async (dir) => {
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
  }));

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
function labelOf(name) {
  return withDir('titles-digits-', async (dir) => {
    put(dir, name, '# Title\n');
    return (await createLinkedTitles().of(dir, { tickets: [name] }))[name];
  });
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

test('a directory or a FIFO in the worktree falls through to the main checkout copy', async (t) => {
  await withDir('titles-special-', async (dir) => {
    const worktree = join(dir, '.factory', 'worktrees', 'w');
    mkdirSync(join(worktree, 'dir.md'), { recursive: true });
    put(dir, 'dir.md', '# Main dir\n');
    put(dir, 'fifo.md', '# Main fifo\n');
    try {
      execFileSync('mkfifo', [join(worktree, 'fifo.md')]);
    } catch {
      t.diagnostic('no mkfifo here: the FIFO case is not exercised');
    }
    const titles = await createLinkedTitles().of(dir, { worktree, tickets: ['dir.md', 'fifo.md'] });
    assert.deepEqual(titles, { 'dir.md': 'Main dir', 'fifo.md': 'Main fifo' });
  });
});

test('the title of a file above 1 MiB still comes from its first 4 KB', async () => {
  await withDir('titles-large-', async (dir) => {
    put(dir, 'big.md', `# Big\n${'x'.repeat(2 * 1024 * 1024)}`);
    assert.deepEqual(await createLinkedTitles().of(dir, { spec_link: 'big.md' }), { 'big.md': 'Big' });
  });
});

test('a worktree outside .factory/worktrees/ is no root', async () => {
  await withDir('titles-root-', async (dir) => {
    put(dir, 'a.md', '# Main\n');
    put(outside, 'a.md', '# Outside\n');
    const titles = createLinkedTitles();
    assert.deepEqual(await titles.of(dir, { worktree: outside, spec_link: 'a.md' }), { 'a.md': 'Main' });
    assert.deepEqual(await titles.of(dir, { worktree: 7, spec_link: 'a.md' }), { 'a.md': 'Main' });
    assert.deepEqual(await titles.of(dir, { worktree: 'rel', spec_link: 'a.md' }), { 'a.md': 'Main' });
  });
});

/** @param {{ count: number }} counter */
const counting = (counter) =>
  /** @type {typeof locateLinkedDocument} */ (
    (...args) => {
      counter.count++;
      return locateLinkedDocument(...args);
    }
  );

test('an unchanged record is not located again; a changed one, or a deleted file, is', async () => {
  await withDir('titles-located-', async (dir) => {
    put(dir, 'a.md', '# One\n');
    const counter = { count: 0 };
    const titles = createLinkedTitles({ locate: counting(counter) });
    const record = { updated: '1', spec_link: 'a.md' };
    assert.deepEqual(await titles.of(dir, record, 'run-1'), { 'a.md': 'One' });
    assert.deepEqual(await titles.of(dir, record, 'run-1'), { 'a.md': 'One' });
    assert.equal(counter.count, 1);
    await titles.of(dir, { ...record, updated: '2' }, 'run-1');
    assert.equal(counter.count, 2);
    rmSync(join(dir, 'a.md'));
    assert.deepEqual(await titles.of(dir, { ...record, updated: '2' }, 'run-1'), {});
    assert.equal(counter.count, 3);
    put(dir, 'a.md', '# Back\n');
    assert.deepEqual(await titles.of(dir, { ...record, updated: '3' }, 'run-1'), { 'a.md': 'Back' });
    assert.equal(counter.count, 4);
  });
});

test('a finished Run keeps its title without locating its documents again', async () => {
  await withDir('titles-finished-', async (dir) => {
    put(dir, 'a.md', '# Kept\n');
    const counter = { count: 0 };
    const titles = createLinkedTitles({ locate: counting(counter) });
    const record = { stage: 'finish', status: 'done', updated: '1', spec_link: 'a.md' };
    await titles.of(dir, record, 'run-done');
    assert.deepEqual(await titles.of(dir, record, 'run-done'), { 'a.md': 'Kept' });
    assert.equal(counter.count, 1);
  });
});

test('the cache drops the least recently used entry, so a hot title survives a burst', async () => {
  await withDir('titles-lru-', async (dir) => {
    const rels = ['a.md', 'b.md', 'c.md', 'd.md', 'e.md'];
    for (const rel of rels) put(dir, rel, `# ${rel}\n`);
    /** @type {string[]} */
    const reads = [];
    const titles = createLinkedTitles({
      max: 3,
      read: async (file) => {
        reads.push(file);
        return '# x\n';
      },
    });
    await titles.of(dir, { tickets: ['a.md', 'b.md', 'c.md'] });
    await titles.of(dir, { tickets: ['a.md'] });
    await titles.of(dir, { tickets: ['d.md', 'e.md'] });
    assert.equal(titles.size(), 3);
    reads.length = 0;
    await titles.of(dir, { tickets: ['a.md'] });
    assert.equal(reads.length, 0, 'the entry used last survived');
    await titles.of(dir, { tickets: ['b.md'] });
    assert.equal(reads.length, 1, 'an entry nobody used was dropped');
  });
});

test('a document that is not found is located again only when the Run record changes', async () => {
  await withDir('titles-missing-', async (dir) => {
    const counter = { count: 0 };
    const titles = createLinkedTitles({ locate: counting(counter) });
    const record = { updated: '1', spec_link: 'a.md' };
    assert.deepEqual(await titles.of(dir, record, 'run-1'), {});
    assert.deepEqual(await titles.of(dir, record, 'run-1'), {});
    assert.equal(counter.count, 1);
    put(dir, 'a.md', '# Now\n');
    assert.deepEqual(await titles.of(dir, record, 'run-1'), {}, 'the record did not change');
    assert.deepEqual(await titles.of(dir, { ...record, updated: '2' }, 'run-1'), { 'a.md': 'Now' });
    assert.equal(counter.count, 2);
  });
});

test(
  'a located file swapped for a symlink to an outside file is located again and refused',
  { skip: process.platform === 'win32' && 'symlinks need privilege on Windows' },
  async () => {
    await withDir('titles-swap-', async (dir) => {
      put(dir, 'a.md', '# One\n');
      put(outside, 'swap.md', '# Out\n');
      const when = new Date(2003, 0, 1);
      utimesSync(join(dir, 'a.md'), when, when);
      utimesSync(join(outside, 'swap.md'), when, when);
      const titles = createLinkedTitles();
      const record = { updated: '1', spec_link: 'a.md' };
      assert.deepEqual(await titles.of(dir, record, 'run-1'), { 'a.md': 'One' });
      rmSync(join(dir, 'a.md'));
      symlinkSync(join(outside, 'swap.md'), join(dir, 'a.md'));
      // Same size and modification time as the cached title, so only the real path check can tell.
      assert.deepEqual(await titles.of(dir, record, 'run-1'), {});
    });
  },
);
