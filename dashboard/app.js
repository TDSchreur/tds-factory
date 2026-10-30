// State, polling and actions of the Dashboard page; components.js holds the markup.
import { render } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { Board, ConfirmDialog, Detail, Header, Intro, html } from './components.js';
import { OLD_MS, POLL_MS, ageMs, folderName } from './model.js';

const BRAND = 'TDS Factory';

function App() {
  const [entries, setEntries] = useState([]);
  const [project, setProject] = useState('');
  const [status, setStatus] = useState({ error: false, text: 'Loading...' });
  const [selectedId, setSelectedId] = useState(null);
  const [showOlder, setShowOlder] = useState(false); // Runs older than a week stay folded until asked for
  const [expandedIds, setExpandedIds] = useState(() => new Set()); // Done cards the user opened
  const [request, setRequest] = useState(null);
  const queue = useRef(Promise.resolve());
  const current = useRef(null);
  current.current = request;

  const poll = useCallback(() => fetch('/api/views', { cache: 'no-store' })
    .then((res) => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
    .then((data) => {
      setEntries(Array.isArray(data) ? data : []);
      setStatus({ error: false, text: 'Updated ' + new Date().toLocaleTimeString() });
    })
    .catch((err) => setStatus({ error: true, text: 'Cannot reach the server (' + err.message + '); showing last data. Retrying...' })), []);

  useEffect(() => {
    poll();
    const timer = setInterval(poll, POLL_MS);
    fetch('/api/info', { cache: 'no-store' }).then((res) => res.json()).then((info) => setProject(typeof info.project === 'string' ? info.project.trim() : '')).catch(() => {});
    return () => clearInterval(timer);
  }, []);

  // Closing the Run detail hands focus back to its card.
  const closeDetail = () => {
    const card = document.querySelector('.card[data-id="' + CSS.escape(selectedId) + '"]');
    setSelectedId(null);
    if (card) card.focus();
  };
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && selectedId && !document.querySelector('dialog[open]')) closeDetail(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedId]);

  // Confirmations are shown one after the other; each resolves to true when the user confirms.
  const ask = (title, message, action, danger, notice) => {
    const result = queue.current.then(() => new Promise((resolve) => setRequest({ title, message, action, danger, notice, resolve })));
    queue.current = result.then(() => {});
    return result;
  };
  const closeDialog = (confirmed) => {
    const open = current.current;
    setRequest(null);
    if (open) open.resolve(confirmed);
  };

  const removeRuns = async (runs, message, doneOnly = false) => {
    if (!await ask(runs.length === 1 ? 'Delete Run?' : 'Delete all Done Runs?', message, 'Delete', true)) return;
    const failed = [];
    for (const run of runs) {
      try {
        const url = '/api/runs/' + encodeURIComponent(run.id);
        const query = doneOnly ? '?doneOnly=true' : '';
        let response = await fetch(url + query, { method: 'DELETE' });
        if (response.status === 409 && response.headers.get('x-factory-error') === 'dirty-worktree') {
          if (!await ask('Discard uncommitted changes?', 'The Run \"' + run.title + '\" has uncommitted changes. They will be permanently lost and its Run worktree removed. Continue?', 'Discard and delete', true)) continue;
          response = await fetch(url + (query ? query + '&' : '?') + 'discardChanges=true', { method: 'DELETE' });
        }
        if (!response.ok) failed.push(run.title + ' (' + (await response.text()) + ')');
      } catch (err) { failed.push(run.title); }
    }
    if (failed.length) await ask('Could not delete', failed.join(', '), 'Close', false, true);
    poll();
  };

  const mergeRun = async (run) => {
    let checks = 'GitHub checks: unavailable';
    try {
      const response = await fetch('/api/runs/' + encodeURIComponent(run.id) + '/merge-checks', { cache: 'no-store' });
      if (response.ok) checks = await response.text();
    } catch {}
    if (!await ask('Squash and merge?', 'Merge the pull request for "' + run.title + '"?\n' + run.pr + '\n\n' + checks, 'Squash and merge', false)) return;
    try {
      const response = await fetch('/api/runs/' + encodeURIComponent(run.id) + '/merge', { method: 'POST' });
      if (!response.ok) await ask('Could not merge', await response.text(), 'Close', false, true);
    } catch (err) { await ask('Could not merge', run.title, 'Close', false, true); }
    poll();
  };

  const doneRuns = entries.filter((r) => r.column === 'done');
  // Runs waiting on the user are never hidden.
  const older = entries.filter((r) => { const a = ageMs(r.updated); return a !== null && a > OLD_MS && !r.waiting; });
  // Newest first within a column; unreadable and undated records sort last.
  const runs = entries.filter((r) => showOlder || !older.includes(r)).sort((a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id));
  const openRun = runs.find((r) => r.id === selectedId) || null; // the Run whose detail is shown
  useEffect(() => { if (selectedId && !openRun) setSelectedId(null); }, [openRun]); // a Run that left the list must not reopen its detail when it returns
  const waiting = entries.filter((r) => r.waiting).length;
  useEffect(() => { const name = folderName(project); document.title = (waiting ? '(' + waiting + ') ' : '') + (name ? name + ' · ' : '') + BRAND; }, [waiting, project]);

  const actions = {
    select: (id) => setSelectedId((now) => (now === id ? null : id)),
    toggle: (id) => setExpandedIds((now) => { const next = new Set(now); if (!next.delete(id)) next.add(id); return next; }),
    merge: mergeRun,
    remove: (run) => removeRuns([run], 'Permanently delete "' + run.title + '" and its Run record, summaries, and Run worktree (if created by the Factory)?' + (!['done', 'abandoned'].includes(run.status) ? ' Stop its agent before deleting this Run.' : '')),
    deleteAll: () => removeRuns(doneRuns, 'Permanently delete all ' + doneRuns.length + ' Done Runs and their records, summaries, and Factory-created Run worktrees, including hidden older Runs?', true),
  };
  const olderLabel = older.length ? (showOlder ? 'Hide older runs' : 'Show older (' + older.length + ')') : '';

  return html`<${Header} project=${project} status=${status} olderLabel=${olderLabel} onOlder=${() => setShowOlder((v) => !v)} />
    <${Intro} />
    <div id="layout" class=${openRun ? 'open' : ''}>
      <${Board} runs=${runs} selectedId=${selectedId} expandedIds=${expandedIds} doneCount=${doneRuns.length} actions=${actions} />
      <${Detail} run=${openRun} onClose=${closeDetail} />
    </div>
    <${ConfirmDialog} request=${request} onClose=${closeDialog} />`;
}

render(html`<${App} />`, document.getElementById('app'));
