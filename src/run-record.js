import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const stages = ['define', 'prepare', 'build', 'check', 'finish'];
const statuses = ['running', 'waiting', 'done', 'abandoned'];
const strings = ['title', 'activity', 'waiting_reason', 'commands', 'spec_link', 'pr'];
const lists = ['conventions', 'tickets'];
const numbers = ['tickets_total', 'tickets_done', 'check_loops'];
const verdicts = ['standards', 'spec', 'security', 'infrastructure'];
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
      : key === 'agent' ? ['claude', 'codex', 'copilot'].includes(value)
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
  if (result.status === 'waiting') {
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
export function startRun(projectDir, data) {
  validate(data);
  if (!data.title || !data.agent || typeof data.commands !== 'string' || !Array.isArray(data.conventions)) throw new Error('title, agent, commands and conventions are required');
  const slug = data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'run';
  const base = `${new Date().toISOString().slice(0, 10)}-${slug}`;
  const root = path.join(projectDir, '.factory', 'runs'); fs.mkdirSync(root, { recursive: true });
  let id = base, n = 2;
  while (true) { try { fs.mkdirSync(path.join(root, id)); break; } catch (err) { if (err.code !== 'EEXIST') throw err; id = `${base}-${n++}`; } }
  const now = new Date().toISOString();
  try { write(path.join(root, id), apply({ stage: 'define', status: 'running', waiting_on_human: false, waiting_reason: '', activity: 'Starting Define', tickets_total: 0, tickets_done: 0, check_loops: 0, created: now }, data)); }
  catch (err) { fs.rmdirSync(path.join(root, id)); throw err; }
  return id;
}
export function updateRun(projectDir, id, data) {
  if (!validId(id)) throw new Error('invalid Run id');
  const root = fs.realpathSync(path.join(projectDir, '.factory', 'runs'));
  const dir = path.join(root, id);
  if (fs.realpathSync(dir) !== dir) throw new Error('Run folder must not be a symlink');
  const file = path.join(dir, 'run.json');
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Run record must not be a symlink');
  const old = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!old || typeof old !== 'object' || Array.isArray(old)) throw new Error('Run record must be an object');
  write(dir, apply(old, data));
}

const str = (v) => typeof v === 'string' ? v.trim() : '';
const strList = (v) => Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : [];
export function interpretRun(entry) {
  const id = str(entry?.id), files = strList(entry?.files);
  if (!entry || entry.unreadable || !entry.record || typeof entry.record !== 'object') return { id, unreadable: true, title: id || 'Unknown run', activity: '', agent: '', waiting: false, reason: '', column: 'define', updated: '', files, links: [], status: '', pr: '' };
  const r = entry.record, status = str(r.status), stage = str(r.stage).toLowerCase();
  const num = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
  const verdict = (v, skip) => { v = str(v).toLowerCase(); return v === 'pass' || v === 'fail' || (skip && v === 'skipped') ? v : ''; };
  const links = [];
  for (const [label, values] of [['Spec', r.spec_link], ['Ticket', r.tickets], ['PR', r.pr]]) for (const value of Array.isArray(values) ? values : [values]) if (str(value)) links.push({ label, href: str(value) });
  return { id, unreadable: false, column: ['done', 'abandoned'].includes(status) ? 'done' : stages.includes(stage) ? stage : 'define', status, pr: str(r.pr), ticketsDone: num(r.tickets_done), ticketsTotal: num(r.tickets_total), standards: verdict(r.standards), spec: verdict(r.spec), security: verdict(r.security), infrastructure: verdict(r.infrastructure, true), loops: num(r.check_loops), waiting: !['done', 'abandoned'].includes(status) && (r.waiting_on_human === true || status === 'waiting'), reason: str(r.waiting_reason), title: str(r.title) || id || 'Untitled run', activity: str(r.activity), agent: str(r.agent), updated: str(r.updated), files, links };
}
