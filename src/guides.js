import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readRun } from './run-folder.js';

// Instruction guides are the Markdown files AGENTS.md or CLAUDE.md links to. A guide may declare `applyTo` globs in its frontmatter
// (Copilot's format); a guide without them is unscoped and applies to every Run. See ADR 0022.
const CONVENTION_FILES = ['AGENTS.md', 'CLAUDE.md'];
const MAX_FILE = 1 << 20;

// True when `file` resolves, symbolic links included, to a place inside the project.
export function insideProject(projectDir, file) {
  try {
    const root = fs.realpathSync(projectDir);
    const rel = path.relative(root, fs.realpathSync(file));
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  } catch { return false; }
}

const readFile = (file) => {
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size > MAX_FILE) return undefined;
  return fs.readFileSync(file, 'utf8');
};

// A glob is repo-relative with `/` separators: `*` stays inside a folder, `**` as a whole segment crosses folders, `?` is one character.
// A glob without a `/` matches the file name at any depth, as `*.js` does in a .gitignore. No regular expression is built from a glob,
// so a hostile glob cannot make the match take more than a few steps per character of path and glob (ADR 0022).
export const MAX_GLOB_LENGTH = 200;

// One path segment against one glob segment, with the linear two-pointer walk that remembers only the last `*`.
function segmentMatches(name, pattern) {
  let n = 0, p = 0, star = -1, mark = 0;
  while (n < name.length) {
    if (p < pattern.length && (pattern[p] === '?' || pattern[p] === name[n])) { n++; p++; }
    else if (p < pattern.length && pattern[p] === '*') { star = p++; mark = n; }
    else if (star >= 0) { p = star + 1; n = ++mark; }
    else return false;
  }
  while (pattern[p] === '*') p++;
  return p === pattern.length;
}

