import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENTS_DIR, SKILLS_DIR } from '../src/paths.js';

import { section } from './skill-text.js';

const check = section('Check');

test('the coordinator passes the diff, the file list and the Verify summary inline to every reviewer', () => {
  assert.match(check, /\*\*Inline assignment\.\*\*/);
  assert.match(check, /once per pass/i);
  assert.match(check, /`git diff <base_sha>\.\.\.HEAD`/);
  assert.match(check, /changed file list/);
  assert.match(check, /Verify summary/);
  assert.match(check, /in each reviewer's assignment \(inline, or in one file in the Run folder, named in the assignment, that the reviewer reads first/);
  assert.match(check, /open other files only to follow a reference/);
  // A large diff: the file list and per-file diffs up to a limit, and the files left out are named.
  assert.match(check, /larger than about 40 KB/);
  assert.match(check, /name the files left out/);
  // The reviewers stay read-only and fresh.
  assert.match(check, /read-only and fresh/);
});

test('the reviewer agents of all three targets start from the supplied diff', () => {
  for (const target of readdirSync(AGENTS_DIR)) {
    for (const file of readdirSync(join(AGENTS_DIR, target)).filter((f) => /^factory-(interactive-)?check\./.test(f))) {
      const text = readFileSync(join(AGENTS_DIR, target, file), 'utf8');
      assert.match(text, /Start from the diff and changed file list the coordinator passes you/, `${target}/${file}`);
      assert.match(text, /open other files only to follow a reference/, `${target}/${file}`);
    }
  }
});
