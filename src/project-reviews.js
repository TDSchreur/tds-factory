import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { targets } from './flow.js';

const baseline = new Set(['standards', 'spec', 'security', 'infrastructure', 'constructor', 'prototype']);
const validId = /^[a-z][a-z0-9-]{0,63}$/;
const text = (v) => typeof v === 'string' && !!v.trim() && !/[\x00-\x1f\x7f]/.test(v);
const plain = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const ownKeys = (x, allowed) => Object.keys(x).every((k) => allowed.includes(k));
const inside = (root, candidate) => candidate === root || candidate.startsWith(root + path.sep);

// Refuse links and special files: project input must not escape its configured Skill directory.
function regularTree(dir) {
  const files = {},
    modes = {};
  let total = 0;
  function visit(current, relative = '') {
    const st = fs.lstatSync(current);
    if (st.isSymbolicLink()) throw new Error(`Skill contains a symlink: ${current}`);
    if (st.isDirectory()) {
      for (const entry of fs.readdirSync(current).sort())
        visit(path.join(current, entry), relative ? `${relative}/${entry}` : entry);
    } else if (st.isFile()) {
      total += st.size;
      if (total > 10 * 1024 * 1024) throw new Error('Skill exceeds 10 MiB');
      files[relative] = fs.readFileSync(current).toString('base64');
      modes[relative] = st.mode & 0o111;
    } else throw new Error(`Skill contains a non-regular file: ${current}`);
  }
  visit(dir);
  if (!Object.hasOwn(files, 'SKILL.md')) throw new Error(`missing SKILL.md in ${dir}`);
  return { files, modes };
}
function safeDirectory(root, relative) {
  if (
    !text(relative) ||
    path.isAbsolute(relative) ||
    relative.split(/[\\/]/).some((s) => !s || s === '.' || s === '..')
  )
    throw new Error(`invalid project Skill path: ${relative}`);
  const canonicalRoot = fs.realpathSync(root);
  let current = canonicalRoot;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Skill path contains a symlink: ${current}`);
  }
  if (!inside(canonicalRoot, fs.realpathSync(current))) throw new Error('Skill path escapes its root');
  return current;
}
function skillDirectory(projectDir, agent, homeDir, skill) {
  if (!plain(skill) || !ownKeys(skill, ['source', 'path', 'name']))
    throw new Error('Skill needs an explicit source and path or name');
  if (skill.source === 'project' && text(skill.path) && skill.name === undefined)
    return safeDirectory(projectDir, skill.path);
  if (
    skill.source === 'installed' &&
    text(skill.name) &&
    /^[a-z0-9][a-z0-9-]*$/.test(skill.name) &&
    skill.path === undefined
  )
    return safeDirectory(path.join(homeDir, targets[agent].global), skill.name);
  throw new Error('Skill must be {source: "project", path: "..."} or {source: "installed", name: "..."}');
}
function readProjectJson(projectDir, name) {
  const file = path.join(projectDir, '.factory', name);
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return undefined;
  if (fs.lstatSync(path.dirname(file)).isSymbolicLink()) throw new Error('.factory must not be a symlink');
  if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error(`${name} must be a regular file under 1 MiB`);
  const source = fs.readFileSync(file, 'utf8');
  try {
    return { source, data: JSON.parse(source) };
  } catch (err) {
    throw new Error(`invalid ${name}: ${err.message}`);
  }
}
// .factory/reviews.json keeps working; the same reviews may also sit under "reviews" in .factory/config.json. IDs are unique across both.
export function loadProjectReviews(projectDir, agent, homeDir = os.homedir()) {
  const legacy = readProjectJson(projectDir, 'reviews.json');
  if (legacy && (!plain(legacy.data) || !ownKeys(legacy.data, ['reviews']) || !Array.isArray(legacy.data.reviews)))
    throw new Error('reviews.json must contain a reviews array');
  const config = readProjectJson(projectDir, 'config.json');
  const configured = config && plain(config.data) && Array.isArray(config.data.reviews) ? config.data.reviews : [];
  const ids = new Set();
  return [...(legacy?.data.reviews ?? []), ...configured].map((review) =>
    parseReview(review, ids, projectDir, agent, homeDir),
  );
}
function parseReview(review, ids, projectDir, agent, homeDir) {
  if (!plain(review) || !ownKeys(review, ['id', 'name', 'mode', 'skill', 'patterns', 'runtime']))
    throw new Error('invalid project review fields');
  const { id, name, mode, skill, patterns, runtime } = review;
  if (!text(id) || !validId.test(id) || baseline.has(id) || ids.has(id))
    throw new Error(`invalid, duplicate or reserved review ID: ${id}`);
  ids.add(id);
  if (!text(name)) throw new Error(`${id}: review needs a name`);
  if (!['source', 'interactive'].includes(mode)) throw new Error(`${id}: mode must be source or interactive`);
  if (
    patterns !== undefined &&
    (!Array.isArray(patterns) ||
      !patterns.length ||
      patterns.some((p) => !text(p) || p.startsWith('/') || p.split('/').includes('..') || /[[\]{}!\\]/.test(p)))
  )
    throw new Error(`${id}: patterns must be nonempty relative globs using *, ** and ?`);
  if (
    mode === 'interactive' &&
    (!plain(runtime) ||
      !ownKeys(runtime, ['start', 'ready', 'setup']) ||
      !text(runtime.start) ||
      !text(runtime.ready) ||
      !text(runtime.setup))
  )
    throw new Error(`${id}: interactive review needs runtime start, ready and setup`);
  if (mode === 'source' && runtime !== undefined) throw new Error(`${id}: runtime is only for interactive reviews`);
  let snapshot;
  try {
    snapshot = regularTree(skillDirectory(projectDir, agent, homeDir, skill));
  } catch (err) {
    throw new Error(`${id}: cannot load Skill: ${err.message}`);
  }
  return { id, name, mode, skill, ...(patterns ? { patterns } : {}), ...(runtime ? { runtime } : {}), ...snapshot };
}
function globRegex(pattern) {
  let result = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        i++;
        if (pattern[i + 1] === '/') {
          i++;
          result += '(?:.*/)?';
        } else result += '.*';
      } else result += '[^/]*';
    } else if (c === '?') result += '[^/]';
    else result += /[.()+^$|\\]/.test(c) ? `\\${c}` : c;
  }
  return new RegExp(result + '$');
}
export function reviewPlan(record) {
  const result = spawnSync('git', ['diff', '--name-only', '--no-renames', '-z', record.base_sha, 'HEAD', '--'], {
    cwd: record.worktree,
    encoding: 'utf8',
  });
  if (result.status !== 0)
    throw new Error(`cannot determine Run changes: ${(result.stderr || result.error?.message || '').trim()}`);
  const changed = result.stdout.split('\0').filter(Boolean);
  return (record.project_reviews ?? []).map((review) => {
    const matched = review.patterns
      ? changed.filter((file) => review.patterns.some((p) => globRegex(p).test(file)))
      : changed;
    const applicable = !review.patterns || matched.length > 0;
    return {
      ...review,
      encoded_files: review.files,
      files: Object.fromEntries(
        Object.entries(review.files).flatMap(([name, data]) => {
          const bytes = Buffer.from(data, 'base64');
          const decoded = bytes.toString('utf8');
          return !bytes.includes(0) && Buffer.from(decoded, 'utf8').equals(bytes) ? [[name, decoded]] : [];
        }),
      ),
      applicable,
      matched,
      ...(applicable ? {} : { reason: 'No changed file matches the review patterns' }),
    };
  });
}

export { readProjectJson };
