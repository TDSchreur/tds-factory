import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { stages, targets } from './flow.js';

const statuses = ['running', 'waiting', 'verification-unavailable', 'interrupted', 'done', 'abandoned'];
const paused = ['verification-unavailable', 'interrupted'];
const strings = ['title', 'activity', 'waiting_reason', 'status_reason', 'commands', 'spec_link', 'pr', 'worktree', 'base_sha'];
const lists = ['conventions', 'tickets'];
const numbers = ['tickets_total', 'tickets_done', 'check_loops'];
const verdicts = ['standards', 'spec', 'security', 'infrastructure'];
// Only the store's own operations (start, transitions) may change these; plain update rejects them.
const gated = ['stage', 'check_loops', ...verdicts, 'worktree', 'base_sha'];
const validId = (id) => typeof id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(id);

function validate(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('data must be an object');
  for (const [key, value] of Object.entries(data)) {
    let ok = strings.includes(key) ? typeof value === 'string'
      : lists.includes(key) ? Array.isArray(value) && value.every((v) => typeof v === 'string')
      : numbers.includes(key) ? Number.isSafeInteger(value) && value >= 0 && (key !== 'check_loops' || value <= 2)
      : verdicts.includes(key) ? ['pass', 'fail', ...(key === 'infrastructure' ? ['skipped'] : [])].includes(value)
      : key === 'stage' ? stages.includes(value)
      : key === 'status' ? statuses.includes(value)
      : key === 'agent' ? typeof value === 'string' && Object.hasOwn(targets, value)
      : key === 'waiting_on_human' ? typeof value === 'boolean' : false;
    if (!ok) throw new Error(`invalid field or value: ${key}`);
  }
}
function write(dir, record) {
  const temp = path.join(dir, `.run-${randomUUID()}.tmp`);
  try { fs.writeFileSync(temp, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' }); fs.renameSync(temp, path.join(dir, 'run.json')); }
  finally { fs.rmSync(temp, { force: true }); }
}
function apply(old, data) {
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
function runRoot(projectDir, create) {
  const project = fs.realpathSync(projectDir);
  const factory = path.join(project, '.factory');
  const root = path.join(factory, 'runs');
  if (create) {
    if (!fs.existsSync(factory)) fs.mkdirSync(factory);
    if (fs.realpathSync(factory) !== factory) throw new Error('Run storage must not be symlinked');
    if (!fs.existsSync(root)) fs.mkdirSync(root);
  }
  if (fs.realpathSync(factory) !== factory || fs.realpathSync(root) !== root) throw new Error('Run storage must not be symlinked');
  return root;
}
function startRun(projectDir, data) {
  validate(data);
  if (Object.keys(data).some((key) => !['title', 'agent', 'commands', 'conventions'].includes(key))) throw new Error('start accepts only title, agent, commands and conventions');
  if (!data.title || !data.agent || typeof data.commands !== 'string' || !Array.isArray(data.conventions)) throw new Error('title, agent, commands and conventions are required');
  const git = (...args) => spawnSync('git', args, { cwd: projectDir, encoding: 'utf8' });
  if (git('rev-parse', '--git-dir').status !== 0) throw new Error('a Run worktree needs a git repository: run git init first');
  if (git('rev-parse', '--verify', '-q', 'HEAD').status !== 0) throw new Error('a Run worktree needs a git repository with at least one commit');
  const remoteHead = git('ls-remote', '--symref', 'origin', 'HEAD');
  const branch = remoteHead.status === 0 && remoteHead.stdout.match(/^ref: refs\/heads\/([^\s]+)\s+HEAD$/m)?.[1];
  if (!branch || git('check-ref-format', '--branch', branch).status !== 0) throw new Error(`cannot determine origin default branch: ${remoteHead.stderr.trim()}`);
  const fetchRef = `refs/tds-factory/fetch/${randomUUID()}`;
  const fetched = git('fetch', '--no-write-fetch-head', 'origin', `+refs/heads/${branch}:${fetchRef}`);
  if (fetched.status !== 0) throw new Error(`cannot fetch origin default branch: ${fetched.stderr.trim()}`);
  const commit = git('rev-parse', '--verify', `${fetchRef}^{commit}`);
  git('update-ref', '-d', fetchRef);
  if (commit.status !== 0) throw new Error('cannot resolve fetched origin default branch');
  const slug = data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'run';
  const base = `${new Date().toISOString().slice(0, 10)}-${slug}`;
  const root = runRoot(projectDir, true);
  const worktrees = path.join(path.dirname(root), 'worktrees');
  if (fs.existsSync(worktrees) && fs.realpathSync(worktrees) !== worktrees) throw new Error('Run storage must not be symlinked');
  let id = base, n = 2;
  while (true) {
    try { fs.mkdirSync(path.join(root, id)); } catch (err) { if (err.code !== 'EEXIST') throw err; id = `${base}-${n++}`; continue; }
    // Branches outlive Run history, so a free folder name is not enough.
    if (git('rev-parse', '--verify', '-q', `refs/heads/${id}`).status !== 0) break;
    fs.rmdirSync(path.join(root, id));
    id = `${base}-${n++}`;
  }
  const now = new Date().toISOString();
  const worktree = path.join(worktrees, id);
  let created = false;
  try {
    const added = git('worktree', 'add', '-b', id, worktree, commit.stdout.trim());
    if (added.status !== 0) throw new Error(`git worktree add failed: ${added.stderr.trim()}`);
    created = true;
    write(path.join(root, id), apply({ stage: 'define', status: 'running', waiting_on_human: false, waiting_reason: '', activity: 'Starting Define', tickets_total: 0, tickets_done: 0, check_loops: 0, created: now }, { ...data, worktree, base_sha: commit.stdout.trim() }));
  } catch (err) {
    const failures = [];
    if (created) {
      const removed = git('worktree', 'remove', worktree);
      if (removed.status !== 0) failures.push(`worktree remains at ${worktree} and branch ${id} remains: ${removed.stderr.trim()}`);
      else {
        const deleted = git('update-ref', '-d', `refs/heads/${id}`, commit.stdout.trim());
        if (deleted.status !== 0) failures.push(`branch ${id} remains: ${deleted.stderr.trim()}`);
      }
    }
    try { fs.rmdirSync(path.join(root, id)); } catch (cleanup) { failures.push(`Run folder remains at ${path.join(root, id)}: ${cleanup.message}`); }
    if (failures.length) throw new Error(`${err.message}; rollback failed: ${failures.join('; ')}`, { cause: err });
    throw err;
  }
  return id;
}
const lockFile = (root, id) => path.join(root, `.lock-${createHash('sha256').update(id).digest('hex')}`);
const pathExists = (p) => !!fs.lstatSync(p, { throwIfNoEntry: false });
function lockOwner(lock) {
  try {
    if (fs.lstatSync(lock).isSymbolicLink()) return { state: 'unknown' };
    const owner = JSON.parse(fs.readFileSync(lock, 'utf8'));
    if (!Number.isSafeInteger(owner.pid) || owner.pid < 1 || typeof owner.host !== 'string' || !owner.host || typeof owner.started !== 'string' || !Number.isFinite(Date.parse(owner.started))) return { state: 'unknown' };
    let state = 'unknown';
    if (owner.host === os.hostname()) {
      try { process.kill(owner.pid, 0); state = 'live'; }
      catch (err) { if (err.code === 'ESRCH') state = 'dead'; }
    }
    return { ...owner, state };
  } catch { return { state: 'unknown' }; }
}
function withLock(lock, action) {
  const fd = fs.openSync(lock, 'wx', 0o600);
  const identity = fs.fstatSync(fd);
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, host: os.hostname(), started: new Date().toISOString() }) + '\n');
    return action();
  } finally {
    fs.closeSync(fd);
    try {
      const current = fs.lstatSync(lock);
      if (current.dev === identity.dev && current.ino === identity.ino) fs.unlinkSync(lock);
    } catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
}
const repairLockFile = (root, id) => lockFile(root, id).replace(`${path.sep}.lock-`, `${path.sep}.repair-`);
const withRunLock = (root, id, action) => withLock(lockFile(root, id), action);
// The Check attempt a Run is in: its first Check is attempt 1, each Rework starts the next.
const loops = (record) => record.check_loops ?? 0;
const attempt = (record) => loops(record) + 1;

