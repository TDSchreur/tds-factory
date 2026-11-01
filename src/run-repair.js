import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validId, paused, write } from './run-record.js';
import {
  runRoot,
  lockFile,
  repairLockFile,
  pathExists,
  lockOwner,
  withLock,
  withRunLock,
  readRun,
  listRuns,
} from './run-folder.js';
import { ownWorktrees, worktreeState } from './worktrees.js';
import { remoteRepo } from './pr-provider.js';

// Produce a reviewable plan from current git, Run and GitHub facts. No writes occur here.
export function repairPlan(projectDir, runsDir, id, ignoreLock = false) {
  if (!validId(id)) throw new Error('invalid Run id');
  const dir = path.join(runsDir, id),
    file = path.join(dir, 'run.json'),
    lock = lockFile(runsDir, id);
  const actions = [],
    notes = [],
    blockers = [];
  const worktrees = ownWorktrees(projectDir),
    wt = worktrees.get(id);
  let record;
  if (fs.existsSync(dir) && fs.realpathSync(dir) !== dir) throw new Error('Run folder must not be a symlink');
  if (fs.existsSync(file)) {
    try {
      record = readRun(projectDir, id).record;
    } catch (err) {
      blockers.push(`existing record is unreadable; preserve it: ${err.message}`);
    }
  } else if (fs.existsSync(dir) && fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink())
    blockers.push('existing record is a symlink; preserve it');
  else if (!wt) throw new Error(`no such Run: ${id}`);
  if (pathExists(repairLockFile(runsDir, id)) && !ignoreLock) {
    const owner = lockOwner(repairLockFile(runsDir, id));
    blockers.push(
      `repair coordination lock: ${owner.pid ? `PID ${owner.pid}, host ${owner.host}, started ${owner.started}, ${owner.state}` : 'owner unknown'}; inspect it before manual recovery`,
    );
  }
  if (pathExists(lock) && !ignoreLock) {
    const owner = lockOwner(lock);
    notes.push(
      owner.pid
        ? `lock: PID ${owner.pid}, host ${owner.host}, started ${owner.started}, ${owner.state}`
        : 'lock owner unknown',
    );
    if (owner.state === 'dead') actions.push('clear lock of demonstrably dead local owner');
    else blockers.push(`lock owner is ${owner.state}; cannot clear it`);
  }
  if (!wt) notes.push('Run worktree missing or unregistered; inspect git and recover manually');
  else {
    notes.push(`git worktree ${wt.dir}, branch ${wt.branch ?? '(detached)'}, head ${wt.head ?? '(unknown)'}`);
    if (wt.missing) blockers.push(`registered Run worktree ${wt.dir} is missing; recover it manually`);
    else if (!wt.safe) blockers.push(`registered Run worktree ${wt.dir} is unsafe or symlinked; investigate manually`);
    else if (wt.branch !== id) blockers.push(`worktree branch does not match Run id ${id}`);
    else {
      try {
        const state = worktreeState({ worktree: wt.dir });
        if (state.dirty) notes.push('worktree is dirty; preserve all uncommitted work');
        const seen = [
          record?.verify?.head,
          record?.accepted?.head,
          ...Object.values(record?.reviewed ?? {}).map((v) => v?.head),
        ].filter(Boolean);
        if (seen.some((head) => head !== state.head)) notes.push('Evidence is stale; review before continuing');
      } catch (err) {
        blockers.push(`cannot read worktree: ${err.message}`);
      }
    }
  }
  if (record && record.worktree !== wt?.dir)
    blockers.push('record worktree does not match the registered Run worktree');
  if (!record && !blockers.length && wt)
    actions.push('recreate missing Run record as interrupted without inventing progress or Evidence');
  if (wt?.safe && wt.branch === id) {
    const remote = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: projectDir, encoding: 'utf8' });
    const url = remote.status === 0 ? remote.stdout.trim() : '';
    const host = remoteRepo(url);
    if (!host || typeof host.provider.listByHead !== 'function')
      notes.push('GitHub origin unresolved or not GitHub; reconcile any PR manually before repeating work');
    else {
      const repo = `${host.owner}/${host.name}`;
      try {
        const all = host.provider.listByHead(repo, id, projectDir);
        const prs = all.filter(
          (pr) =>
            pr.headRefName === id &&
            pr.headRepositoryOwner?.login?.toLowerCase() === host.owner.toLowerCase() &&
            pr.headRepository?.name?.toLowerCase() === host.name.toLowerCase() &&
            typeof pr.url === 'string' &&
            pr.url.toLowerCase().startsWith(`https://github.com/${repo.toLowerCase()}/pull/`) &&
            /^[0-9]+$/.test(pr.url.slice(`https://github.com/${repo}/pull/`.length)),
        );
        if (prs.length > 1) notes.push('GitHub PR lookup is ambiguous; reconcile manually');
        else if (prs.length === 1 && record?.pr && record.pr !== prs[0].url)
          notes.push('recorded PR conflicts with GitHub; reconcile manually');
        else if (prs.length === 1 && !record?.pr) {
          actions.push(`adopt existing PR ${prs[0].url}`);
          notes.push(`GitHub PR found: ${prs[0].url}`);
        } else if (!prs.length && record?.pr) notes.push('recorded PR not found in GitHub results; reconcile manually');
        else notes.push(prs.length ? `GitHub PR confirmed: ${prs[0].url}` : 'no matching GitHub PR found');
      } catch (err) {
        notes.push(`GitHub reconciliation unavailable: ${err.message}`);
      }
    }
  }
  if (!actions.length) notes.push('no automatic changes proposed');
  return { id, actions, notes, blockers };
}

