import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIZE_WAIT_REASON, SPLIT_DONE_REASON, canAnswerSize } from '../dashboard/model.js';
import { SIZE_WAIT_REASON as NODE_SIZE_WAIT_REASON } from '../src/run-size.js';
import { SPLIT_DONE_REASON as NODE_SPLIT_DONE_REASON } from '../src/run-lifecycle.js';

/** @import { RunView } from '../dashboard/model.js' */
/** @param {Partial<RunView>} over @returns {RunView} */
const view = (over) =>
  /** @type {RunView} */ ({ id: 'r', title: 't', column: 'build', waiting: true, reason: SIZE_WAIT_REASON, ...over });

test('the page constants equal the Node ones', () => {
  assert.equal(SIZE_WAIT_REASON, NODE_SIZE_WAIT_REASON);
  assert.equal(SPLIT_DONE_REASON, NODE_SPLIT_DONE_REASON);
});

test('the size answer is offered only to a readable, waiting Run in Build with the size reason', () => {
  assert.equal(canAnswerSize(view({})), true);
  assert.equal(canAnswerSize(view({ reason: 'something else' })), false);
  assert.equal(canAnswerSize(view({ column: 'check' })), false);
  assert.equal(canAnswerSize(view({ waiting: false })), false);
  assert.equal(canAnswerSize(view({ unreadable: true })), false);
});
