import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { stages, targets, isStage } from './flow.js';

// The Run record types (see skills/factory/references/run-schema.md). Other modules import them with `@import`.
// Every field is optional on the type: an older or damaged record may lack any of them, and the code reads defensively.

/** @typedef {'define' | 'build' | 'check' | 'finish' | 'follow-up'} Stage */
/** @typedef {'running' | 'waiting' | 'verification-unavailable' | 'interrupted' | 'done' | 'abandoned'} Status */
/** @typedef {'standards' | 'spec' | 'security' | 'infrastructure'} Axis */
/** @typedef {'pass' | 'fail' | 'skipped'} VerdictValue */
/** @typedef {'fast' | 'full'} Track */
/** @typedef {'claude' | 'codex' | 'copilot'} AgentName */

/**
 * The latest Verify result.
 * @typedef {object} Verify
 * @property {string} command
 * @property {string} [cwd]
 * @property {string} head
 * @property {boolean} dirty
 * @property {number | null} exit_code
 * @property {string} started
 * @property {string} ended
 * @property {string} log
 * @property {boolean} [fast]
 * @property {string} [signal]
 */

/**
 * The head and Check attempt a verdict was recorded for.
 * @typedef {object} Reviewed
 * @property {string} head
 * @property {number} attempt
 * @property {string} [carried_from]
 */

/**
 * A project review report as recorded by `run review`.
 * @typedef {object} ProjectResult
 * @property {VerdictValue} verdict
 * @property {string[]} [inspected]
 * @property {{ severity: string, description: string, location: string }[]} [findings]
 * @property {string[]} [evidence]
 * @property {Record<string, string>} [evidence_hashes]
 * @property {string} [reason]
 * @property {string} head
 * @property {string} [base_sha]
 * @property {number} attempt
 */

/**
 * A project review as frozen at Run start.
 * @typedef {object} ProjectReview
 * @property {string} id
 * @property {string} name
 * @property {'source' | 'interactive'} mode
 * @property {{ source?: string, path?: string, name?: string }} skill
 * @property {string[]} [patterns]
 * @property {{ start: string, ready: string, setup: string }} [runtime]
 * @property {Record<string, string>} files Base64 content of each captured Skill file.
 * @property {Record<string, number>} [modes]
 */

/**
 * @typedef {object} Check
 * @property {string} name
 * @property {string} state
 * @property {string | null} [conclusion]
 * @property {string | null} [url]
 * @property {string | null} [description]
 * @property {boolean} failing
 * @property {boolean} pending
 */

/**
 * The latest GitHub observation of the PR, set by `run follow-up`.
 * @typedef {object} FollowUp
 * @property {string} pr
 * @property {string} head
 * @property {string} observed
 * @property {boolean} conflicts Whether the PR has merge conflicts with its base branch.
 * @property {'conflicts' | 'checks' | 'comments'} [scope] The scope of the Rework this observation started; absent when none started.
 * @property {Check[]} checks
 * @property {Check[]} failures
 * @property {boolean} pending
 * @property {{ id: string, path: string, comments: { body: string, url: string }[] }[]} threads
 */

/**
 * A Stage visit: UTC start and end.
 * @typedef {object} Visit
 * @property {string} stage
 * @property {string} started
 * @property {string} [ended]
 * @property {number} [attempt]
 */

/**
 * A recorded Check verdict event.
 * @typedef {object} VerdictEvent
 * @property {string} axis
 * @property {string} value
 * @property {string} [head]
 * @property {string} [base_sha]
 * @property {number} [attempt]
 * @property {string} [carried_from]
 * @property {string} at
 */

/**
 * @typedef {object} ReworkCause
 * @property {number} attempt
 * @property {string[]} causes
 * @property {string} at
 */

/**
 * One row of token usage, counts only.
 * @typedef {object} UsageRow
 * @property {string} stage
 * @property {string} model
 * @property {number | null} ticket
 * @property {'rework' | 'wrap-up' | null} bucket
 * @property {number | null} input
 * @property {number | null} cache_read
 * @property {number | null} cache_write
 * @property {number | null} output
 * @property {number | null} reasoning
 * @property {number} subagent_fresh
 */

/**
 * The token usage of a Run: tracked with rows, or not tracked.
 * @typedef {object} UsageRecord
 * @property {string} [status]
 * @property {UsageRow[]} [rows]
 * @property {unknown[]} [sessions]
 * @property {string} [reason]
 * @property {string} [tokens]
 * @property {string} [cost]
 */

/**
 * Versioned observations maintained by named operations.
 * @typedef {object} Metrics
 * @property {1} version
 * @property {Visit[]} visits
 * @property {VerdictEvent[]} verdicts
 * @property {'clean' | 'unclean'} [first_check]
 * @property {ReworkCause[]} [rework_causes]
 * @property {string[]} [sessions]
 * @property {UsageRecord} [usage]
 */

