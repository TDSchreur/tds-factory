// Presentational components of the Dashboard page. State, polling and actions live in app.js.
import { Fragment, h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { parseMarkdown } from './markdown.js';
import { COLUMNS, STALE_MS, ageMs, ago, chipsOf, safeUrl } from './model.js';

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

// One card per Run. Done cards keep their detail in a block that starts hidden, so the Done column stays short.
export function Card({ run, selected, expanded, onSelect, onToggle, onMerge, onDelete }) {
  const done = run.column === 'done';
  const age = ageMs(run.updated);
  const stale = age !== null && !done && !run.unreadable && age > STALE_MS;
  const prLabel = { open: 'Open', merged: 'Merged', closed: 'Closed' }[run.prState];
  const more = [
    run.activity && html`<div class="activity">${run.activity}</div>`,
    html`<${Chips} run=${run} />`,
    run.agent && html`<div class="agent">Agent: ${run.agent}</div>`,
    done && run.pr && html`<div class="pr">${safeUrl(run.pr) ? html`<${Link} href=${run.pr}>Pull request<//>` : 'PR: ' + run.pr}${prLabel && html`<span> · ${prLabel}</span>`}</div>`,
    done && run.pr && run.prState === 'open' && run.status === 'done' && html`<button type="button" aria-label=${'Squash and merge the pull request of ' + run.title} onClick=${(e) => { stop(e); onMerge(run); }} onKeyDown=${stop}>Merge</button>`,
    done && html`<button type="button" aria-label=${'Delete ' + run.title} onClick=${(e) => { stop(e); onDelete(run); }} onKeyDown=${stop}>Delete</button>`,
  ];
  const toggleText = expanded ? 'Hide details' : 'Show details';
  const classes = ['card', run.unreadable && 'unreadable', run.waiting && 'waiting', selected && 'selected', run.status === 'abandoned' && 'abandoned'].filter(Boolean).join(' ');
  return html`<li class=${classes} data-id=${run.id} tabindex="0" onClick=${() => onSelect(run.id)} onKeyDown=${(e) => { if (e.key === 'Enter') onSelect(run.id); }}>
    ${run.waiting && html`<div class="reason">Needs you${run.reason ? ': ' + run.reason : ''}</div>`}
    <div class="title">${(run.unreadable ? 'Unreadable record: ' : '') + run.title}</div>
    ${!done && more}
    <div class=${'updated' + (stale ? ' stale' : '')}>Updated: ${age === null ? 'unknown' : ago(age)}</div>
    ${run.status === 'abandoned' && html`<div class="agent">Abandoned</div>`}
    ${done && html`<button type="button" aria-expanded=${String(expanded)} aria-label=${toggleText + ': ' + run.title} onClick=${(e) => { stop(e); onToggle(run.id); }} onKeyDown=${stop}>${toggleText}</button>`}
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
  return html`<select id="theme" value=${theme} onChange=${change}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select>`;
}

export function Header({ project, status, olderLabel, onOlder }) {
  return html`<header>
    <h1>tds-factory dashboard</h1>
    <span id="project">${project}</span>
    <span id="status" role="status" aria-live="polite" class=${status.error ? 'error' : ''}>${status.text}</span>
    <label for="theme">Theme</label>
    <${ThemeSelect} />
    <button id="older" type="button" hidden=${!olderLabel} onClick=${onOlder}>${olderLabel}</button>
  </header>`;
}

// Shows the Markdown files of the selected Run. On a refresh of the same Run the old text stays until the new files are loaded,
// because showing the Loading placeholders again would shrink the page and the browser would scroll back to the top.
export function Detail({ run }) {
  const key = run ? JSON.stringify([run.id, run.title, run.updated, run.files, run.links]) : '';
  const [loaded, setLoaded] = useState(null);
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
    <h2>${run.title}</h2>
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
