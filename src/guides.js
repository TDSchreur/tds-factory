import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readRun } from './run-folder.js';

// Instruction guides are the Markdown files AGENTS.md or CLAUDE.md links to. A guide may declare `applyTo` globs in its frontmatter
// (Copilot's format); a guide without them is unscoped and applies to every Run. See ADR 0022.
const CONVENTION_FILES = ['AGENTS.md', 'CLAUDE.md'];
const MAX_FILE = 1 << 20;

const readFile = (file) => {
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size > MAX_FILE) return undefined;
  return fs.readFileSync(file, 'utf8');
};

// A glob is repo-relative with `/` separators: `*` stays inside a folder, `**` crosses folders, `?` is one character.
// A glob without a `/` matches the file name at any depth, as `*.js` does in a .gitignore.
export function globToRegExp(glob) {
  const pattern = glob.includes('/') ? glob.replace(/^\.\//, '') : `**/${glob}`;
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') { out += '(?:.*/)?'; i += 2; } else { out += '.*'; i += 1; }
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

export const matchesGlob = (file, globs) => globs.some((g) => globToRegExp(g).test(file));

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
    const bad = globs.find((g) => g.startsWith('/') || g.split('/').includes('..') || /[\x00-\x1f]/.test(g));
    if (bad) return { problem: { line: i + 1, message: `applyTo glob "${bad}" must be relative to the repository and stay inside it` } };
    return { globs };
  }
  return { globs: [] };
}

export const conventionsFile = (projectDir) => CONVENTION_FILES.find((f) => fs.statSync(path.join(projectDir, f), { throwIfNoEntry: false })?.isFile());

// Markdown links, plus backticked paths that exist, to other Markdown files inside the project. Only a link can be reported missing.
export function linkedGuides(projectDir) {
  const file = conventionsFile(projectDir);
  const text = file && readFile(path.join(projectDir, file));
  if (!text) return [];
  const found = new Map();
  const add = (raw, link) => {
    const target = raw.split('#')[0].trim();
    if (!/\.md$/i.test(target) || /^[a-z][a-z0-9+.-]*:/i.test(target) || path.isAbsolute(target)) return;
    const rel = path.posix.normalize(target.replace(/\\/g, '/'));
    if (rel.startsWith('..') || CONVENTION_FILES.includes(rel) || /[<>*]/.test(rel)) return;
    const exists = !!fs.statSync(path.join(projectDir, rel), { throwIfNoEntry: false })?.isFile();
    if (link || exists) found.set(rel, { path: rel, exists });
  };
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) add(m[1], true);
  for (const m of text.matchAll(/`([^`\n]+\.md)`/gi)) add(m[1], false);
  return [...found.values()];
}

// Every linked guide with its globs; a missing guide or a bad applyTo comes back as a problem.
export function loadGuides(projectDir) {
  return linkedGuides(projectDir).map(({ path: rel, exists }) => {
    if (!exists) return { path: rel, globs: [], problem: { line: 1, message: 'the linked guide does not exist' } };
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
  const out = spawnSync('git', ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '-z', '--name-only', record.base_sha], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (out.status !== 0) throw new Error(`git diff failed: ${(out.stderr || '').trim()}`);
  const files = out.stdout.split('\0').filter(Boolean);
  const guides = loadGuides(root);
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
