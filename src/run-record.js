import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { stages, targets } from './flow.js';

export const statuses = ['running', 'waiting', 'verification-unavailable', 'interrupted', 'done', 'abandoned'];
export const paused = ['verification-unavailable', 'interrupted'];
const strings = ['title', 'activity', 'waiting_reason', 'status_reason', 'commands', 'spec_link', 'pr', 'worktree', 'base_sha'];
const lists = ['conventions', 'tickets'];
const numbers = ['tickets_total', 'tickets_done', 'check_loops'];
export const verdicts = ['standards', 'spec', 'security', 'infrastructure'];
// Only the store's own operations (start, transitions) may change these; plain update rejects them.
export const gated = ['stage', 'check_loops', ...verdicts, 'worktree', 'base_sha'];
// How many times Check may send a Run back to Build. The factory Skill, the docs and the Dashboard chip say the same number.
export const MAX_CHECK_LOOPS = 4;
export const validId = (id) => typeof id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(id);

// Why a Verify command cannot be run at all; undefined when it is usable. Doctor reports the same rule.
export function verifyCommandProblem(commands) {
  if (typeof commands !== 'string' || !commands.trim()) return 'the Verify command is empty';
  if (commands.includes('\0')) return 'the Verify command contains a NUL byte';
}
// An empty Verify command stands for one the user has not given yet; any other unusable one is rejected.
export function checkCommands(commands) {
  const problem = commands === '' ? undefined : verifyCommandProblem(commands);
  if (problem) throw new Error(problem);
}
export function validate(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('data must be an object');
  for (const [key, value] of Object.entries(data)) {
    let ok = strings.includes(key) ? typeof value === 'string'
      : lists.includes(key) ? Array.isArray(value) && value.every((v) => typeof v === 'string')
      : numbers.includes(key) ? Number.isSafeInteger(value) && value >= 0 && (key !== 'check_loops' || value <= MAX_CHECK_LOOPS)
      : verdicts.includes(key) ? ['pass', 'fail', ...(key === 'infrastructure' ? ['skipped'] : [])].includes(value)
      : key === 'stage' ? stages.includes(value)
      : key === 'status' ? statuses.includes(value)
      : key === 'agent' ? typeof value === 'string' && Object.hasOwn(targets, value)
      : key === 'waiting_on_human' ? typeof value === 'boolean' : false;
    if (!ok) throw new Error(`invalid field or value: ${key}`);
  }
}
export function write(dir, record) {
  const temp = path.join(dir, `.run-${randomUUID()}.tmp`);
  try { fs.writeFileSync(temp, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' }); fs.renameSync(temp, path.join(dir, 'run.json')); }
  finally { fs.rmSync(temp, { force: true }); }
}
export function apply(old, data) {
  validate(data);
  const result = { ...old, ...data };
  if (result.status === 'waiting' && ('status' in data || 'waiting_on_human' in data || 'waiting_reason' in data)) {
    if (data.waiting_on_human === false || !result.waiting_reason) throw new Error('waiting requires a reason');
    result.waiting_on_human = true;
  } else if (data.status !== undefined) {
    if (data.waiting_on_human === true || (data.waiting_reason && data.waiting_reason !== '')) throw new Error('only waiting Runs can have a waiting reason');
    result.waiting_on_human = false; result.waiting_reason = '';
  } else if ('waiting_on_human' in data || 'waiting_reason' in data) {
    if (result.waiting_on_human !== (result.status === 'waiting') || (result.status !== 'waiting' && result.waiting_reason)) throw new Error('inconsistent waiting fields');
  }
  if (paused.includes(result.status)) {
    if (!result.status_reason?.trim()) throw new Error(`${result.status} requires a status reason`);
  } else if (data.status !== undefined) {
    if (data.status_reason) throw new Error('only paused Runs can have a status reason');
    result.status_reason = '';
  } else if (data.status_reason) throw new Error('only paused Runs can have a status reason');
  result.updated = new Date().toISOString();
  return result;
}

// The Check attempt a Run is in: its first Check is attempt 1, each Rework starts the next.
export const loops = (record) => record.check_loops ?? 0;
export const attempt = (record) => loops(record) + 1;
