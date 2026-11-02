// Folds the changelog fragments in changelog.d/ into CHANGELOG.md for a Release.
// Usage: node scripts/changelog.js release <version> [yyyy-mm-dd]
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { messageOf } from '../src/narrow.js';

export const CATEGORIES = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'];

// Entries by category from fragment text or an [Unreleased] body: `### Category` headings over `- ` lines, indented lines continue the entry above.
/**
 * @param {string} text
 * @param {string} source
 * @returns {Record<string, string[]>}
 */
export function parseEntries(text, source) {
  /** @type {Record<string, string[]>} */
  const entries = {};
  /** @type {string | null} */
  let category = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const heading = /^### (.+?)\s*$/.exec(line);
    if (heading) {
      if (!CATEGORIES.includes(heading[1]))
        throw new Error(`${source}: unknown heading "${heading[1]}", use one of ${CATEGORIES.join(', ')}`);
      category = heading[1];
    } else if (/^- \S/.test(line) && category) (entries[category] ??= []).push(line.trimEnd());
    else if (/^\s+\S/.test(line) && category && entries[category]?.length)
      entries[category][entries[category].length - 1] += `\n${line.trimEnd()}`;
    else throw new Error(`${source}: expected a "### Category" heading or a "- " entry, found "${line.trim()}"`);
  }
  return entries;
}
/**
 * @param {string} text
 * @param {string} [source]
 */
export function parseFragment(text, source = 'fragment') {
  const entries = parseEntries(text, source);
  if (!Object.keys(entries).length) throw new Error(`${source}: no entries`);
  return entries;
}
/** @param {string} dir */
const fragmentFiles = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith('.md') && name !== 'README.md')
        .sort()
    : [];

// Moves the fragments and the [Unreleased] entries into a section for `version`, and deletes the fragments.
/** @param {{ root?: string, version?: string, date?: string }} options */
export function release({ root = '.', version, date }) {
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`not a version: ${version}`);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`not a date: ${date}`);
  const changelogPath = join(root, 'CHANGELOG.md'),
    fragmentsDir = join(root, 'changelog.d');
  const changelog = readFileSync(changelogPath, 'utf8');
  if (changelog.includes(`## [${version}]`)) throw new Error(`CHANGELOG.md already has a section for ${version}`);
  const start = changelog.indexOf('## [Unreleased]');
  if (start < 0) throw new Error('CHANGELOG.md has no [Unreleased] section');
  const bodyStart = changelog.indexOf('\n', start) + 1;
  const next = changelog.indexOf('\n## [', bodyStart);
  const bodyEnd = next < 0 ? changelog.length : next + 1;
  const sources = [parseEntries(changelog.slice(bodyStart, bodyEnd), 'CHANGELOG.md [Unreleased]')];
  const files = fragmentFiles(fragmentsDir);
  for (const name of files)
    sources.push(parseFragment(readFileSync(join(fragmentsDir, name), 'utf8'), `changelog.d/${name}`));
  /** @type {[string, string[]][]} */
  const all = CATEGORIES.map((category) => [category, sources.flatMap((entries) => entries[category] ?? [])]);
  const sections = all.filter(([, lines]) => lines.length);
  if (!sections.length) throw new Error('nothing to release: no fragments and nothing under [Unreleased]');
  const body = sections.map(([category, lines]) => `### ${category}\n${lines.join('\n')}\n`).join('\n');
  writeFileSync(
    changelogPath,
    `${changelog.slice(0, bodyStart)}\n## [${version}] - ${date}\n\n${body}\n${changelog.slice(bodyEnd).replace(/^\n+/, '')}`,
  );
  for (const name of files) rmSync(join(fragmentsDir, name));
  return files;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const [command, version, date = new Date().toISOString().slice(0, 10)] = process.argv.slice(2);
    if (command !== 'release') throw new Error('usage: node scripts/changelog.js release <version> [yyyy-mm-dd]');
    const files = release({ version, date });
    console.log(
      `Released ${version}: folded ${files.length} fragment${files.length === 1 ? '' : 's'} into CHANGELOG.md`,
    );
  } catch (err) {
    console.error(`error: ${messageOf(err)}`);
    process.exitCode = 1;
  }
}
