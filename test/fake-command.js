// Fake commands for tests. On POSIX a fake is a Node script with a shebang. Windows starts only real .exe files and cannot run a script by name, so there a fake is a copy of node.exe next to its script, and a preload (loaded through NODE_OPTIONS) runs that script when the copy is started under another name.
import { chmodSync, copyFileSync, existsSync, linkSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const WINDOWS = process.platform === 'win32';

const PRELOAD = `const path = require('node:path');
const script = path.join(path.dirname(process.execPath), path.basename(process.execPath, '.exe') + '.fake.cjs');
if (require('node:fs').existsSync(script)) {
  // Node has turned the first argument into an absolute path, as if it were a script.
  if (process.argv.length > 1) process.argv[1] = path.relative(process.cwd(), process.argv[1]);
  process.argv.splice(1, 0, script);
  require(script);
  process.exit(process.exitCode ?? 0);
}
`;

function enablePreload() {
  const file = join(tmpdir(), 'tds-fake-command-preload.cjs');
  if (!existsSync(file)) writeFileSync(file, PRELOAD);
  const option = `--require "${file.replaceAll('\\', '/')}"`;
  if (!process.env.NODE_OPTIONS?.includes(option))
    process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, option].filter(Boolean).join(' ');
}

// One copy of node.exe per test run; each fake is a hard link to it.
function nodeCopy() {
  const cache = join(tmpdir(), 'tds-fake-node.exe');
  if (!existsSync(cache)) {
    const partial = `${cache}.${process.pid}`;
    copyFileSync(process.execPath, partial);
    renameSync(partial, cache);
  }
  return cache;
}

// Writes the command `name` into `dir`; `source` is CommonJS and reads its arguments from process.argv.slice(2).
export function fakeCommand(dir, name, source) {
  const file = join(dir, name);
  if (!WINDOWS) {
    writeFileSync(file, `#!/usr/bin/env node\n${source}`);
    chmodSync(file, 0o755);
    return file;
  }
  writeFileSync(`${file}.fake.cjs`, source);
  enablePreload();
  const exe = `${file}.exe`;
  if (existsSync(exe)) return exe;
  try {
    linkSync(nodeCopy(), exe);
  } catch {
    copyFileSync(nodeCopy(), exe);
  }
  return exe;
}

// The value of PATH with `dir` first.
export const pathWith = (dir) => `${dir}${delimiter}${process.env.PATH}`;

// An environment for a child process with `dir` first on PATH; on Windows the variable is spelled Path.
export function envWith(dir, extra = {}) {
  const key = Object.keys(process.env).find((name) => name.toLowerCase() === 'path') ?? 'PATH';
  return { ...process.env, [key]: pathWith(dir), ...extra };
}