// A Run's folder and record, refusing links anywhere on the way.
function readRun(projectDir, id) {
  if (!validId(id)) throw new Error('invalid Run id');
  const root = runRoot(projectDir, false);
  const dir = path.join(root, id);
  if (fs.realpathSync(dir) !== dir) throw new Error('Run folder must not be a symlink');
  const file = path.join(dir, 'run.json');
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Run record must not be a symlink');
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Run record must be an object');
  return { root, dir, record };
}
// Reads a Run record under its lock, hands it to change, and writes back what change returns.
function changeRun(projectDir, id, change) {
  if (!validId(id)) throw new Error('invalid Run id');
  return withRunLock(runRoot(projectDir, false), id, () => {
    const { dir, record } = readRun(projectDir, id);
    write(dir, change(record));
  });
}
function updateRun(projectDir, id, data) {
  changeRun(projectDir, id, (old) => {
    validate(data);
    const locked = gated.find((key) => key in data);
    if (locked) throw new Error(`${locked} can only change through a Run transition`);
    // Evidence is only worth something if the command it came from cannot be swapped: set it once.
    if ('commands' in data && old.commands) throw new Error('the Verify command is already set; start a new Run to change it');
    if (data.status === 'done') throw new Error('a Run is completed with run complete');
    if ('status' in data && ['done', 'abandoned'].includes(old.status)) throw new Error(`a ${old.status} Run cannot change status`);
    return apply(old, data);
  });
}

