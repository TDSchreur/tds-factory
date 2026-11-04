import fs from 'node:fs';
import os from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { FactoryError } from './errors.js';
import { isMissing, messageOf } from './narrow.js';
import { SKILLS_DIR, AGENTS_DIR, MARKER } from './paths.js';
import { printable } from './printable.js';
import { factoryConfigDir } from './project-registry.js';
import { cleanupDestination } from './install-cleanup.js';
import { planSelection, readSelection, saveSelection } from './install-selection.js';
import { chooseDestinations, explicitDestinations } from './install-prompt.js';
import { verifyInstallPaths } from './trusted-install-paths.js';
import { replaceDir } from './replace-dir.js';
import { hashLine, modifiedLocally } from './tree-hash.js';

/** @typedef {{ agent: import('./run-record.js').AgentName, configDir?: string }} Destination */
/** @typedef {Destination & { skillsDir: string, agentsDir: string, installed?: boolean }} Candidate */

const NO_CHOICE =
  'no install destination chosen: name the complete selection with --agent claude,codex (or --agent all), add --claude-dir PATH for each Claude folder, or use --reuse-selection to repeat the saved choice. Example: tds-factory install --agent claude,codex';

// The record of the chosen destinations lives in the user's Factory config folder, never in a shared Project file.
/** @param {{ project: boolean, cwd: string, home: string, env: NodeJS.ProcessEnv }} options */
function selectionRecordFile({ project, cwd, home, env }) {
  const dir = path.join(factoryConfigDir({ env, home }), 'install');
  if (!project) return path.join(dir, 'global.json');
  const id = createHash('sha256').update(path.resolve(cwd)).digest('hex').slice(0, 32);
  return path.join(dir, 'projects', `${id}.json`);
}

/** @param {Destination} a @param {Destination} b */
const same = (a, b) => a.agent === b.agent && a.configDir === b.configDir;

/** Copy a folder with owner-only modes, so inherited default ACLs cannot grant others write access.
 * @param {string} src @param {string} dest */
function copyPrivate(src, dest) {
  fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyPrivate(from, to);
    else if (entry.isFile())
      fs.writeFileSync(to, fs.readFileSync(from), { mode: fs.statSync(from).mode & 0o111 ? 0o700 : 0o600 });
    else throw new Error(`cannot install special file ${from}`);
  }
}

/**
 * Install the Skills and Stage agents into the chosen destinations, remove the Factory-owned copies from deselected
 * ones and remember the choice. Nothing is written until every affected path has been verified as trusted.
 * @param {{ agent?: string, claudeDirs?: string[], reuseSelection?: boolean, selected?: Destination[], project?: boolean, force?: boolean, dryRun?: boolean, cwd?: string, home?: string, env?: NodeJS.ProcessEnv, log?: (message: string) => void, warn?: (message: string) => void, verifyPaths?: typeof verifyInstallPaths }} options
 */