export function repairApply(projectDir, runsDir, id, expected) {
  let plan = repairPlan(projectDir, runsDir, id);
  if (JSON.stringify(plan) !== JSON.stringify(expected)) throw new Error('repair facts changed; inspect a new plan');
  if (plan.blockers.length) throw new Error(plan.blockers.join('; '));
  if (!plan.actions.length) return;
  const root = runRoot(projectDir, true),
    lock = lockFile(root, id);
  return withLock(repairLockFile(root, id), () => {
    if (pathExists(lock)) {
      const stat = fs.lstatSync(lock),
        owner = lockOwner(lock);
      if (owner.state !== 'dead') throw new Error('lock ownership changed; inspect a new plan');
      const again = fs.lstatSync(lock);
      if (stat.ino !== again.ino || stat.dev !== again.dev) throw new Error('lock changed; inspect a new plan');
      fs.unlinkSync(lock);
    }
    withRunLock(root, id, () => {
      const fresh = repairPlan(projectDir, root, id, true);
      const expectedActions = plan.actions.filter((a) => !a.startsWith('clear lock'));
      if (
        fresh.blockers.length ||
        JSON.stringify(fresh.actions) !== JSON.stringify(expectedActions) ||
        JSON.stringify(fresh.notes.filter((n) => n !== 'no automatic changes proposed')) !==
          JSON.stringify(plan.notes.filter((n) => !n.startsWith('lock:') && n !== 'no automatic changes proposed'))
      )
        throw new Error('repair facts changed; inspect a new plan');
      const dir = path.join(root, id),
        file = path.join(dir, 'run.json');
      let record;
      if (fresh.actions.some((a) => a.startsWith('recreate'))) {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        if (fs.lstatSync(file, { throwIfNoEntry: false })) throw new Error('Run record appeared; inspect a new plan');
        const now = new Date().toISOString();
        record = {
          title: id,
          stage: 'define',
          status: 'interrupted',
          status_reason: 'Recreated missing Run record; reconcile existing work before resuming',
          waiting_on_human: false,
          waiting_reason: '',
          activity: 'Reconcile existing work before continuing',
          tickets_total: 0,
          tickets_done: 0,
          check_loops: 0,
          worktree: path.join(projectDir, '.factory', 'worktrees', id),
          commands: '',
          conventions: [],
          created: now,
          updated: now,
          last_seen: now,
        };
      } else if (fresh.actions.some((a) => a.startsWith('adopt'))) record = readRun(projectDir, id).record;
      const pr = fresh.actions.find((a) => a.startsWith('adopt existing PR '));
      if (pr && record)
        record = { ...record, pr: pr.slice('adopt existing PR '.length), updated: new Date().toISOString() };
      if (record) write(dir, { ...record, last_seen: new Date().toISOString() });
    });
  });
}

