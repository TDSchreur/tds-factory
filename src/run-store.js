import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { stages, targets } from './flow.js';

const statuses = ['running', 'waiting', 'done', 'abandoned'];
const strings = ['title', 'activity', 'waiting_reason', 'commands', 'spec_link', 'pr', 'worktree', 'base_sha'];
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
  try {
    const worktree = path.join(worktrees, id);
    const added = git('worktree', 'add', '-b', id, worktree, commit.stdout.trim());
    if (added.status !== 0) throw new Error(`git worktree add failed: ${added.stderr.trim()}`);
    write(path.join(root, id), apply({ stage: 'define', status: 'running', waiting_on_human: false, waiting_reason: '', activity: 'Starting Define', tickets_total: 0, tickets_done: 0, check_loops: 0, created: now }, { ...data, worktree, base_sha: commit.stdout.trim() }));
  } catch (err) { fs.rmdirSync(path.join(root, id)); throw err; }
  return id;
}
function withRunLock(root, id, action) {
  const lock = path.join(root, `.lock-${createHash('sha256').update(id).digest('hex')}`);
  const fd = fs.openSync(lock, 'wx');
  try { return action(); }
  finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
// Reads a Run record under its lock, hands it to change, and writes back what change returns.
function changeRun(projectDir, id, change) {
  if (!validId(id)) throw new Error('invalid Run id');
  const root = runRoot(projectDir, false);
  return withRunLock(root, id, () => {
    const dir = path.join(root, id);
    if (fs.realpathSync(dir) !== dir) throw new Error('Run folder must not be a symlink');
    const file = path.join(dir, 'run.json');
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Run record must not be a symlink');
    const old = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!old || typeof old !== 'object' || Array.isArray(old)) throw new Error('Run record must be an object');
    write(dir, change(old));
  });
}
function updateRun(projectDir, id, data) {
  changeRun(projectDir, id, (old) => {
    validate(data);
    const locked = gated.find((key) => key in data);
    if (locked) throw new Error(`${locked} can only change through a Run transition`);
    if (data.status === 'done') throw new Error('a Run is completed with run complete');
    if ('status' in data && ['done', 'abandoned'].includes(old.status)) throw new Error(`a ${old.status} Run cannot change status`);
    return apply(old, data);
  });
}

// Transitions take only an optional activity line besides their own arguments.
function moveRun(projectDir, id, data, move) {
  validate(data);
  if (Object.keys(data).some((key) => key !== 'activity')) throw new Error('a transition accepts only activity');
  changeRun(projectDir, id, (old) => {
    if (old.status !== 'running') throw new Error(`a ${old.status} Run cannot be changed this way, only a running one`);
    const { record, activity } = move(old);
    return { ...record, activity: data.activity ?? activity, updated: new Date().toISOString() };
  });
}
function transitionRun(projectDir, id, to, data = {}) {
  moveRun(projectDir, id, data, (old) => {
    const next = stages[stages.indexOf(old.stage) + 1];
    if (!stages.includes(to) || to !== next) throw new Error(`a Run in ${old.stage} can only move to ${next ?? 'nowhere'}, not ${to}`);
    if (to === 'build') {
      const missing = [!old.spec_link && 'a Spec link', !(old.tickets?.length > 0) && 'Tickets'].filter(Boolean);
      if (missing.length) throw new Error(`Build needs ${missing.join(' and ')}`);
    }
    if (to === 'check' && old.tickets_done !== old.tickets_total) throw new Error(`Check needs every Ticket done (${old.tickets_done} of ${old.tickets_total})`);
    if (to === 'finish') throw new Error('Finish needs a clean or Accepted Check');
    return { record: { ...old, stage: to }, activity: `Starting ${to}` };
  });
}
function reworkRun(projectDir, id, data = {}) {
  moveRun(projectDir, id, data, (old) => {
    if (old.stage !== 'check') throw new Error('only a Run in Check can be sent back to Build');
    if ((old.check_loops ?? 0) >= 2) throw new Error('the Check loop limit of 2 is reached');
    const record = { ...old, stage: 'build', check_loops: (old.check_loops ?? 0) + 1 };
    for (const key of [...verdicts, 'verify', 'reviewed', 'accepted']) delete record[key];
    return { record, activity: 'Rework: back to Build' };
  });
}
function completeRun(projectDir, id, data = {}) {
  moveRun(projectDir, id, data, (old) => {
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
  if (!validId(id)) throw new Error('invalid Run id');
  const dir = path.join(runRoot(projectDir, false), id);
  if (fs.realpathSync(dir) !== dir) throw new Error('Run folder must not be a symlink');
  const record = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
  if (record.status !== 'running') throw new Error(`a ${record.status} Run cannot be verified, only a running one`);
  if (!record.commands) throw new Error('the Run has no Verify command');
  const { head, dirty } = worktreeState(record);
  const started = new Date().toISOString();
  const fd = fs.openSync(path.join(dir, 'verify.log'), 'w');
  let ran;
  try { ran = spawnSync(record.commands, { cwd: record.worktree, shell: true, stdio: ['ignore', fd, fd] }); }
  finally { fs.closeSync(fd); }
  const result = { command: record.commands, cwd: record.worktree, head, dirty, exit_code: ran.status ?? 1, started, ended: new Date().toISOString(), log: 'verify.log' };
  changeRun(projectDir, id, (old) => ({ ...old, verify: result, updated: new Date().toISOString() }));
  return result;
}
function verdictRun(projectDir, id, axis, value) {
  if (!verdicts.includes(axis)) throw new Error(`unknown Check axis: ${axis}`);
  validate({ [axis]: value });
  moveRun(projectDir, id, {}, (old) => {
    if (old.stage !== 'check') throw new Error('verdicts are recorded in Check');
    const { head, dirty } = worktreeState(old);
    if (value !== 'fail' && dirty) throw new Error(`cannot record ${value} for ${axis}: the Run worktree has uncommitted changes`);
    return { record: { ...old, [axis]: value, reviewed: { ...old.reviewed, [axis]: { head, attempt: (old.check_loops ?? 0) + 1 } } }, activity: `${axis} verdict: ${value}` };
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
    verify: (id) => verifyRun(projectDir, id),
    verdict: (id, axis, value) => verdictRun(projectDir, id, axis, value),
    list: () => listRuns(runsDir),
    readFile: (rawPath) => readRunFile(runsDir, rawPath),
    remove: (id) => removeRun(projectDir, id),
  };
}
