// @ts-check
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { messageOf } from './narrow.js';

/** Where a command's output goes: `process.stdout` and `process.stderr` qualify, and so does a test's collector. @typedef {{ write(chunk: string): unknown }} Sink */
/**
 * What `main` runs with; every field defaults to the real process.
 * `onTerminate` registers what stops a long-running command (the Dashboard) when the process is told to end.
 * @typedef {{ cwd?: string, env?: NodeJS.ProcessEnv, stdout?: Sink, stderr?: Sink, onTerminate?: (stop: () => Promise<unknown>) => void }} CliContext
 */

const USAGE = `Usage:
  tds-factory --version
  tds-factory sync [--force]       (maintainers only: needs a repository checkout, run it as node bin/tds-factory.js sync)
  tds-factory install [--agent claude|codex|copilot|all] [--project] [--force] [--dry-run]
  tds-factory rules [--force] [--dry-run]   (writes .claude/rules/ copies of .github/instructions/*.instructions.md, with applyTo as paths)
  tds-factory update [--no-force]
  tds-factory doctor [--agent claude|codex|copilot] [--json]
  tds-factory dashboard [--port N]   (one Dashboard for every Project on port 4300, or the next free port; --port N starts a separate one that is not shared)
  tds-factory run start --data JSON
  tds-factory run update --id ID --data JSON
  tds-factory run track --id ID --value fast|full   (in Define, after the user chose or confirmed the track)
  tds-factory run transition --id ID --to build|check|finish|follow-up [--data JSON]
  tds-factory run split --id ID   (when a Run waits for the Run size answer in Build: keeps the Tickets done, prints the links of the others; only after the user chose to split)
  tds-factory run size --id ID [--accept]   (prints the Run size; --accept records the user's acceptance of the size, only after the user answered)
  tds-factory run follow-up --id ID [--scope conflicts|checks|comments]   (observes the GitHub or Azure DevOps PR; --scope is required when it has findings, and only that scope goes back to Build as a Rework)
  tds-factory run rework --id ID [--cause CAUSE]... [--data JSON]   (CAUSE: stale-doc, test-gap, spec-gap, security, bug, size or other)
  tds-factory run sync --id ID [--data JSON]   (rebases the Run branch onto origin's default branch)
  tds-factory run complete --id ID [--data JSON]
  tds-factory run accept --id ID --data '{"findings":"...","decision":"..."}'
  tds-factory run verify --id ID [--fast]
  tds-factory run sweep --id ID [--term TEXT]... [--files]   (--files prints only the documents still to read)
  tds-factory run guides --id ID   (lists the instruction guides recorded in the Run's conventions that apply to its diff: the unscoped ones and the ones whose applyTo globs match)
  tds-factory run stats --id ID | --all
  tds-factory run inspect [--id ID] [--json]
  tds-factory run repair --id ID [--apply]
  tds-factory run config --id ID   (prints the project settings frozen for the Run: models, Check loop cap, labels, usage)
  tds-factory run reviews --id ID
  tds-factory run materialize-review --id ID --axis ID
  tds-factory run review --id ID --axis ID --data JSON
  tds-factory run verdict --id ID --axis standards|spec|security|infrastructure --value pass|fail|skipped [--carried]
  tds-factory run clean --id ID | --all     (after the PR is merged, from the main checkout: removes the Run worktree and branch)

install defaults to the user-global directory; --project installs into the current directory.
--dry-run prints what install would do and changes nothing.
update installs the latest Release when yours is older and refreshes the skills with install --force, which replaces edited agent files
and skills, and same-named skills that tds-factory did not install; --no-force keeps them.`;

const OPTIONS = /** @type {const} */ ({
  agent: { type: 'string' },
  project: { type: 'boolean', default: false },
  force: { type: 'boolean', default: false },
  'no-force': { type: 'boolean', default: false },
  'dry-run': { type: 'boolean', default: false },
  data: { type: 'string' },
  id: { type: 'string' },
  to: { type: 'string' },
  scope: { type: 'string' },
  axis: { type: 'string' },
  value: { type: 'string' },
  json: { type: 'boolean', default: false },
  apply: { type: 'boolean', default: false },
  all: { type: 'boolean', default: false },
  files: { type: 'boolean', default: false },
  cause: { type: 'string', multiple: true },
  accept: { type: 'boolean', default: false },
  fast: { type: 'boolean', default: false },
  carried: { type: 'boolean', default: false },
  term: { type: 'string', multiple: true },
  port: { type: 'string' },
  version: { type: 'boolean', default: false },
});

/**
 * Runs one tds-factory command and resolves to its exit code. It never sets `process.exitCode` and never calls `process.exit`.
 * @param {string[]} argv The arguments after the script name.
 * @param {CliContext} [context]
 * @returns {Promise<number>}
 */