// Read-only health report: what would stop each Run from carrying on. Finished Runs only report records, locks and uncommitted work.
export async function inspectRuns(projectDir, runsDir, only) {
  const runs = await listRuns(runsDir);
  for (const [id, wt] of ownWorktrees(projectDir)) {
    const existing = runs.find((r) => r.id === id);
    if (!existing) runs.push({ id, orphan: true, worktree: wt.dir, worktreeInfo: wt });
    else if (existing.unreadable && !fs.existsSync(path.join(runsDir, id, 'run.json')))
      Object.assign(existing, { orphan: true, worktree: wt.dir, worktreeInfo: wt });
  }
  const selected = runs.filter((run) => only === undefined || run.id === only);
  if (only !== undefined && !selected.length) throw new Error(`no such Run: ${only}`);
  const listed =
    spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: projectDir, encoding: 'utf8' }).stdout ?? '';
  const known = new Set(
    [...listed.matchAll(/^worktree (.+)$/gm)].map((m) => (fs.existsSync(m[1]) ? fs.realpathSync(m[1]) : m[1])),
  );
  return selected.map(({ id, unreadable, record, orphan, worktree, worktreeInfo }) => {
    const found = [];
    const add = (code, message) => found.push({ code, message });
    if (pathExists(repairLockFile(runsDir, id))) {
      const owner = lockOwner(repairLockFile(runsDir, id));
      add(
        'repair-lock',
        owner.pid
          ? `repair coordination lock: PID ${owner.pid}, host ${owner.host}, started ${owner.started}: ${owner.state}`
          : 'repair coordination lock owner unknown',
      );
    }
    if (pathExists(lockFile(runsDir, id))) {
      const owner = lockOwner(lockFile(runsDir, id));
      add(
        'lock',
        owner.pid
          ? `lock owner PID ${owner.pid}, host ${owner.host}, started ${owner.started}: ${owner.state}`
          : 'lock owner unknown (legacy, unreadable or malformed lock)',
      );
    }
    if (orphan) {
      add('orphan', `registered Run worktree ${worktree} has no Run folder or record`);
      if (worktreeInfo.missing) add('worktree-missing', `the registered Run worktree ${worktree} does not exist`);
      else if (!worktreeInfo.safe)
        add('worktree-unknown', `the registered Run worktree ${worktree} is unsafe or symlinked`);
      else {
        try {
          if (worktreeState({ worktree }).dirty) add('worktree-dirty', 'the Run worktree has uncommitted changes');
        } catch (err) {
          add('worktree-unreadable', err.message);
        }
      }
    } else if (unreadable) add('unreadable', 'run.json is missing or cannot be parsed');
    else {
      // A finished Run only matters here for uncommitted work that would block removing its worktree.
      const active = ['running', 'waiting', ...paused].includes(record.status);
      if (!record.worktree || !fs.existsSync(record.worktree)) {
        if (active) add('worktree-missing', `the Run worktree ${record.worktree ?? '(none recorded)'} does not exist`);
      } else if (!known.has(fs.realpathSync(record.worktree))) {
        if (active) add('worktree-unknown', `git does not list ${record.worktree} as a worktree`);
      } else {
        try {
          const { head, dirty } = worktreeState(record);
          if (dirty) add('worktree-dirty', 'the Run worktree has uncommitted changes');
          // A cheap sign that the Flow was bypassed: project files committed while the Run never left Define. Define may only add its own documents.
          if (active && record.stage === 'define' && record.base_sha) {
            // base_sha comes from a file an agent can edit: only a plain commit id may reach git, never something it would read as an option.
            if (!/^[0-9a-f]{40,64}$/.test(record.base_sha)) throw new Error('base_sha is not a commit id');
            const diff = spawnSync(
              'git',
              ['diff', '--name-only', '--no-renames', '-z', record.base_sha, 'HEAD', '--'],
              { cwd: record.worktree, encoding: 'utf8' },
            );
            if (diff.status !== 0)
              throw new Error(`cannot compare the Run branch with its base: ${(diff.stderr ?? '').trim()}`);
            const outside = diff.stdout
              .split('\0')
              .filter((f) => f && !/^(docs\/|changelog\.d\/|GLOSSARY\.md$)/.test(f));
            if (outside.length)
              add(
                'stage-skipped',
                `the Run is still in Define but its branch changes ${outside.slice(0, 3).join(', ')}${outside.length > 3 ? ' and more' : ''}; a Stage may have been skipped`,
              );
          }
          const seen = [
            record.verify?.head,
            record.accepted?.head,
            ...Object.values(record.reviewed ?? {}).map((r) => r?.head),
            ...Object.values(record.project_results ?? {}).map((r) => r?.head),
          ].filter(Boolean);
          const staleBase = Object.values(record.project_results ?? {}).some((r) => r?.base_sha !== record.base_sha);
          if (active && ['check', 'finish'].includes(record.stage) && (seen.some((h) => h !== head) || staleBase))
            add('stale-evidence', 'Evidence was recorded for an earlier head or base than the current one');
        } catch (err) {
          add('worktree-unreadable', err.message);
        }
      }
    }
    return { id, problems: found };
  });
}