// Changes a running Run for a named operation, which takes only an optional activity line besides its own arguments.
function changeRunning(projectDir, id, data, move) {
  validate(data);
  if (Object.keys(data).some((key) => key !== 'activity')) throw new Error('this operation accepts only activity');
  changeRun(projectDir, id, (old) => {
    if (old.status !== 'running') throw new Error(`a ${old.status} Run cannot be changed this way, only a running one`);
    const { record, activity } = move(old);
    return { ...record, activity: data.activity ?? activity, updated: new Date().toISOString() };
  });
}
function transitionRun(projectDir, id, to, data = {}) {
  changeRunning(projectDir, id, data, (old) => {
    const next = stages[stages.indexOf(old.stage) + 1];
    if (!stages.includes(to) || to !== next) throw new Error(`a Run in ${old.stage} can only move to ${next ?? 'nowhere'}, not ${to}`);
    if (to === 'build') {
      const missing = [!old.spec_link && 'a Spec link', !(old.tickets?.length > 0) && 'Tickets'].filter(Boolean);
      if (missing.length) throw new Error(`Build needs ${missing.join(' and ')}`);
    }
    if (to === 'check' && (!old.tickets_total || old.tickets_done !== old.tickets_total)) throw new Error(`Check needs every Ticket done (${old.tickets_done} of ${old.tickets_total})`);
    if (to === 'finish') {
      const problems = finishProblems(old);
      if (problems.length) throw new Error(`Finish needs a clean or Accepted Check: ${problems.join('; ')}`);
    }
    return { record: { ...old, stage: to }, activity: `Starting ${to}` };
  });
}
// Why a Run in Check may not go to Finish: empty when its Check is clean for the current head, or Accepted for it.
function finishProblems(record, { head, dirty } = worktreeState(record)) {
  if (dirty) return ['the Run worktree has uncommitted changes'];
  if (record.accepted?.head === head) return [];
  const problems = [];
  for (const axis of verdicts) {
    const seen = record.reviewed?.[axis];
    if (record[axis] === undefined) problems.push(`${axis} has no verdict`);
    else if (seen?.head !== head || seen?.attempt !== attempt(record)) problems.push(`${axis} was not reviewed at the current head in this Check attempt`);
    else if (record[axis] === 'fail') problems.push(`${axis} failed`);
  }
  const verify = record.verify;
  if (!verify) problems.push('there is no Verify result');
  else if (verify.head !== head || verify.dirty) problems.push('the Verify result is not for the current committed head');
  else if (verify.command !== record.commands) problems.push('the Verify result came from a different command than the Run\'s Verify command');
  else if (verify.exit_code !== 0) problems.push(`the Verify command failed (exit ${verify.exit_code})`);
  return problems;
}
function acceptRun(projectDir, id, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('data must be an object');
  if (Object.keys(data).some((key) => !['findings', 'decision'].includes(key))) throw new Error('accept takes only findings and decision');
  for (const key of ['findings', 'decision']) if (typeof data[key] !== 'string' || !data[key].trim()) throw new Error(`accept needs ${key}`);
  changeRunning(projectDir, id, {}, (old) => {
    if (old.stage !== 'check') throw new Error('only a Run in Check can accept its Check');
    const { head, dirty } = worktreeState(old);
    if (dirty) throw new Error('cannot accept a Check while the Run worktree has uncommitted changes');
    return { record: { ...old, accepted: { findings: data.findings, decision: data.decision, head, at: new Date().toISOString() } }, activity: 'Check accepted by the user' };
  });
}
function reworkRun(projectDir, id, data = {}) {
  changeRunning(projectDir, id, data, (old) => {
    if (old.stage !== 'check') throw new Error('only a Run in Check can be sent back to Build');
    if (loops(old) >= 2) throw new Error('the Check loop limit of 2 is reached');
    const record = { ...old, stage: 'build', check_loops: loops(old) + 1 };
    for (const key of [...verdicts, 'verify', 'reviewed', 'accepted']) delete record[key];
    return { record, activity: 'Rework: back to Build' };
  });
}
function completeRun(projectDir, id, data = {}) {
  changeRunning(projectDir, id, data, (old) => {
    if (old.stage !== 'finish') throw new Error('only a Run in Finish can be completed');
    if (!old.pr) throw new Error('completing a Run needs a PR link');
    if (old.tickets_done > old.tickets_total) throw new Error(`more Tickets done (${old.tickets_done}) than counted (${old.tickets_total})`);
    return { record: { ...old, status: 'done', waiting_on_human: false, waiting_reason: '' }, activity: 'Done' };
  });
}

