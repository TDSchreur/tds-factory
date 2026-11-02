import assert from 'node:assert/strict';
/** @import { RunView } from '../dashboard/model.js' */
/** @import { ReadableEntry } from '../src/run-folder.js' */

/**
 * A complete RunView: the required fields hold neutral values and the optional fields stay absent,
 * so a test names only the fields it is about.
 * @param {Partial<RunView>} [fields]
 * @returns {RunView}
 */
export const runView = (fields = {}) => ({
  id: 'r',
  unreadable: false,
  title: 'r',
  activity: '',
  agent: '',
  waiting: false,
  reason: '',
  column: 'build',
  updated: '',
  files: [],
  links: [],
  status: '',
  pr: '',
  model: { requested: '', effort: '', observed: '' },
  lastSeen: '',
  events: [],
  eventsDamaged: 0,
  ...fields,
});

/**
 * A Run store entry whose record has been through JSON, the way listRuns reads it from disk, so a test can hand
 * interpretRun a record of any shape.
 * @param {string} id
 * @param {unknown} [record]
 * @param {string[]} [files]
 * @returns {ReadableEntry}
 */
export const entryOf = (id, record = {}, files = []) => ({
  id,
  unreadable: false,
  record: JSON.parse(JSON.stringify(record)),
  files,
  events: { events: [], damaged: 0 },
});

/**
 * A view as the page receives it over the wire: whatever fields a test names, with no defaults and any value,
 * to prove a model function copes with a view that is incomplete or has the wrong types.
 * @param {unknown} fields
 * @returns {RunView}
 */
export const strayView = (fields) => JSON.parse(JSON.stringify(fields));

/**
 * The views a running Dashboard serves.
 * @param {{ url: string }} dash
 * @returns {Promise<RunView[]>}
 */
export async function viewsOf(dash) {
  const body = await (await fetch(`${dash.url}/api/views`)).json();
  assert.ok(Array.isArray(body), '/api/views answers with a list');
  return body;
}
