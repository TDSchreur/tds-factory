import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { messageOf, codeOf, oneOf, execFailure } from '../src/narrow.js';

test('messageOf reads the message of an Error and the text of anything else that was thrown', () => {
  assert.equal(messageOf(new Error('boom')), 'boom');
  assert.equal(messageOf('plain'), 'plain');
  assert.equal(messageOf(undefined), 'undefined');
  assert.equal(messageOf({ message: 'not an Error' }), 'not an Error');
  assert.equal(messageOf({ message: 5 }), '[object Object]');
});

test('codeOf reads a string code and ignores everything else', () => {
  assert.equal(codeOf(Object.assign(new Error('x'), { code: 'ENOENT' })), 'ENOENT');
  assert.equal(codeOf(new Error('x')), undefined);
  assert.equal(codeOf({ code: 2 }), undefined);
  assert.equal(codeOf(null), undefined);
  assert.equal(codeOf('ENOENT'), undefined);
});

test('oneOf accepts an absent value', () => {
  assert.equal(oneOf(['a', 'b'], 'a'), true);
  assert.equal(oneOf(['a', 'b'], undefined), false);
  assert.equal(oneOf([], 'a'), false);
});

test('execFailure reads the status and the standard error of a failed command', () => {
  let caught;
  try {
    execFileSync(process.execPath, ['-e', 'process.stderr.write("bad"); process.exit(3)'], { stdio: 'pipe' });
  } catch (err) {
    caught = err;
  }
  assert.deepEqual(execFailure(caught), { status: 3, stderr: 'bad' });
  assert.deepEqual(execFailure(undefined), { status: undefined, stderr: '' });
  assert.deepEqual(execFailure(new Error('x')), { status: undefined, stderr: '' });
});
