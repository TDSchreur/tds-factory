import fs from 'node:fs';
import os from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { FactoryError } from './errors.js';
import { isMissing, messageOf } from './narrow.js';
import { SKILLS_DIR, AGENTS_DIR, MARKER } from './paths.js';
import { targets, userDir, agentNames, isAgent } from './flow.js';
import { replaceDir } from './replace-dir.js';
import { hashLine, modifiedLocally } from './tree-hash.js';

// Copilot reads the Claude and Codex directories, so `all` skips it to avoid duplicates.
/**
 * @param {{ agent: string, project?: boolean, force?: boolean, dryRun?: boolean, cwd?: string, log?: (message: string) => void, warn?: (message: string) => void }} options
 */
export function install({
  agent,
  project,
  force,
  dryRun = false,
  cwd = process.cwd(),
  log = console.log,
  warn = console.warn,
}) {
  const all = agentNames;
  const requested = agent === 'all' ? all.filter((name) => name !== 'copilot') : [agent];
  for (const name of requested) {
    if (!isAgent(name)) throw new Error(`unknown agent "${name}" (${agentNames.join(', ')}, all)`);
  }
  const names = requested.filter(isAgent);
  const base = project ? cwd : os.homedir();
  const skills = fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(SKILLS_DIR, e.name, 'SKILL.md')))
    .map((e) => e.name);

  for (const name of names) {
    const targetDir = project ? path.join(base, targets[name].project) : userDir(name, 'global', base);
    if (!dryRun) fs.mkdirSync(targetDir, { recursive: true });
    for (const skill of skills) {
      const dest = path.join(targetDir, skill);
      // A symlink is another installer's link to the same skill; replace it, not its target.
      const replaceable = force || fs.lstatSync(dest, { throwIfNoEntry: false })?.isSymbolicLink();
      if (fs.existsSync(dest) && !replaceable && !fs.existsSync(path.join(dest, MARKER))) {
        warn(`skip ${name}/${skill}: exists and was not installed by tds-factory (use --force)`);
        continue;
      }
      if (!replaceable && fs.existsSync(dest) && modifiedLocally(dest)) {
        warn(`skip ${name}/${skill}: edited locally (use --force to replace)`);
        continue;
      }
      if (!dryRun) {
        replaceDir(dest, (staging) => {
          fs.cpSync(path.join(SKILLS_DIR, skill), staging, { recursive: true });
          fs.writeFileSync(path.join(staging, MARKER), hashLine(staging));
        });
      }
      log(`${dryRun ? 'would install' : 'installed'} ${name}/${skill} -> ${dest}`);
    }
    // Marked folders that are no longer shipped are ours to remove; unmarked ones never are.
    for (const e of fs.existsSync(targetDir) ? fs.readdirSync(targetDir, { withFileTypes: true }) : []) {
      const stale = path.join(targetDir, e.name);
      if (e.isDirectory() && !skills.includes(e.name) && fs.existsSync(path.join(stale, MARKER))) {
        if (!dryRun) fs.rmSync(stale, { recursive: true, force: true });
        log(`${dryRun ? 'would remove' : 'removed'} ${name}/${e.name}`);
      }
    }
  }
  // Stage agents carry per-target model choices, so Copilot gets its own even when its skills are shared.
  for (const name of agent === 'all' ? all : names) {
    installAgents(
      name,
      project ? path.join(base, targets[name].projectAgents) : userDir(name, 'agents', base),
      force,
      dryRun,
      { log, warn },
    );
  }
}

// Stage agent files hold the editable model choices. Each installed file's hash is recorded, so a file you did not edit is updated
// and one you edited is kept; --force replaces it anyway. A file without a record (an older install) counts as edited.
const AGENT_RECORD = '.tds-factory-agents.json';
/** @param {string} file */
const sha = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/**
 * @param {import('./run-record.js').AgentName} name
 * @param {string} targetDir
 * @param {boolean | undefined} force
 * @param {boolean} dryRun
 * @param {{ log: (message: string) => void, warn: (message: string) => void }} output
 */
function installAgents(name, targetDir, force, dryRun, { log, warn }) {
  const sourceDir = path.join(AGENTS_DIR, name);
  if (!dryRun) fs.mkdirSync(targetDir, { recursive: true });
  const recordFile = path.join(targetDir, AGENT_RECORD);
  /** @type {Record<string, string>} */
  let record = {};
  try {
    record = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  } catch (err) {
    if (!isMissing(err)) {
      throw new FactoryError(
        `cannot read the install record ${recordFile}: ${messageOf(err)} (remove the file to install again)`,
        { code: 'install-record-unreadable', cause: err },
      );
    }
    // No record yet: nothing was installed here before.
  }
  for (const file of fs.readdirSync(sourceDir)) {
    const dest = path.join(targetDir, file);
    const src = path.join(sourceDir, file);
    const existing = fs.lstatSync(dest, { throwIfNoEntry: false });
    const pristine = existing?.isFile() && (sha(dest) === record[file] || sha(dest) === sha(src));
    if (existing && !force && !pristine) {
      warn(`skip ${name}/${file}: edited locally, keeping your configuration (use --force to replace)`);
      continue;
    }
    if (!dryRun) {
      if (existing) fs.rmSync(dest);
      fs.copyFileSync(src, dest);
      record[file] = sha(dest);
    }
    log(`${dryRun ? 'would install' : 'installed'} ${name}/${file} -> ${dest}`);
  }
  if (!dryRun) fs.writeFileSync(recordFile, JSON.stringify(record, null, 2) + '\n');
}
