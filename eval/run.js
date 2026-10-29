#!/usr/bin/env node
// On-demand agent evaluation: npm run eval -- <claude|codex|copilot> [scenario...]
// Needs the agent CLI on PATH (or EVAL_AGENT_CMD). Not part of `npm test`.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaults } from './lib/agents.js';
import { fixture } from './lib/fixture.js';
import { collect } from './lib/artifacts.js';

const here = dirname(fileURLToPath(import.meta.url));
const [agent, ...wanted] = process.argv.slice(2);
const command = process.env.EVAL_AGENT_CMD ?? defaults[agent];
if (!command) {
  console.error(`usage: npm run eval -- <${Object.keys(defaults).join('|')}> [scenario...]\nset EVAL_AGENT_CMD to use another command; nothing was run.`);
  process.exit(2);
}
const timeoutMs = Number(process.env.EVAL_TIMEOUT_MS ?? 20 * 60 * 1000);
const names = readdirSync(join(here, 'scenarios')).map((f) => f.replace(/\.js$/, ''));
const unknown = wanted.filter((w) => !names.includes(w));
if (unknown.length) {
  console.error(`unknown scenario: ${unknown.join(', ')} (${names.join(', ')})`);
  process.exit(2);
}

let failed = 0;
for (const name of wanted.length ? wanted : names) {
  const scenario = await import(`./scenarios/${name}.js`);
  const fx = fixture({ agent, ...scenario.fixture });
  const { prompt } = scenario.setup(fx);
  const ran = spawnSync('sh', ['-c', command], { cwd: fx.dir, env: { ...fx.env, EVAL_PROMPT: prompt }, timeout: timeoutMs, encoding: 'utf8' });
  const timedOut = ran.error?.code === 'ETIMEDOUT';
  const results = scenario.grade(collect(fx), fx);
  console.log(`\n${name}: ${scenario.description}  [${fx.root}]${timedOut ? '  (agent timed out)' : ''}`);
  for (const [check, ok] of results) console.log(`  ${ok ? 'PASS' : 'FAIL'} ${check}`);
  if (results.some(([, ok]) => !ok)) failed++;
}
process.exit(failed ? 1 : 0);
