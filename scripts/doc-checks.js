// Mechanical checks on the repository's own documentation and tests. Each takes a root folder and returns a list of problems,
// so `npm test` can run it on the repo and the tests can run it on a temporary folder.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MAX_CHECK_LOOPS } from '../src/run-store.js';

const walk = (root, dir, skip = () => false) => {
  const full = join(root, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full).flatMap((name) => {
    const path = join(dir, name);
    if (skip(path)) return [];
    return statSync(join(root, path)).isDirectory() ? walk(root, path, skip) : [path];
  });
};

// Documentation that holds links. Archived Specs are history and the vendored upstream Skills have example links
// that never resolve, so neither is checked.
export function linkedDocs(root) {
  const loose = ['README.md', 'CONTRIBUTING.md', 'GLOSSARY.md', 'AGENTS.md', 'changelog.d/README.md', 'skills/factory/SKILL.md'].filter((file) => existsSync(join(root, file)));
  const docs = walk(root, 'docs', (path) => path === join('docs', 'specs', 'archive')).filter((file) => file.endsWith('.md'));
  const agents = walk(root, 'agents').filter((file) => file.endsWith('.md'));
  return [...loose, ...docs, ...agents];
}

// Relative Markdown links whose target is missing. Code is not read, since it shows links as examples.
export function brokenLinks(root) {
  const problems = [];
  for (const file of linkedDocs(root)) {
    const prose = readFileSync(join(root, file), 'utf8').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]+`/g, '');
    for (const [, target] of prose.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/')) continue;
      if (!existsSync(join(root, dirname(file), target))) problems.push(`${file} links to missing ${target}`);
    }
  }
  return problems;
}

// ADR files must be named NNNN-slug.md, and each number is used once.
export function adrProblems(root) {
  const problems = [];
  const owners = new Map();
  for (const name of readdirSync(join(root, 'docs', 'adr')).sort()) {
    const number = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.exec(name)?.[1];
    if (!number) problems.push(`docs/adr/${name} is not named NNNN-slug.md`);
    else if (owners.has(number)) problems.push(`docs/adr/${name} reuses number ${number} of ${owners.get(number)}`);
    else owners.set(number, name);
  }
  return problems;
}

// Words in the glossary's Avoid lists that are also ordinary words, so a bare use is no sign of drift.
const ORDINARY_WORDS = new Set(['step', 'Standards', 'Clean', 'Sync', 'Reviewer', 'Restart', 'Log', 'Job', 'Task', 'Board', 'Monitor', 'Package', 'Distribution', 'Upgrade', 'Modal', 'Backend', 'platform', 'story', 'Ticket']);

// The terms the glossary says to avoid. A term with a qualifier, or an explanation instead of a term, is left out.
export function avoidTerms(glossary) {
  const terms = [];
  for (const [, line] of glossary.matchAll(/^_Avoid_: (.+)$/gm)) {
    let depth = 0;
    let item = '';
    const items = [];
    for (const char of line) {
      if (char === '(') depth++;
      if (char === ')') depth--;
      if (char === ',' && !depth) { items.push(item.trim()); item = ''; } else item += char;
    }
    items.push(item.trim());
    terms.push(...items.filter((term) => /^[A-Za-z]+(?: [A-Za-z]+){0,2}$/.test(term) && !ORDINARY_WORDS.has(term)));
  }
  return terms;
}

const withoutCode = (text) => text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]+`/g, '');

// Documentation that uses an Avoid term as the term. The glossary, the changelog, the ADRs (history) and archived Specs are not read.
export function bareAvoidTerms(root) {
  const terms = avoidTerms(readFileSync(join(root, 'GLOSSARY.md'), 'utf8'));
  const docs = ['README.md', 'skills/factory/SKILL.md', ...walk(root, 'docs', (path) => path === join('docs', 'adr') || path === join('docs', 'specs', 'archive')).filter((file) => file.endsWith('.md'))].filter((file) => existsSync(join(root, file)));
  const problems = [];
  for (const file of docs) {
    withoutCode(readFileSync(join(root, file), 'utf8')).split('\n').forEach((line, index) => {
      for (const term of terms) if (new RegExp(`\\b${term}\\b`).test(line)) problems.push(`${file}: "${term}" is a glossary Avoid term (${line.trim().slice(0, 60)})`);
    });
  }
  return problems;
}

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

// Constants the code defines and the prose states. Each entry names the files that state it and the patterns that find the
// statement; the first capture of a pattern is the number or the number word. A new constant is a new entry.
export const CONSTANTS = [{
  name: 'Check loop limit',
  value: MAX_CHECK_LOOPS,
  patterns: [/at most (\w+) times/g, /\(at most (\w+)\)/g, /`0` to `(\w+)`/g],
  files: ['README.md', 'docs/usage.md', 'dashboard/model.js', 'skills/factory/SKILL.md'],
}];

// Files whose statement of a constant differs from the code, or that no longer state it at all.
export function staleConstants(root, constants = CONSTANTS) {
  const problems = [];
  for (const { name, value, patterns, files } of constants) {
    for (const file of files) {
      const text = readFileSync(join(root, file), 'utf8');
      const found = patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((m) => m[1]));
      if (!found.length) problems.push(`${file} no longer states the ${name}; update the patterns in scripts/doc-checks.js`);
      for (const word of found) {
        const number = NUMBER_WORDS[word] ?? Number(word);
        if (number !== value) problems.push(`${file} says the ${name} is ${word}, the code says ${value}`);
      }
    }
  }
  return problems;
}

// Test files that import openPage, the helper that skips without a browser, but are not named *-browser.test.js. CI runs those in the job that requires a browser;
// any other test file runs in the unit job, where a missing browser skips the test instead of failing it.
export function misnamedBrowserTests(root) {
  return walk(root, 'test')
    .filter((file) => file.endsWith('.test.js') && !file.endsWith('-browser.test.js'))
    .filter((file) => /^import\s*\{[^}]*\bopenPage\b[^}]*\}\s*from\s*'\.\/browser\.js'/m.test(readFileSync(join(root, file), 'utf8')))
    .map((file) => `${file} opens a browser, so it must be named *-browser.test.js`);
}