// The code revision a Run's Evidence is about: the worktree's head, and whether it has uncommitted changes.
function worktreeState(record) {
  if (!record.worktree || !fs.existsSync(record.worktree)) throw new Error('the Run worktree is missing');
  const git = (...args) => spawnSync('git', args, { cwd: record.worktree, encoding: 'utf8' });
  const head = git('rev-parse', 'HEAD'), status = git('status', '--porcelain');
  if (head.status !== 0 || status.status !== 0) throw new Error(`cannot read the Run worktree: ${(head.stderr || status.stderr).trim()}`);
  return { head: head.stdout.trim(), dirty: status.stdout.trim() !== '' };
}
// Runs the Verify command outside the Run lock, since it can take minutes, and records the result under it.
function verifyRun(projectDir, id) {
  const { dir, record } = readRun(projectDir, id);
  if (record.status !== 'running') throw new Error(`a ${record.status} Run cannot be verified, only a running one`);
  if (!record.commands?.trim()) throw new Error('the Run has no Verify command');
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
function verdictRun(projectDir, id, axis, value) {
  if (!verdicts.includes(axis)) throw new Error(`unknown Check axis: ${axis}`);
  validate({ [axis]: value });
  changeRunning(projectDir, id, {}, (old) => {
    if (old.stage !== 'check') throw new Error('verdicts are recorded in Check');
    const { head, dirty } = worktreeState(old);
    if (value !== 'fail' && dirty) throw new Error(`cannot record ${value} for ${axis}: the Run worktree has uncommitted changes`);
    return { record: { ...old, [axis]: value, reviewed: { ...old.reviewed, [axis]: { head, attempt: attempt(old) } } }, activity: `${axis} verdict: ${value}` };
  });
}

// Only worktrees at the store's own paths can be recovered.
function ownWorktrees(projectDir) {
  const base = path.join(projectDir, '.factory', 'worktrees');
  if (fs.existsSync(base) && fs.realpathSync(base) !== base) throw new Error('Run worktree storage must not be symlinked');
  const listed = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: projectDir, encoding: 'utf8' });
  if (listed.status !== 0) throw new Error('cannot list git worktrees');
  const entries = new Map();
  for (const part of listed.stdout.split('\n\n')) {
    const dir = /^worktree (.+)$/m.exec(part)?.[1];
    const branch = /^branch refs\/heads\/(.+)$/m.exec(part)?.[1];
    if (!dir || path.dirname(dir) !== base) continue;
    const id = path.basename(dir);
    if (!validId(id) || !fs.existsSync(dir) || fs.realpathSync(dir) !== dir) continue;
    entries.set(id, { dir, branch, head: /^HEAD (.+)$/m.exec(part)?.[1] });
  }
  return entries;
}

