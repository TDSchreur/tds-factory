import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// The README and the colleague guides are the first thing a colleague reads; keep their links and commands true.
const GUIDES = [
  'README.md',
  'docs/install.md',
  'docs/usage.md',
  'docs/dashboard.md',
  'docs/development.md',
  'docs/capabilities.md',
];
const read = (file) => readFileSync(resolve(file), 'utf8');

// Subcommands and flags the CLI knows, taken from its own usage text.
const usage = spawnSync(process.execPath, [resolve('bin/tds-factory.js')], { encoding: 'utf8' }).stdout;
const commands = new Set([...usage.matchAll(/^\s+tds-factory (--?[\w-]+|[\w-]+)/gm)].map((m) => m[1]));
const AGENTS = new Set(['claude', 'codex', 'copilot', 'all']);

test('the README links to both guides directly under its opening paragraph', () => {
  const readme = read('README.md');
  for (const guide of ['docs/install.md', 'docs/usage.md']) {
    const link = readme.indexOf(`(${guide})`);
    assert.ok(link > -1, 'link to ' + guide);
    assert.ok(link < readme.indexOf('## The flow'), guide + ' is linked before the Flow section');
  }
});

test('the guides present the release install, not the setup scripts, as the way to install', () => {
  for (const file of ['docs/install.md', 'docs/usage.md']) assert.doesNotMatch(read(file), /setup\.(sh|ps1)/, file);
});

for (const file of GUIDES) {
  test(`${file}: every relative link resolves to a file`, () => {
    assert.ok(existsSync(resolve(file)), file + ' exists');
    for (const [, target] of read(file).matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
      if (/^[a-z]+:/i.test(target)) continue;
      assert.ok(existsSync(join(dirname(resolve(file)), target)), `${file} links to missing ${target}`);
    }
  });

  test(`${file}: every tds-factory command and --agent value shown is one the CLI knows`, () => {
    const code = [...read(file).matchAll(/```[\s\S]*?```|`[^`\n]+`/g)].map((m) => m[0]).join('\n');
    for (const [, word] of code.matchAll(/(?:^|\s)tds-factory\s+(\S+)/g))
      assert.ok(commands.has(word), `${file}: unknown command "tds-factory ${word}"`);
    for (const [, agent] of code.matchAll(/--agent\s+([\w|]+)/g)) {
      for (const value of agent.split('|')) assert.ok(AGENTS.has(value), `${file}: unknown --agent ${value}`);
    }
  });
}

test('every Mermaid block opens with a diagram type, and the README flow reads top to bottom', () => {
  for (const file of GUIDES) {
    for (const [, body] of read(file).matchAll(/```mermaid\n([\s\S]*?)```/g))
      assert.match(body, /^(flowchart (TB|LR)|stateDiagram-v2)\b/, `${file}: Mermaid diagram type`);
  }
  assert.match(read('README.md'), /```mermaid\nflowchart TB\n/);
});

test('the README lists the guides in a Documentation section', () => {
  const readme = read('README.md');
  const at = readme.indexOf('## Documentation');
  assert.ok(at > -1, 'has a Documentation section');
  const section = readme.slice(at);
  for (const doc of [
    'docs/install.md',
    'docs/usage.md',
    'docs/dashboard.md',
    'docs/capabilities.md',
    'docs/evaluation.md',
    'docs/releasing.md',
  ])
    assert.ok(section.includes(`(${doc})`), doc);
});

test('the install and usage guides send the reader to tds-factory doctor', () => {
  for (const file of ['docs/install.md', 'docs/usage.md']) assert.match(read(file), /^\s*tds-factory doctor$/m, file);
});
