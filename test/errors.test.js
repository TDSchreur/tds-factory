import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FactoryError } from '../src/errors.js';
import { codeOf } from '../src/narrow.js';

test('a FactoryError is an Error with a code and keeps the message and name unchanged', () => {
  const err = new FactoryError('cannot do it', { code: 'some-code' });
  assert.ok(err instanceof Error);
  assert.equal(err.message, 'cannot do it');
  assert.equal(err.name, 'Error');
  assert.equal(err.code, 'some-code');
  assert.equal(codeOf(err), 'some-code');
  assert.equal('cause' in err, false);
});

test('a FactoryError keeps the error that caused it', () => {
  const cause = new SyntaxError('bad json');
  assert.equal(new FactoryError('x', { code: 'error', cause }).cause, cause);
});
