import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { stages } from './flow.js';
import { loadProjectConfig, frozenSettings } from './project-config.js';
import {
  loopCap,
  extraLoops,
  tracks,
  trackOf,
  gated,
  validate,
  apply,
  write,
  checkCommands,
  fastCommandProblem,
  verifyCommandProblem,
  loops,
} from './run-record.js';
import { runRoot, changeRun, changeRunning } from './run-folder.js';
import { fetchOriginDefault, mergeProblem, worktreeState } from './worktrees.js';
import { finishProblems, clearEvidence } from './evidence.js';
import { newMetrics, moveVisit, firstCheck } from './run-metrics.js';

export function startRun(projectDir, data) {
  validate(data);
  if (Object.keys(data).some((key) => !['title', 'agent', 'commands', 'fast_commands', 'conventions'].includes(key)))
    throw new Error('start accepts only title, agent, commands, fast_commands and conventions');
  if (!data.title || !data.agent || typeof data.commands !== 'string' || !Array.isArray(data.conventions))
    throw new Error('title, agent, commands and conventions are required');
  checkCommands(data.commands);
  const fastProblem = fastCommandProblem(data.fast_commands);
  if (fastProblem) throw new Error(fastProblem);
  const git = (...args) => spawnSync('git', args, { cwd: projectDir, encoding: 'utf8' });
  if (git('rev-parse', '--git-dir').status !== 0)
    throw new Error('a Run worktree needs a git repository: run git init first');
  if (git('rev-parse', '--verify', '-q', 'HEAD').status !== 0)
    throw new Error('a Run worktree needs a git repository with at least one commit');
  const commit = fetchOriginDefault(projectDir);
  const slug =
    data.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'run';
  const base = `${new Date().toISOString().slice(0, 10)}-${slug}`;
  const root = runRoot(projectDir, true);
  const worktrees = path.join(path.dirname(root), 'worktrees');
  if (fs.existsSync(worktrees) && fs.realpathSync(worktrees) !== worktrees)
    throw new Error('Run storage must not be symlinked');
  let id = base,
    n = 2;
  while (true) {
    try {
      fs.mkdirSync(path.join(root, id));
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      id = `${base}-${n++}`;
      continue;
    }
    // Branches outlive Run history, so a free folder name is not enough.
    if (git('rev-parse', '--verify', '-q', `refs/heads/${id}`).status !== 0) break;
    fs.rmdirSync(path.join(root, id));
    id = `${base}-${n++}`;
  }
  const now = new Date().toISOString();
  const worktree = path.join(worktrees, id);
  let created = false;
  try {
    const added = git('worktree', 'add', '-b', id, worktree, commit);
    if (added.status !== 0) throw new Error(`git worktree add failed: ${added.stderr.trim()}`);
    created = true;
    const { reviews: projectReviews, ...settings } = loadProjectConfig(worktree, data.agent);
    write(path.join(root, id), {
      ...apply(
        {
          stage: 'define',
          status: 'running',
          waiting_on_human: false,
          waiting_reason: '',
          activity: 'Starting Define',
          tickets_total: 0,
          tickets_done: 0,
          check_loops: 0,
          created: now,
          last_seen: now,
        },
        { ...data, worktree, base_sha: commit },
      ),
      project_reviews: projectReviews,
      project_config: frozenSettings(settings),
      metrics: newMetrics(now),
    });
  } catch (err) {
    const failures = [];
    if (created) {
      const removed = git('worktree', 'remove', worktree);
      if (removed.status !== 0)
        failures.push(`worktree remains at ${worktree} and branch ${id} remains: ${removed.stderr.trim()}`);
      else {
        const deleted = git('update-ref', '-d', `refs/heads/${id}`, commit);
        if (deleted.status !== 0) failures.push(`branch ${id} remains: ${deleted.stderr.trim()}`);
      }
    }
    try {
      fs.rmdirSync(path.join(root, id));
    } catch (cleanup) {
      failures.push(`Run folder remains at ${path.join(root, id)}: ${cleanup.message}`);
    }
    if (failures.length) throw new Error(`${err.message}; rollback failed: ${failures.join('; ')}`, { cause: err });
    throw err;
  }
  return id;
}