/**
 * @typedef {object} Accepted
 * @property {string} head
 * @property {string} [decision]
 * @property {string} [at]
 * @property {string} [findings]
 */

/**
 * @typedef {object} ProjectConfig
 * @property {Partial<Record<Stage, string>>} [models]
 * @property {number} [max_check_loops]
 * @property {Record<string, string>} [labels]
 * @property {boolean} [usage]
 */

/**
 * The Run record: the contents of run.json.
 * @typedef {object} Run
 * @property {string} [title]
 * @property {Stage | 'prepare'} [stage] 'prepare' is only on Runs recorded before that Stage was removed.
 * @property {Status} [status]
 * @property {boolean} [waiting_on_human]
 * @property {string} [waiting_reason]
 * @property {string} [status_reason]
 * @property {string} [activity]
 * @property {AgentName} [agent]
 * @property {string} [requested_model]
 * @property {string} [requested_effort]
 * @property {string} [observed_model]
 * @property {string} [last_seen]
 * @property {number} [tickets_total]
 * @property {number} [tickets_done]
 * @property {VerdictValue} [standards]
 * @property {VerdictValue} [spec]
 * @property {VerdictValue} [security]
 * @property {VerdictValue} [infrastructure]
 * @property {ProjectReview[]} [project_reviews]
 * @property {Record<string, ProjectResult>} [project_results]
 * @property {FollowUp} [follow_up]
 * @property {Track} [track]
 * @property {number} [extra_loops]
 * @property {number} [check_loops]
 * @property {Metrics} [metrics]
 * @property {string} worktree Set by `run start`.
 * @property {string} [base_sha] Set by `run start` and `run sync`; a Run record recreated by `run repair` has none.
 * @property {Verify} [verify]
 * @property {Partial<Record<Axis, Reviewed>>} [reviewed]
 * @property {Accepted} [accepted]
 * @property {string} [fast_commands]
 * @property {string} [commands]
 * @property {string[]} [conventions]
 * @property {string} [created]
 * @property {string} [updated]
 * @property {string} [spec_link]
 * @property {string[]} [tickets]
 * @property {string} [pr]
 * @property {ProjectConfig} [project_config]
 */

/** @type {Status[]} */
export const statuses = ['running', 'waiting', 'verification-unavailable', 'interrupted', 'done', 'abandoned'];
/** @type {Status[]} */
export const paused = ['verification-unavailable', 'interrupted'];
/** @type {string[]} */
const strings = [
  'title',
  'activity',
  'waiting_reason',
  'status_reason',
  'commands',
  'fast_commands',
  'spec_link',
  'pr',
  'worktree',
  'base_sha',
  'requested_model',
  'requested_effort',
  'observed_model',
];
const lists = ['conventions', 'tickets'];
const numbers = ['tickets_total', 'tickets_done', 'check_loops', 'extra_loops'];
/** @type {Axis[]} */
export const verdicts = ['standards', 'spec', 'security', 'infrastructure'];
/** @param {unknown} value @returns {value is Axis} */
export const isAxis = (value) => verdicts.some((axis) => axis === value);
/** @type {Track[]} */
export const tracks = ['fast', 'full'];
/** @param {unknown} value @returns {value is Track} */
export const isTrack = (value) => tracks.some((track) => track === value);
// A record without a track is a Full track Run.
/** @param {Run | undefined | null} record @returns {Track} */
export const trackOf = (record) => (record?.track === 'fast' ? 'fast' : 'full');
// Standards and Security are required on both tracks; the Spec axis may be skipped only on the Fast track.
/** @param {string} axis @param {Run | undefined | null} record */
export const skippable = (axis, record) => axis === 'infrastructure' || (axis === 'spec' && trackOf(record) === 'fast');
// Only the store's own operations (start, transitions) may change these; plain update rejects them.
export const gated = ['stage', 'track', 'check_loops', 'extra_loops', ...verdicts, 'worktree', 'base_sha', 'follow_up'];
// How many times Check and Follow-up may send a Run back to Build. The factory Skill, the docs and the Dashboard chip say the same number.
export const MAX_CHECK_LOOPS = 4;
// A model belongs to the Stage worker that was asked for or reported it, so a change of Stage clears the three fields and
// asks again for the model the frozen project settings name for the new Stage.
/** @param {Run} record @returns {Run} */
export function withStageModel(record) {
  const next = { ...record };
  delete next.requested_model;
  delete next.requested_effort;
  delete next.observed_model;
  const configured = next.stage && isStage(next.stage) && next.project_config?.models?.[next.stage];
  if (typeof configured === 'string' && configured) next.requested_model = configured;
  return next;
}
/** @param {unknown} id @returns {id is string} */
export const validId = (id) => typeof id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(id);