export function install({
  agent,
  claudeDirs,
  reuseSelection = false,
  selected,
  project = false,
  force = false,
  dryRun = false,
  cwd = process.cwd(),
  home = os.homedir(),
  env = process.env,
  log = console.log,
  warn = console.warn,
  verifyPaths = verifyInstallPaths,
}) {
  const recordFile = selectionRecordFile({ project, cwd, home, env });
  const previous = readSelection({ file: recordFile, home, cwd, project, env });
  selected ??= explicitDestinations({ agent, claudeDirs, reuse: reuseSelection, previous, project });
  if (!selected?.length) throw new FactoryError(NO_CHOICE, { code: 'install-selection-required' });
  const plan = planSelection({ home, cwd, env, project, desired: selected, previous: previous ?? [] });
  const lost = plan.unavailable.filter((item) => !plan.desired.some((wanted) => same(wanted, item)));
  if (lost.length)
    throw new FactoryError(
      `cannot change the selection while ${lost.map((item) => printable(item.configDir ?? item.agent)).join(', ')} is unavailable: mount it again or choose it. Nothing was changed.`,
      { code: 'install-destination-unavailable' },
    );
  const desired = plan.candidates.filter((item) => plan.desired.some((wanted) => same(wanted, item)));
  const removals = plan.candidates.filter((item) => item.installed && !desired.includes(item));
  const skills = fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(SKILLS_DIR, e.name, 'SKILL.md')))
    .map((e) => e.name);
  const backupRoot = path.join(factoryConfigDir({ env, home }), 'install-backups');

  /** The existing objects an operation on this destination reads, replaces or removes. @param {Candidate} item */
  const affected = (item) => {
    const record = path.join(item.agentsDir, AGENT_RECORD);
    const owned = fs.existsSync(item.skillsDir)
      ? fs
          .readdirSync(item.skillsDir, { withFileTypes: true })
          .filter(
            (entry) =>
              skills.includes(entry.name) ||
              (entry.isDirectory() &&
                fs.lstatSync(path.join(item.skillsDir, entry.name, MARKER), { throwIfNoEntry: false })),
          )
          .map((entry) => entry.name)
      : [];
    const agentFiles = new Set([...fs.readdirSync(path.join(AGENTS_DIR, item.agent)), AGENT_RECORD]);
    return [
      ...owned.map((name) => path.join(item.skillsDir, name)),
      ...[...agentFiles].map((name) => path.join(item.agentsDir, name)),
      record,
    ];
  };
  /** @param {Candidate[]} items */
  const verify = (items) => {
    try {
      verifyPaths([...items.flatMap((item) => [item.skillsDir, item.agentsDir]), recordFile, backupRoot]);
      verifyPaths(items.flatMap(affected), { recursive: true });
    } catch (cause) {
      throw new FactoryError(
        `cannot establish that the install paths are trusted: ${printable(messageOf(cause))}. Nothing was installed, removed or saved, and your saved selection is unchanged.`,
        { code: 'install-untrusted-path', cause },
      );
    }
  };
  const everything = [...desired, ...removals];
  if (dryRun) log('dry run: install path trust is checked only when installing');
  else verify(everything);

  // Preview, and validate the cleanup plan, before the first write.
  const preview = (/** @type {string} */ message) => log(dryRun ? message : message.replace(/^would /, 'will '));
  for (const item of removals)
    // Trust was verified above; a dry run only reads.
    cleanupDestination({ ...item, backupRoot, trustedPaths: true, dryRun: true, log: preview });
  if (dryRun) {
    for (const item of desired) installDestination(item, skills, { force, dryRun, log, warn });
    return;
  }

  /** @type {string[]} */
  const done = [];
  /** @type {string[]} */
  const pending = [
    ...desired.map((item) => `install ${label(item)}`),
    ...removals.map((item) => `remove ${label(item)}`),
    'save the selection',
  ];
  try {
    for (const item of desired) {
      verify([item]);
      installDestination(item, skills, { force, dryRun, log, warn });
      done.push(/** @type {string} */ (pending.shift()));
    }
    for (const item of removals) {
      verify([item]);
      cleanupDestination({ ...item, backupRoot, trustedPaths: true, log });
      done.push(/** @type {string} */ (pending.shift()));
    }
    verifyPaths([recordFile]);
    saveSelection({ file: recordFile, home, cwd, project, env, selected: plan.desired, trustedPaths: true });
    log(`saved the selection (${desired.map(label).join(', ')})`);
  } catch (cause) {
    throw new FactoryError(
      `install stopped: ${printable(messageOf(cause))}. Done: ${done.length ? done.join('; ') : 'nothing'}. Not done: ${pending.join('; ')}. The saved selection was not changed and backups already made were kept, so running the command again is safe.`,
      { code: 'install-partial', cause },
    );
  }
}

/** @param {Candidate} item */
const label = (item) => printable(item.configDir ?? `${item.agent} (${item.skillsDir})`);

/**
 * Resolve the destinations from flags, saved choices or the terminal, then install.
 * @param {Parameters<typeof install>[0] & { terminal?: typeof import('./install-prompt.js').openInstallTerminal }} options
 */
export async function runInstall(options) {
  const { project = false, cwd = process.cwd(), home = os.homedir(), env = process.env } = options;
  if (options.selected === undefined) {
    const recordFile = selectionRecordFile({ project, cwd, home, env });
    const previous = readSelection({ file: recordFile, home, cwd, project, env }) ?? [];
    const explicit = explicitDestinations({
      agent: options.agent,
      claudeDirs: options.claudeDirs,
      reuse: options.reuseSelection,
      previous,
      project,
    });
    if (explicit === undefined) {
      const plan = planSelection({ home, cwd, env, project, desired: [], previous });
      const chosen = await chooseDestinations({
        project,
        previous,
        candidates: plan.candidates,
        terminal: options.terminal,
      });
      if (!chosen.length) {
        (options.log ?? console.log)('nothing selected; no changes were made');
        return;
      }
      return install({ ...options, selected: chosen });
    }
  }
  return install(options);
}

/**
 * @param {Candidate} item
 * @param {string[]} skills
 * @param {{ force: boolean, dryRun: boolean, log: (message: string) => void, warn: (message: string) => void }} options
 */
function installDestination(item, skills, { force, dryRun, log, warn }) {
  const name = item.agent;
  const targetDir = item.skillsDir;
  if (!dryRun) fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
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
        copyPrivate(path.join(SKILLS_DIR, skill), staging);
        fs.writeFileSync(path.join(staging, MARKER), hashLine(staging), { mode: 0o600 });
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
  // Stage agents carry per-target model choices, so each target gets its own.
  installAgents(name, item.agentsDir, force, dryRun, { log, warn });
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
  if (!dryRun) fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
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
      fs.writeFileSync(dest, fs.readFileSync(src), { mode: 0o600 });
      record[file] = sha(dest);
    }
    log(`${dryRun ? 'would install' : 'installed'} ${name}/${file} -> ${dest}`);
  }
  if (!dryRun) fs.writeFileSync(recordFile, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
}
