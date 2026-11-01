import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readRun } from './run-folder.js';

// Read-only: lists where the terms a Run changed still occur in the documents, so a stale statement is found while building.
const MAX_TERMS = 25;
const MAX_GONE = 15;
const MAX_MEMBERS = 20;
const MAX_SIBLINGS = 12;
const MAX_TOKENS = 30;
const MAX_CLAIMS = 40;
const CLAIM = /\b(?:linear|bounded|constant[- ]time|safe|safely|sanitized|injection-proof)\b|\bO\([^()\n]{1,20}\)/i;
const PER_TERM = 40;
const TO_READ = 15;
const TOTAL = 250;
const TOO_COMMON = 100;
const LINE = 160;
const MAX_FILE = 1 << 20;
const SKIP = new Set(['.git', 'node_modules', '.factory', 'vendor']);
const ROOT_DOCS = ['README.md', 'CONTRIBUTING.md', 'GLOSSARY.md', 'AGENTS.md', 'CLAUDE.md', 'SECURITY.md'];
const DOC_DIRS = ['docs', 'skills', 'agents', 'changelog.d'];
// User-facing text that lives in code: the command line help and the Dashboard help. Other source files and their error messages are not searched.
const CODE_FILES = ['bin/tds-factory.js', 'dashboard/help.js'];
const REPLACED_NOTE = /^[_>].*\b(?:replaced|changed|superseded) by\b/im;
// Newlines and tabs go too: a file name with a newline must not be able to add a line of its own.
const clean = (text) =>
  text.replace(/\t/g, ' ').replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, '?');

const git = (cwd, ...args) => {
  const out = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (out.status !== 0) throw new Error(`git ${args[0]} failed: ${(out.stderr || out.error?.message || '').trim()}`);
  return out.stdout;
};

const NUMBER =
  /(?<![\w.])\d+(?:[.,]\d+)?(?: ?%| ?(?:KB|MB|GB|bytes?|files?|loops?|lines?|characters?|chars|seconds?|minutes?|ms|times|Tickets?|axes|steps?|passes|Reworks?)\b)/gi;
