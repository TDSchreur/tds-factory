import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SKILLS_DIR } from '../src/paths.js';

// The factory Skill is its main file plus the reference files it names; the tests pin the text of both.
const dir = join(SKILLS_DIR, 'factory');
export const main = readFileSync(join(dir, 'SKILL.md'), 'utf8');
export const references = Object.fromEntries(readdirSync(join(dir, 'references')).sort().map((name) => [name, readFileSync(join(dir, 'references', name), 'utf8')]));
export const flow = [main, ...Object.values(references)].join('\n');
// A stage section of the main file, followed by the reference file that holds its details.
const details = { Define: ['fast-track.md', 'define.md'], Build: 'exit-checklist.md', Check: 'check.md', Finish: 'finish.md', 'Follow-up': 'follow-up.md', 'Invoked Skills': 'invoked-skills.md', 'Stage agents': 'stage-agents.md' };
export function section(name) {
  const found = main.split(/^## /m).find((s) => s.startsWith(`${name}\n`));
  if (!found) throw new Error(`SKILL.md has no "## ${name}" section`);
  return details[name] ? `${found}\n${[details[name]].flat().map((n) => references[n]).join('\n')}` : found;
}
