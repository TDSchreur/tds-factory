import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { repo } from './git-repo.js';

// A copy of the package that the test can damage, run against a ready project.
function brokenPackage(damage) {
  const copy = mkdtempSync(join(tmpdir(), 'doctor-package-'));
  for (const name of ['bin', 'src', 'agents', 'skills', 'dashboard', 'package.json'])
    cpSync(resolve(name), join(copy, name), { recursive: true });
  damage(copy);
  const dir = repo();
  mkdirSync(join(dir, 'docs', 'agents'), { recursive: true });
  for (const f of ['issue-tracker.md', 'domain.md']) writeFileSync(join(dir, 'docs', 'agents', f), '# x\n');
  writeFileSync(
    join(dir, 'AGENTS.md'),
    '# Agents\n\n## Agent skills\n\nsee docs\n\n## Commands\n\n- Verify: `npm test`\n',
  );
  const home = mkdtempSync(join(tmpdir(), 'doctor-home-'));
  const result = spawnSync(
    process.execPath,
    [join(copy, 'bin', 'tds-factory.js'), 'doctor', '--json', '--agent', 'claude'],
    {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, USERPROFILE: home },
    },
  );
  return { result, report: result.stdout ? JSON.parse(result.stdout) : null };
}
const find = (report, id) => report.checks.find((c) => c.id === id) ?? report.agents[0].checks.find((c) => c.id === id);

test('doctor reports a package that ships no factory-check agent as a missing agent, not a crash', () => {
  const { result, report } = brokenPackage((copy) => {
    for (const file of readdirSync(join(copy, 'agents', 'claude')).filter((f) => f.startsWith('factory-check.')))
      rmSync(join(copy, 'agents', 'claude', file));
  });
  assert.doesNotMatch(result.stderr, /TypeError/);
  const review = find(report, 'review');
  assert.equal(review.status, 'fail');
  assert.match(review.message, /the factory-check Stage agent \(factory-check\.\*\)/);
});

test('doctor reports a package.json whose engines.node names no version as a failed cli check, not a crash', () => {
  const { result, report } = brokenPackage((copy) => {
    const file = join(copy, 'package.json');
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    pkg.engines = { node: 'latest' };
    writeFileSync(file, JSON.stringify(pkg));
  });
  assert.doesNotMatch(result.stderr, /TypeError/);
  const cli = find(report, 'cli');
  assert.equal(cli.status, 'fail');
  assert.match(cli.message, /no Node version/);
});
