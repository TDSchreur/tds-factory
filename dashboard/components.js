// Presentational components of the Dashboard page. State, polling and actions live in app.js.
import { Fragment, h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { parseMarkdown } from './markdown.js';
import { COLUMNS, STALE_MS, ageMs, ago, chipsOf, safeUrl, ticketsOf } from './model.js';

export const html = htm.bind(h);

// An anchor that opens in a new tab for an http(s) URL; anything else is plain text.
export function Link({ href, children }) {
  const url = safeUrl(href);
  return url ? html`<a href=${url} target="_blank" rel="noopener noreferrer">${children}</a>` : html`<span>${children}</span>`;
}

const inline = (spans) => spans.map((sp) => {
  if (sp.t === 'text') return sp.v;
  if (sp.t === 'code') return html`<code>${sp.v}</code>`;
  if (sp.t === 'link') return html`<${Link} href=${sp.href}>${inline(sp.c)}<//>`;
  return h(sp.t, null, inline(sp.c));
});

function MdList({ list }) {
  const Tag = list.ordered ? 'ol' : 'ul';
  return html`<${Tag}>${list.items.map((item) => html`<li>${inline(item.inline)}${item.sub && html`<${MdList} list=${item.sub} />`}</li>`)}<//>`;
}

// Text becomes Preact text nodes only, so file content can never inject markup.
export function Markdown({ text }) {
  return html`<div class="md">${parseMarkdown(text).map((b) => {
    if (b.type === 'heading') return h('h' + Math.min(6, b.level + 3), null, inline(b.inline));
    if (b.type === 'paragraph') return html`<p>${inline(b.inline)}</p>`;
    if (b.type === 'quote') return html`<blockquote>${inline(b.inline)}</blockquote>`;
    if (b.type === 'rule') return html`<hr />`;
    if (b.type === 'code') return html`<pre><code>${b.text}</code></pre>`;
    if (b.type === 'list') return html`<${MdList} list=${b} />`;
    if (b.type === 'table') {
      return html`<div class="scroll"><table>
        <thead><tr>${b.head.map((c) => html`<th>${inline(c)}</th>`)}</tr></thead>
        <tbody>${b.rows.map((row) => html`<tr>${row.map((c) => html`<td>${inline(c)}</td>`)}</tr>`)}</tbody>
      </table></div>`;
    }
    return null;
  })}</div>`;
}

const stop = (e) => e.stopPropagation();

function Chips({ run }) {
  const chips = chipsOf(run);
  return chips.length ? html`<div class="chips">${chips.map((c) => html`<span key=${c.key} class=${'chip ' + c.cls} title=${c.tip}>${c.text}</span>`)}</div>` : null;
}

function Tickets({ run }) {
  const tickets = ticketsOf(run);
  const mark = { done: '✓', active: '▶', todo: '○' };
  return tickets.length ? html`<ul class="tickets" aria-label="Tickets">${tickets.map((t) => html`<li key=${t.href} class=${'ticket ' + t.state}><span aria-hidden="true">${mark[t.state]}</span> <${Link} href=${t.href}>${t.label}<//><span class="sr"> (${t.state})</span></li>`)}</ul>` : null;
}

// One card per Run. Done cards keep their detail in a block that starts hidden, so the Done column stays short.
const pauseLabel = (run) => run.waiting ? 'Needs you' : run.status === 'verification-unavailable' ? 'Verification unavailable' : run.status === 'interrupted' ? 'Agent interrupted' : '';

export function Card({ run, selected, expanded, onSelect, onToggle, onMerge, onDelete }) {
  const done = run.column === 'done';
  const age = ageMs(run.updated);
  const stale = age !== null && !done && !run.unreadable && age > STALE_MS;
  const prLabel = { open: 'Open', merged: 'Merged', closed: 'Closed' }[run.prState];
  const more = [
    run.activity && html`<div class="activity">${run.activity}</div>`,
    html`<${Tickets} run=${run} />`,
    html`<${Chips} run=${run} />`,
    done && run.pr && html`<div class="pr">${safeUrl(run.pr) ? html`<${Link} href=${run.pr}>Pull request<//>` : 'PR: ' + run.pr}${prLabel && html` <span class=${'badge ' + run.prState}>${prLabel}</span>`}</div>`,
    done && html`<div class="actions">
      ${run.pr && run.prState === 'open' && run.status === 'done' && html`<button type="button" class="primary" aria-label=${'Squash and merge the pull request of ' + run.title} onClick=${(e) => { stop(e); onMerge(run); }} onKeyDown=${stop}>Merge</button>`}
      <button type="button" class="danger" aria-label=${'Delete ' + run.title} onClick=${(e) => { stop(e); onDelete(run); }} onKeyDown=${stop}>Delete</button>
    </div>`,
  ];
  const toggleText = expanded ? 'Hide details' : 'Show details';
  const classes = ['card', run.unreadable && 'unreadable', run.waiting && 'waiting', selected && 'selected', run.status === 'abandoned' && 'abandoned'].filter(Boolean).join(' ');
  return html`<li class=${classes} data-id=${run.id} tabindex="0" onClick=${() => onSelect(run.id)} onKeyDown=${(e) => { if (e.key === 'Enter') onSelect(run.id); }}>
    ${pauseLabel(run) && html`<div class="reason">${pauseLabel(run)}${run.reason ? ': ' + run.reason : ''}</div>`}
    <div class="title">${(run.unreadable ? 'Unreadable record: ' : '') + run.title}</div>
    <div class="meta"><span class=${'updated' + (stale ? ' stale' : '')}>Updated: ${age === null ? 'unknown' : ago(age)}</span>${run.agent && html`<span class="agent">Agent: ${run.agent}</span>`}${run.status === 'abandoned' && html`<span class="agent">Abandoned</span>`}</div>
    ${done && run.prState === 'open' && html`<div class="open-pr"><span class="badge open">Open PR</span></div>`}
    ${!done && more}
    ${done && html`<button type="button" class="toggle" aria-expanded=${String(expanded)} aria-label=${toggleText + ': ' + run.title} onClick=${(e) => { stop(e); onToggle(run.id); }} onKeyDown=${stop}>${expanded ? '▾' : '▸'} ${toggleText}</button>`}
    ${done && html`<div class="details" hidden=${!expanded}>${more}</div>`}
  </li>`;
}

export function Board({ runs, selectedId, expandedIds, doneCount, actions }) {
  return html`<main id="board" aria-label="Runs by Stage" tabindex="-1">${COLUMNS.map((c) => {
    const mine = runs.filter((r) => r.column === c.key);
    return html`<section key=${c.key} class="column" data-stage=${c.key} aria-labelledby=${'col-' + c.key}>
      <h2 id=${'col-' + c.key} tabindex="0" title=${c.help}>${c.label}</h2>
      ${c.key === 'done' && doneCount > 0 && html`<button type="button" onClick=${actions.deleteAll}>Delete all</button>`}
      <ul class="cards">${mine.map((r) => html`<${Card} key=${r.id} run=${r} selected=${r.id === selectedId} expanded=${expandedIds.has(r.id)} onSelect=${actions.select} onToggle=${actions.toggle} onMerge=${actions.merge} onDelete=${actions.remove} />`)}</ul>
      ${!mine.length && html`<div class="empty">No runs</div>`}
    </section>`;
  })}</main>`;
}

export function Intro() {
  return html`<details id="intro">
    <summary>What is this?</summary>
    <p>The Factory walks a piece of work from idea to pull request. Each card is one Run, moving left to right through the Stages. Hover or focus a Stage heading or a chip for details.</p>
    <ol>
      <li><strong>Define</strong>: settle what to build, write a Spec and cut it into Tickets.</li>
      <li><strong>Prepare</strong>: switch to the minimal-code working style.</li>
      <li><strong>Build</strong>: implement the Tickets test-first.</li>
      <li><strong>Check</strong>: independent reviews of Standards, Spec, Security and Infrastructure.</li>
      <li><strong>Finish</strong>: open the pull request.</li>
    </ol>
    <p>A red card marked "Needs you" is waiting for your answer in the agent session. Chips show Check verdicts (pass, fail, skipped), Ticket progress and how often Check sent the Run back to Build.</p>
  </details>`;
}

const THEMES = ['system', 'light', 'dark'];
const THEME_KEY = 'dashboard-theme';

// The inline script in index.html has already applied the saved theme; this keeps the selector in step with it.
function ThemeSelect() {
  const [theme, setTheme] = useState(() => (THEMES.includes(document.documentElement.dataset.theme) ? document.documentElement.dataset.theme : 'system'));
  const change = (e) => {
    const choice = e.target.value;
    setTheme(choice);
    document.documentElement.dataset.theme = choice;
    try { localStorage.setItem(THEME_KEY, choice); } catch (err) { /* storage unavailable: the choice still applies to this page */ }
  };
  return html`<select id="theme" aria-label="Theme" value=${theme} onChange=${change}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select>`;
}

// The pill shows the last segment of the project path (either separator); the full path is its tooltip.
const folderName = (path) => String(path ?? '').split(/[\\/]/).filter(Boolean).pop() ?? '';

// The TDS mark, traced by hand from the logo PNG. The dark parts use the theme's logo colour, the blue parts keep theirs.
function Logo() {
  return html`<svg class="logo" viewBox="285 70 1205 570" aria-hidden="true" focusable="false">
    <defs><linearGradient id="logo-blue" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1a8cff" /><stop offset="1" stop-color="#0553e0" /></linearGradient></defs>
    <rect x="584" y="177" width="40" height="40" rx="5" fill="#0a7bff" />
    <rect x="638" y="124" width="61" height="64" rx="6" fill="#0a7bff" />
    <rect x="707" y="77" width="50" height="43" rx="5" fill="#3ba6ff" />
    <path class="ink" d="M287 350 385 291V338L463 291V338L540 291V352H556L563 228H622L627 357H651V431H548V636H400V431H287Z" />
    <path d="M445 478 416 512 445 547M500 478 531 512 500 547M489 462 462 567" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M669 357H905C1000 357 1066 420 1066 497C1066 575 1000 636 905 636H669V452H767V565H905C935 565 954 535 954 497C954 458 935 431 905 431H669Z" fill="url(#logo-blue)" />
    <path class="ink" d="M1190 357H1485L1408 433H1190C1170 433 1170 467 1190 467H1390C1450 467 1485 505 1485 548C1485 600 1440 636 1385 636H1052L1125 563H1375C1393 563 1395 535 1375 535H1185C1120 535 1085 500 1085 462C1085 400 1130 357 1190 357Z" />
  </svg>`;
}

export function Header({ project, status, olderLabel, onOlder }) {
  return html`<header>
    <div class="title"><h1><${Logo} /><span class="sr">tds-factory</span></h1><span class="tagline">Factory</span></div>
    ${folderName(project) && html`<span id="project" title=${project}>${folderName(project)}</span>`}
    <span id="status" role="status" aria-live="polite" class=${status.error ? 'error' : ''}>${status.text}</span>
    <${ThemeSelect} />
    <button id="older" type="button" hidden=${!olderLabel} onClick=${onOlder}>${olderLabel}</button>
  </header>`;
}

// Shows the Markdown files of the selected Run. On a refresh of the same Run the old text stays until the new files are loaded,
// because showing the Loading placeholders again would shrink the panel and the browser would scroll it back to the top.
export function Detail({ run, onClose }) {
  const key = run ? JSON.stringify([run.id, run.title, run.updated, run.files, run.links]) : '';
  const [loaded, setLoaded] = useState(null);
  const heading = useRef(null);
  useEffect(() => { if (run) heading.current?.focus(); }, [run?.id]); // only a newly opened Run takes focus, never a refresh
  useEffect(() => {
    if (!run) return undefined;
    let live = true;
    Promise.all(run.files.map((name) => fetch('/files/' + encodeURIComponent(run.id) + '/' + encodeURIComponent(name), { cache: 'no-store' })
      .then((res) => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.text(); })
      .then((text) => ({ name, text }), (err) => ({ name, error: `Cannot load ${name} (${err.message})` }))))
      .then((files) => { if (live) setLoaded({ id: run.id, files }); });
    return () => { live = false; };
  }, [key]);
  if (!run) return html`<section id="detail" aria-label="Run detail" hidden></section>`;
  const files = loaded && loaded.id === run.id ? loaded.files : run.files.map((name) => ({ name }));
  return html`<section id="detail" aria-label="Run detail">
    <header>
      <div class="head-row"><h2 ref=${heading} tabindex="-1">${run.title}</h2><button type="button" class="close" aria-label="Close Run detail" onClick=${onClose}>✕</button></div>
      ${pauseLabel(run) && html`<div class="reason">${pauseLabel(run)}${run.reason ? ': ' + run.reason : ''}</div>`}
      <div class="meta"><span>Stage: ${COLUMNS.find((c) => c.key === run.column)?.label ?? run.column}</span>${run.status === 'abandoned' && html`<span>Abandoned</span>`}${run.agent && html`<span>Agent: ${run.agent}</span>`}<span>Updated: ${ageMs(run.updated) === null ? 'unknown' : ago(ageMs(run.updated))}</span></div>
      <${Chips} run=${run} />
    </header>
    ${run.links.map((l) => html`<div class="link"><${Link} href=${l.href}>${l.label + ': ' + l.href}<//></div>`)}
    ${!run.files.length && html`<div class="empty">No summaries yet</div>`}
    ${run.files.length > 0 && files.map((f) => html`<${Fragment} key=${f.name}>
      <h3>${f.name}</h3>
      ${f.error ? html`<pre>${f.error}</pre>` : f.text === undefined ? html`<pre>Loading...</pre>` : html`<${Markdown} text=${f.text} />`}
    <//>`)}
  </section>`;
}

// A native dialog driven by one request at a time: { title, message, action, danger, notice, resolve }, or null when closed.
export function ConfirmDialog({ request, onClose }) {
  const dialog = useRef(null);
  const cancel = useRef(null);
  const confirm = useRef(null);
  useEffect(() => {
    if (!request || dialog.current.open) return;
    dialog.current.returnValue = '';
    dialog.current.showModal();
    (request.notice ? confirm : cancel).current.focus();
  }, [request]);
  return html`<dialog id="dialog" ref=${dialog} aria-labelledby="dialog-title" aria-describedby="dialog-message" onClose=${() => onClose(dialog.current.returnValue === 'confirm')}>
    <div class="dialog-content">
      <h2 id="dialog-title">${request ? request.title : ''}</h2>
      <p id="dialog-message">${request ? request.message : ''}</p>
      <div class="dialog-actions">
        <button id="dialog-cancel" ref=${cancel} type="button" hidden=${!!(request && request.notice)} onClick=${() => dialog.current.close('cancel')}>Cancel</button>
        <button id="dialog-confirm" ref=${confirm} type="button" class=${request && request.danger ? 'primary danger' : 'primary'} onClick=${() => dialog.current.close('confirm')}>${request ? request.action : ''}</button>
      </div>
    </div>
  </dialog>`;
}
