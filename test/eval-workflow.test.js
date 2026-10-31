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
  const scripts = [...workflow.matchAll(/^ {8}run: \|\n((?: {10}.*\n|\n)+)/gm)].map((m) => m[1]);
  assert.ok(scripts.length >= 2 && scripts.every((script) => !script.includes('${{')), 'no expression inside a run script');
  assert.equal(workflow.match(/secrets\./g).length, 1);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /permissions:\n  contents: read/);
});
