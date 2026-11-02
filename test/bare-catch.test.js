import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// A catch without a variable throws the error away. In src/ that must be on purpose, and the first line of the block says why;
// a catch that has to react to the error names it instead.
test('every bare catch in src/ starts with a comment that says why the error is ignored', () => {
  /** @type {string[]} */
  const bare = [];
  for (const name of readdirSync('src').filter((f) => f.endsWith('.js'))) {
    const lines = readFileSync(join('src', name), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/\bcatch \{\s*$/.test(line) && !/^\s*(\/\/|\/\*)/.test(lines[i + 1] ?? '')) bare.push(`${name}:${i + 1}`);
    });
  }
  assert.deepEqual(bare, []);
});