const MAX_HEADING_LINE = 200;
// No regular expression over the whole line: a long run of spaces would make a trailing-space pattern quadratic, so long lines are skipped first.
const headingOf = (text) => {
  if (text.length > MAX_HEADING_LINE) return null;
  const marks = /^#{1,6}[ \t]+/.exec(text);
  if (!marks) return null;
  const title = text
    .slice(marks[0].length)
    .trimEnd()
    .replace(/(?:[ \t]+#+)$/, '')
    .trim();
  return title.length >= 2 && title.length <= 60 ? title : null;
};
const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .trim()
    .replace(/ /g, '-');

// Numbers with a unit and headings that only the removed lines hold: a changed cap or a moved section leaves these behind in other documents.
function goneTerms(diff) {
  const side = { '-': new Map(), '+': new Map() };
  for (const line of diff.split('\n')) {
    const mark = line[0];
    if (!side[mark] || line.startsWith('+++') || line.startsWith('---')) continue;
    const text = line.slice(1);
    const put = (term) => {
      const key = term.toLowerCase();
      if (!side[mark].has(key)) side[mark].set(key, term);
    };
    for (const m of text.matchAll(NUMBER)) put(m[0].trim());
    const heading = headingOf(text);
    if (heading) {
      put(heading);
      put(`#${slug(heading)}`);
    }
  }
  return [...side['-']]
    .filter(([key]) => !side['+'].has(key))
    .map(([, term]) => term)
    .filter((t) => t.length >= 3)
    .slice(0, MAX_GONE);
}

const tokens = (text) => [...text.matchAll(/`([^`\n]{1,40})`/g)].slice(0, MAX_TOKENS).map((m) => m[1]);

// Added and removed lines per file, so a member added to a list and the lines that claim something can be told apart.
function changedLines(diff) {
  const files = new Map();
  let file = null,
    header = false;
  // Only a line between `diff --git` and the first `@@` is a file header; the same text in a hunk is content.
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      header = true;
      file = null;
      continue;
    }
    if (line.startsWith('@@')) header = false;
    if (header) {
      if (line.startsWith('+++ ')) {
        const m = /^\+\+\+ b\/(.+)$/.exec(line);
        file = m ? m[1] : null;
        if (file && !files.has(file)) files.set(file, { added: [], removed: [] });
      }
      continue;
    }
    if (!file) continue;
    if (line[0] === '+') files.get(file).added.push(line.slice(1));
    else if (line[0] === '-') files.get(file).removed.push(line.slice(1));
  }
  return files;
}

// A list is a line with at least three backticked names. A member only the added (or only the removed) lines of a file hold is the change; its siblings are the other names on that line.
function listChanges(files) {
  const found = new Map();
  for (const { added, removed } of files.values()) {
    const had = (lines) => new Set(lines.flatMap(tokens));
    const before = had(removed),
      after = had(added);
    for (const [lines, other, kind] of [
      [added, before, 'added'],
      [removed, after, 'removed'],
    ]) {
      for (const line of lines) {
        const names = tokens(line);
        if (names.length < 3) continue;
        for (const member of names) {
          if (other.has(member)) continue;
          const siblings = names.filter((n) => n !== member && before.has(n) && after.has(n));
          const key = `${kind}\0${member}`;
          const known = found.get(key) ?? { member, kind, siblings: new Set() };
          for (const n of siblings) if (known.siblings.size < MAX_SIBLINGS) known.siblings.add(n);
          found.set(key, known);
        }
      }
    }
  }
  return [...found.values()].filter((x) => x.siblings.size >= 2).slice(0, MAX_MEMBERS);
}

// Backticked terms, --flags, quoted phrases, snake_case and camelCase identifiers on the added and removed lines, most frequent first.
function termsFromDiff(diff) {
  const counts = new Map();
  const add = (raw) => {
    const term = raw.trim();
    if (term.length < 3 || term.endsWith('/')) return;
    const key = term.toLowerCase();
    const seen = counts.get(key);
    if (seen) seen.n += 1;
    else counts.set(key, { term, n: 1, order: counts.size });
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
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.order - b.order)
    .slice(0, MAX_TERMS)
    .map((x) => x.term);
}

// The documents the sweep reads: regular Markdown and TOML files of sane size, never links, and the two code files that hold help text.
function documents(root) {
  const found = [];
  const take = (file, code = false) => {
    // A code file sits in a folder of the Run worktree; a linked folder would lead out of it.
    if (code && !fs.lstatSync(path.dirname(file), { throwIfNoEntry: false })?.isDirectory()) return;
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat || !stat.isFile() || stat.size >= MAX_FILE || !(code || /\.(md|toml)$/.test(file))) return;
    found.push({ file, code });
  };
  const walk = (dir) => {
    const stat = fs.lstatSync(dir, { throwIfNoEntry: false });
    if (!stat || !stat.isDirectory()) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name) || entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else take(full);
    }
  };
  for (const name of ROOT_DOCS) take(path.join(root, name));
  for (const dir of DOC_DIRS) walk(path.join(root, dir));
  for (const name of CODE_FILES) take(path.join(root, name), true);
  return found.sort((a, b) => a.file.localeCompare(b.file));
}

export function sweepRun(projectDir, id, extra = []) {
  const { record } = readRun(projectDir, id);
  const root = record.worktree;
  if (!root || !fs.existsSync(root)) throw new Error('the Run worktree is missing');
  if (!/^[0-9a-f]{40,64}$/.test(record.base_sha ?? '')) throw new Error('the Run has no usable base commit');
  const plain = ['--no-ext-diff', '--no-textconv', '--no-color'];
  const diff = git(root, 'diff', ...plain, record.base_sha, '--');
  const changed = new Set(
    git(root, 'diff', ...plain, '-z', '--name-only', record.base_sha, '--')
      .split('\0')
      .filter(Boolean),
  );
  const gone = goneTerms(diff);
  const fromDiff = [
    ...gone,
    ...termsFromDiff(diff).filter((t) => !gone.some((g) => g.toLowerCase() === t.toLowerCase())),
  ];
  const given = [...new Set(extra.map((t) => t.trim()).filter(Boolean))];
  const terms = [...fromDiff, ...given.filter((t) => !fromDiff.some((d) => d.toLowerCase() === t.toLowerCase()))];
  const files = documents(root).map(({ file, code }) => {
    const rel = path.relative(root, file).split(path.sep).join('/');
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const replaced =
      !code && (rel.startsWith('docs/specs/archive/') || REPLACED_NOTE.test(lines.slice(0, 12).join('\n')));
    return { rel, lines, replaced, code, changed: changed.has(rel) };
  });
  const results = terms.map((term) => {
    const needle = term.toLowerCase();
    const hits = { current: [], replaced: [] };
    for (const f of files)
      f.lines.forEach((text, i) => {
        if (text.toLowerCase().includes(needle))
          hits[f.replaced ? 'replaced' : 'current'].push({
            file: f.rel,
            line: i + 1,
            text,
            changed: f.changed,
            code: f.code,
          });
      });
    return { term, ...hits };
  });
  const byFile = changedLines(diff);
  const lists = listChanges(byFile)
    .map(({ member, kind, siblings }) => {
      const names = [...siblings];
      const hits = [];
      for (const f of files) {
        if (f.replaced || f.code) continue;
        f.lines.forEach((text, i) => {
          if (text.length > 4000 || names.filter((n) => text.includes(`\`${n}\``)).length < 2) return;
          if (text.includes(`\`${member}\``) === (kind === 'removed'))
            hits.push({ file: f.rel, line: i + 1, text, changed: f.changed });
        });
      }
      return { member, kind, siblings: names, hits };
    })
    .filter((x) => x.hits.length);
  const claims = [];
  for (const [file, { added }] of byFile) {
    if (/(^|\/)tests?\//.test(file)) continue;
    for (const text of added)
      if (text.length < 4000 && CLAIM.test(text) && claims.length < MAX_CLAIMS) claims.push({ file, text });
  }
  // The documents still to read: current documents the Run did not change, with the distinct lines that hold a shown term or a list hit.
  const lines = new Map();
  const code = new Set();
  const note = (hit) => {
    if (hit.changed) return;
    if (hit.code) code.add(hit.file);
    lines.set(hit.file, (lines.get(hit.file) ?? new Set()).add(hit.line));
  };
  for (const r of results) if (r.current.length + r.replaced.length <= TOO_COMMON) r.current.forEach(note);
  for (const l of lists) l.hits.forEach(note);
  const toRead = [...lines]
    .map(([file, set]) => ({ file, hits: set.size, code: code.has(file) }))
    .sort((a, b) => b.hits - a.hits || a.file.localeCompare(b.file));
  return {
    id,
    base: record.base_sha,
    toRead,
    fromDiff: fromDiff.length,
    given: terms.length - fromDiff.length,
    files: files.length,
    results,
    lists,
    claims,
  };
}

