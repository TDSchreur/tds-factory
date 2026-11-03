import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { avoidTerms } from '../scripts/doc-checks.js';
import { COLUMNS } from '../dashboard/model.js';
import { HELP_SECTIONS, helpText } from '../dashboard/help.js';

const text = helpText();

test('the help text names every Stage, both tracks, the Check verdicts and the actions', () => {
  for (const column of COLUMNS) assert.match(text, new RegExp(column.label, 'i'), column.label);
  for (const word of [
    'Fast track',
    'Full track',
    'Needs you',
    'pass',
    'fail',
    'skipped',
    'Left open',
    'Sync',
    'Clean up',
    'Accept Check',
    'Grant extra loop',
    'Split and Continue',
  ])
    assert.ok(text.includes(word), word);
});

test('the help sections are short and each has a title and items of plain text', () => {
  assert.ok(HELP_SECTIONS.length >= 5 && HELP_SECTIONS.length <= 8);
  for (const section of HELP_SECTIONS) {
    assert.ok(section.id && section.title, section.title);
    assert.ok(section.items.length >= 1 && section.items.length <= 7, section.title);
    for (const item of section.items) assert.equal(typeof item.text, 'string');
  }
  assert.ok(text.length < 3500, `the help text stays short (${text.length} characters)`);
});

test('the help text uses no Avoid term of the glossary and asks for no external resource', () => {
  for (const term of avoidTerms(readFileSync(new URL('../GLOSSARY.md', import.meta.url), 'utf8'))) {
    assert.doesNotMatch(text, new RegExp(`\\b${term}\\b`, 'i'), term);
  }
  assert.doesNotMatch(text, /https?:\/\//);
});

test('the help has no Merge entry, because the Dashboard never merges', () => {
  const section = HELP_SECTIONS.find((s) => s.id === 'actions');
  assert.ok(section, 'the help has an actions section');
  assert.equal(
    section.items.some((item) => /merge$/i.test(String(item.term))),
    false,
  );
  assert.doesNotMatch(String(text), /Squash and merge/i);
});

test('each action says when its button appears', () => {
  const section = HELP_SECTIONS.find((s) => s.id === 'actions');
  assert.ok(section, 'the help has an actions section');
  const actions = section.items;
  /** @type {Record<string, RegExp>} */
  const when = {
    Sync: /Build or Check/,
    'Clean up': /merged/,
    'Accept Check': /waits in Check/,
    'Grant extra loop': /limit/,
    'Split and Continue': /waits in Build/,
    'Check PR': /open pull request/,
    Fix: /Run detail/,
  };
  assert.deepEqual(
    actions.map((item) => item.term),
    Object.keys(when),
  );
  for (const item of actions) assert.match(item.text, /Shown /, item.term ?? '');
  for (const item of actions)
    assert.ok(item.term !== undefined && item.term in when, 'an action item has a known term');
  for (const item of actions) assert.match(item.text, when[item.term ?? ''], item.term ?? '');
});
