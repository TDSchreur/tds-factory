#!/usr/bin/env node
import { enableCompileCache } from 'node:module';

// Compiled code is cached on disk for the next start. This has to run before the CLI's modules are imported, which is why `main` is imported afterwards, and the modules of each command inside `main`.
try {
  enableCompileCache();
} catch {
  // a read-only or missing cache folder only costs the start-up time
}

const { main } = await import('../src/cli.js');
process.exitCode = await main(process.argv.slice(2), {
  // The Dashboard runs until it is told to stop: close it, then end the process.
  onTerminate: (stop) => {
    for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM']))
      process.once(signal, () => void stop().finally(() => process.exit(0)));
  },
});