// Produce a reviewable plan from current git, Run and GitHub facts. No writes occur here.
function repairPlan(projectDir, runsDir, id, ignoreLock = false) {
  if (!validId(id)) throw new Error('invalid Run id');
  const dir = path.join(runsDir, id), file = path.join(dir, 'run.json'), lock = lockFile(runsDir, id);
  const actions = [], notes = [], blockers = [];
  const worktrees = ownWorktrees(projectDir), wt = worktrees.get(id);
  let record;
  if (fs.existsSync(dir) && fs.realpathSync(dir) !== dir) throw new Error('Run folder must not be a symlink');
  if (fs.existsSync(file)) {
    try { record = readRun(projectDir, id).record; } catch (err) { blockers.push(`existing record is unreadable; preserve it: ${err.message}`); }
  } else if (fs.existsSync(dir) && fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) blockers.push('existing record is a symlink; preserve it');
  else if (!wt) throw new Error(`no such Run: ${id}`);
  if (pathExists(repairLockFile(runsDir, id)) && !ignoreLock) {
    const owner = lockOwner(repairLockFile(runsDir, id));
    blockers.push(`repair coordination lock: ${owner.pid ? `PID ${owner.pid}, host ${owner.host}, started ${owner.started}, ${owner.state}` : 'owner unknown'}; inspect it before manual recovery`);
  }
  if (pathExists(lock) && !ignoreLock) {
    const owner = lockOwner(lock);
    notes.push(owner.pid ? `lock: PID ${owner.pid}, host ${owner.host}, started ${owner.started}, ${owner.state}` : 'lock owner unknown');
    if (owner.state === 'dead') actions.push('clear lock of demonstrably dead local owner');
    else blockers.push(`lock owner is ${owner.state}; cannot clear it`);
  }
  if (!wt) notes.push('Run worktree missing or unregistered; inspect git and recover manually');
  else {
    notes.push(`git worktree ${wt.dir}, branch ${wt.branch ?? '(detached)'}, head ${wt.head ?? '(unknown)'}`);
    if (wt.branch !== id) blockers.push(`worktree branch does not match Run id ${id}`);
    else {
      try {
        const state = worktreeState({ worktree: wt.dir });
        if (state.dirty) notes.push('worktree is dirty; preserve all uncommitted work');
        const seen = [record?.verify?.head, record?.accepted?.head, ...Object.values(record?.reviewed ?? {}).map((v) => v?.head)].filter(Boolean);
        if (seen.some((head) => head !== state.head)) notes.push('Evidence is stale; review before continuing');
      } catch (err) { blockers.push(`cannot read worktree: ${err.message}`); }
    }
  }
  if (record && record.worktree !== wt?.dir) blockers.push('record worktree does not match the registered Run worktree');
  if (!record && !blockers.length && wt) actions.push('recreate missing Run record as interrupted without inventing progress or Evidence');
  if (wt?.branch === id) {
    const remote = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: projectDir, encoding: 'utf8' });
    const url = remote.status === 0 ? remote.stdout.trim() : '';
    const match = /^(?:https?:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(url);
    if (!match) notes.push('GitHub origin unresolved or not GitHub; reconcile any PR manually before repeating work');
    else {
      const repo = `${match[1]}/${match[2]}`;
      const gh = spawnSync('gh', ['pr', 'list', '--repo', repo, '--head', id, '--state', 'all', '--json', 'url,headRefName,headRepository,headRepositoryOwner'], { cwd: projectDir, encoding: 'utf8', timeout: 10000 });
      try {
        if (gh.status !== 0) throw new Error(gh.error?.message || gh.stderr.trim() || 'GitHub lookup failed');
        const all = JSON.parse(gh.stdout);
        if (!Array.isArray(all) || all.some((pr) => !pr || typeof pr.url !== 'string' || typeof pr.headRefName !== 'string' || typeof pr.headRepositoryOwner?.login !== 'string' || typeof pr.headRepository?.name !== 'string')) throw new Error('incomplete GitHub PR response');
        const prs = all.filter((pr) => pr.headRefName === id && pr.headRepositoryOwner?.login?.toLowerCase() === match[1].toLowerCase() && pr.headRepository?.name?.toLowerCase() === match[2].toLowerCase() && typeof pr.url === 'string' && pr.url.toLowerCase().startsWith(`https://github.com/${repo.toLowerCase()}/pull/`) && /^[0-9]+$/.test(pr.url.slice(`https://github.com/${repo}/pull/`.length)));
        if (prs.length > 1) notes.push('GitHub PR lookup is ambiguous; reconcile manually');
        else if (prs.length === 1 && record?.pr && record.pr !== prs[0].url) notes.push('recorded PR conflicts with GitHub; reconcile manually');
        else if (prs.length === 1 && !record?.pr) { actions.push(`adopt existing PR ${prs[0].url}`); notes.push(`GitHub PR found: ${prs[0].url}`); }
        else if (!prs.length && record?.pr) notes.push('recorded PR not found in GitHub results; reconcile manually');
        else notes.push(prs.length ? `GitHub PR confirmed: ${prs[0].url}` : 'no matching GitHub PR found');
      } catch (err) { notes.push(`GitHub reconciliation unavailable: ${err.message}`); }
    }
  }
  if (!actions.length) notes.push('no automatic changes proposed');
  return { id, actions, notes, blockers };
}