export async function main(argv, context = {}) {
  const {
    cwd = process.cwd(),
    env = process.env,
    stdout = process.stdout,
    stderr = process.stderr,
    onTerminate,
  } = context;
  /** @param {string} text */
  const out = (text) => void stdout.write(`${text}\n`);
  /** @param {string} text */
  const err = (text) => void stderr.write(`${text}\n`);
  let exitCode = 0;
  try {
    const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS });
    const [command] = positionals;
    const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    if (values.version) out(version);
    else if (command === 'run') {
      const data = values.data === undefined ? undefined : JSON.parse(values.data);
      const { openRunStore, formatMetrics } = await import('../src/run-store.js');
      const store = openRunStore(cwd);
      const [, op] = positionals;
      if (op === 'start') {
        out(store.start(data));
        const { openProjectRegistry } = await import('../src/project-registry.js');
        openProjectRegistry({ warn: (m) => err(`warning: ${m}`) }).join(store.projectDir);
      } else if (op === 'update') store.update(values.id, data);
      else if (op === 'track') store.track(values.id, values.value);
      else if (op === 'transition') {
        store.transition(values.id, values.to, data);
        if (values.to === 'check') for (const warning of store.sizeWarnings(values.id)) err(`warning: ${warning}`);
      } else if (op === 'split') {
        for (const link of store.split(values.id, { warn: err }))
          out(link.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, '?'));
      } else if (op === 'size') {
        const size = store.size(values.id, { accept: values.accept });
        if (!size) out('The Run size is unknown (no base commit, or git failed)');
        else out(`${size.files} file${size.files === 1 ? '' : 's'}, ${Math.round(size.bytes / 1024)} KB`);
      } else if (op === 'follow-up') out(String(store.followUp(values.id, { scope: values.scope })));
      else if (op === 'rework') store.rework(values.id, data, values.cause ?? []);
      else if (op === 'sync') store.sync(values.id, data);
      else if (op === 'complete') {
        store.complete(values.id, data);
        out(
          `Done. After the PR is merged, run \`tds-factory run clean --id ${values.id}\` from the main checkout to remove the Run worktree and branch.`,
        );
      } else if (op === 'clean') {
        if (Boolean(values.id) === values.all) throw new Error('run clean needs --id ID or --all, not both');
        for (const { id, outcome, reason } of values.all ? store.cleanAll() : [store.clean(values.id)])
          out(
            (reason ? `${outcome} ${id}: ${reason}` : `${outcome} ${id}`).replace(
              /[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g,
              '?',
            ),
          );
      } else if (op === 'stats') {
        if (Boolean(values.id) === values.all) throw new Error('run stats needs --id ID or --all, not both');
        const { rowLine } = await import('../src/run-usage.js');
        const report = await store.stats(values.id);
        /**
         * @param {string} label
         * @param {Parameters<typeof formatMetrics>[0]} summary
         */
        const print = (label, summary) => {
          const formatted = formatMetrics(summary);
          out(
            `${label}${formatted.track ? `\n  Track: ${formatted.track}` : ''}\n${Object.entries(formatted.stages)
              .map(([stage, value]) => `  ${stage[0].toUpperCase()}${stage.slice(1)}: ${value}`)
              .join(
                '\n',
              )}\n  Reworks: ${formatted.reworks}\n  Rework causes: ${formatted.reworkCauses}\n  First-pass clean rate: ${formatted.firstPass}\n  Tokens: ${formatted.tokens}\n  Cost: ${formatted.cost}`,
          );
          for (const row of formatted.usage.rows) out(`    ${rowLine(row)}`);
          for (const gap of formatted.usage.gaps ?? []) out(`    ${gap.label} · no data`);
        };
        for (const run of report.runs) {
          const name = run.id.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, '?');
          if (run.unreadable) out(`${name}: unreadable (no data)`);
          else if (run.summary) print(name, run.summary);
        }
        if (values.all) {
          print('Total observed', report.total);
          for (const [track, { runs, total }] of Object.entries(report.byTrack))
            if (runs) print(`Total observed, ${track[0].toUpperCase()}${track.slice(1)} track (${runs} Run(s))`, total);
          if (report.usage.tracked) {
            out(`Token usage of ${report.usage.tracked} tracked Run(s)`);
            for (const row of report.usage.rows) out(`  ${rowLine(row)}`);
          }
          if (report.usage.left.length)
            out(
              `Left out of the token totals (not tracked): ${report.usage.left.map((id) => id.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, '?')).join(', ')}`,
            );
          const missing = report.runs.filter(
            (run) =>
              !run.summary ||
              Object.values(run.summary.stages).some((value) => value.ms === null) ||
              run.summary.reworks === null,
          ).length;
          if (missing) out(`${missing} Run(s) have missing or unreadable data; totals include observed values only.`);
        }
      } else if (op === 'accept') store.accept(values.id, data);
      else if (op === 'inspect') {
        const report = await store.inspect(values.id);
        if (values.json) out(JSON.stringify(report, null, 2));
        else {
          for (const { id, problems } of report.filter((r) => r.problems.length))
            out([id, ...problems.map((p) => `  - ${p.message}`)].join('\n'));
          if (report.every((r) => !r.problems.length)) out('no problems found');
        }
      } else if (op === 'repair') {
        const plan = store.repairPlan(values.id);
        out(
          [
            `Proposed repair for ${plan.id}:`,
            ...plan.notes.map((n) => `  - ${n}`),
            ...plan.actions.map((a) => `  - Would ${a}`),
            ...plan.blockers.map((b) => `  - Blocked: ${b}`),
          ].join('\n'),
        );
        if (values.apply) {
          store.repairApply(values.id, plan);
          out('Repair applied.');
        }
      } else if (op === 'verify') {
        const result = store.verify(values.id, { fast: values.fast });
        if (result.fast) {
          out(
            `fast verify ${result.exit_code === 0 ? 'passed' : result.signal ? `interrupted (${result.signal})` : `failed (exit ${result.exit_code})`} at ${result.head}${result.dirty ? ' with uncommitted changes' : ''}; output in ${result.log}; not Evidence: run the full verify before Check`,
          );
        } else
          out(
            `verify ${result.exit_code === 0 ? 'passed' : result.signal ? `interrupted (${result.signal})` : `failed (exit ${result.exit_code})`} at ${result.head}${result.dirty ? ' with uncommitted changes' : ''}; output in ${result.log}`,
          );
        if (result.exit_code !== 0) exitCode = 1;
      } else if (op === 'sweep') {
        const { formatSweep } = await import('../src/run-sweep.js');
        out(formatSweep(store.sweep(values.id, values.term ?? []), { filesOnly: values.files }));
      } else if (op === 'guides') {
        const { formatGuides } = await import('../src/guides.js');
        out(formatGuides(store.guides(values.id)));
      } else if (op === 'materialize-review') out(store.materializeReview(values.id, values.axis));
      else if (op === 'review') store.review(values.id, values.axis, data);
      else if (op === 'config') out(JSON.stringify(store.config(values.id), null, 2));
      else if (op === 'reviews') out(JSON.stringify(store.reviews(values.id), null, 2));
      else if (op === 'verdict') store.verdict(values.id, values.axis, values.value, { carried: values.carried });
      else
        throw new Error(
          'expected run start, update, transition, follow-up, rework, sync, complete, accept, verify, sweep, guides, verdict, inspect, repair or clean',
        );
    } else if (command === 'update')
      await (
        await import('../src/update.js')
      ).update({ installed: version, force: !values['no-force'], env, log: out, warn: err });
    else if (command === 'sync') (await import('../src/sync.js')).sync({ force: values.force, log: out });
    else if (command === 'rules')
      (await import('../src/rules.js')).syncRules({
        project: cwd,
        force: values.force,
        dryRun: values['dry-run'],
        log: out,
      });
    else if (command === 'install')
      (await import('../src/install.js')).install({
        ...values,
        agent: values.agent ?? 'all',
        dryRun: values['dry-run'],
        cwd,
        log: out,
        warn: err,
      });
    else if (command === 'doctor') {
      const { doctor } = await import('../src/doctor.js');
      const report = doctor({ projectDir: cwd, agent: values.agent, env });
      /** @param {string} text */
      const clean = (text) => text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '?');
      if (values.json) out(JSON.stringify(report, null, 2));
      else {
        for (const { id, status, message } of report.checks) out(`${status.padEnd(7)} ${id}: ${clean(message)}`);
        for (const { id, usable, checks } of report.agents) {
          out(`${id}: ${usable ? 'usable' : 'not usable'}`);
          for (const check of checks) out(`  ${check.status.padEnd(7)} ${check.id}: ${clean(check.message)}`);
        }
        for (const note of report.notes) out(`note    ${clean(note)}`);
      }
      if (!report.ok) exitCode = 1;
    } else if (command === 'dashboard') {
      const port = values.port === undefined ? undefined : Number(values.port);
      if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535))
        throw new Error(`invalid port: ${values.port}`);
      const { launchDashboard } = await import('../src/dashboard-launch.js');
      const dashboard = await launchDashboard({ projectDir: cwd, port, version });
      const link =
        process.stdout.isTTY && !process.env.NO_COLOR
          ? `\x1b]8;;${dashboard.url}\x1b\\${dashboard.url}\x1b]8;;\x1b\\`
          : dashboard.url;
      if (dashboard.reused) out(`Dashboard already running; open ${link}`);
      else {
        out(`Dashboard running at ${link} (Ctrl+C to stop)`);
        onTerminate?.(() => dashboard.close());
      }
    } else {
      out(USAGE);
      exitCode = command ? 1 : 0;
    }
  } catch (caught) {
    err(`error: ${messageOf(caught).replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, '?')}`);
    exitCode = 1;
  }
  return exitCode;
}
