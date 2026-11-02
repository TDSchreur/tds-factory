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
 * @param {ReadableEntry['events']} [events]
 * @returns {ReadableEntry}
 */
export const entryOf = (id, record = {}, files = [], events = { events: [], damaged: 0 }) => ({
  id,
  unreadable: false,
  record: JSON.parse(JSON.stringify(record)),
  files,
  events,
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

/**
 * A value as it comes back from a file or the wire: a test uses it for an argument of the wrong shape, which
 * the types forbid and the code under test has to survive because run.json is user-editable.
 * @param {unknown} value
 */
export const fromJson = (value) => JSON.parse(JSON.stringify(value));

/**
 * The value of an optional field a test has just made the code set, or a failed assertion.
 * @template T
 * @param {T} value
 * @param {string} what
 * @returns {NonNullable<T>}
 */
export function defined(value, what) {
  assert.ok(value !== undefined && value !== null, what);
  return value;
}

/**
 * @template M
 * @param {{ metrics?: M }} record
 * @returns {M}
 */
export const metricsOf = (record) => defined(record.metrics, 'the record has metrics');

/**
 * @template U
 * @param {{ metrics?: { usage?: U } }} record
 * @returns {U}
 */
export const usageOf = (record) => defined(metricsOf(record).usage, 'the record has usage');
