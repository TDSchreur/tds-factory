import { test } from 'node:test';
import assert from 'node:assert/strict';
import { printable } from '../src/printable.js';

test('plain text is unchanged', () => {
  assert.equal(printable('docs/specs/x.md#12'), 'docs/specs/x.md#12');
});

test('a control character becomes a space', () => {
  assert.equal(printable('a\u0007b\u009fc'), 'a b c');
});

test('a newline and a carriage return become spaces, so a link is one line', () => {
  assert.equal(printable('t2\nwarning: forged\r\nx'), 't2 warning: forged  x');
});

test('bidi, zero-width and line or paragraph separators become spaces', () => {
  assert.equal(printable('a\u202eb\u2066c\u2069d\u200be\u2028f\u2029g'), 'a b c d e f g');
});

test('a ZWJ inside an emoji becomes a space', () => {
  assert.equal(printable('\u{1F468}\u200d\u{1F469}'), '\u{1F468} \u{1F469}');
});

test('many control characters are all replaced and keep their count', () => {
  const input = '\u0000'.repeat(1_000_000);
  const out = printable(input);
  assert.equal(out.length, input.length);
  assert.equal(out, ' '.repeat(input.length));
});

test('a very long input is returned whole and without a control character', () => {
  const input = `${'a\n'.repeat(500_000)}end`;
  const out = printable(input);
  assert.equal(out.length, input.length);
  assert.doesNotMatch(out, /[\n\u0000-\u001f]/);
});

test('an astral character is not split', () => {
  assert.equal(printable('\u{1F600}x'), '\u{1F600}x');
});
