#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { install } from '../src/install.js';
import { sync } from '../src/sync.js';
import { startDashboard, DEFAULT_PORT } from '../src/dashboard.js';

const USAGE = `Usage:
  tds-factory sync
  tds-factory install [--agent claude|codex|copilot|all] [--project] [--force]
  tds-factory dashboard [--port 4317]

install defaults to the user-global directory; --project installs into the current directory.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    agent: { type: 'string', default: 'all' },
    project: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    port: { type: 'string', default: String(DEFAULT_PORT) },
  },
});

try {
  const [command] = positionals;
  if (command === 'sync') sync();
  else if (command === 'install') install(values);
  else if (command === 'dashboard') {
    const port = Number(values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`invalid port: ${values.port}`);
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