// Why a Verify command cannot be run at all; undefined when it is usable. Doctor reports the same rule.
/** @param {unknown} commands */
export function verifyCommandProblem(commands) {
  if (typeof commands !== 'string' || !commands.trim()) return 'the Verify command is empty';
  if (commands.includes('\0')) return 'the Verify command contains a NUL byte';
}
// The fast Verify command is optional: empty or absent means the Run has none.
/** @param {unknown} commands */
export function fastCommandProblem(commands) {
  if (commands === undefined || commands === '') return undefined;
  const problem = verifyCommandProblem(commands);
  return problem && problem.replace('the Verify command', 'the fast Verify command');
}
// An empty Verify command stands for one the user has not given yet; any other unusable one is rejected.
/** @param {unknown} commands */
export function checkCommands(commands) {
  const problem = commands === '' ? undefined : verifyCommandProblem(commands);
  if (problem) throw new Error(problem);
}
/** @param {unknown} data Fields to set on a Run record; throws on an unknown field or an invalid value. */
export function validate(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('data must be an object');
  for (const [key, value] of Object.entries(data)) {
    const ok = strings.includes(key)
      ? typeof value === 'string'
      : lists.includes(key)
        ? Array.isArray(value) && value.every((v) => typeof v === 'string')
        : numbers.includes(key)
          ? Number.isSafeInteger(value) && value >= 0
          : /** @type {string[]} */ (verdicts).includes(key)
            ? ['pass', 'fail', ...(['spec', 'infrastructure'].includes(key) ? ['skipped'] : [])].includes(value)
            : key === 'follow_up'
              ? value !== null && typeof value === 'object' && !Array.isArray(value)
              : key === 'stage'
                ? stages.includes(value)
                : key === 'track'
                  ? tracks.includes(value)
                  : key === 'status'
                    ? statuses.includes(value)
                    : key === 'agent'
                      ? typeof value === 'string' && Object.hasOwn(targets, value)
                      : key === 'waiting_on_human'
                        ? typeof value === 'boolean'
                        : false;
    if (!ok) throw new Error(`invalid field or value: ${key}`);
  }
}
/**
 * @param {string} dir
 * @param {Run} record
 */
export function write(dir, record) {
  const temp = path.join(dir, `.run-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
    fs.renameSync(temp, path.join(dir, 'run.json'));
  } finally {
    fs.rmSync(temp, { force: true });
  }
}
/**
 * @param {Run} old
 * @param {Partial<Run>} data
 * @returns {Run}
 */
export function apply(old, data) {
  validate(data);
  const result = { ...old, ...data };
  if (result.status === 'waiting' && ('status' in data || 'waiting_on_human' in data || 'waiting_reason' in data)) {
    if (data.waiting_on_human === false || !result.waiting_reason) throw new Error('waiting requires a reason');
    result.waiting_on_human = true;
  } else if (data.status !== undefined) {
    if (data.waiting_on_human === true || (data.waiting_reason && data.waiting_reason !== ''))
      throw new Error('only waiting Runs can have a waiting reason');
    result.waiting_on_human = false;
    result.waiting_reason = '';
  } else if ('waiting_on_human' in data || 'waiting_reason' in data) {
    if (
      result.waiting_on_human !== (result.status === 'waiting') ||
      (result.status !== 'waiting' && result.waiting_reason)
    )
      throw new Error('inconsistent waiting fields');
  }
  if (result.status && paused.includes(result.status)) {
    if (!result.status_reason?.trim()) throw new Error(`${result.status} requires a status reason`);
  } else if (data.status !== undefined) {
    if (data.status_reason) throw new Error('only paused Runs can have a status reason');
    result.status_reason = '';
  } else if (data.status_reason) throw new Error('only paused Runs can have a status reason');
  result.updated = new Date().toISOString();
  return result;
}

// The Check attempt a Run is in: its first Check is attempt 1, each Rework starts the next.
/** @param {Run} record */
export const loops = (record) => record.check_loops ?? 0;
// The loops the user granted beyond the cap (ADR 0024); absent or unreadable means none.
/** @param {Run | undefined | null} record */
export const extraLoops = (record) =>
  record?.extra_loops !== undefined && Number.isSafeInteger(record.extra_loops) && record.extra_loops > 0
    ? record.extra_loops
    : 0;
// A Run freezes the project's cap at start; it is never above the Factory maximum. Older Runs have the maximum.
// The loops the user granted are added to it.
/** @param {Run | undefined | null} record */
export const loopCap = (record) =>
  Math.min(record?.project_config?.max_check_loops ?? MAX_CHECK_LOOPS, MAX_CHECK_LOOPS) + extraLoops(record);
/** @param {Run} record */
export const attempt = (record) => loops(record) + 1;