export function globMatches(file, glob) {
  const pattern = (glob.includes('/') ? glob.replace(/^\.\//, '') : `**/${glob}`).split('/').map((seg) => (/^\*{2,}$/.test(seg) ? '**' : seg.replace(/\*+/g, '*')));
  const parts = file.split('/');
  // reachable[i] after pattern segment k: path segments consumed so far.
  let reachable = new Set([0]);
  pattern.forEach((seg, k) => {
    const next = new Set();
    for (const i of reachable) {
      if (seg === '**') {
        // A final `**` needs at least one segment below it; elsewhere it may match none.
        for (let j = k === pattern.length - 1 ? i + 1 : i; j <= parts.length; j++) next.add(j);
      } else if (i < parts.length && segmentMatches(parts[i], seg)) next.add(i + 1);
    }
    reachable = next;
  });
  return reachable.has(parts.length);
}

export const matchesGlob = (file, globs) => globs.some((g) => globMatches(file, g));

// Reads the frontmatter of a guide. Returns { globs } (empty when unscoped) or { problem: { line, message } }.
export function parseGuide(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { globs: [] };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end < 0) return { globs: [] };
  for (let i = 1; i < end; i++) {
    const found = lines[i].match(/^applyTo\s*:\s*(.*)$/);
    if (!found) continue;
    let value = found[1].trim();
    const quote = value[0] === '"' || value[0] === "'" ? value[0] : '';
    if (quote) {
      if (value.length < 2 || !value.endsWith(quote)) return { problem: { line: i + 1, message: 'applyTo has an unclosed quote' } };
      value = value.slice(1, -1);
    }
    const globs = value.split(',').map((g) => g.trim());
    if (!value.trim() || globs.some((g) => !g)) return { problem: { line: i + 1, message: 'applyTo must be one glob or a comma-separated list of globs' } };
    const long = globs.find((g) => g.length > MAX_GLOB_LENGTH);
    if (long) return { problem: { line: i + 1, message: `an applyTo glob is longer than ${MAX_GLOB_LENGTH} characters` } };
    const bad = globs.find((g) => g.startsWith('/') || g.split('/').includes('..') || /[\x00-\x1f]/.test(g));
    if (bad) return { problem: { line: i + 1, message: `applyTo glob ${JSON.stringify(bad)} must be relative to the repository and stay inside it` } };
    return { globs };
  }
  return { globs: [] };
}

export const conventionsFile = (projectDir) => CONVENTION_FILES.find((f) => fs.statSync(path.join(projectDir, f), { throwIfNoEntry: false })?.isFile());

// Markdown links, plus backticked paths that exist, to other Markdown files inside the project. Only a link can be reported missing.
export function linkedGuides(projectDir) {
  const file = conventionsFile(projectDir);
  if (!file) return [];
  const text = readFile(path.join(projectDir, file));
  if (text === undefined) throw new Error(`${file} is not a regular file of at most 1 MiB`);
  const found = new Map();
  const add = (raw, link) => {
    const target = raw.split('#')[0].trim();
    if (!/\.md$/i.test(target) || /^[a-z][a-z0-9+.-]*:/i.test(target) || path.isAbsolute(target)) return;
    const rel = path.posix.normalize(target.replace(/\\/g, '/'));
    if (rel.startsWith('..') || CONVENTION_FILES.includes(rel) || /[<>*\x00-\x1f]/.test(rel)) return;
    const exists = !!fs.statSync(path.join(projectDir, rel), { throwIfNoEntry: false })?.isFile();
    if (link || exists) found.set(rel, { path: rel, exists });
  };
  for (const m of text.matchAll(/\[[^\]\n]{0,200}\]\(([^)\s]{1,300})\)/g)) add(m[1], true);
  for (const m of text.matchAll(/`([^`\n]{1,300}\.md)`/gi)) add(m[1], false);
  return [...found.values()];
}

// A path the coordinator recorded in `conventions`: a Markdown file inside the project, other than the conventions file itself.
function normalizeGuidePath(projectDir, raw) {
  if (typeof raw !== 'string' || !/\.md$/i.test(raw) || path.isAbsolute(raw) || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return undefined;
  const rel = path.posix.normalize(raw.replace(/\\/g, '/'));
  if (rel.startsWith('..') || CONVENTION_FILES.includes(rel) || /[\x00-\x1f]/.test(rel)) return undefined;
  return { path: rel, exists: !!fs.statSync(path.join(projectDir, rel), { throwIfNoEntry: false })?.isFile() };
}

// Every guide with its globs, from the links in the conventions file or from the paths given; a missing guide or a bad applyTo comes back as a problem.
export function loadGuides(projectDir, only) {
  return (only ? only.map((p) => normalizeGuidePath(projectDir, p)).filter(Boolean) : linkedGuides(projectDir)).map(({ path: rel, exists }) => {
    if (!exists) return { path: rel, globs: [], problem: { line: 1, message: 'the linked guide does not exist' } };
    if (!insideProject(projectDir, path.join(projectDir, rel))) return { path: rel, globs: [], problem: { line: 1, message: 'the guide resolves to a place outside the project' } };
    const text = readFile(path.join(projectDir, rel));
    if (text === undefined) return { path: rel, globs: [], problem: { line: 1, message: 'the guide is not a regular file of at most 1 MiB' } };
    return { path: rel, ...parseGuide(text) };
  });
}

export function guidesCheck(projectDir) {
  const guides = loadGuides(projectDir);
  const bad = guides.filter((g) => g.problem);
  if (bad.length) return ['fail', bad.map((g) => `${g.path}:${g.problem.line}: ${g.problem.message}`).join('; ')];
  const scoped = guides.filter((g) => g.globs.length).length;
  return ['pass', guides.length ? `${guides.length} instruction guide(s), ${scoped} scoped by applyTo` : 'no instruction guides linked'];
}

// The guides that apply to a diff: the unscoped ones and the scoped ones with a glob that matches a changed file.
export function guidesForFiles(guides, files) {
  return guides.filter((g) => !g.problem && (!g.globs.length || files.some((f) => matchesGlob(f, g.globs))));
}

export function guidesRun(projectDir, id) {
  const { record } = readRun(projectDir, id);
  const root = record.worktree;
  if (!root || !fs.existsSync(root)) throw new Error('the Run worktree is missing');
  if (!/^[0-9a-f]{40,64}$/.test(record.base_sha ?? '')) throw new Error('the Run has no usable base commit');
  const out = spawnSync('git', ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames', '-z', '--name-only', record.base_sha], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (out.status !== 0) throw new Error(`git diff failed: ${(out.stderr || '').trim()}`);
  const files = out.stdout.split('\0').filter(Boolean);
  const guides = loadGuides(root, record.conventions ?? []);
  const broken = guides.find((g) => g.problem);
  if (broken) throw new Error(`${broken.path}:${broken.problem.line}: ${broken.problem.message}`);
  const applying = guidesForFiles(guides, files);
  return { files: files.length, guides: applying.map((g) => ({ path: g.path, applyTo: g.globs })), skipped: guides.length - applying.length };
}

// One guide per line, safe to print: control characters in a path become `?`.
export function formatGuides(result) {
  const clean = (t) => t.replace(/[\x00-\x1f\x7f-\x9f]/g, '?');
  const lines = result.guides.map((g) => `${clean(g.path)} (${g.applyTo.length ? `applyTo ${g.applyTo.map(clean).join(', ')}` : 'unscoped'})`);
  lines.push(`${result.guides.length} guide(s) apply to ${result.files} changed file(s); ${result.skipped} scoped guide(s) do not.`);
  return lines.join('\n');
}