function repairApply(projectDir, runsDir, id, expected) {
  let plan = repairPlan(projectDir, runsDir, id);
  if (JSON.stringify(plan) !== JSON.stringify(expected)) throw new Error('repair facts changed; inspect a new plan');
  if (plan.blockers.length) throw new Error(plan.blockers.join('; '));
  if (!plan.actions.length) return;
  const root = runRoot(projectDir, true), lock = lockFile(root, id);
  return withLock(repairLockFile(root, id), () => {
  if (pathExists(lock)) {
    const stat = fs.lstatSync(lock), owner = lockOwner(lock);
    if (owner.state !== 'dead') throw new Error('lock ownership changed; inspect a new plan');
    const again = fs.lstatSync(lock);
    if (stat.ino !== again.ino || stat.dev !== again.dev) throw new Error('lock changed; inspect a new plan');
    fs.unlinkSync(lock);
  }
  withRunLock(root, id, () => {
    const fresh = repairPlan(projectDir, root, id, true);
    const expectedActions = plan.actions.filter((a) => !a.startsWith('clear lock'));
    if (fresh.blockers.length || JSON.stringify(fresh.actions) !== JSON.stringify(expectedActions) || JSON.stringify(fresh.notes.filter((n) => n !== 'no automatic changes proposed')) !== JSON.stringify(plan.notes.filter((n) => !n.startsWith('lock:') && n !== 'no automatic changes proposed'))) throw new Error('repair facts changed; inspect a new plan');
    const dir = path.join(root, id), file = path.join(dir, 'run.json');
    let record;
    if (fresh.actions.some((a) => a.startsWith('recreate'))) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir);
      if (fs.lstatSync(file, { throwIfNoEntry: false })) throw new Error('Run record appeared; inspect a new plan');
      const now = new Date().toISOString();
      record = { title: id, stage: 'define', status: 'interrupted', status_reason: 'Recreated missing Run record; reconcile existing work before resuming', waiting_on_human: false, waiting_reason: '', activity: 'Reconcile existing work before continuing', tickets_total: 0, tickets_done: 0, check_loops: 0, worktree: path.join(projectDir, '.factory', 'worktrees', id), commands: '', conventions: [], created: now, updated: now };
    } else if (fresh.actions.some((a) => a.startsWith('adopt'))) record = readRun(projectDir, id).record;
    const pr = fresh.actions.find((a) => a.startsWith('adopt existing PR '));
    if (pr && record) record = { ...record, pr: pr.slice('adopt existing PR '.length), updated: new Date().toISOString() };
    if (record) write(dir, record);
  });
  });
}

