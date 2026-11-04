// @ts-check
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import tty from 'node:tty';
import { printable } from './printable.js';

/** Open the controlling terminal instead of reading a piped Bootstrap script. */
export function openInstallTerminal() {
  let readFd;
  let writeFd;
  try {
    readFd = fs.openSync(process.platform === 'win32' ? 'CONIN$' : '/dev/tty', 'r');
    writeFd = fs.openSync(process.platform === 'win32' ? 'CONOUT$' : '/dev/tty', 'w');
    if (!tty.isatty(readFd) || !tty.isatty(writeFd)) throw new Error('not a terminal');
    const input = new tty.ReadStream(readFd);
    const output = new tty.WriteStream(writeFd);
    return {
      input,
      output,
      close: () => {
        input.destroy();
        output.destroy();
      },
    };
  } catch {
    // A missing or unusable terminal is expected for unattended invocations.
    if (readFd !== undefined) fs.closeSync(readFd);
    if (writeFd !== undefined) fs.closeSync(writeFd);
    throw new Error('No interactive terminal; use --agent claude,codex or --reuse-selection.');
  }
}

/**
 * @param {{ candidates: Array<{agent: import('./run-record.js').AgentName, configDir?: string, skillsDir: string, installed?: boolean}>, previous: Array<{agent: import('./run-record.js').AgentName, configDir?: string}>, project?: boolean, input: NodeJS.ReadableStream, output: NodeJS.WritableStream }} options
 */
export async function promptDestinations({ candidates, previous, project = false, input, output }) {
  const choices = [...candidates];
  const display = () => {
    for (const [index, item] of choices.entries()) {
      const saved = previous.some((prior) => prior.agent === item.agent && prior.configDir === item.configDir);
      output.write(
        `${index + 1}. ${item.agent} ${printable(item.skillsDir)}${saved ? ' (saved)' : ''}${item.installed ? ' (installed)' : ''}\n`,
      );
    }
    const add = project ? '' : ', add:PATH for a Claude directory';
    output.write(`Choose numbers separated by commas${add}, yes for saved choices, or empty to cancel: `);
  };
  const terminal = createInterface({ input, output });
  try {
    display();
    for await (const line of terminal) {
      const answer = line.trim();
      if (!answer) return [];
      if (answer.toLowerCase() === 'yes' && previous.length) return previous;
      if (answer.startsWith('add:') && answer.slice(4).trim()) {
        if (project) throw new Error('custom Claude directories are not supported for projects');
        const configDir = answer.slice(4).trim();
        choices.push({ agent: 'claude', configDir, skillsDir: path.join(configDir, 'skills') });
        display();
        continue;
      }
      const indices = answer.split(',').map((part) => {
        if (!/^\s*\d+\s*$/.test(part)) throw new Error('invalid destination selection');
        const index = Number(part.trim()) - 1;
        if (!Number.isSafeInteger(index) || index < 0 || index >= choices.length)
          throw new Error('invalid destination selection');
        return index;
      });
      return [...new Set(indices)].map((index) => {
        const item = choices[index];
        return item.configDir ? { agent: item.agent, configDir: item.configDir } : { agent: item.agent };
      });
    }
    return [];
  } finally {
    terminal.close();
  }
}

/**
 * @param {{agent?: string, claudeDirs?: string[], reuse?: boolean, previous?: Array<{agent: import('./run-record.js').AgentName, configDir?: string}>, project?: boolean}} options
 * @returns {Array<{agent: import('./run-record.js').AgentName, configDir?: string}> | undefined}
 */
export function explicitDestinations({ agent, claudeDirs = [], reuse = false, previous, project = false }) {
  if (reuse) {
    if (agent !== undefined || claudeDirs.length)
      throw new Error('--reuse-selection cannot be combined with destination flags');
    if (!previous?.length) throw new Error('no saved selection to reuse');
    return previous;
  }
  if (agent === undefined) {
    if (claudeDirs.length) throw new Error('--claude-dir requires --agent claude');
    return undefined;
  }
  const names = agent.split(',').map((name) => name.trim());
  if (names.includes('all')) {
    if (names.length !== 1) throw new Error('all cannot be combined with other agents');
    names.splice(0, 1, 'claude', 'codex', 'copilot');
  }
  if (names.some((name) => !['claude', 'codex', 'copilot'].includes(name)) || new Set(names).size !== names.length)
    throw new Error('invalid or duplicate agent');
  if (claudeDirs.some((dir) => !dir.trim()) || (claudeDirs.length && (!names.includes('claude') || project)))
    throw new Error('--claude-dir requires a global Claude selection');
  /** @type {Array<{agent: import('./run-record.js').AgentName, configDir?: string}>} */
  const selected = [];
  for (const name of names) {
    if (name === 'claude' && claudeDirs.length)
      selected.push(...claudeDirs.map((configDir) => ({ agent: /** @type {const} */ ('claude'), configDir })));
    else selected.push({ agent: /** @type {import('./run-record.js').AgentName} */ (name) });
  }
  return selected;
}
