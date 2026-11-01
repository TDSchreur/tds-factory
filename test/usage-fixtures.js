import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = resolve('bin/tds-factory.js');

// A project, a home folder for the fixture session logs, and the CLI run against both.
export function world(agent = 'claude') {
  const home = mkdtempSync(join(tmpdir(), 'usage-home-'));
  return {
    home,
    agent,
    run(cwd, ...args) {
      return spawnSync(process.execPath, [cli, 'run', ...args], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CODE_SESSION_ID: this.sessionId ?? '' },
      });
    },
    command(cwd, ...args) {
      const r = this.run(cwd, ...args);
      if (r.status !== 0) throw new Error(`run ${args.join(' ')} failed: ${r.stderr}`);
      return r.stdout.trim();
    },
    start(cwd, title = 'Usage') {
      return this.command(
        cwd,
        'start',
        '--data',
        JSON.stringify({ title, agent: this.agent, commands: 'true', conventions: [] }),
      );
    },
    update(cwd, id, data) {
      return this.command(cwd, 'update', '--id', id, '--data', JSON.stringify(data));
    },
    move(cwd, id, to) {
      return this.command(cwd, 'transition', '--id', id, '--to', to);
    },
    read: (cwd, id) => JSON.parse(readFileSync(join(cwd, '.factory', 'runs', id, 'run.json'), 'utf8')),
  };
}

// One Claude Code assistant response in a session transcript. `text` stands for conversation content.
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
export const mention = (runId) =>
  JSON.stringify({
    type: 'user',
    timestamp: new Date().toISOString(),
    message: { content: `tds-factory run update --id ${runId}` },
  });

export function claudeSession(home, sessionId, slug = '-home-user-project') {
  const dir = join(home, '.claude', 'projects', slug);
  mkdirSync(join(dir, sessionId, 'subagents'), { recursive: true });
  const main = join(dir, `${sessionId}.jsonl`);
  const sub = join(dir, sessionId, 'subagents', 'agent-1.jsonl');
  writeFileSync(main, '');
  writeFileSync(sub, '');
  return {
    add: (...lines) => appendFileSync(main, lines.join('\n') + '\n'),
    addSub: (...lines) => appendFileSync(sub, lines.join('\n') + '\n'),
    main,
  };
}

// A Codex rollout file. `rootId` is the root session; a subagent rollout has its own `id` but the same `rootId`.
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
    add: (...lines) => appendFileSync(file, lines.join('\n') + '\n'),
    file,
    turn: `turn-${id}`,
  };
}
export const codexMention = (runId) =>
  JSON.stringify({
    timestamp: new Date().toISOString(),
    type: 'response_item',
    payload: { type: 'custom_tool_call', input: `tds-factory run update --id ${runId}` },
  });
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