// Read-only health report: what would stop each Run from carrying on. Finished Runs only report records, locks and uncommitted work.
async function inspectRuns(projectDir, runsDir, only) {
  const runs = await listRuns(runsDir);
  for (const [id, wt] of ownWorktrees(projectDir)) {
    const existing = runs.find((r) => r.id === id);
    if (!existing) runs.push({ id, orphan: true, worktree: wt.dir });
    else if (existing.unreadable && !fs.existsSync(path.join(runsDir, id, 'run.json'))) Object.assign(existing, { orphan: true, worktree: wt.dir });
  }
  const selected = runs.filter((run) => only === undefined || run.id === only);
  if (only !== undefined && !selected.length) throw new Error(`no such Run: ${only}`);
  const listed = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: projectDir, encoding: 'utf8' }).stdout ?? '';
  const known = new Set([...listed.matchAll(/^worktree (.+)$/gm)].map((m) => fs.existsSync(m[1]) ? fs.realpathSync(m[1]) : m[1]));
  return selected.map(({ id, unreadable, record, orphan, worktree }) => {
    const found = [];
    const add = (code, message) => found.push({ code, message });
    if (pathExists(repairLockFile(runsDir, id))) {
      const owner = lockOwner(repairLockFile(runsDir, id));
      add('repair-lock', owner.pid ? `repair coordination lock: PID ${owner.pid}, host ${owner.host}, started ${owner.started}: ${owner.state}` : 'repair coordination lock owner unknown');
    }
    if (pathExists(lockFile(runsDir, id))) {
      const owner = lockOwner(lockFile(runsDir, id));
      add('lock', owner.pid ? `lock owner PID ${owner.pid}, host ${owner.host}, started ${owner.started}: ${owner.state}` : 'lock owner unknown (legacy, unreadable or malformed lock)');
    }
    if (orphan) {
      add('orphan', `registered Run worktree ${worktree} has no Run folder or record`);
      try { if (worktreeState({ worktree }).dirty) add('worktree-dirty', 'the Run worktree has uncommitted changes'); } catch (err) { add('worktree-unreadable', err.message); }
    }
    else if (unreadable) add('unreadable', 'run.json is missing or cannot be parsed');
    else {
      // A finished Run only matters here for uncommitted work that would block removing its worktree.
      const active = ['running', 'waiting', ...paused].includes(record.status);
      if (!record.worktree || !fs.existsSync(record.worktree)) { if (active) add('worktree-missing', `the Run worktree ${record.worktree ?? '(none recorded)'} does not exist`); }
      else if (!known.has(fs.realpathSync(record.worktree))) { if (active) add('worktree-unknown', `git does not list ${record.worktree} as a worktree`); }
      else {
        try {
          const { head, dirty } = worktreeState(record);
          if (dirty) add('worktree-dirty', 'the Run worktree has uncommitted changes');
          const seen = [record.verify?.head, record.accepted?.head, ...Object.values(record.reviewed ?? {}).map((r) => r?.head)].filter(Boolean);
          if (active && ['check', 'finish'].includes(record.stage) && seen.some((h) => h !== head)) add('stale-evidence', 'Evidence was recorded for an earlier head than the current one');
        } catch (err) { add('worktree-unreadable', err.message); }
      }
    }
    return { id, problems: found };
  });
}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// Sort Stage summaries in Flow order, with numbered Check passes sorted numerically.
function stageOrder(name) {
  const base = name.replace(/\.md$/, '');
  const m = /^check-(\d+)$/.exec(base);
  const index = stages.indexOf(m ? 'check' : base);
  return [index < 0 ? stages.length : index, m ? Number(m[1]) : 0];
}
const byStage = (a, b) => {
  const [x, y] = [stageOrder(a), stageOrder(b)];
  return x[0] - y[0] || x[1] - y[1] || a.localeCompare(b);
};

// Names of the Markdown files directly inside a Run folder, in Stage order.
async function listMarkdown(dir) {
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith('.md') && SEGMENT.test(e.name)).map((e) => e.name).sort(byStage);
  } catch {
    return [];
  }
}

