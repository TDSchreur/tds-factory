// Mechanical checks on the repository's own documentation. Each takes a root folder and returns a list of problems,
// so `npm test` can run it on the repo and the tests can run it on a temporary folder.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

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
