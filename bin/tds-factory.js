#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { install } from '../src/install.js';
import { openRunStore, formatMetrics } from '../src/run-store.js';
import { sync } from '../src/sync.js';
import { startDashboard } from '../src/dashboard.js';
import { doctor } from '../src/doctor.js';
import { update } from '../src/update.js';

const USAGE = `Usage:
  tds-factory --version
  tds-factory sync [--force]       (maintainers only: needs a repository checkout, run it as node bin/tds-factory.js sync)
  tds-factory install [--agent claude|codex|copilot|all] [--project] [--force] [--dry-run]
  tds-factory update [--no-force]
  tds-factory doctor [--agent claude|codex|copilot] [--json]
  tds-factory dashboard [--port N]
  tds-factory run start --data JSON
  tds-factory run update --id ID --data JSON
  tds-factory run track --id ID --value fast|full   (in Define, after the user chose or confirmed the track)
  tds-factory run transition --id ID --to build|check|finish|follow-up [--data JSON]
  tds-factory run follow-up --id ID
  tds-factory run rework --id ID [--data JSON]
  tds-factory run sync --id ID [--data JSON]   (rebases the Run branch onto origin's default branch)
  tds-factory run complete --id ID [--data JSON]
  tds-factory run accept --id ID --data '{"findings":"...","decision":"..."}'
  tds-factory run verify --id ID
  tds-factory run stats --id ID | --all
  tds-factory run inspect [--id ID] [--json]
  tds-factory run repair --id ID [--apply]
  tds-factory run reviews --id ID
  tds-factory run materialize-review --id ID --axis ID
  tds-factory run review --id ID --axis ID --data JSON
  tds-factory run verdict --id ID --axis standards|spec|security|infrastructure --value pass|fail|skipped
  tds-factory run clean --id ID | --all     (after the PR is merged, from the main checkout: removes the Run worktree and branch)

install defaults to the user-global directory; --project installs into the current directory.
--dry-run prints what install would do and changes nothing.
update installs the latest Release when yours is older and refreshes the skills with install --force, which replaces edited agent files
and skills, and same-named skills that tds-factory did not install; --no-force keeps them.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    agent: { type: 'string' },
    project: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    'no-force': { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    data: { type: 'string' },
    id: { type: 'string' },
    to: { type: 'string' },
    axis: { type: 'string' },
    value: { type: 'string' },
    json: { type: 'boolean', default: false },
    apply: { type: 'boolean', default: false },
    all: { type: 'boolean', default: false },
    port: { type: 'string' },
    version: { type: 'boolean', default: false },
  },
});

try {
  const [command] = positionals;
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  if (values.version) console.log(version);
  else if (command === 'run') {
    const data = values.data === undefined ? undefined : JSON.parse(values.data);
    const store = openRunStore(process.cwd());
    const [, op] = positionals;
    if (op === 'start') console.log(store.start(data));
    else if (op === 'update') store.update(values.id, data);
    else if (op === 'track') store.track(values.id, values.value);
    else if (op === 'transition') store.transition(values.id, values.to, data);
    else if (op === 'follow-up') console.log(store.followUp(values.id));
    else if (op === 'rework') store.rework(values.id, data);
    else if (op === 'sync') store.sync(values.id, data);
    else if (op === 'complete') {
      store.complete(values.id, data);
      console.log(`Done. After the PR is merged, run \`tds-factory run clean --id ${values.id}\` from the main checkout to remove the Run worktree and branch.`);
    }
    else if (op === 'clean') {
      if (Boolean(values.id) === values.all) throw new Error('run clean needs --id ID or --all, not both');
      for (const { id, outcome, reason } of values.all ? store.cleanAll() : [store.clean(values.id)]) console.log((reason ? `${outcome} ${id}: ${reason}` : `${outcome} ${id}`).replace(/[\x00-\x1f\x7f-\x9f]/g, '?'));
    }
    else if (op === 'stats') {
      if (Boolean(values.id) === values.all) throw new Error('run stats needs --id ID or --all, not both');
      const report = await store.stats(values.id);
      const print = (label, summary) => {
        const formatted = formatMetrics(summary);
        console.log(`${label}${formatted.track ? `\n  Track: ${formatted.track}` : ''}\n${Object.entries(formatted.stages).map(([stage, value]) => `  ${stage[0].toUpperCase()}${stage.slice(1)}: ${value}`).join('\n')}\n  Reworks: ${formatted.reworks}\n  First-pass clean rate: ${formatted.firstPass}\n  Tokens: ${formatted.tokens}\n  Cost: ${formatted.cost}`);
      };
      for (const run of report.runs) {
        const name = run.id.replace(/[\x00-\x1f\x7f-\x9f]/g, '?');
        if (run.unreadable) console.log(`${name}: unreadable (no data)`);
        else print(name, run.summary);
      }
      if (values.all) {
        print('Total observed', report.total);
        for (const [track, { runs, total }] of Object.entries(report.byTrack)) if (runs) print(`Total observed, ${track[0].toUpperCase()}${track.slice(1)} track (${runs} Run(s))`, total);
        const missing = report.runs.filter(run => !run.summary || Object.values(run.summary.stages).some(value => value.ms === null) || run.summary.reworks === null).length;
        if (missing) console.log(`${missing} Run(s) have missing or unreadable data; totals include observed values only.`);
      }
    }
    else if (op === 'accept') store.accept(values.id, data);
    else if (op === 'inspect') {
      const report = await store.inspect(values.id);
      if (values.json) console.log(JSON.stringify(report, null, 2));
      else {
        for (const { id, problems } of report.filter((r) => r.problems.length)) console.log([id, ...problems.map((p) => `  - ${p.message}`)].join('\n'));
        if (report.every((r) => !r.problems.length)) console.log('no problems found');
      }
    }
    else if (op === 'repair') {
      const plan = store.repairPlan(values.id);
      console.log([`Proposed repair for ${plan.id}:`, ...plan.notes.map((n) => `  - ${n}`), ...plan.actions.map((a) => `  - Would ${a}`), ...plan.blockers.map((b) => `  - Blocked: ${b}`)].join('\n'));
      if (values.apply) { store.repairApply(values.id, plan); console.log('Repair applied.'); }
    }
    else if (op === 'verify') {
      const result = store.verify(values.id);
      console.log(`verify ${result.exit_code === 0 ? 'passed' : result.signal ? `interrupted (${result.signal})` : `failed (exit ${result.exit_code})`} at ${result.head}${result.dirty ? ' with uncommitted changes' : ''}; output in ${result.log}`);
      if (result.exit_code !== 0) process.exitCode = 1;
    }
    else if (op === 'materialize-review') console.log(store.materializeReview(values.id, values.axis));
    else if (op === 'review') store.review(values.id, values.axis, data);
    else if (op === 'reviews') console.log(JSON.stringify(store.reviews(values.id), null, 2));
    else if (op === 'verdict') store.verdict(values.id, values.axis, values.value);
    else throw new Error('expected run start, update, transition, follow-up, rework, sync, complete, accept, verify, verdict, inspect, repair or clean');
  }
  else if (command === 'update') await update({ installed: version, force: !values['no-force'] });
  else if (command === 'sync') sync({ force: values.force });
  else if (command === 'install') install({ ...values, agent: values.agent ?? 'all', dryRun: values['dry-run'] });
  else if (command === 'doctor') {
    const report = doctor({ projectDir: process.cwd(), agent: values.agent });
    if (values.json) console.log(JSON.stringify(report, null, 2));
    else for (const { id, status, message } of report.checks) console.log(`${status.padEnd(7)} ${id}: ${message.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '?')}`);
    if (!values.json) for (const note of report.notes) console.log(`note    ${note.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '?')}`);
    if (!report.ok) process.exitCode = 1;
  }
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
