import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SKILLS_DIR, MARKER } from './paths.js';

// Copilot reads the Claude and Codex directories, so `all` skips it to avoid duplicates.
const TARGETS = {
  claude: { project: '.claude/skills', global: '.claude/skills' },
  codex: { project: '.agents/skills', global: '.agents/skills' },
  copilot: { project: '.github/skills', global: '.copilot/skills' },
};

export function install({ agent, project, force }) {
  const names = agent === 'all' ? ['claude', 'codex'] : [agent];
  for (const name of names) {
    if (!TARGETS[name]) throw new Error(`unknown agent "${name}" (claude, codex, copilot, all)`);
  }
  const base = project ? process.cwd() : os.homedir();
  const skills = fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(SKILLS_DIR, e.name, 'SKILL.md')))
    .map((e) => e.name);

  for (const name of names) {
    const targetDir = path.join(base, TARGETS[name][project ? 'project' : 'global']);
    fs.mkdirSync(targetDir, { recursive: true });
    for (const skill of skills) {
      const dest = path.join(targetDir, skill);
      // A symlink is another installer's link to the same skill; replace it, not its target.
      const replaceable = force || fs.lstatSync(dest, { throwIfNoEntry: false })?.isSymbolicLink();
      if (fs.existsSync(dest) && !replaceable && !fs.existsSync(path.join(dest, MARKER))) {
        console.warn(`skip ${name}/${skill}: exists and was not installed by tds-factory (use --force)`);
        continue;
      }
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(path.join(SKILLS_DIR, skill), dest, { recursive: true });
      fs.writeFileSync(path.join(dest, MARKER), '');
      console.log(`installed ${name}/${skill} -> ${dest}`);
    }
    // Marked folders that are no longer shipped are ours to remove; unmarked ones never are.
    for (const e of fs.readdirSync(targetDir, { withFileTypes: true })) {
      const stale = path.join(targetDir, e.name);
      if (e.isDirectory() && !skills.includes(e.name) && fs.existsSync(path.join(stale, MARKER))) {
        fs.rmSync(stale, { recursive: true, force: true });
        console.log(`removed ${name}/${e.name}`);
      }
    }
  }
}
