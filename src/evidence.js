import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { reviewPlan } from './project-reviews.js';
import { verdicts, apply, validate, loops, attempt, verifyCommandProblem } from './run-record.js';
import { readRun, changeRun, changeRunning } from './run-folder.js';
import { worktreeState } from './worktrees.js';
import { recordVerdict } from './run-metrics.js';

// Why a Run in Check may not go to Finish: empty when its Check is clean for the current head, or Accepted for it.
export function finishProblems(record, { head, dirty } = worktreeState(record)) {
  if (dirty) return ['the Run worktree has uncommitted changes'];
  if (record.accepted?.head === head) return [];
  const problems = [];
  for (const axis of verdicts) {
    const seen = record.reviewed?.[axis];
    if (record[axis] === undefined) problems.push(`${axis} has no verdict`);
    else if (seen?.head !== head || seen?.attempt !== attempt(record)) problems.push(`${axis} was not reviewed at the current head in this Check attempt`);
    else if (record[axis] === 'fail') problems.push(`${axis} failed`);
  }
  for (const review of record.project_reviews ?? []) {
    const result = record.project_results?.[review.id];
    if (!result) problems.push(`${review.id} has no verdict`);
    else if (result.head !== head || result.base_sha !== record.base_sha || result.attempt !== attempt(record)) problems.push(`${review.id} was not reviewed at the current head and base in this Check attempt`);
    else if (result.verdict === 'fail') problems.push(`${review.id} failed`);
    else if (!['pass', 'skipped'].includes(result.verdict)) problems.push(`${review.id} has an invalid verdict`);
    else if (review.mode === 'interactive' && result.verdict === 'pass') {
      try {
        if (!result.evidence?.length || result.evidence.some(item => evidenceHash(record, item) !== result.evidence_hashes?.[item])) throw new Error('missing or changed');
      } catch { problems.push(`${review.id} browser evidence is missing or changed`); }
    }
  }
  const verify = record.verify;
  if (!verify) problems.push('there is no Verify result');
  else if (verify.head !== head || verify.dirty) problems.push('the Verify result is not for the current committed head');
  else if (verify.command !== record.commands) problems.push('the Verify result came from a different command than the Run\'s Verify command');
  else if (verify.exit_code !== 0) problems.push(`the Verify command failed (exit ${verify.exit_code})`);
  return problems;
}

// Runs the Verify command outside the Run lock, since it can take minutes, and records the result under it.
export function verifyRun(projectDir, id) {
  const { dir, record } = readRun(projectDir, id);
  if (record.status !== 'running') throw new Error(`a ${record.status} Run cannot be verified, only a running one`);
  const commandProblem = verifyCommandProblem(record.commands);
  if (commandProblem) throw new Error(`the Run has no usable Verify command: ${commandProblem}`);
  let state;
  try { state = worktreeState(record); } catch (err) {
    changeRun(projectDir, id, (old) => {
      if (old.status !== 'running' || old.commands !== record.commands || loops(old) !== loops(record)) throw new Error('the Run changed while verification was prepared');
      const next = apply(old, { status: 'verification-unavailable', status_reason: err.message });
      delete next.verify;
      return next;
    });
    throw err;
  }
  const { head, dirty } = state;
  const started = new Date().toISOString();
  // Replace rather than reuse the log, so a planted link is never written through.
  const log = path.join(dir, 'verify.log');
  fs.rmSync(log, { force: true });
  const fd = fs.openSync(log, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  let ran;
  try { ran = spawnSync(record.commands, { cwd: record.worktree, shell: true, stdio: ['ignore', fd, fd] }); }
  finally { fs.closeSync(fd); }
  const output = fs.readFileSync(log, 'utf8');
  const unavailable = ran.error || ([126, 127].includes(ran.status) && /(?:not found|not recognized|permission denied|cannot execute)/i.test(output));
  const pause = ran.signal ? { status: 'interrupted', status_reason: `Verify interrupted by ${ran.signal}` }
    : unavailable ? { status: 'verification-unavailable', status_reason: `Verify unavailable: ${ran.error?.message ?? output.trim()}` } : null;
  const result = { command: record.commands, cwd: record.worktree, head, dirty, exit_code: ran.status, started, ended: new Date().toISOString(), log: 'verify.log', ...(ran.signal ? { signal: ran.signal } : {}) };
  changeRun(projectDir, id, (old) => {
    if (old.status !== 'running' || old.commands !== record.commands || loops(old) !== loops(record)) throw new Error('the Run changed while the Verify command ran, so its result was not recorded');
    return { ...old, verify: result, ...(pause ? { ...pause, waiting_on_human: false, waiting_reason: '' } : {}), updated: new Date().toISOString() };
  });
  return result;
}
export function verdictRun(projectDir, id, axis, value) {
  if (!verdicts.includes(axis)) throw new Error(`unknown Check axis: ${axis}`);
  validate({ [axis]: value });
  changeRunning(projectDir, id, {}, (old) => {
    if (old.stage !== 'check') throw new Error('verdicts are recorded in Check');
    const { head, dirty } = worktreeState(old);
    if (value !== 'fail' && dirty) throw new Error(`cannot record ${value} for ${axis}: the Run worktree has uncommitted changes`);
    return { record: recordVerdict({ ...old, [axis]: value, reviewed: { ...old.reviewed, [axis]: { head, attempt: attempt(old) } } }, { axis, value, head, attempt: attempt(old) }), activity: `${axis} verdict: ${value}` };
  });
}

// Resolve artifacts only within the Run folder, refusing links and changed evidence.
function evidenceHash(record, item) {
  if (typeof item !== 'string' || path.isAbsolute(item) || item.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) throw new Error(`invalid evidence path: ${item}`);
  const folder = path.join(path.dirname(path.dirname(record.worktree)), 'runs', path.basename(record.worktree));
  if (fs.realpathSync(folder) !== folder) throw new Error('Run folder must not be a symlink');
  let current = folder;
  for (const part of item.split('/')) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`evidence path contains a symlink: ${item}`);
  }
  if (!fs.statSync(current).isFile()) throw new Error(`evidence is not a regular file: ${item}`);
  return createHash('sha256').update(fs.readFileSync(current)).digest('hex');
}

