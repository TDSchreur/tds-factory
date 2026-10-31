import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workflow = readFileSync(resolve('.github/workflows/eval.yml'), 'utf8');

test('the eval workflow starts only by hand and checks its inputs before using them', () => {
  const triggers = /^on:\n((?:  .*\n|\n)+?)(?=\S)/m.exec(workflow)[1];
  assert.deepEqual([...triggers.matchAll(/^  (\w+):/gm)].map((m) => m[1]), ['workflow_dispatch']);
  assert.match(workflow, /Check the inputs[\s\S]*Run the scenarios/);
  assert.match(workflow, /EVAL_MODEL" =~/);
  assert.match(workflow, /permissions:\n  contents: read/);
});