export function updateRun(projectDir, id, data) {
  changeRun(projectDir, id, (old) => {
    validate(data);
    const locked = gated.find((key) => key in data);
    if (locked) throw new Error(`${locked} can only change through a Run transition`);
    // Evidence is only worth something if the command it came from cannot be swapped: set it once.
    if ('commands' in data && old.commands)
      throw new Error('the Verify command is already set; start a new Run to change it');
    if ('commands' in data) checkCommands(data.commands);
    if ('fast_commands' in data) throw new Error('the fast Verify command is set when the Run starts');
    if (data.status === 'done') throw new Error('a Run is completed with run complete');
    if ('status' in data && ['done', 'abandoned'].includes(old.status))
      throw new Error(`a ${old.status} Run cannot change status`);
    const next = apply(old, data);
    return data.status === 'abandoned' ? moveVisit(next, null) : next;
  });
}

export function transitionRun(projectDir, id, to, data = {}) {
  changeRunning(projectDir, id, data, (old) => {
    // Runs recorded before the Prepare Stage was removed still say `prepare`; they are in Define.
    const from = old.stage === 'prepare' ? 'define' : old.stage;
    const next = stages[stages.indexOf(from) + 1];
    if (!stages.includes(to) || to !== next)
      throw new Error(`a Run in ${from} can only move to ${next ?? 'nowhere'}, not ${to}`);
    // Everything from Build on depends on verification, so an unusable command stops the Run here.
    const commandProblem = ['build', 'check', 'finish'].includes(to) && verifyCommandProblem(old.commands);
    if (commandProblem)
      throw new Error(`${to[0].toUpperCase()}${to.slice(1)} needs a usable Verify command: ${commandProblem}`);
    if (to === 'build') {
      const missing = [!old.spec_link && 'a Spec link', !(old.tickets?.length > 0) && 'Tickets'].filter(Boolean);
      if (missing.length) throw new Error(`Build needs ${missing.join(' and ')}`);
    }
    if (['build', 'check'].includes(to) && trackOf(old) === 'fast' && old.tickets?.length !== 1) {
      throw new Error(`the Fast track needs exactly one Ticket, not ${old.tickets?.length ?? 0}`);
    }
    if (to === 'check' && (!old.tickets_total || old.tickets_done !== old.tickets_total))
      throw new Error(`Check needs every Ticket done (${old.tickets_done} of ${old.tickets_total})`);
    if (to === 'follow-up' && !old.pr) throw new Error('Follow-up needs a PR link');
    if (to === 'finish') {
      const problems = finishProblems(old);
      if (problems.length) throw new Error(`Finish needs a clean or Accepted Check: ${problems.join('; ')}`);
      const conflict = mergeProblem(projectDir, old);
      if (conflict) throw new Error(`Finish needs a branch that merges cleanly: ${conflict}`);
    }
    let record = old;
    if (to === 'finish') record = firstCheck(record, finishProblems({ ...old, accepted: undefined }).length === 0);
    record = moveVisit(record, to);
    record = { ...record, stage: to };
    return { record, activity: `Starting ${to}` };
  });
}

// The user's choice of Track, recorded only in Define; a record without one is a Full track Run.
export function trackRun(projectDir, id, value) {
  if (!tracks.includes(value)) throw new Error(`track must be ${tracks.join(' or ')}`);
  changeRunning(projectDir, id, {}, (old) => {
    if (!['define', 'prepare'].includes(old.stage)) throw new Error('the track is chosen in Define');
    return { record: { ...old, track: value }, activity: `${value === 'fast' ? 'Fast' : 'Full'} track chosen` };
  });
}

