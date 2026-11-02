import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { usageOf } from './run-view.js';

/** @import { AgentName, Run, UsageRow } from '../src/run-record.js' */

const cli = resolve('bin/tds-factory.js');

// A project, a home folder for the fixture session logs, and the CLI run against both.
/** @param {AgentName} [agent] */
export function world(agent = 'claude') {
  const home = mkdtempSync(join(tmpdir(), 'usage-home-'));
  return {
    home,
    agent,
    // The session id a test gives the CLI through CLAUDE_CODE_SESSION_ID.
    /** @type {string | undefined} */
    sessionId: undefined,
    /**
     * @param {string} cwd
     * @param {...string} args
     */
    run(cwd, ...args) {
      return spawnSync(process.execPath, [cli, 'run', ...args], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CODE_SESSION_ID: this.sessionId ?? '' },
      });
    },
    /**
     * @param {string} cwd
     * @param {...string} args
     * @returns {string} The trimmed stdout.
     */
    command(cwd, ...args) {
      const r = this.run(cwd, ...args);
      if (r.status !== 0) throw new Error(`run ${args.join(' ')} failed: ${r.stderr}`);
      return r.stdout.trim();
    },
    /**
     * @param {string} cwd
     * @param {string} [title]
     * @returns {string} The new Run's id.
     */
    start(cwd, title = 'Usage') {
      return this.command(
        cwd,
        'start',
        '--data',
        JSON.stringify({ title, agent: this.agent, commands: 'true', conventions: [] }),
      );
    },
    /**
     * @param {string} cwd
     * @param {string} id
     * @param {object} data
     */
    update(cwd, id, data) {
      return this.command(cwd, 'update', '--id', id, '--data', JSON.stringify(data));
    },
    /**
     * @param {string} cwd
     * @param {string} id
     * @param {string} to
     */
    move(cwd, id, to) {
      return this.command(cwd, 'transition', '--id', id, '--to', to);
    },
    /**
     * @param {string} cwd
     * @param {string} id
     * @returns {Run}
     */
    read: (cwd, id) => JSON.parse(readFileSync(join(cwd, '.factory', 'runs', id, 'run.json'), 'utf8')),
  };
}

// One Claude Code assistant response in a session transcript. `text` stands for conversation content.
/**
 * @param {object} line
 * @param {string | number} line.id
 * @param {string} [line.model]
 * @param {number} [line.input]
 * @param {number} [line.cacheRead]
 * @param {number} [line.cacheWrite]
 * @param {number} [line.output]
 * @param {string} [line.text]
 */
export function claudeLine({
  id,
  model = 'claude-sonnet-5-5',
  input = 1,
  cacheRead = 0,
  cacheWrite = 0,
  output = 1,
  text,
}) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: new Date().toISOString(),
    requestId: `req-${id}`,
    message: {
      id: `msg-${id}`,
      model,
      content: text ? [{ type: 'text', text }] : [],
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheWrite,
      },
    },
  });
}

// A user line that names the Run, as every `tds-factory run` command in a session does.
/** @param {string} runId */
export const mention = (runId) =>
  JSON.stringify({
    type: 'user',
    timestamp: new Date().toISOString(),
    message: { content: `tds-factory run update --id ${runId}` },
  });

/**
 * @param {string} home
 * @param {string} sessionId
 * @param {string} [slug]
 */
export function claudeSession(home, sessionId, slug = '-home-user-project') {
  const dir = join(home, '.claude', 'projects', slug);
  mkdirSync(join(dir, sessionId, 'subagents'), { recursive: true });
  const main = join(dir, `${sessionId}.jsonl`);
  const sub = join(dir, sessionId, 'subagents', 'agent-1.jsonl');
  writeFileSync(main, '');
  writeFileSync(sub, '');
  return {
    /** @param {...string} lines */
    add: (...lines) => appendFileSync(main, lines.join('\n') + '\n'),
    /** @param {...string} lines */
    addSub: (...lines) => appendFileSync(sub, lines.join('\n') + '\n'),
    main,
  };
}

// A Codex rollout file. `rootId` is the root session; a subagent rollout has its own `id` but the same `rootId`.
/**
 * @param {string} home
 * @param {object} options
 * @param {string} options.id
 * @param {string} [options.rootId]
 * @param {boolean} [options.subagent]
 * @param {string} [options.model]
 */