async function listRuns(runsDir) {
  let entries;
  try {
    entries = await fs.promises.readdir(runsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const runs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const files = await listMarkdown(path.join(runsDir, entry.name));
    try {
      const record = JSON.parse(await fs.promises.readFile(path.join(runsDir, entry.name, 'run.json'), 'utf8'));
      if (record === null || typeof record !== 'object' || Array.isArray(record)) throw new Error('not an object');
      runs.push({ id: entry.name, unreadable: false, record, files });
    } catch {
      runs.push({ id: entry.name, unreadable: true, record: null, files });
    }
  }
  return runs.sort((a, b) => a.id.localeCompare(b.id));
}

// Returns file contents, or null if the path is not a Markdown file inside a Run folder.
async function readRunFile(runsDir, rawPath) {
  let parts;
  try {
    parts = rawPath.split('/').map(decodeURIComponent);
  } catch {
    return null;
  }
  if (parts.length !== 2 || !parts.every((p) => SEGMENT.test(p) && !p.startsWith('..'))) return null;
  if (!parts[1].endsWith('.md')) return null;
  try {
    const root = await fs.promises.realpath(runsDir);
    const file = await fs.promises.realpath(path.resolve(root, ...parts));
    if (!file.startsWith(root + path.sep)) return null;
    return await fs.promises.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

// Deletes only a terminal Run in the project's own, unlinked storage.
function removeRun(projectDir, id) {
  if (!id || id === '.' || id === '..' || /[\/\\\0]/.test(id)) return 'invalid';
  const project = fs.realpathSync(projectDir);
  const factory = path.join(project, '.factory');
  const root = path.join(factory, 'runs');
  const dir = path.join(root, id);
  try {
    if (fs.realpathSync(factory) !== factory || fs.realpathSync(root) !== root) return 'not-allowed';
    return withRunLock(root, id, () => {
      if (fs.realpathSync(dir) !== dir || fs.lstatSync(path.join(dir, 'run.json')).isSymbolicLink()) return 'not-allowed';
      const record = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
      if (!record || !['done', 'abandoned'].includes(record.status)) return 'not-allowed';
      // Only a worktree this store created is removed; an adopted one belongs to the user. Never forced, so uncommitted work stays.
      const own = path.join(factory, 'worktrees', id);
      if (record.worktree === own && fs.existsSync(own) && spawnSync('git', ['worktree', 'remove', own], { cwd: project }).status !== 0) return 'worktree-refused';
      fs.rmSync(dir, { recursive: true });
      return 'deleted';
    });
  } catch (err) {
    if (err.code === 'ENOENT') return 'not-found';
    if (err.code === 'EEXIST' || err instanceof SyntaxError) return 'not-allowed';
    throw err;
  }
}

// Run records live in the main checkout, including when called from a linked worktree.
function mainCheckout(dir) {
  const out = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir', '--show-toplevel'], { cwd: dir, encoding: 'utf8' });
  const [gitDir, common] = out.status === 0 ? out.stdout.trim().split('\n') : [];
  if (!gitDir || path.basename(common) !== '.git') return { dir };
  return { dir: path.dirname(common) };
}

// The one module that touches .factory/runs. remove returns 'deleted', 'not-found', 'not-allowed', 'worktree-refused' or 'invalid'.
export function openRunStore(callerDir) {
  const { dir: projectDir } = mainCheckout(callerDir);
  const runsDir = path.resolve(projectDir, '.factory', 'runs');
  return {
    projectDir,
    start: (data) => startRun(projectDir, data),
    update: (id, data) => updateRun(projectDir, id, data),
    transition: (id, to, data) => transitionRun(projectDir, id, to, data),
    rework: (id, data) => reworkRun(projectDir, id, data),
    complete: (id, data) => completeRun(projectDir, id, data),
    accept: (id, data) => acceptRun(projectDir, id, data),
    verify: (id) => verifyRun(projectDir, id),
    verdict: (id, axis, value) => verdictRun(projectDir, id, axis, value),
    mergeEligibility: (id) => {
      const { record } = readRun(projectDir, id);
      const state = worktreeState(record);
      return { ...state, problems: finishProblems(record, state), worktree: record.worktree };
    },
    list: () => listRuns(runsDir),
    inspect: (id) => inspectRuns(projectDir, runsDir, id),
    repairPlan: (id) => repairPlan(projectDir, runsDir, id),
    repairApply: (id, plan) => repairApply(projectDir, runsDir, id, plan),
    readFile: (rawPath) => readRunFile(runsDir, rawPath),
    remove: (id) => removeRun(projectDir, id),
  };
}
