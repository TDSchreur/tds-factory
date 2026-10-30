import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { adrProblems, avoidTerms, bareAvoidTerms, brokenLinks, staleConstants } from '../scripts/doc-checks.js';

const repo = (files) => {
  const dir = mkdtempSync(join(tmpdir(), 'doc-checks-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
};

test('brokenLinks reports a relative link whose target is missing and passes a good one', () => {
  const dir = repo({ 'README.md': '[ok](docs/a.md) [gone](docs/b.md#x) [web](https://example.com/x) [anchor](#top)', 'docs/a.md': '[up](../README.md)' });
  assert.deepEqual(brokenLinks(dir), ['README.md links to missing docs/b.md']);
});

test('brokenLinks resolves a link from the folder of the file that holds it and reads no code', () => {
  const dir = repo({ 'docs/adr/0001-a.md': '[spec](../specs/x.md) `[inline](nope.md)`\n```\n[fenced](nope.md)\n```', 'docs/specs/x.md': '' });
  assert.deepEqual(brokenLinks(dir), []);
  writeFileSync(join(dir, 'docs', 'adr', '0002-b.md'), '[spec](../specs/y.md)');
  assert.deepEqual(brokenLinks(dir), ['docs/adr/0002-b.md links to missing ../specs/y.md']);
});

test('brokenLinks skips archived Specs and the vendored Skills but reads the Factory Skill and the agent files', () => {
  const dir = repo({ 'docs/specs/archive/old.md': '[gone](nope.md)', 'skills/other/GLOSSARY-FORMAT.md': '[gone](nope.md)', 'skills/factory/SKILL.md': '[gone](nope.md)', 'agents/claude/factory-build.md': '[gone](nope.md)' });
  assert.deepEqual(brokenLinks(dir), ['skills/factory/SKILL.md links to missing nope.md', 'agents/claude/factory-build.md links to missing nope.md']);
});

test('adrProblems reports a reused number and a badly named file and passes a clean folder', () => {
  const dir = repo({ 'docs/adr/0001-a.md': '', 'docs/adr/0002-b.md': '' });
  assert.deepEqual(adrProblems(dir), []);
  writeFileSync(join(dir, 'docs', 'adr', '0002-c.md'), '');
  writeFileSync(join(dir, 'docs', 'adr', 'notes.md'), '');
  assert.deepEqual(adrProblems(dir), ['docs/adr/0002-c.md reuses number 0002 of 0002-b.md', 'docs/adr/notes.md is not named NNNN-slug.md']);
});

test('this repository has no broken relative link and its ADR numbers are unique', () => {
  assert.deepEqual(brokenLinks(resolve('.')), []);
  assert.deepEqual(adrProblems(resolve('.')), []);
});

const GLOSSARY = '**A**:\nx\n_Avoid_: Pipeline, step, Sync (alone), which is the maintainer command `x`, Ticket (a Ticket is a unit, not a click), Modal, Loop back\n';

test('avoidTerms keeps plain terms and drops qualified terms, explanations and ordinary words', () => {
  assert.deepEqual(avoidTerms(GLOSSARY), ['Pipeline', 'Loop back']);
});

test('bareAvoidTerms reports an Avoid term in the docs and reads no code, glossary, ADR or archived Spec', () => {
  const dir = repo({ 'GLOSSARY.md': GLOSSARY, 'README.md': 'Our Pipeline runs. `Pipeline` and a Loop back.\n```\nPipeline\n```', 'docs/usage.md': 'A pipeline is fine.', 'docs/adr/0001-a.md': 'Pipeline', 'docs/specs/archive/x.md': 'Pipeline', 'CHANGELOG.md': 'Pipeline' });
  assert.deepEqual(bareAvoidTerms(dir), ['README.md: "Pipeline" is a glossary Avoid term (Our Pipeline runs.  and a Loop back.)', 'README.md: "Loop back" is a glossary Avoid term (Our Pipeline runs.  and a Loop back.)']);
});

const LIMIT = [{ name: 'Check loop limit', value: 4, patterns: [/at most (\w+) times/g, /`0` to `(\w+)`/g], files: ['README.md', 'docs/usage.md'] }];

test('staleConstants reports a statement that differs from the code, in digits or in words, and a file that no longer states it', () => {
  const dir = repo({ 'README.md': 'Back at most four times, `0` to `4`.', 'docs/usage.md': 'Back at most 2 times.' });
  assert.deepEqual(staleConstants(dir, LIMIT), ['docs/usage.md says the Check loop limit is 2, the code says 4']);
  writeFileSync(join(dir, 'README.md'), 'No limit here.');
  assert.deepEqual(staleConstants(dir, LIMIT), ['README.md no longer states the Check loop limit; update the patterns in scripts/doc-checks.js', 'docs/usage.md says the Check loop limit is 2, the code says 4']);
});

test('this repository uses no bare Avoid term and states the Check loop limit as the code does', () => {
  assert.deepEqual(bareAvoidTerms(resolve('.')), []);
  assert.deepEqual(staleConstants(resolve('.')), []);
});
