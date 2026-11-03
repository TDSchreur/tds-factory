// Presentational components of the Dashboard page. State, polling and actions live in app.js.
/** @import { VNode } from 'preact' */
/** @import { RunView } from './model.js' */
/** @import { Span, ListItem } from './markdown.js' */
import { Fragment, h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { parseMarkdown } from './markdown.js';
import { HELP_SECTIONS } from './help.js';
import {
  COLUMNS,
  STALE_MS,
  ageMs,
  ago,
  canGrantLoop,
  chipsOf,
  folderName,
  lastSeenOf,
  modelOf,
  prStatusOf,
  progressOf,
  safeUrl,
  ticketTilesOf,
  timelineOf,
  waitAgeOf,
} from './model.js';

export const html = htm.bind(h);

// The HTML elements below a node that match a selector.
/** @param {ParentNode} root @param {string} selector */
const elementsOf = (root, selector) => [...root.querySelectorAll(selector)].filter((e) => e instanceof HTMLElement);

/** @param {unknown} element @param {FocusOptions} [options] */
const focus = (element, options) => {
  if (element instanceof HTMLElement) element.focus(options);
};

// An anchor that opens in a new tab for an http(s) URL; anything else is plain text.
/** @param {{ href: unknown, children?: unknown }} props */
export function Link({ href, children }) {
  const url = safeUrl(href);
  return url
    ? html`<a href=${url} target="_blank" rel="noopener noreferrer">${children}</a>`
    : html`<span>${children}</span>`;
}

/**
 * @param {Span[]} spans
 * @returns {unknown[]}
 */
const inline = (spans) =>
  spans.map((sp) => {
    if (sp.t === 'text') return sp.v;
    if (sp.t === 'code') return html`<code>${sp.v}</code>`;
    if (sp.t === 'link') return html`<${Link} href=${sp.href}>${inline(sp.c)}<//>`;
    return h(sp.t, null, inline(sp.c));
  });

/**
 * @param {{ list: { ordered: boolean, items: ListItem[] } }} props
 * @returns {VNode}
 */
function MdList({ list }) {
  const Tag = list.ordered ? 'ol' : 'ul';
  return html`<${Tag}>${list.items.map((item) => html`<li>${inline(item.inline)}${item.sub && html`<${MdList} list=${item.sub} />`}</li>`)}<//>`;
}

// Text becomes Preact text nodes only, so file content can never inject markup.
/** @param {{ text: string }} props */
export function Markdown({ text }) {
  return html`<div class="md">${parseMarkdown(text).map((b) => {
    if (b.type === 'heading') return h('h' + Math.min(6, b.level + 3), null, inline(b.inline));
    if (b.type === 'paragraph') return html`<p>${inline(b.inline)}</p>`;
    if (b.type === 'quote') return html`<blockquote>${inline(b.inline)}</blockquote>`;
    if (b.type === 'rule') return html`<hr />`;
    if (b.type === 'code') return html`<pre><code>${b.text}</code></pre>`;
    if (b.type === 'list') return html`<${MdList} list=${b} />`;
    if (b.type === 'table') {
      return html`<div class="scroll" tabindex="0"><table>
        <thead><tr>${b.head.map((c) => html`<th>${inline(c)}</th>`)}</tr></thead>
        <tbody>${b.rows.map((row) => html`<tr>${row.map((c) => html`<td>${inline(c)}</td>`)}</tr>`)}</tbody>
      </table></div>`;
    }
    return null;
  })}</div>`;
}

/** @param {Event} e */
const stop = (/** @type {Event} */ e) => e.stopPropagation();

/** @param {{ run: RunView }} props */
function Chips({ run }) {
  const chips = chipsOf(run);
  return chips.length
    ? html`<ul class="chips" aria-label="Run facts">${chips.map(
        (c) =>
          html`<li key=${c.key} class=${'chip ' + c.cls} title=${c.tip}><span class="chip-icon" aria-hidden="true">${c.icon}</span><span class="chip-label">${c.label}</span> <span class="chip-value">${c.value}</span></li>`,
      )}</ul>`
    : null;
}

/** @param {{ run: RunView }} props */
function Progress({ run }) {
  const p = progressOf(run);
  return p
    ? html`<div class="progress" role="progressbar" aria-label="Ticket progress" aria-valuemin="0" aria-valuenow=${p.done} aria-valuemax=${p.total} aria-valuetext=${p.done + ' of ' + p.total + ' Tickets done'}><div class="progress-fill" style=${'width:' + Math.round((p.done / p.total) * 100) + '%'}></div></div>`
    : null;
}

/** @param {{ run: RunView }} props */
function ModelLine({ run }) {
  const m = modelOf(run);
  return m ? html`<div class=${'model' + (m.observed ? ' observed' : '')} title=${m.title}>${m.label}</div>` : null;
}

// The event log of the Run, oldest first. A damaged log is said so, because the timeline is then incomplete.
/** @param {{ run: RunView }} props */
function Timeline({ run }) {
  const events = timelineOf(run);
  const damaged = Number.isSafeInteger(run.eventsDamaged) ? run.eventsDamaged : 0;
  if (!events.length && !damaged) return null;
  return html`<section aria-label="Event timeline"><h3>Event timeline</h3>
    ${damaged > 0 && html`<p class="timeline-damaged" role="note">${damaged} ${damaged === 1 ? 'line' : 'lines'} of the event log could not be read, so this timeline is incomplete.</p>`}
    ${events.length > 0 && html`<ol class="timeline">${events.map((e, i) => html`<li key=${i}><span class="when">${e.when || 'time unknown'}</span> ${e.text}</li>`)}</ol>`}
  </section>`;
}

// The status of the Run's pull request. The PR link is shown here for a Run that is not Done; a Done card has its own link.
/** @param {{ run: RunView, onCheckPr: (run: RunView) => void, showLink?: boolean }} props */
function PrStatus({ run, onCheckPr, showLink = true }) {
  const status = prStatusOf(run);
  if (!status) return null;
  const link = showLink && run.column !== 'done' && safeUrl(run.pr) && html`<${Link} href=${run.pr}>Pull request<//>`;
  if (status.kind === 'closed') return link ? html`<div class="pr-status">${link}</div>` : null;
  return html`<div class="pr-status" aria-label="Pull request status">
    ${link}${link && ' '}
    ${status.kind === 'checking' && html`<span>PR status: checking...</span>`}
    ${
      status.kind === 'unavailable' &&
      html`<span class="unavailable">PR status unavailable: ${status.text}</span> <button type="button" aria-label=${'Check the PR status of ' + run.title + ' again'} onClick=${(
        /** @type {Event} */ e,
      ) => {
        stop(e);
        onCheckPr(run);
      }} onKeyDown=${stop}>Check again</button>`
    }
    ${status.lines.map((line) => html`<span key=${line} class=${'pr-fact' + (/^(Checks: failing|Merge: conflicts)/.test(line) ? ' bad' : '')}>${line}</span>${' '}`)}
  </div>`;
}

/** @param {{ run: RunView }} props */
function Tickets({ run }) {
  const tickets = ticketTilesOf(run);
  /** @type {Record<string, string>} */
  const mark = { done: '✓', active: '▶', todo: '○', rework: '↻' };
  return tickets.length
    ? html`<ul class="tickets" aria-label="Tickets">${tickets.map((t) => {
        const id = `usage-${run.id}-${t.key}`.replace(/[^A-Za-z0-9_-]/g, '-');
        return html`<li key=${t.key} class=${'ticket ' + t.state}>
          <div class="ticket-head"><span aria-hidden="true">${mark[t.state]}</span> ${t.href ? html`<${Link} href=${t.href}>${t.label}<//>` : t.label}<span class="sr"> (${t.state})</span></div>
          ${
            t.usage &&
            html`<div class="ticket-usage" tabindex="0" aria-describedby=${id}>
            <span>${t.usage.fresh} fresh${t.state === 'active' ? ' so far' : ''} · ${t.usage.models.join(', ')}</span>
            <span class="usage-breakdown" id=${id} role="tooltip">${t.usage.breakdown.map((b) => html`<span key=${b.model} class="usage-model">${b.model}: fresh ${b.fresh}, input ${b.input}, cache read ${b.cacheRead}, cache write ${b.cacheWrite}, output ${b.output}</span>`)}</span>
          </div>`
          }
        </li>`;
      })}</ul>`
    : null;
}

// One card per Run. Done cards keep their detail in a block that starts hidden, so the Done column stays short.
/** @param {RunView} run */
const pauseLabel = (run) => {
  const wait = waitAgeOf(run);
  return run.waiting
    ? 'Needs you' + (wait ? ', ' + wait.text : '')
    : run.status === 'verification-unavailable'
      ? 'Verification unavailable'
      : run.status === 'interrupted'
        ? 'Agent interrupted'
        : '';
};

/**
 * @param {object} props
 * @param {RunView} props.run
 * @param {boolean} props.selected
 * @param {boolean} props.expanded
 * @param {(id: string) => void} props.onSelect
 * @param {(id: string) => void} props.onToggle
 * @param {(run: RunView) => void} props.onCheckPr
 * @param {(run: RunView) => void} props.onGrant
 * @param {(run: RunView) => void} props.onMerge
 * @param {(run: RunView) => void} props.onSync
 * @param {(run: RunView) => void} props.onClean
 * @param {(run: RunView) => void} props.onAccept
 * @param {(run: RunView) => void} props.onDelete
 */
export function Card({
  run,
  selected,
  expanded,
  onSelect,
  onToggle,
  onCheckPr,
  onGrant,
  onMerge,
  onSync,
  onClean,
  onAccept,
  onDelete,
}) {
  const done = run.column === 'done';
  const age = ageMs(run.updated);
  const stale = age !== null && !done && !run.unreadable && age > STALE_MS;
  const seen = lastSeenOf(run);
  /** @type {Record<string, string>} */
  const prLabels = { open: 'Open', merged: 'Merged', closed: 'Closed' };
  const prLabel = prLabels[run.prState ?? ''];
  const more = [
    run.activity && html`<div class="activity">${run.activity}</div>`,
    html`<${ModelLine} run=${run} />`,
    html`<${Progress} run=${run} />`,
    html`<${Tickets} run=${run} />`,
    html`<${Chips} run=${run} />`,
    html`<${PrStatus} run=${run} onCheckPr=${onCheckPr} />`,
    done &&
      run.pr &&
      html`<div class="pr">${safeUrl(run.pr) ? html`<${Link} href=${run.pr}>Pull request<//>` : 'PR: ' + run.pr}${prLabel && html` <span class=${'badge ' + run.prState}>${prLabel}</span>`}</div>`,
    (done ||
      (!run.unreadable && ['running', 'waiting', 'verification-unavailable', 'interrupted'].includes(run.status))) &&
      html`<div class="actions">
      ${run.pr && run.prState === 'open' && run.status === 'done' && run.prCanMerge === false && html`<span class="merge-note">Merge it in ${run.prHost === 'azure-devops' ? 'Azure DevOps' : 'the pull request host'}</span>`}
      ${
        run.pr &&
        run.prState === 'open' &&
        run.status === 'done' &&
        run.prCanMerge !== false &&
        html`<button type="button" class="primary" aria-label=${'Squash and merge the pull request of ' + run.title} onClick=${(
          /** @type {Event} */ e,
        ) => {
          stop(e);
          onMerge(run);
        }} onKeyDown=${stop}>Merge</button>`
      }
      ${
        !run.unreadable &&
        ['build', 'check'].includes(run.column) &&
        run.status === 'running' &&
        html`<button type="button" aria-label=${'Sync ' + run.title + ' with origin'} onClick=${(
          /** @type {Event} */ e,
        ) => {
          stop(e);
          onSync(run);
        }} onKeyDown=${stop}>Sync</button>`
      }
      ${
        canGrantLoop(run) &&
        html`<button type="button" aria-label=${'Grant an extra Check loop to ' + run.title} onClick=${(
          /** @type {Event} */ e,
        ) => {
          stop(e);
          onGrant(run);
        }} onKeyDown=${stop}>Grant extra loop</button>`
      }
      ${
        !run.unreadable &&
        run.column === 'check' &&
        run.status === 'waiting' &&
        html`<button type="button" class="primary" aria-label=${'Accept the Check of ' + run.title} onClick=${(
          /** @type {Event} */ e,
        ) => {
          stop(e);
          onAccept(run);
        }} onKeyDown=${stop}>Accept Check</button>`
      }
      ${
        run.status === 'done' &&
        run.prState === 'merged' &&
        html`<button type="button" aria-label=${'Clean up ' + run.title} onClick=${(/** @type {Event} */ e) => {
          stop(e);
          onClean(run);
        }} onKeyDown=${stop}>Clean up</button>`
      }
      ${
        !run.unreadable &&
        ['running', 'waiting', 'verification-unavailable', 'interrupted', 'done', 'abandoned'].includes(run.status) &&
        html`<button type="button" class="danger" aria-label=${'Delete ' + run.title} onClick=${(
          /** @type {Event} */ e,
        ) => {
          stop(e);
          onDelete(run);
        }} onKeyDown=${stop}>Delete</button>`
      }
    </div>`,
  ];
  const toggleText = expanded ? 'Hide details' : 'Show details';
  const classes = [
    'card',
    run.unreadable && 'unreadable',
    run.waiting && 'waiting',
    selected && 'selected',
    run.status === 'abandoned' && 'abandoned',
  ]
    .filter(Boolean)
    .join(' ');
  return html`<li class=${classes} data-id=${run.id} tabindex="0" onClick=${() => onSelect(run.id)} onKeyDown=${(
    /** @type {KeyboardEvent} */ e,
  ) => {
    if (e.key === 'Enter') onSelect(run.id);
  }}>
    ${pauseLabel(run) && html`<div class=${'reason' + (run.waiting ? ' needs-you' : '')}>${pauseLabel(run)}${run.reason ? ': ' + run.reason : ''}</div>`}
    <div class="title">${(run.unreadable ? 'Unreadable record: ' : '') + run.title}</div>
    <div class="meta"><span class=${'updated' + (stale ? ' stale' : '')}>Updated: ${age === null ? 'unknown' : ago(age)}</span>${seen && html`<span class=${'last-seen' + (seen.quiet ? ' quiet' : '')}>${seen.quiet ? '⚠ ' : ''}${seen.text}</span>`}${run.agent && html`<span class="agent">Agent: ${run.agent}</span>`}${run.status === 'abandoned' && html`<span class="agent">Abandoned</span>`}</div>
    ${done && run.prState === 'open' && html`<div class="open-pr"><span class="badge open">Open PR</span></div>`}
    ${!done && more}
    ${
      done &&
      html`<button type="button" class="toggle" aria-expanded=${String(expanded)} aria-label=${toggleText + ': ' + run.title} onClick=${(
        /** @type {Event} */ e,
      ) => {
        stop(e);
        onToggle(run.id);
      }} onKeyDown=${stop}>${expanded ? '▾' : '▸'} ${toggleText}</button>`
    }
    ${done && html`<div class="details" hidden=${!expanded}>${more}</div>`}
  </li>`;
}

// Shown instead of the Stages when there is no Run at all.
/** @param {{ onHelp: () => void }} props */
export function Welcome({ onHelp }) {
  return html`<div class="board-wrap"><section class="welcome" aria-labelledby="welcome-title">
    <h2 id="welcome-title">No Runs yet</h2>
    <p>A Run is one piece of work, from idea to pull request. Start one in your agent session:</p>
    <p><code>/factory <em>what you want built</em></code></p>
    <p>The Run appears here and moves through the Stages while the agent works. Whenever it needs an answer from you, it turns red and says so.</p>
    <p><button type="button" class="link" onClick=${onHelp}>How does this work?</button></p>
  </section></div>`;
}

/**
 * @typedef {object} Actions
 * @property {(id: string) => void} select
 * @property {(id: string) => void} toggle
 * @property {(run: RunView) => Promise<void>} checkPr
 * @property {(run: RunView) => Promise<void>} merge
 * @property {(run: RunView) => Promise<void>} sync
 * @property {(run: RunView) => Promise<void>} clean
 * @property {(run: RunView) => Promise<void>} accept
 * @property {(run: RunView) => Promise<void>} grant
 * @property {(run: RunView) => Promise<void>} remove
 * @property {() => Promise<void>} deleteAll
 */
/**
 * @param {object} props
 * @param {RunView[]} props.runs
 * @param {boolean} props.onlyWaiting
 * @param {string} props.stage
 * @param {(stage: string) => void} props.onStage
 * @param {string | null} props.selectedId
 * @param {Set<string>} props.expandedIds
 * @param {number} props.doneCount
 * @param {Actions} props.actions
 */
export function Board({ runs, onlyWaiting, stage, onStage, selectedId, expandedIds, doneCount, actions }) {
  return html`<div class="board-wrap">
  <nav class="stage-nav" aria-label="Stages">${COLUMNS.map((c) => {
    const mine = runs.filter((r) => r.column === c.key);
    return html`<button type="button" aria-pressed=${String(stage === c.key)} onClick=${() => onStage(c.key)}>
      <span>${c.label} <span class="stage-count">(${mine.length})</span></span>${' '}
      ${mine.some((r) => r.waiting) && html`<span class="stage-waiting">Needs you</span>`}
    </button>`;
  })}</nav>
  <main id="board" aria-label="Runs by Stage" tabindex="-1">${COLUMNS.map((c) => {
    const mine = runs.filter((r) => r.column === c.key);
    return html`<section key=${c.key} class="column" data-stage=${c.key} data-active=${String(stage === c.key)} aria-labelledby=${'col-' + c.key}>
      <h2 id=${'col-' + c.key} tabindex="0" title=${c.help}>${c.label}</h2>
      ${c.key === 'done' && doneCount > 0 && html`<button type="button" onClick=${actions.deleteAll}>Delete all</button>`}
      <ul class="cards">${mine.map((r) => html`<${Card} key=${r.id} run=${r} selected=${r.id === selectedId} expanded=${expandedIds.has(r.id)} onSelect=${actions.select} onToggle=${actions.toggle} onCheckPr=${actions.checkPr} onGrant=${actions.grant} onMerge=${actions.merge} onSync=${actions.sync} onClean=${actions.clean} onAccept=${actions.accept} onDelete=${actions.remove} />`)}</ul>
      ${!mine.length && html`<div class="empty">${onlyWaiting ? 'No runs waiting on you' : 'No runs'}</div>`}
    </section>`;
  })}</main></div>`;
}

// The help panel: static text from help.js in a native dialog. The dialog closes itself on Esc and on the Close button; onClose tells the page.
/** @param {{ open: boolean, onClose: () => void }} props */
export function HelpPanel({ open, onClose }) {
  /** @type {{ current: HTMLDialogElement | null }} */
  const dialog = useRef(null);
  /** @type {{ current: HTMLButtonElement | null }} */
  const close = useRef(null);
  /** @type {{ current: Element | null }} */
  const opener = useRef(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      opener.current = document.activeElement;
      element.showModal();
      close.current?.focus();
    } else if (!open && element.open) element.close();
  }, [open]);
  // The page behind the dialog is inert; Tab cycles inside it instead of leaving for the browser's own controls.
  const trap = (/** @type {KeyboardEvent} */ event) => {
    if (event.key !== 'Tab' || !dialog.current) return;
    const targets = elementsOf(dialog.current, 'button:not([disabled]), a[href]');
    const first = targets[0],
      last = targets[targets.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  // The focus goes back to what opened the panel, or to the Help button when that did not take the focus (some browsers do not focus a clicked button).
  const closed = () => {
    const back =
      opener.current && opener.current !== document.body && opener.current.isConnected
        ? opener.current
        : document.getElementById('help');
    focus(back);
    requestAnimationFrame(() => {
      if (back?.isConnected && document.activeElement !== back) focus(back);
    }); // the browser may still be lifting the inert state
    onClose();
  };
  return html`<dialog id="help-panel" ref=${dialog} aria-labelledby="help-title" onKeyDown=${trap} onClose=${closed}>
    <div class="dialog-content">
      <h2 id="help-title">Help</h2>
      <p class="help-lead">The Factory walks a piece of work from idea to pull request. Each card is one Run, moving left to right through the Stages. Start a Run in your agent with <code>/factory</code>.</p>
      ${HELP_SECTIONS.map(
        (section) => html`<section key=${section.id} class="help-section" aria-labelledby=${'help-' + section.id}>
        <h3 id=${'help-' + section.id}>${section.title}</h3>
        <ul>${section.items.map((item) => html`<li key=${item.term || item.text}>${item.term && html`<strong>${item.term}</strong>: `}${item.text}</li>`)}</ul>
      </section>`,
      )}
      <div class="dialog-actions"><button id="help-close" ref=${close} type="button" class="primary" onClick=${() => dialog.current?.close()}>Close</button></div>
    </div>
  </dialog>`;
}

const THEMES = ['system', 'light', 'dark'];
const THEME_KEY = 'dashboard-theme';

// The inline script in index.html has already applied the saved theme; this keeps the selector in step with it.
function ThemeSelect() {
  const [theme, setTheme] = useState(() => {
    const saved = document.documentElement.dataset.theme;
    return saved !== undefined && THEMES.includes(saved) ? saved : 'system';
  });
  const change = (/** @type {Event} */ e) => {
    if (!(e.target instanceof HTMLSelectElement)) return;
    const choice = e.target.value;
    setTheme(choice);
    document.documentElement.dataset.theme = choice;
    try {
      localStorage.setItem(THEME_KEY, choice);
    } catch {
      /* storage unavailable: the choice still applies to this page */
    }
  };
  return html`<select id="theme" aria-label="Theme" value=${theme} onChange=${change}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select>`;
}

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

// The pill shows the last segment of the project path; the full path is its tooltip.
/**
 * @param {object} props
 * @param {string} props.project
 * @param {string} props.version
 * @param {{ error: boolean, text: string }} props.status
 * @param {string} props.olderLabel
 * @param {() => void} props.onOlder
 * @param {boolean} props.canNotify
 * @param {() => void} props.onNotify
 * @param {number} props.waitingCount
 * @param {boolean} props.onlyWaiting
 * @param {() => void} props.onToggleWaiting
 * @param {() => void} props.onHelp
 */
export function Header({
  project,
  version,
  status,
  olderLabel,
  onOlder,
  canNotify,
  onNotify,
  waitingCount,
  onlyWaiting,
  onToggleWaiting,
  onHelp,
}) {
  return html`<header>
    <div class="title"><h1><${Logo} /><span class="sr">tds-factory</span></h1><span class="tagline">Factory</span>${version && html`<span id="factory-version">v${version}</span>`}</div>
    ${folderName(project) && html`<span id="project" title=${project}>${folderName(project)}</span>`}
    <span id="status" role="status" aria-live="polite" class=${status.error ? 'error' : ''}>${status.text}</span>
    <button id="needs-you" type="button" aria-pressed=${String(!!onlyWaiting)} title="Show only the Runs that wait on you" onClick=${onToggleWaiting}>Needs you (${waitingCount ?? 0})</button>
    <button id="help" type="button" aria-haspopup="dialog" onClick=${onHelp}>Help</button>
    <${ThemeSelect} />
    ${canNotify && html`<button id="notify" type="button" onClick=${onNotify}>Notify me</button>`}
    <button id="older" type="button" hidden=${!olderLabel} onClick=${onOlder}>${olderLabel}</button>
  </header>`;
}

// The columns of the token usage table: the field of a usage row and its header; the first column is the row label.
/** @type {[keyof import('./model.js').UsageRowView, string][]} */
const USAGE_COLUMNS = [
  ['label', 'Where'],
  ['fresh', 'Fresh'],
  ['input', 'Input'],
  ['cacheRead', 'Cache read'],
  ['cacheWrite', 'Cache write'],
  ['output', 'Output'],
  ['reasoning', 'Reasoning'],
  ['subagents', 'Subagents'],
];

/** @typedef {{ name: string, text?: string, error?: string }} LoadedFile */

/**
 * A usage row label as segments split on its " · " separators: a segment stays whole, the separators may break.
 * @param {string} label
 */
const labelSegments = (label) =>
  label.split(' · ').map((part, i) => html`${i > 0 ? ' · ' : ''}<span class="seg">${part}</span>`);

// Shows the Markdown files of the selected Run. On a refresh of the same Run the old text stays until the new files are loaded,
// because showing the Loading placeholders again would shrink the panel and the browser would scroll it back to the top.
/**
 * @param {object} props
 * @param {RunView | null} props.run
 * @param {() => void} props.onClose
 * @param {(run: RunView) => void} props.onCheckPr
 * @param {(run: RunView) => void} props.onGrant
 */
export function Detail({ run, onClose, onCheckPr, onGrant }) {
  const key = run ? JSON.stringify([run.id, run.title, run.updated, run.files, run.links]) : '';
  const [loaded, setLoaded] = useState(/** @type {{ id: string, files: LoadedFile[] } | null} */ (null));
  /** @type {{ current: HTMLHeadingElement | null }} */
  const heading = useRef(null);
  /** @type {{ current: HTMLDialogElement | null }} */
  const dialog = useRef(null);
  const closing = useRef(false); // true while the page itself closes the dialog, so its close event is not a user's close
  // The native modal dialog provides the focus trap, the inert board and Escape. It opens once per Run: a refresh never calls showModal again.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (run && !element.open) element.showModal();
    else if (!run && element.open) {
      closing.current = true;
      element.close();
    }
    if (run && document.activeElement !== heading.current) heading.current?.focus({ preventScroll: true });
  }, [run?.id]); // only a newly opened Run takes focus, never a refresh
  const closed = () => {
    if (closing.current) closing.current = false;
    else onClose();
  };
  const pressedOnBackdrop = useRef(false); // a selection dragged out of the content ends on the backdrop and must not close
  const press = (/** @type {PointerEvent} */ event) => {
    pressedOnBackdrop.current = event.target === dialog.current;
  };
  // A press and a click both on the dialog itself, not on its content, are a click on the backdrop.
  const backdrop = (/** @type {MouseEvent} */ event) => {
    if (event.target === dialog.current && pressedOnBackdrop.current) dialog.current?.close();
  };
  useEffect(() => {
    if (!run) return undefined;
    let live = true;
    Promise.all(
      run.files.map((/** @type {string} */ name) =>
        fetch(
          '/files/' +
            encodeURIComponent(run.projectId) +
            '/' +
            encodeURIComponent(run.id) +
            '/' +
            encodeURIComponent(name),
          { cache: 'no-store' },
        )
          .then((res) => {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.text();
          })
          .then(
            (text) => ({ name, text }),
            (err) => ({ name, error: `Cannot load ${name} (${err.message})` }),
          ),
      ),
    ).then((files) => {
      if (live) setLoaded({ id: run.id, files });
    });
    return () => {
      live = false;
    };
  }, [key]);
  if (!run) return html`<dialog id="detail" ref=${dialog} aria-label="Run detail" onClose=${closed} hidden></dialog>`;
  const updatedAge = ageMs(run.updated);
  const reviews = run.projectReviews ?? [];
  /** @type {LoadedFile[]} */
  const files = loaded && loaded.id === run.id ? loaded.files : run.files.map((name) => ({ name }));
  return html`<dialog id="detail" ref=${dialog} aria-label="Run detail" onClose=${closed} onPointerDown=${press} onClick=${backdrop}>
    <div class="detail-body">
    <div class="compact-back"><button type="button" onClick=${onClose}><span aria-hidden="true">← </span>Back to stages</button></div>
    <header>
      <div class="head-row"><h2 ref=${heading} tabindex="-1">${run.title}</h2><button type="button" class="close" aria-label="Close Run detail" onClick=${onClose}>✕</button></div>
      ${pauseLabel(run) && html`<div class=${'reason' + (run.waiting ? ' needs-you' : '')}>${pauseLabel(run)}${run.reason ? ': ' + run.reason : ''}</div>`}
      <div class="meta"><span>Stage: ${COLUMNS.find((c) => c.key === run.column)?.label ?? run.column}</span>${run.status === 'abandoned' && html`<span>Abandoned</span>`}${run.agent && html`<span>Agent: ${run.agent}</span>`}<span>Updated: ${updatedAge === null ? 'unknown' : ago(updatedAge)}</span></div>
      <${Chips} run=${run} />
      <${PrStatus} run=${run} onCheckPr=${onCheckPr} showLink=${false} />
      ${canGrantLoop(run) && html`<div class="actions"><button type="button" aria-label=${'Grant an extra Check loop to ' + run.title} onClick=${() => onGrant(run)}>Grant extra loop</button></div>`}
    </header>
    <${Timeline} run=${run} />
    ${
      run.metrics &&
      html`<section aria-label="Run metrics"><h3>Run metrics</h3>
      <div>Track: ${run.metrics.track}</div>
      ${Object.entries(run.metrics.stages).map(([stage, value]) => html`<div key=${stage}>${stage[0].toUpperCase() + stage.slice(1)}: ${value}</div>`)}
      <div>Reworks: ${run.metrics.reworks}</div><div>Rework causes: ${run.metrics.reworkCauses}</div><div>First-pass clean rate: ${run.metrics.firstPass}</div>
      <div>Tokens: ${run.metrics.tokens}</div>
      ${
        run.metrics.usage?.rows?.length > 0 &&
        html`<div class="usage"><table class="usage-table" role="table"><caption>Token usage per Stage, model and Ticket</caption>
        <thead role="rowgroup"><tr role="row">${USAGE_COLUMNS.map(([, label]) => html`<th key=${label} scope="col" role="columnheader">${label}</th>`)}</tr></thead>
        <tbody role="rowgroup">${run.metrics.usage.rows.map(
          (r) =>
            html`<tr key=${r.label} role="row"><th scope="row" role="rowheader">${labelSegments(r.label)}</th>${USAGE_COLUMNS.slice(1).map(([field, label]) => html`<td key=${label} role="cell" data-label=${label}>${r[field] ?? 'n/a'}</td>`)}</tr>`,
        )}</tbody></table></div>`
      }
      ${(run.metrics.usage?.gaps ?? []).map((g) => html`<div key=${g.label}>${g.label} · no data</div>`)}
      <div>Cost: ${run.metrics.cost}</div>
    </section>`
    }
    ${reviews.length > 0 && html`<section aria-label="Project reviews"><h3>Project reviews</h3>${reviews.map((review) => html`<div key=${review.id}><strong>${review.name}: ${review.verdict || 'pending'}</strong>${review.reason && html`<p>${review.reason}</p>`}${review.findings.length > 0 && html`<ul>${review.findings.map((finding) => html`<li>${finding.severity}: ${finding.description} (${finding.location})</li>`)}</ul>`}</div>`)}</section>`}
    ${run.links.map((l) => html`<div class="link"><${Link} href=${l.href}>${l.label + ': ' + l.href}<//></div>`)}
    ${!run.files.length && html`<div class="empty">No summaries yet</div>`}
    ${
      run.files.length > 0 &&
      files.map(
        (f) => html`<${Fragment} key=${f.name}>
      <h3>${f.name}</h3>
      ${f.error ? html`<pre>${f.error}</pre>` : f.text === undefined ? html`<pre>Loading...</pre>` : html`<${Markdown} text=${f.text} />`}
    <//>`,
      )
    }
    </div>
  </dialog>`;
}

// A native dialog driven by one request at a time: { title, message, action, danger, notice, resolve }, or null when closed.
/**
 * @typedef {{ title: string, message: string, action: string, danger?: boolean, notice?: boolean, resolve: (confirmed: boolean) => void }} ConfirmRequest
 */
/** @param {{ request: ConfirmRequest | null, onClose: (confirmed: boolean) => void }} props */
export function ConfirmDialog({ request, onClose }) {
  /** @type {{ current: HTMLDialogElement | null }} */
  const dialog = useRef(null);
  /** @type {{ current: HTMLButtonElement | null }} */
  const cancel = useRef(null);
  /** @type {{ current: HTMLButtonElement | null }} */
  const confirm = useRef(null);
  useEffect(() => {
    const element = dialog.current;
    if (!request || !element || element.open) return;
    element.returnValue = '';
    element.showModal();
    (request.notice ? confirm : cancel).current?.focus();
  }, [request]);
  return html`<dialog id="dialog" ref=${dialog} aria-labelledby="dialog-title" aria-describedby="dialog-message" onClose=${() => onClose(dialog.current?.returnValue === 'confirm')}>
    <div class="dialog-content">
      <h2 id="dialog-title">${request ? request.title : ''}</h2>
      <p id="dialog-message">${request ? request.message : ''}</p>
      <div class="dialog-actions">
        <button id="dialog-cancel" ref=${cancel} type="button" hidden=${!!(request && request.notice)} onClick=${() => dialog.current?.close('cancel')}>Cancel</button>
        <button id="dialog-confirm" ref=${confirm} type="button" class=${request && request.danger ? 'primary danger' : 'primary'} onClick=${() => dialog.current?.close('confirm')}>${request ? request.action : ''}</button>
      </div>
    </div>
  </dialog>`;
}
