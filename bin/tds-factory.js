#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { install } from '../src/install.js';
import { sync } from '../src/sync.js';

const USAGE = `Usage:
  tds-factory sync
  tds-factory install [--agent claude|codex|copilot|all] [--project] [--force]

install defaults to the user-global directory; --project installs into the current directory.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    agent: { type: 'string', default: 'all' },
    project: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
  },
});

try {
  const [command] = positionals;
  if (command === 'sync') sync();
  else if (command === 'install') install(values);
  else {
    console.log(USAGE);
    process.exitCode = command ? 1 : 0;
  }
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
}