// Record a structured project review at the current head and attempt. Browser artifacts live
// under the Run folder so screenshots do not dirty the implementation worktree.
export function projectReviewRun(projectDir, id, axis, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('review needs a report object');
  if (Object.keys(data).some(k => !['verdict', 'inspected', 'findings', 'evidence'].includes(k))) throw new Error('unknown review report field');
  if (!['pass', 'fail', 'skipped'].includes(data.verdict)) throw new Error('review verdict must be pass, fail or skipped');
  const isText = value => typeof value === 'string' && !!value.trim() && !/[\x00-\x1f\x7f]/.test(value);
  if (data.verdict !== 'skipped') {
    if (!Array.isArray(data.inspected) || !data.inspected.length || !data.inspected.every(isText)) throw new Error('review needs inspected files or screens');
    if (!Array.isArray(data.findings) || data.findings.some(f => !f || typeof f !== 'object' || Array.isArray(f) || Object.keys(f).some(k => !['severity', 'description', 'location'].includes(k)) || !['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].includes(f.severity) || !isText(f.description) || !isText(f.location))) throw new Error('each finding needs severity, description and location');
    if (data.verdict === 'pass' && data.findings.some(f => ['CRITICAL', 'HIGH', 'MEDIUM'].includes(f.severity))) throw new Error('a review with medium-or-higher findings cannot pass');
    if (data.evidence !== undefined && (!Array.isArray(data.evidence) || !data.evidence.every(isText))) throw new Error('evidence must be an array of Run-relative artifact paths');
  } else if (Object.keys(data).length !== 1) throw new Error('a skipped review takes only its verdict');
  changeRunning(projectDir, id, {}, old => {
    if (old.stage !== 'check') throw new Error('project reviews are recorded in Check');
    const review = (old.project_reviews ?? []).find(r => r.id === axis);
    if (!review) throw new Error(`unknown project review: ${axis}`);
    const { head, dirty } = worktreeState(old);
    if (data.verdict !== 'fail' && dirty) throw new Error('cannot record a passing or skipped review with uncommitted changes');
    const plan = reviewPlan(old).find(r => r.id === axis);
    if (data.verdict === 'skipped' && plan.applicable) throw new Error(`${axis} is applicable and cannot be skipped`);
    if (data.verdict !== 'skipped' && !plan.applicable) throw new Error(`${axis} is not applicable; record skipped`);
    if (review.mode === 'interactive' && data.verdict === 'pass' && !data.evidence?.length) throw new Error(`${axis} needs browser evidence to pass`);
    const evidenceHashes = Object.fromEntries((data.evidence ?? []).map(item => [item, evidenceHash(old, item)]));
    const result = { ...data, ...(data.evidence?.length ? { evidence_hashes: evidenceHashes } : {}), ...(data.verdict === 'skipped' ? { reason: plan.reason } : {}), head, base_sha: old.base_sha, attempt: attempt(old) };
    return { record: recordVerdict({ ...old, project_results: { ...old.project_results, [axis]: result } }, { axis, value: data.verdict, head, base_sha: old.base_sha, attempt: attempt(old) }), activity: `${axis} verdict: ${data.verdict}` };
  });
}

// Materialize only captured files into a new private folder; never execute the live Skill.
export function materializeReview(projectDir, id, axis) {
  const { dir, record } = readRun(projectDir, id);
  const review = (record.project_reviews ?? []).find(r => r.id === axis);
  if (!review) throw new Error(`unknown project review: ${axis}`);
  const files = review.files;
  if (!files || typeof files !== 'object' || Array.isArray(files) || !Object.hasOwn(files, 'SKILL.md')) throw new Error('frozen Skill is invalid');
  for (const [name, data] of Object.entries(files)) {
    if (!name || path.isAbsolute(name) || name.split(/[\\/]/).some(part => !part || part === '.' || part === '..') || typeof data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw new Error(`invalid frozen Skill file: ${name}`);
  }
  const output = fs.mkdtempSync(path.join(dir, 'review-skill-'));
  for (const [name, data] of Object.entries(files)) {
    const dest = path.join(output, ...name.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
    fs.writeFileSync(dest, Buffer.from(data, 'base64'), { flag: 'wx', mode: 0o600 | ((review.modes?.[name] ?? 0) & 0o111) });
  }
  return output;
}
