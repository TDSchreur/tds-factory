#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { install } from '../src/install.js';
import { openRunStore } from '../src/run-store.js';
import { sync } from '../src/sync.js';
import { startDashboard } from '../src/dashboard.js';

const USAGE = `Usage:
  tds-factory --version
  tds-factory sync
  tds-factory install [--agent claude|codex|copilot|all] [--project] [--force]
  tds-factory dashboard [--port N]
  tds-factory run start --data JSON
  tds-factory run update --id ID --data JSON
  tds-factory run transition --id ID --to prepare|build|check|finish [--data JSON]
  tds-factory run rework --id ID [--data JSON]
  tds-factory run complete --id ID [--data JSON]

install defaults to the user-global directory; --project installs into the current directory.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    agent: { type: 'string', default: 'all' },
    project: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    data: { type: 'string' },
    id: { type: 'string' },
    to: { type: 'string' },
    port: { type: 'string' },
    version: { type: 'boolean', default: false },
  },
});

try {
  const [command] = positionals;
  if (values.version) console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
  else if (command === 'run') {
    const data = values.data === undefined ? undefined : JSON.parse(values.data);
    const store = openRunStore(process.cwd());
    const [, op] = positionals;
    if (op === 'start') console.log(store.start(data));
    else if (op === 'update') store.update(values.id, data);
    else if (op === 'transition') store.transition(values.id, values.to, data);
    else if (op === 'rework') store.rework(values.id, data);
    else if (op === 'complete') store.complete(values.id, data);
    else throw new Error('expected run start, update, transition, rework or complete');
  }
  else if (command === 'sync') sync();
  else if (command === 'install') install(values);
  else if (command === 'dashboard') {
    const port = values.port === undefined ? undefined : Number(values.port);
    if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) throw new Error(`invalid port: ${values.port}`);
    const { url } = await startDashboard({ projectDir: process.cwd(), port });
    console.log(`Dashboard for ${process.cwd()}/.factory running at ${url} (Ctrl+C to stop)`);
  } else {
    console.log(USAGE);
    process.exitCode = command ? 1 : 0;
  }
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
}
