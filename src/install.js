import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SKILLS_DIR, AGENTS_DIR, MARKER } from './paths.js';
import { targets } from './flow.js';
import { replaceDir } from './replace-dir.js';
import { hashLine, modifiedLocally } from './tree-hash.js';

// Copilot reads the Claude and Codex directories, so `all` skips it to avoid duplicates.
export function install({ agent, project, force, dryRun = false }) {
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
    if (!dryRun) fs.mkdirSync(targetDir, { recursive: true });
    for (const skill of skills) {
      const dest = path.join(targetDir, skill);
      // A symlink is another installer's link to the same skill; replace it, not its target.
      const replaceable = force || fs.lstatSync(dest, { throwIfNoEntry: false })?.isSymbolicLink();
      if (fs.existsSync(dest) && !replaceable && !fs.existsSync(path.join(dest, MARKER))) {
        console.warn(`skip ${name}/${skill}: exists and was not installed by tds-factory (use --force)`);
        continue;
      }
      if (!replaceable && fs.existsSync(dest) && modifiedLocally(dest)) {
        console.warn(`skip ${name}/${skill}: edited locally (use --force to replace)`);
        continue;
      }
      if (!dryRun) {
        replaceDir(dest, (staging) => {
          fs.cpSync(path.join(SKILLS_DIR, skill), staging, { recursive: true });
          fs.writeFileSync(path.join(staging, MARKER), hashLine(staging));
        });
      }
      console.log(`${dryRun ? 'would install' : 'installed'} ${name}/${skill} -> ${dest}`);
    }
    // Marked folders that are no longer shipped are ours to remove; unmarked ones never are.
    for (const e of fs.existsSync(targetDir) ? fs.readdirSync(targetDir, { withFileTypes: true }) : []) {
      const stale = path.join(targetDir, e.name);
      if (e.isDirectory() && !skills.includes(e.name) && fs.existsSync(path.join(stale, MARKER))) {
        if (!dryRun) fs.rmSync(stale, { recursive: true, force: true });
        console.log(`${dryRun ? 'would remove' : 'removed'} ${name}/${e.name}`);
      }
    }
  }
  // Stage agents carry per-target model choices, so Copilot gets its own even when its skills are shared.
  for (const name of agent === 'all' ? all : names) {
    installAgents(name, path.join(base, targets[name][project ? 'projectAgents' : 'agents']), force, dryRun);
  }
}

// Stage agent files hold the editable model choices, so an existing file is never overwritten without --force.
function installAgents(name, targetDir, force, dryRun) {
  const sourceDir = path.join(AGENTS_DIR, name);
  if (!dryRun) fs.mkdirSync(targetDir, { recursive: true });
  for (const file of fs.readdirSync(sourceDir)) {
    const dest = path.join(targetDir, file);
    if (fs.lstatSync(dest, { throwIfNoEntry: false }) && !force) {
      console.warn(`skip ${name}/${file}: exists, keeping your configuration (use --force to replace)`);
      continue;
    }
    if (!dryRun) fs.copyFileSync(path.join(sourceDir, file), dest);
    console.log(`${dryRun ? 'would install' : 'installed'} ${name}/${file} -> ${dest}`);
  }
}
