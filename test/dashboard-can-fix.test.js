import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canFix } from '../dashboard/model.js';

/** @import { RunView } from '../dashboard/model.js' */
/** @param {Partial<RunView>} over @returns {RunView} */
const view = (over) => /** @type {RunView} */ ({ id: 'r', title: 't', prHost: 'github', ...over });

test('Fix is offered for a pull request of every host the Dashboard knows', () => {
  assert.equal(canFix(view({ prHost: 'github' })), true);
  assert.equal(canFix(view({ prHost: 'azure-devops' })), true);
});

test('Fix is not offered without a host, for an unreadable or an abandoned Run', () => {
  assert.equal(canFix(view({ prHost: '' })), false);
  assert.equal(canFix(view({ prHost: undefined })), false);
  assert.equal(canFix(view({ prHost: 'azure-devops', unreadable: true })), false);
  assert.equal(canFix(view({ prHost: 'azure-devops', status: 'abandoned' })), false);
});
