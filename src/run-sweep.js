import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readRun } from './run-folder.js';

// Read-only: lists where the terms a Run changed still occur in the documents, so a stale statement is found while building.
const MAX_TERMS = 25;
const PER_TERM = 40;
const TOTAL = 250;
const TOO_COMMON = 100;
const LINE = 160;
const MAX_FILE = 1 << 20;
const SKIP = new Set(['.git', 'node_modules', '.factory', 'vendor']);
const ROOT_DOCS = ['README.md', 'CONTRIBUTING.md', 'GLOSSARY.md', 'AGENTS.md', 'CLAUDE.md', 'SECURITY.md'];
const DOC_DIRS = ['docs', 'skills', 'agents', 'changelog.d'];
const REPLACED_NOTE = /^[_>].*\b(?:replaced|changed|superseded) by\b/im;
const clean = (text) => text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '?');

const git = (cwd, ...args) => {
  const out = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (out.status !== 0) throw new Error(`git ${args[0]} failed: ${(out.stderr || out.error?.message || '').trim()}`);
  return out.stdout;
};

// Backticked terms, --flags, quoted phrases, snake_case and camelCase identifiers on the added and removed lines, most frequent first.
function termsFromDiff(diff) {
  const counts = new Map();
  const add = (raw) => {
    const term = raw.trim();
    if (term.length < 3 || term.endsWith('/')) return;
    const key = term.toLowerCase();
    const seen = counts.get(key);
    if (seen) seen.n += 1; else counts.set(key, { term, n: 1, order: counts.size });
  };
  for (const line of diff.split('\n')) {
    if (!/^[+-]/.test(line) || /^(\+\+\+|---)/.test(line)) continue;
    const text = line.slice(1);
    for (const m of text.matchAll(/`([^`\n]{3,60})`/g)) add(m[1]);
    for (const m of text.matchAll(/(?<![\w-])--[a-z][a-z0-9-]{2,}/g)) add(m[0]);
    for (const m of text.matchAll(/"([^"\n]{5,60})"/g)) add(m[1]);
    for (const m of text.matchAll(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g)) if (m[0].length >= 5) add(m[0]);
    for (const m of text.matchAll(/\b[a-z]+(?:[A-Z][a-z0-9]+)+\b/g)) if (m[0].length >= 6) add(m[0]);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.order - b.order).slice(0, MAX_TERMS).map((x) => x.term);
}

// The documents the sweep reads: regular Markdown and TOML files of sane size, never links.
function documents(root) {
  const found = [];
  const take = (file) => {
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat || !stat.isFile() || stat.size >= MAX_FILE || !/\.(md|toml)$/.test(file)) return;
    found.push(file);
  };
  const walk = (dir) => {
    const stat = fs.lstatSync(dir, { throwIfNoEntry: false });
    if (!stat || !stat.isDirectory()) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name) || entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full); else take(full);
    }
  };
  for (const name of ROOT_DOCS) take(path.join(root, name));
  for (const dir of DOC_DIRS) walk(path.join(root, dir));
  return found.sort();
}

export function sweepRun(projectDir, id, extra = []) {
  const { record } = readRun(projectDir, id);
  const root = record.worktree;
  if (!root || !fs.existsSync(root)) throw new Error('the Run worktree is missing');
  if (!/^[0-9a-f]{40,64}$/.test(record.base_sha ?? '')) throw new Error('the Run has no usable base commit');
  const plain = ['--no-ext-diff', '--no-textconv', '--no-color'];
  const diff = git(root, 'diff', ...plain, record.base_sha);
  const changed = new Set(git(root, 'diff', ...plain, '--name-only', record.base_sha).split('\n').filter(Boolean));
  const fromDiff = termsFromDiff(diff);
  const given = [...new Set(extra.map((t) => t.trim()).filter(Boolean))];
  const terms = [...fromDiff, ...given.filter((t) => !fromDiff.some((d) => d.toLowerCase() === t.toLowerCase()))];
  const files = documents(root).map((file) => {
    const rel = path.relative(root, file).split(path.sep).join('/');
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const replaced = rel.startsWith('docs/specs/archive/') || REPLACED_NOTE.test(lines.slice(0, 12).join('\n'));
    return { rel, lines, replaced, changed: changed.has(rel) };
  });
  const results = terms.map((term) => {
    const needle = term.toLowerCase();
    const hits = { current: [], replaced: [] };
    for (const f of files) f.lines.forEach((text, i) => {
      if (text.toLowerCase().includes(needle)) hits[f.replaced ? 'replaced' : 'current'].push({ file: f.rel, line: i + 1, text, changed: f.changed });
    });
    return { term, ...hits };
  });
  return { id, base: record.base_sha, fromDiff: fromDiff.length, given: terms.length - fromDiff.length, files: files.length, results };
}

export function formatSweep(report) {
  const out = [`Term sweep for ${report.id}: ${report.fromDiff} term(s) from the diff, ${report.given} given with --term, ${report.files} documents searched.`];
  if (!report.results.length) { out.push('no terms found in the diff and none given with --term'); return out.join('\n'); }
  let budget = TOTAL, cut = 0;
  const show = (hits, perTerm) => {
    const take = hits.slice(0, Math.max(0, Math.min(perTerm, budget)));
    budget -= take.length;
    const left = hits.length - take.length;
    cut += left;
    return { lines: take.map((h) => `    ${clean(h.file)}:${h.line}: ${clean(h.text.trim().slice(0, LINE))}${h.changed ? ' [changed]' : ''}`), left };
  };
  for (const { term, current, replaced } of report.results) {
    out.push('', `== ${clean(term)}: ${current.length + replaced.length} hit(s) in ${new Set([...current, ...replaced].map((h) => h.file)).size} file(s)`);
    if (current.length + replaced.length > TOO_COMMON) { out.push(`    too common to list (${current.length + replaced.length} hits); search a narrower wording with --term`); continue; }
    const a = show(current, PER_TERM);
    out.push(...a.lines);
    if (a.left) out.push(`    ${a.left} more hits left out`);
    if (replaced.length) {
      out.push(`  marked as replaced (${replaced.length}):`);
      const b = show(replaced, Math.max(0, PER_TERM - a.lines.length));
      out.push(...b.lines);
      if (b.left) out.push(`    ${b.left} more hits left out`);
    }
  }
  if (cut) out.push('', `${cut} hit(s) left out in total; narrow the terms with --term to see them.`);
  return out.join('\n');
}
