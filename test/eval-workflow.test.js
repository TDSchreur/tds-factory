import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const workflow = readFileSync(resolve('.github/workflows/eval.yml'), 'utf8');

test('the eval workflow starts only by hand and checks its inputs before using them', () => {
  const triggers = /^on:\n((?:  .*\n|\n)+?)(?=\S)/m.exec(workflow)[1];
  assert.deepEqual([...triggers.matchAll(/^  (\w+):/gm)].map((m) => m[1]), ['workflow_dispatch']);
  assert.match(workflow, /Check the inputs[\s\S]*Run the scenarios/);
  for (const name of ['EVAL_MODEL', 'EVAL_SCENARIOS', 'EVAL_MINUTES']) assert.match(workflow, new RegExp(`\\[\\[ "\\$${name}" =~ \\$\\w+ \\]\\]`));
  assert.ok(workflow.indexOf('secrets.ANTHROPIC_API_KEY') > workflow.indexOf('name: Run the scenarios'), 'the key is only in the run step');
  const scripts = [...workflow.matchAll(/^ {8}run: \|\n((?: {10}.*\n|\n)+)/gm)].map((m) => m[1]);
  assert.ok(scripts.length >= 2 && scripts.every((script) => !script.includes('${{')), 'no expression inside a run script');
  assert.equal(workflow.match(/secrets\./g).length, 1);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /permissions:\n  contents: read/);
});

test('the input checks of the eval workflow run in bash and accept and reject what they should', () => {
  const step = /name: Check the inputs\n[\s\S]*?run: \|\n((?: {10}.*\n)+)/.exec(workflow)[1].replace(/^ {10}/gm, '');
  const check = (model, scenarios, minutes) => spawnSync('bash', ['-c', step], { env: { PATH: process.env.PATH, EVAL_MODEL: model, EVAL_SCENARIOS: scenarios, EVAL_MINUTES: minutes }, encoding: 'utf8' }).status;
  assert.equal(check('claude-haiku-5-5', 'spec-missing user-stops', '5'), 0);
  assert.equal(check('claude-haiku-5-5', '', '15'), 0);
  assert.equal(check('-x', '', '5'), 1);
  assert.equal(check('m', 'a;b', '5'), 1);
  assert.equal(check('m', 'Bad', '5'), 1);
  assert.equal(check('m', '', '0'), 1);
  assert.equal(check('m', '', '16'), 1);
});
