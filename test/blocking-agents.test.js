import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENTS_DIR } from '../src/paths.js';

// Every reviewer agent of every Agent target asks for a severity and a basis on each finding, so the coordinator can apply the Blocking finding rule.
test('the check agents of all three targets ask for a severity and the basis of each finding', () => {
  const targets = readdirSync(AGENTS_DIR);
  assert.deepEqual(targets.sort(), ['claude', 'codex', 'copilot']);
  for (const target of targets) {
    const files = readdirSync(join(AGENTS_DIR, target)).filter((f) => /^factory-(interactive-)?check\./.test(f));
    assert.equal(files.length, 2, target);
    for (const file of files) {
      const text = readFileSync(join(AGENTS_DIR, target, file), 'utf8');
      assert.match(text, /severity \(CRITICAL, HIGH, MEDIUM, LOW or INFO\)/, `${target}/${file}`);
      assert.match(text, /the standard or Spec requirement it breaks, or `judgement`/, `${target}/${file}`);
      assert.match(
        text,
        /code smell or style judgement is never above LOW, and a security, infrastructure or project review finding keeps its severity whatever its basis/,
        `${target}/${file}`,
      );
    }
  }
});