export function acceptRun(projectDir, id, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('data must be an object');
  if (Object.keys(data).some((key) => !['findings', 'decision'].includes(key)))
    throw new Error('accept takes only findings and decision');
  for (const key of ['findings', 'decision'])
    if (typeof data[key] !== 'string' || !data[key].trim()) throw new Error(`accept needs ${key}`);
  changeRunning(projectDir, id, {}, (old) => {
    if (old.stage !== 'check') throw new Error('only a Run in Check can accept its Check');
    const { head, dirty } = worktreeState(old);
    if (dirty) throw new Error('cannot accept a Check while the Run worktree has uncommitted changes');
    return {
      record: {
        ...old,
        accepted: { findings: data.findings, decision: data.decision, head, at: new Date().toISOString() },
      },
      activity: 'Check accepted by the user',
    };
  });
}
// Rebases onto origin's default branch. A changed head or recorded base makes Evidence stale, so it goes.
export function syncRun(projectDir, id, data = {}) {
  changeRunning(projectDir, id, data, (old) => {
    if (!['build', 'check'].includes(old.stage)) throw new Error('only a Run in Build or Check can be synced');
    const git = (...args) => spawnSync('git', args, { cwd: old.worktree, encoding: 'utf8' });
    // A rebase the user left open is theirs to finish; starting another or aborting it would lose their work.
    for (const dir of ['rebase-merge', 'rebase-apply']) {
      if (fs.existsSync(path.resolve(old.worktree, git('rev-parse', '--git-path', dir).stdout.trim())))
        throw new Error(
          'a rebase is already in progress in the Run worktree: finish it with git rebase --continue (or stop it with git rebase --abort), then run sync again',
        );
    }
    const { head, dirty } = worktreeState(old);
    if (dirty) throw new Error('cannot sync while the Run worktree has uncommitted changes');
    const base = fetchOriginDefault(projectDir);
    const rebased = git('rebase', base);
    if (rebased.status !== 0) {
      const files = git('diff', '--name-only', '--diff-filter=U').stdout.trim().split('\n').filter(Boolean);
      const aborted = git('rebase', '--abort');
      const why = files.length ? `conflicts in ${files.join(', ')}` : `failed: ${rebased.stderr.trim()}`;
      if (aborted.status !== 0)
        throw new Error(`rebase onto origin ${why}; it could not be aborted: ${aborted.stderr.trim()}`);
      throw new Error(
        `rebase onto origin ${why}; the branch is unchanged. To resolve it, run git rebase ${base} in the Run worktree, fix each conflicted file, git add it, run git rebase --continue, then run sync again`,
      );
    }
    const moved = worktreeState(old).head !== head;
    const changed = moved || old.base_sha !== base;
    const record = changed ? clearEvidence({ ...old, base_sha: base }) : { ...old, base_sha: base };
    return { record, activity: changed ? 'Synced with origin; Evidence cleared' : 'Already up to date with origin' };
  });
}

export function reworkRun(projectDir, id, data = {}) {
  changeRunning(projectDir, id, data, (old) => {
    if (old.stage !== 'check') throw new Error('only a Run in Check can be sent back to Build');
    if (loops(old) >= loopCap(old)) throw new Error(`the Check loop limit of ${loopCap(old)} is reached`);
    const record = clearEvidence({
      ...moveVisit(firstCheck(old, false), 'build'),
      stage: 'build',
      check_loops: loops(old) + 1,
    });
    return { record, activity: 'Rework: back to Build' };
  });
}
// The user's decision to allow one more Rework (ADR 0024). Not reachable from the command line: only the Dashboard route calls it.
// `updated` is the record time the user saw; a Run that changed since is refused.
export function grantLoopRun(projectDir, id, { updated } = {}) {
  changeRun(projectDir, id, (old) => {
    if (old.stage !== 'check') throw new Error('only a Run in Check can be granted an extra loop');
    if (old.status !== 'waiting' || old.waiting_on_human !== true)
      throw new Error('only a Run that waits on the user can be granted an extra loop');
    if (loops(old) < loopCap(old)) throw new Error(`the Check loop limit of ${loopCap(old)} is not reached`);
    if (updated !== undefined && updated !== old.updated) throw new Error('the Run changed since it was shown');
    return {
      ...old,
      extra_loops: extraLoops(old) + 1,
      status: 'running',
      waiting_on_human: false,
      waiting_reason: '',
      activity: 'The user granted an extra Check loop on the Dashboard',
      updated: new Date().toISOString(),
    };
  });
}
export function completeRun(projectDir, id, data = {}) {
  changeRunning(projectDir, id, data, (old) => {
    if (!['finish', 'follow-up'].includes(old.stage))
      throw new Error('only a Run in Finish or Follow-up can be completed');
    if (!old.pr) throw new Error('completing a Run needs a PR link');
    if (old.tickets_done > old.tickets_total)
      throw new Error(`more Tickets done (${old.tickets_done}) than counted (${old.tickets_total})`);
    return {
      record: { ...moveVisit(old, null), status: 'done', waiting_on_human: false, waiting_reason: '' },
      activity: 'Done',
    };
  });
}
