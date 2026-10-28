import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SKILLS_DIR, AGENTS_DIR, MARKER } from './paths.js';
import { targets } from './flow.js';

// Copilot reads the Claude and Codex directories, so `all` skips it to avoid duplicates.
export function install({ agent, project, force }) {
  const all = Object.keys(targets);
  const names = agent === 'all' ? all.filter((name) => name !== 'copilot') : [agent];
  for (const name of names) {
    if (!Object.hasOwn(targets, name)) throw new Error(`unknown agent "${name}" (${Object.keys(targets).join(', ')}, all)`);
  }
  const base = project ? process.cwd() : os.homedir();
  const skills = fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(SKILLS_DIR, e.name, 'SKILL.md')))
    .map((e) => e.name);

  for (const name of names) {
    const targetDir = path.join(base, targets[name][project ? 'project' : 'global']);
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
  // Stage agents carry per-target model choices, so Copilot gets its own even when its skills are shared.
  for (const name of agent === 'all' ? all : names) {
    installAgents(name, path.join(base, targets[name][project ? 'projectAgents' : 'agents']), force);
  }
}

// Stage agent files hold the editable model choices, so an existing file is never overwritten without --force.
function installAgents(name, targetDir, force) {
  const sourceDir = path.join(AGENTS_DIR, name);
  fs.mkdirSync(targetDir, { recursive: true });
  for (const file of fs.readdirSync(sourceDir)) {
    const dest = path.join(targetDir, file);
    if (fs.lstatSync(dest, { throwIfNoEntry: false }) && !force) {
      console.warn(`skip ${name}/${file}: exists, keeping your configuration (use --force to replace)`);
      continue;
    }
    fs.copyFileSync(path.join(sourceDir, file), dest);
    console.log(`installed ${name}/${file} -> ${dest}`);
  }
}