// The closing list, also printed alone by `run sweep --files`, so a reader who cuts the long output still sees the files.
function formatToRead(report) {
  const out = ['== documents to read (not changed in this Run)'];
  if (!report.toRead.length) return [...out, '  no other document holds a changed term'];
  for (const { file, hits, code } of report.toRead.slice(0, TO_READ))
    out.push(`  ${clean(file)}: ${hits} hit(s)${code ? ' [code]' : ''}`);
  if (report.toRead.length > TO_READ) out.push(`  ${report.toRead.length - TO_READ} more documents`);
  return out;
}

export function formatSweep(report, { filesOnly = false } = {}) {
  if (filesOnly) return formatToRead(report).join('\n');
  const out = [
    `Term sweep for ${report.id}: ${report.fromDiff} term(s) from the diff, ${report.given} given with --term, ${report.files} documents searched.`,
  ];
  if (!report.results.length && !report.lists.length && !report.claims.length) {
    out.push('no terms found in the diff and none given with --term');
    return out.join('\n');
  }
  let budget = TOTAL,
    cut = 0;
  const show = (hits, perTerm) => {
    const take = hits.slice(0, Math.max(0, Math.min(perTerm, budget)));
    budget -= take.length;
    const left = hits.length - take.length;
    cut += left;
    return {
      lines: take.map(
        (h) =>
          `    ${clean(h.file)}:${h.line}: ${clean(h.text.trim().slice(0, LINE))}${h.changed ? ' [changed]' : ''}${h.code ? ' [code]' : ''}`,
      ),
      left,
    };
  };
  for (const { term, current, replaced } of report.results) {
    out.push(
      '',
      `== ${clean(term)}: ${current.length + replaced.length} hit(s) in ${new Set([...current, ...replaced].map((h) => h.file)).size} file(s)`,
    );
    if (current.length + replaced.length > TOO_COMMON) {
      out.push(
        `    too common to list (${current.length + replaced.length} hits); search a narrower wording with --term`,
      );
      continue;
    }
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
  if (report.lists.length) {
    out.push('', '== lists that miss a changed member or still hold a removed one:');
    for (const { member, kind, siblings, hits } of report.lists) {
      out.push(
        `  ${kind} \`${clean(member)}\` (siblings: ${clean(siblings.slice(0, 4).join(', '))}${siblings.length > 4 ? ', ...' : ''}): ${hits.length} line(s)`,
      );
      for (const h of hits.slice(0, 10))
        out.push(
          `    ${clean(h.file)}:${h.line}: ${clean(h.text.trim().slice(0, LINE))}${h.changed ? ' [changed]' : ''}`,
        );
      if (hits.length > 10) out.push(`    ${hits.length - 10} more lines left out`);
    }
  }
  if (report.claims.length) {
    out.push('', '== claims in added lines; each needs an adversarial test or must go:');
    for (const c of report.claims) out.push(`    ${clean(c.file)}: ${clean(c.text.trim().slice(0, LINE))}`);
  }
  if (cut) out.push('', `${cut} hit(s) left out in total; narrow the terms with --term to see them.`);
  out.push('', ...formatToRead(report));
  return out.join('\n');
}
