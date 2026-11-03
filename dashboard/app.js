// State, polling and actions of the Dashboard page; components.js holds the markup.
/** @import { RunView } from './model.js' */
/** @import { ConfirmRequest, Actions } from './components.js' */
import { render } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Board, ConfirmDialog, Detail, Header, HelpPanel, Welcome, html } from './components.js';
import { COLUMNS, OLD_MS, POLL_MS, ageMs, folderName, sortWaitingFirst } from './model.js';

const BRAND = 'TDS Factory';
const COMPACT_QUERY = '(max-width: 1024px)'; // keep in step with the media query in style.css

// 'default' while the user can still be asked, 'unsupported' without the Notification API.
const notifyPermission = () =>
  typeof window.Notification === 'function' ? window.Notification.permission : 'unsupported';

// The hash alone would leave focus in the header, and the board is not focusable by link in every browser.
/** @param {Event} event */
function skipToBoard(event) {
  event.preventDefault();
  document.getElementById('board')?.focus();
}

function App() {
  const [entries, setEntries] = useState(/** @type {RunView[]} */ ([]));
  const [project, setProject] = useState('');
  const [version, setVersion] = useState('');
  const [status, setStatus] = useState({ error: false, text: 'Loading...' });
  const [selectedId, setSelectedId] = useState(/** @type {string | null} */ (null));
  const [selectedStage, setSelectedStage] = useState(/** @type {string | null} */ (null));
  const [loaded, setLoaded] = useState(false); // true after the first successful poll
  const [compact, setCompact] = useState(() => window.matchMedia(COMPACT_QUERY).matches);
  const [showOlder, setShowOlder] = useState(false); // Runs older than a week stay folded until asked for
  const [expandedIds, setExpandedIds] = useState(() => new Set()); // Done cards the user opened
  const [request, setRequest] = useState(/** @type {ConfirmRequest | null} */ (null));
  const [helpOpen, setHelpOpen] = useState(false);
  const [onlyWaiting, setOnlyWaiting] = useState(false); // the Needs you filter; not saved
  const queue = useRef(Promise.resolve());
  /** @type {{ current: ConfirmRequest | null }} */
  const current = useRef(null);
  /** @type {{ current: string | null }} */
  const token = useRef(null);
  /** @type {{ current: Set<string> | null }} */
  const known = useRef(null); // ids of Runs that were waiting at the last poll; null before the first one
  const [, setAsked] = useState(0); // re-render after the permission question; the permission itself is read at render time
  /** @type {{ current: HTMLElement | null }} */
  const returnFocus = useRef(null);
  /** @type {{ current: RunView | null }} */
  const shown = useRef(null); // the Run whose detail is open, as of the last render; the Escape handler outlives renders
  current.current = request;

  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY);
    const change = (/** @type {MediaQueryListEvent} */ event) => setCompact(event.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);

  const poll = useCallback(
    () =>
      fetch('/api/views', { cache: 'no-store' })
        .then((res) => {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then((data) => {
          setEntries(Array.isArray(data) ? data : []);
          setLoaded(true);
          setStatus({ error: false, text: 'Updated ' + new Date().toLocaleTimeString() });
        })
        .catch((err) =>
          setStatus({
            error: true,
            text: 'Cannot reach the server (' + err.message + '); showing last data. Retrying...',
          }),
        ),
    [],
  );

  useEffect(() => {
    poll();
    const timer = setInterval(poll, POLL_MS);
    fetch('/api/info', { cache: 'no-store' })
      .then((res) => res.json())
      .then((info) => {
        setProject(typeof info.project === 'string' ? info.project.trim() : '');
        setVersion(typeof info.version === 'string' ? info.version.trim() : '');
      })
      .catch(() => {});
    return () => clearInterval(timer);
  }, []);

  // Closing the Run detail hands focus back to its card.
  const closeDetail = () => {
    const card = document.querySelector('.card[data-id="' + CSS.escape(String(selectedId)) + '"]');
    if (shown.current) setSelectedStage(shown.current.column); // the Run may have moved while its detail was open
    const target = card instanceof HTMLElement ? card : null;
    if (compact) returnFocus.current = target;
    else if (target) target.focus();
    setSelectedId(null);
  };

  // Confirmations are shown one after the other; each resolves to true when the user confirms.
  /**
   * @param {string} title
   * @param {string} message
   * @param {string} action
   * @param {boolean} [danger]
   * @param {boolean} [notice]
   * @returns {Promise<boolean>}
   */
  const ask = (title, message, action, danger, notice) => {
    const result = queue.current.then(
      () =>
        new Promise((/** @type {(confirmed: boolean) => void} */ resolve) =>
          setRequest({ title, message, action, danger, notice, resolve }),
        ),
    );
    queue.current = result.then(() => {});
    return result;
  };
  const closeDialog = (/** @type {boolean} */ confirmed) => {
    const open = current.current;
    setRequest(null);
    if (open) open.resolve(confirmed);
  };

  // Every write carries the session token the server gave this page (ADR 0017).
  /**
   * @param {string} method
   * @param {string} url
   */
  const write = async (method, url) => {
    /** @type {string} */
    const given = (token.current ??= (await (await fetch('/api/info', { cache: 'no-store' })).json()).token);
    return fetch(url, { method, headers: { 'x-factory-token': given } });
  };
  /**
   * @param {RunView} run
   * @param {string} name
   * @param {string} title
   * @param {string} message
   * @param {string} action
   * @param {string} done
   * @param {string} [query]
   */
  const runAction = async (run, name, title, message, action, done, query = '') => {
    if (!(await ask(title, message, action, false))) return;
    try {
      const response = await write('POST', '/api/runs/' + encodeURIComponent(run.id) + '/' + name + query);
      const text = await response.text();
      await ask(
        response.ok
          ? done
          : 'Could not ' +
              (name === 'sync'
                ? 'sync the Run'
                : name === 'clean'
                  ? 'clean up the Run'
                  : name === 'extra-loop'
                    ? 'grant the extra loop'
                    : 'accept the Check'),
        response.ok ? (name === 'clean' ? text : done + '.') : text,
        'Close',
        false,
        true,
      );
    } catch {
      await ask(
        'Could not ' +
          (name === 'sync'
            ? 'sync the Run'
            : name === 'clean'
              ? 'clean up the Run'
              : name === 'extra-loop'
                ? 'grant the extra loop'
                : 'accept the Check'),
        run.title,
        'Close',
        false,
        true,
      );
    }
    poll();
  };
  const syncRun = (/** @type {RunView} */ run) =>
    runAction(
      run,
      'sync',
      'Sync with origin?',
      'Rebase the branch of "' +
        run.title +
        '" onto the default branch of origin. Evidence is cleared when the code or the base changes. Conflicts leave the branch unchanged.',
      'Sync',
      'Synced',
    );
  const cleanRun = (/** @type {RunView} */ run) =>
    runAction(
      run,
      'clean',
      'Clean up Run?',
      'Remove the Run worktree and local branch of "' +
        run.title +
        '". The Run record stays. This is refused unless its pull request is merged.',
      'Clean up',
      'Cleaned up',
    );
  const acceptRun = (/** @type {RunView} */ run) => {
    const open = [
      ['Standards', run.standards],
      ['Spec', run.spec],
      ['Security', run.security],
      ['Infrastructure', run.infrastructure],
    ]
      .map(([name, verdict]) => name + ': ' + (verdict || 'no verdict'))
      .join(', ');
    return runAction(
      run,
      'accept',
      'Accept this Check?',
      'Continue "' +
        run.title +
        '" to Finish with a Check that is not clean. ' +
        open +
        '. Only the current code is accepted; a new commit voids this.',
      'Accept and continue',
      'Accepted',
      '?updated=' + encodeURIComponent(run.updated),
    );
  };

  const grantRun = (/** @type {RunView} */ run) =>
    runAction(
      run,
      'extra-loop',
      'Grant an extra Check loop?',
      '"' +
        run.title +
        '" has used its ' +
        run.loopCap +
        ' Check loops. This allows one more Rework and raises the limit to ' +
        ((run.loopCap ?? 0) + 1) +
        '. Then tell the agent in its chat to continue. You can grant another loop later; there is no ceiling.',
      'Grant extra loop',
      'Extra loop granted',
      '?updated=' + encodeURIComponent(run.updated),
    );
  /**
   * @param {RunView[]} runs
   * @param {string} message
   * @param {boolean} [doneOnly]
   */
  const removeRuns = async (runs, message, doneOnly = false) => {
    if (!(await ask(runs.length === 1 ? 'Delete Run?' : 'Delete all Done Runs?', message, 'Delete', true))) return;
    /** @type {string[]} */
    const failed = [];
    for (const run of runs) {
      try {
        const url = '/api/runs/' + encodeURIComponent(run.id);
        const query = doneOnly ? '?doneOnly=true' : '';
        let response = await write('DELETE', url + query);
        if (response.status === 409 && response.headers.get('x-factory-error') === 'dirty-worktree') {
          if (
            !(await ask(
              'Discard uncommitted changes?',
              'The Run "' +
                run.title +
                '" has uncommitted changes. They will be permanently lost and its Run worktree removed. Continue?',
              'Discard and delete',
              true,
            ))
          )
            continue;
          response = await write('DELETE', url + (query ? query + '&' : '?') + 'discardChanges=true');
        }
        if (!response.ok) failed.push(run.title + ' (' + (await response.text()) + ')');
      } catch {
        failed.push(run.title);
      }
    }
    if (failed.length) await ask('Could not delete', failed.join(', '), 'Close', false, true);
    poll();
  };

  const mergeRun = async (/** @type {RunView} */ run) => {
    let checks = 'GitHub checks: unavailable';
    try {
      const response = await fetch('/api/runs/' + encodeURIComponent(run.id) + '/merge-checks', { cache: 'no-store' });
      if (response.ok) checks = await response.text();
    } catch {}
    if (
      !(await ask(
        'Squash and merge?',
        'Merge the pull request for "' + run.title + '"?\n' + run.pr + '\n\n' + checks,
        'Squash and merge',
        false,
      ))
    )
      return;
    try {
      const response = await write('POST', '/api/runs/' + encodeURIComponent(run.id) + '/merge');
      if (!response.ok) await ask('Could not merge', await response.text(), 'Close', false, true);
    } catch {
      await ask('Could not merge', run.title, 'Close', false, true);
    }
    poll();
  };

  const doneRuns = entries.filter((r) => r.column === 'done');
  // Runs waiting on the user are never hidden.
  const older = entries.filter((r) => {
    const a = ageMs(r.updated);
    return a !== null && a > OLD_MS && !r.waiting;
  });
  // Newest first within a column; unreadable and undated records sort last.
  const runs = sortWaitingFirst(
    entries
      .filter((r) => showOlder || !older.includes(r))
      .sort((a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id)),
  ); // waiting Runs first in every Stage
  const defaultStage =
    COLUMNS.find((c) => runs.some((r) => r.column === c.key && r.waiting))?.key ??
    COLUMNS.find((c) => runs.some((r) => r.column === c.key))?.key ??
    COLUMNS[0].key;
  const stage = selectedStage ?? defaultStage;
  // The first view picks a Stage once and keeps it, so polling never moves the user to another Stage.
  useEffect(() => {
    if (selectedStage === null && loaded) setSelectedStage(defaultStage);
  }, [selectedStage, loaded, defaultStage]);
  const openRun = runs.find((r) => r.id === selectedId) || null; // the Run whose detail is shown
  shown.current = openRun;
  useEffect(() => {
    if (selectedId && !openRun) setSelectedId(null);
  }, [openRun]); // a Run that left the list must not reopen its detail when it returns
  // Compact detail covers the board, so focus returns to the card once the board is shown again.
  useLayoutEffect(() => {
    if (!openRun && returnFocus.current) {
      returnFocus.current.focus({ preventScroll: true });
      returnFocus.current.scrollIntoView({ block: 'nearest' }); // the card may sit in another Stage list than the scroll position restored
      returnFocus.current = null;
    }
  }, [!!openRun]);
  const waiting = entries.filter((r) => r.waiting).length;
  // A browser notification for each Run that starts waiting on the user while the page is open; Runs already waiting at the first poll only count in the title.
  useEffect(() => {
    if (!loaded) return;
    const now = new Set(entries.filter((r) => r.waiting).map((r) => r.id));
    if (known.current && notifyPermission() === 'granted') {
      for (const r of entries)
        if (r.waiting && !known.current.has(r.id)) {
          try {
            new Notification('Needs you: ' + r.title, { body: r.reason || 'This Run is waiting on you.', tag: r.id });
          } catch {}
        }
    }
    known.current = now;
  }, [entries, loaded]);
  const enableNotify = async () => {
    try {
      await Notification.requestPermission();
    } catch {}
    setAsked((n) => n + 1);
  };
  useEffect(() => {
    const name = folderName(project);
    document.title = (waiting ? '(' + waiting + ') ' : '') + (name ? name + ' · ' : '') + BRAND;
  }, [waiting, project]);

  /** @type {Actions} */
  const actions = {
    select: (id) => {
      const selected = runs.find((run) => run.id === id);
      if (selected) setSelectedStage(selected.column);
      setSelectedId((now) => (now === id ? null : id));
    },
    toggle: (id) =>
      setExpandedIds((now) => {
        const next = new Set(now);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    checkPr: async (run) => {
      try {
        await fetch('/api/runs/' + encodeURIComponent(run.id) + '/pr-status?refresh=1', { cache: 'no-store' });
      } catch {}
      poll();
    },
    merge: mergeRun,
    sync: syncRun,
    clean: cleanRun,
    accept: acceptRun,
    grant: grantRun,
    remove: (run) =>
      removeRuns(
        [run],
        'Permanently delete "' +
          run.title +
          '" and its Run record, summaries, and Run worktree (if created by the Factory)?' +
          (!['done', 'abandoned'].includes(run.status) ? ' Stop its agent before deleting this Run.' : ''),
      ),
    deleteAll: () =>
      removeRuns(
        doneRuns,
        'Permanently delete all ' +
          doneRuns.length +
          ' Done Runs and their records, summaries, and Factory-created Run worktrees, including hidden older Runs?',
        true,
      ),
  };
  const olderLabel = older.length ? (showOlder ? 'Hide older runs' : 'Show older (' + older.length + ')') : '';

  const showsBoard = !(loaded && !entries.length);

  return html`${showsBoard && html`<a class="skip-link" href="#board" onClick=${skipToBoard}>Skip to the Runs</a>`}<${Header} project=${project} version=${version} status=${status} olderLabel=${olderLabel} onOlder=${() => setShowOlder((v) => !v)} canNotify=${notifyPermission() === 'default'} onNotify=${enableNotify} waitingCount=${waiting} onlyWaiting=${onlyWaiting} onToggleWaiting=${() => setOnlyWaiting((v) => !v)} onHelp=${() => setHelpOpen(true)} />
    <div id="layout">
      ${loaded && !entries.length ? html`<${Welcome} onHelp=${() => setHelpOpen(true)} />` : html`<${Board} runs=${onlyWaiting ? runs.filter((r) => r.waiting) : runs} onlyWaiting=${onlyWaiting} stage=${stage} onStage=${setSelectedStage} selectedId=${selectedId} expandedIds=${expandedIds} doneCount=${doneRuns.length} actions=${actions} />`}
      <${Detail} run=${openRun} onClose=${closeDetail} onCheckPr=${actions.checkPr} onGrant=${actions.grant} />
    </div>
    <${ConfirmDialog} request=${request} onClose=${closeDialog} />
    <${HelpPanel} open=${helpOpen} onClose=${() => setHelpOpen(false)} />`;
}

const root = document.getElementById('app');
if (!root) throw new Error('index.html has no #app element');
render(html`<${App} />`, root);
