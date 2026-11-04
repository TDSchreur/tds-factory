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

const ANSWER_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Ask which destinations to install into. An empty answer, end of input or a timeout cancels and returns an empty list.
 * @param {{ candidates: Array<{agent: import('./run-record.js').AgentName, configDir?: string, skillsDir: string, installed?: boolean}>, previous: Array<{agent: import('./run-record.js').AgentName, configDir?: string}>, project?: boolean, input: NodeJS.ReadableStream, output: NodeJS.WritableStream, timeoutMs?: number }} options
 */
export async function promptDestinations({
  candidates,
  previous,
  project = false,
  input,
  output,
  timeoutMs = ANSWER_TIMEOUT_MS,
}) {
  const choices = [...candidates];
  /** @param {{agent: string, configDir?: string}} item */
  const isSaved = (item) => previous.some((prior) => prior.agent === item.agent && prior.configDir === item.configDir);
  const display = () => {
    for (const [index, item] of choices.entries()) {
      const saved = isSaved(item);
      const state = saved ? ' (saved)' : item.installed ? ' (legacy: installed by an earlier version)' : '';
      output.write(`${index + 1}. [${saved ? 'x' : ' '}] ${item.agent} ${printable(item.skillsDir)}${state}\n`);
    }
    const add = project ? '' : ', add:PATH for another Claude directory';
    const keep = previous.length ? ', yes to keep the destinations marked [x]' : '';
    output.write(`Choose numbers separated by commas${add}${keep}, or press Enter to cancel: `);
  };
  const terminal = createInterface({ input, output });
  const lines = terminal[Symbol.asyncIterator]();
  try {
    display();
    while (true) {
      /** @type {NodeJS.Timeout | undefined} */
      let timer;
      const expired = new Promise((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs);
      });
      const next = await Promise.race([lines.next(), expired]);
      clearTimeout(timer);
      if (next === 'timeout') {
        output.write('\nNo answer; nothing was changed.\n');
        return [];
      }
      if (typeof next !== 'object' || next === null || !('done' in next) || next.done) return [];
      const answer = String(next.value).trim();
      if (!answer) return [];
      if (answer.toLowerCase() === 'yes' && previous.length) return previous;
      if (answer.startsWith('add:') && answer.slice(4).trim()) {
        if (project) throw new Error('custom Claude directories are not supported for projects');
        const configDir = answer.slice(4).trim();
        if (/[\p{Cc}\p{Cf}]/u.test(configDir)) throw new Error('invalid destination path');
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
  if (claudeDirs.some((dir) => dir.length > 4096 || /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(dir)))
    throw new Error('--claude-dir must be a path without control characters and under 4096 characters');
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

/**
 * @param {{agent?: string, claudeDirs?: string[], reuse?: boolean, previous?: Array<{agent: import('./run-record.js').AgentName, configDir?: string}>, project?: boolean, candidates: Array<{agent: import('./run-record.js').AgentName, configDir?: string, skillsDir: string, installed?: boolean}>, terminal?: typeof openInstallTerminal}} options
 */
export async function chooseDestinations(options) {
  const selected = explicitDestinations(options);
  if (selected !== undefined) return selected;
  const terminal = (options.terminal ?? openInstallTerminal)();
  try {
    return await promptDestinations({
      candidates: options.candidates,
      previous: options.previous ?? [],
      project: options.project,
      input: terminal.input,
      output: terminal.output,
    });
  } finally {
    terminal.close();
  }
}