export function codexSession(home, { id, rootId = id, subagent = false, model = 'gpt-6.1-sol' }) {
  const day = new Date().toISOString().slice(0, 10).split('-');
  const dir = join(home, '.codex', 'sessions', ...day);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `rollout-${day.join('-')}T00-00-00-${id}.jsonl`);
  const at = () => new Date().toISOString();
  const meta = {
    id,
    session_id: rootId,
    timestamp: at(),
    cwd: '/home/user/project',
    ...(subagent ? { source: { subagent: {} } } : {}),
  };
  writeFileSync(
    file,
    [
      { timestamp: at(), type: 'session_meta', payload: meta },
      { timestamp: at(), type: 'turn_context', payload: { turn_id: `turn-${id}`, model } },
    ]
      .map((l) => JSON.stringify(l))
      .join('\n') + '\n',
  );
  return {
    /** @param {...string} lines */
    add: (...lines) => appendFileSync(file, lines.join('\n') + '\n'),
    file,
    turn: `turn-${id}`,
  };
}
/** @param {string} runId */
export const codexMention = (runId) =>
  JSON.stringify({
    timestamp: new Date().toISOString(),
    type: 'response_item',
    payload: { type: 'custom_tool_call', input: `tds-factory run update --id ${runId}` },
  });
/**
 * @param {string} turn
 * @param {string} responseId
 * @param {{ input: number, cached?: number, output?: number, reasoning?: number }} usage
 */
export const codexUsage = (turn, responseId, { input, cached = 0, output = 1, reasoning = 0 }) =>
  JSON.stringify({
    timestamp: new Date().toISOString(),
    type: 'token_usage_record',
    payload: {
      turn_id: turn,
      response_id: responseId,
      usage: {
        input_tokens: input,
        cached_input_tokens: cached,
        cache_write_input_tokens: 0,
        output_tokens: output,
        reasoning_output_tokens: reasoning,
      },
    },
  });

// A Copilot session event file. Copilot counts cache reads and cache writes inside inputTokens.
/**
 * @param {string} home
 * @param {string} id
 */
export function copilotSession(home, id) {
  const dir = join(home, '.copilot', 'session-state', id);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'events.jsonl');
  writeFileSync(
    file,
    JSON.stringify({
      type: 'session.start',
      timestamp: new Date().toISOString(),
      data: { sessionId: id, context: { cwd: '/home/user/project' } },
    }) + '\n',
  );
  return {
    /** @param {...string} lines */
    add: (...lines) => appendFileSync(file, lines.join('\n') + '\n'),
    file,
  };
}
/** @param {string} runId */
export const copilotMention = (runId) =>
  JSON.stringify({
    type: 'tool.execution_start',
    timestamp: new Date().toISOString(),
    data: { arguments: { command: `tds-factory run update --id ${runId}` } },
  });
/**
 * @param {string} callId
 * @param {object} usage
 * @param {string} [usage.model]
 * @param {number} usage.input
 * @param {number} [usage.cacheRead]
 * @param {number} [usage.cacheWrite]
 * @param {number} [usage.output]
 * @param {number} [usage.reasoning]
 * @param {boolean} [usage.subagent]
 */
export const copilotUsage = (
  callId,
  { model = 'claude-sonnet-5.5', input, cacheRead = 0, cacheWrite = 0, output = 1, reasoning = 0, subagent = false },
) =>
  JSON.stringify({
    type: 'session.usage_record',
    timestamp: new Date().toISOString(),
    data: {
      usage: {
        apiCallId: callId,
        model,
        initiator: subagent ? 'sub-agent' : 'agent',
        inputTokens: input,
        outputTokens: output,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        reasoningTokens: reasoning,
      },
    },
  });

// The one usage row of a Run record whose fields equal `match`.
/**
 * @param {Run} record
 * @param {Partial<UsageRow>} match
 */
export function findRow(record, match) {
  const row = (usageOf(record).rows ?? []).find((r) =>
    Object.entries(match).every(([key, value]) => Object.entries(r).some(([k, v]) => k === key && v === value)),
  );
  assert.ok(row, `a usage row matches ${JSON.stringify(match)}`);
  return row;
}
