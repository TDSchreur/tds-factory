import { readProjectJson, loadProjectReviews } from './project-reviews.js';
import { stages } from './flow.js';
import { MAX_CHECK_LOOPS } from './run-record.js';
import os from 'node:os';

// Stage agents the coordinator can dispatch to; the interactive reviewer is not a Stage.
export const modelKeys = [...stages, 'interactive-check'];
export const labelKeys = ['ticket'];
export const defaultLabels = { ticket: 'ready-for-agent' };
const topKeys = ['models', 'max_check_loops', 'labels', 'reviews'];
const plain = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const modelName = (v) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:\/@-]{0,99}$/.test(v);
const labelName = (v) => typeof v === 'string' && !!v.trim() && v.length <= 50 && /^[\w .:\/-]+$/.test(v) && !!v.trim();

// The line of the last key in `keys`, searched in order so a repeated name resolves to the right object.
function lineOf(source, keys) {
  const lines = source.split('\n');
  let from = 0, found = 1;
  for (const key of keys) {
    const at = lines.findIndex((l, i) => i >= from && l.includes(JSON.stringify(key)));
    if (at < 0) break;
    found = at + 1; from = at;
  }
  return found;
}
const problem = (source, keys, message) => ({ line: lineOf(source, keys), message });

// Validates the shape of .factory/config.json. Returns problems, each with the line to fix.
export function configProblems(source, data) {
  const out = [];
  const add = (keys, message) => out.push(problem(source, keys, message));
  if (!plain(data)) return [{ line: 1, message: 'config.json must contain a JSON object' }];
  for (const key of Object.keys(data)) if (!topKeys.includes(key)) add([key], `unknown setting "${key}" (use ${topKeys.join(', ')})`);
  if ('models' in data) {
    if (!plain(data.models)) add(['models'], '"models" must be an object of Stage name to model');
    else for (const [key, value] of Object.entries(data.models)) {
      if (!modelKeys.includes(key)) add(['models', key], `unknown Stage "${key}" in "models" (use ${modelKeys.join(', ')})`);
      else if (!modelName(value)) add(['models', key], `the model for "${key}" must be a model name such as "claude-sonnet-5.5"`);
    }
  }
  if ('max_check_loops' in data) {
    const v = data.max_check_loops;
    if (!Number.isSafeInteger(v) || v < 0 || v > MAX_CHECK_LOOPS) add(['max_check_loops'], `"max_check_loops" must be a whole number from 0 to ${MAX_CHECK_LOOPS}, the Factory maximum`);
  }
  if ('labels' in data) {
    if (!plain(data.labels)) add(['labels'], '"labels" must be an object');
    else for (const [key, value] of Object.entries(data.labels)) {
      if (!labelKeys.includes(key)) add(['labels', key], `unknown label "${key}" (use ${labelKeys.join(', ')})`);
      else if (!labelName(value)) add(['labels', key], `the "${key}" label must be 1 to 50 letters, digits, spaces or . : _ / -`);
    }
  }
  if ('reviews' in data && !Array.isArray(data.reviews)) add(['reviews'], '"reviews" must be an array');
  return out;
}

// Reads the project configuration from `projectDir`. Absent file: defaults. A bad file throws one message per problem with its line.
export function loadProjectConfig(projectDir, agent, homeDir = os.homedir()) {
  const file = readProjectJson(projectDir, 'config.json');
  const config = { models: {}, max_check_loops: MAX_CHECK_LOOPS, labels: { ...defaultLabels } };
  if (file) {
    const problems = configProblems(file.source, file.data);
    if (problems.length) throw new Error(problems.map((p) => `.factory/config.json line ${p.line}: ${p.message}`).join('; '));
    Object.assign(config.models, file.data.models);
    if (file.data.max_check_loops !== undefined) config.max_check_loops = file.data.max_check_loops;
    Object.assign(config.labels, file.data.labels);
  }
  let reviews;
  try { reviews = loadProjectReviews(projectDir, agent, homeDir); }
  catch (err) {
    const id = /^([a-z][a-z0-9-]*): /.exec(err.message)?.[1] ?? /review ID: (\S+)$/.exec(err.message)?.[1];
    const line = file && id ? lineOf(file.source, ['reviews', id]) : undefined;
    throw new Error(line ? `.factory/config.json line ${line}: ${err.message}` : err.message);
  }
  return { ...config, reviews };
}

// What a Run freezes: everything but the reviews, which the Run stores with their Skill content.
export const frozenSettings = ({ models, max_check_loops, labels }) => ({ models, max_check_loops, labels });
