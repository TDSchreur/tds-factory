(function () {
  'use strict';
  var COLUMNS = [
    { key: 'define', label: 'Define', help: 'Settle what has to be done: the agent interviews you, writes a Spec and cuts it into Tickets.' },
    { key: 'prepare', label: 'Prepare', help: 'Get ready to build: the agent switches to the minimal-code working style.' },
    { key: 'build', label: 'Build', help: 'Implement the Tickets test-first, one commit per Ticket, running the verify command after each.' },
    { key: 'check', label: 'Check', help: 'Independent reviewers check the changes on Standards, Spec, Security and Infrastructure. Problems send the Run back to Build, at most twice.' },
    { key: 'finish', label: 'Finish', help: 'Write the pull request description, push the branch and open the pull request.' },
    { key: 'done', label: 'Done', help: 'The Run is finished: its pull request is open, merged or closed, or the Run was abandoned.' }
  ];
  var CHIP_HELP = {
    tickets: 'Tickets finished out of the Tickets cut from the Spec.',
    standards: 'Check verdict: does the code follow the project conventions?',
    spec: 'Check verdict: does the code match what the Spec asked for?',
    security: 'Check verdict: no open critical, high or medium security findings.',
    infrastructure: 'Check verdict for Bicep and pipeline changes; skipped when none changed.',
    loops: 'Times Check sent the Run back to Build to fix problems. The maximum is 2.'
  };
  var BASE_TITLE = document.title;
  var POLL_MS = 2000;
  var STALE_MS = 10 * 60 * 1000;
  var OLD_MS = 7 * 24 * 60 * 60 * 1000;
  var expanded = Object.create(null); // Done cards the user opened, by Run id; same lifetime as showOlder
  var showOlder = false; // lives here because render() rebuilds the board every poll
  var olderBtn = document.getElementById('older');
  var board = document.getElementById('board');
  var statusEl = document.getElementById('status');

  // Lenient reader: any field may be missing or of the wrong type; unknown fields are ignored.
  function str(v) { return typeof v === 'string' ? v.trim() : ''; }

  // Age in ms of an ISO timestamp, or null when missing/unparseable.
  function ageMs(iso) {
    var t = Date.parse(iso);
    return isNaN(t) ? null : Date.now() - t;
  }
  function ago(ms) {
    var m = Math.floor(ms / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    if (m < 1440) return Math.floor(m / 60) + ' h ago';
    return Math.floor(m / 1440) + ' d ago';
  }
  // Only http(s) links become anchors.
  function safeUrl(v) { var u = str(v); return /^https?:\/\//i.test(u) ? u : ''; }

  // An anchor that opens in a new tab when href is an http(s) URL; otherwise plain text in an anchor-less span.
  function link(text, href) {
    var url = safeUrl(href);
    if (!url) return el('span', null, text);
    var a = el('a', null, text);
    a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    return a;
  }

  function el(tag, cls, text, tip) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    if (tip) e.title = tip;
    return e;
  }

  // One card per Run.
  function renderCard(run) {
    var li = el('li', 'card' + (run.unreadable ? ' unreadable' : '') + (run.waiting ? ' waiting' : ''));
    li.dataset.id = run.id;
    if (run.id === selectedId) li.classList.add('selected');
    li.tabIndex = 0;
    li.addEventListener('click', function () { select(run.id); });
    li.addEventListener('keydown', function (e) { if (e.key === 'Enter') select(run.id); });
    if (run.waiting) li.appendChild(el('div', 'reason', 'Needs you' + (run.reason ? ': ' + run.reason : '')));
    li.appendChild(el('div', 'title', (run.unreadable ? 'Unreadable record: ' : '') + run.title));
    // Done cards keep their detail in a block that starts hidden, so the Done column stays short.
    var more = run.column === 'done' ? el('div', 'details') : li;
    if (run.activity) more.appendChild(el('div', 'activity', run.activity));
    var chips = el('div', 'chips');
    if (run.ticketsTotal) chips.appendChild(el('span', 'chip', Math.min(run.ticketsDone || 0, run.ticketsTotal) + '/' + run.ticketsTotal + ' tickets', CHIP_HELP.tickets));
    if (run.standards) chips.appendChild(el('span', 'chip ' + run.standards, 'Standards ' + run.standards, CHIP_HELP.standards));
    if (run.spec) chips.appendChild(el('span', 'chip ' + run.spec, 'Spec ' + run.spec, CHIP_HELP.spec));
    if (run.security) chips.appendChild(el('span', 'chip ' + run.security, 'Security ' + run.security, CHIP_HELP.security));
    if (run.infrastructure) chips.appendChild(el('span', 'chip ' + run.infrastructure, 'Infrastructure ' + run.infrastructure, CHIP_HELP.infrastructure));
    if (typeof run.loops === 'number') chips.appendChild(el('span', 'chip', 'loop ' + run.loops + '/2', CHIP_HELP.loops));
    if (chips.childNodes.length) more.appendChild(chips);
    if (run.agent) more.appendChild(el('div', 'agent', 'Agent: ' + run.agent));
    var age = ageMs(run.updated);
    var active = run.column !== 'done' && !run.unreadable;
    li.appendChild(el('div', 'updated' + (age !== null && active && age > STALE_MS ? ' stale' : ''), 'Updated: ' + (age === null ? 'unknown' : ago(age))));
    if (run.status === 'abandoned') {
      li.classList.add('abandoned');
      li.appendChild(el('div', 'agent', 'Abandoned'));
    }
    if (run.column === 'done' && run.pr) {
      var p = el('div', 'pr');
      if (safeUrl(run.pr)) p.appendChild(link('Pull request', run.pr));
      else p.textContent = 'PR: ' + run.pr;
      var prLabel = { open: 'Open', merged: 'Merged', closed: 'Closed' }[run.prState];
      if (prLabel) p.appendChild(el('span', null, ' · ' + prLabel));
      more.appendChild(p);
      if (run.prState === 'open' && run.status === 'done') {
        var merge = el('button', null, 'Merge');
        merge.type = 'button';
        merge.setAttribute('aria-label', 'Squash and merge the pull request of ' + run.title);
        merge.addEventListener('click', function (e) { e.stopPropagation(); mergeRun(run); });
        merge.addEventListener('keydown', function (e) { e.stopPropagation(); });
        more.appendChild(merge);
      }
    }
    if (run.column === 'done') {
      var del = el('button', null, 'Delete');
      del.type = 'button';
      del.setAttribute('aria-label', 'Delete ' + run.title);
      del.addEventListener('click', function (e) { e.stopPropagation(); removeRuns([run], 'Permanently delete "' + run.title + '" and its Run record, summaries, and Run worktree (if created by the Factory)?'); });
      del.addEventListener('keydown', function (e) { e.stopPropagation(); });
      more.appendChild(del);
      var open = !!expanded[run.id];
      more.hidden = !open;
      var toggle = el('button', null);
      toggle.type = 'button';
      // The name starts with the visible text so voice control can match it.
      function label() {
        toggle.textContent = expanded[run.id] ? 'Hide details' : 'Show details';
        toggle.setAttribute('aria-label', toggle.textContent + ': ' + run.title);
        toggle.setAttribute('aria-expanded', !!expanded[run.id]);
      }
      label();
      // Flips in place instead of re-rendering the board, so the toggle keeps keyboard focus.
      toggle.addEventListener('click', function (e) {
        e.stopPropagation();
        expanded[run.id] = !expanded[run.id];
        more.hidden = !expanded[run.id];
        label();
      });
      toggle.addEventListener('keydown', function (e) { e.stopPropagation(); });
      li.appendChild(toggle);
      li.appendChild(more);
    }
    return li;
  }

  var selectedId = null;
  var lastEntries = [];
  var detailEl = document.getElementById('detail');
  var shownId = null;
  var shown = null; // key of what the detail view currently shows, to avoid flicker on each poll

  function select(id) { selectedId = selectedId === id ? null : id; render(lastEntries); }

  // Builds DOM for parseMarkdown output with textContent only, never innerHTML.
  function mdInline(parent, spans) {
    spans.forEach(function (sp) {
      if (sp.t === 'text') parent.appendChild(document.createTextNode(sp.v));
      else if (sp.t === 'code') parent.appendChild(el('code', null, sp.v));
      else if (sp.t === 'link') { var a = link('', sp.href); mdInline(a, sp.c); parent.appendChild(a); }
      else { var e = el(sp.t); mdInline(e, sp.c); parent.appendChild(e); }
    });
  }
  function mdBlock(parent, tag, spans) { var e = el(tag); mdInline(e, spans); parent.appendChild(e); return e; }
  function mdList(b) {
    var list = el(b.ordered ? 'ol' : 'ul');
    b.items.forEach(function (item) {
      var li = mdBlock(list, 'li', item.inline);
      if (item.sub) li.appendChild(mdList(item.sub));
    });
    return list;
  }
  function renderMarkdown(text) {
    var root = el('div', 'md');
    parseMarkdown(text).forEach(function (b) {
      if (b.type === 'heading') mdBlock(root, 'h' + Math.min(6, b.level + 3), b.inline);
      else if (b.type === 'paragraph') mdBlock(root, 'p', b.inline);
      else if (b.type === 'quote') mdBlock(root, 'blockquote', b.inline);
      else if (b.type === 'rule') root.appendChild(el('hr'));
      else if (b.type === 'code') { var pre = el('pre'); pre.appendChild(el('code', null, b.text)); root.appendChild(pre); }
      else if (b.type === 'list') {
        root.appendChild(mdList(b));
      } else if (b.type === 'table') {
        var table = el('table'), tr = el('tr');
        b.head.forEach(function (c) { mdBlock(tr, 'th', c); });
        table.appendChild(el('thead')).appendChild(tr);
        var body = table.appendChild(el('tbody'));
        b.rows.forEach(function (row) { var r = body.appendChild(el('tr')); row.forEach(function (c) { mdBlock(r, 'td', c); }); });
        var wrap = el('div', 'scroll'); wrap.appendChild(table); root.appendChild(wrap);
      }
    });
    return root;
  }

  function renderDetail(runs) {
    var run = selectedId && runs.filter(function (r) { return r.id === selectedId; })[0];
    if (!run) { shown = null; shownId = null; detailEl.hidden = true; detailEl.replaceChildren(); return; }
    var key = JSON.stringify([run.id, run.title, run.updated, run.files, run.links]);
    if (key === shown) return;
    var refresh = shownId === run.id; // same Run as on screen: keep it until the new files are loaded
    shown = key; shownId = run.id;
    detailEl.hidden = false;
    var kids = [el('h2', null, run.title)], loads = [];
    run.links.forEach(function (l) {
      var p = el('div', 'link');
      p.appendChild(link(l.label + ': ' + l.href, l.href));
      kids.push(p);
    });
    if (!run.files.length) kids.push(el('div', 'empty', 'No summaries yet'));
    run.files.forEach(function (name) {
      kids.push(el('h3', null, name));
      var pre = el('pre', null, 'Loading...');
      kids.push(pre);
      loads.push(fetch('/files/' + encodeURIComponent(run.id) + '/' + encodeURIComponent(name), { cache: 'no-store' })
        .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.text(); })
        .then(function (t) { pre.replaceWith(renderMarkdown(t)); })
        .catch(function (err) { pre.textContent = 'Cannot load ' + name + ' (' + err.message + ')'; }));
    });
    var next = document.createDocumentFragment();
    kids.forEach(function (k) { next.appendChild(k); });
    // Showing the Loading placeholders again would shrink the page, and the browser would scroll back to the top.
    if (!refresh) { detailEl.replaceChildren(next); return; }
    Promise.all(loads).then(function () { if (shown === key) detailEl.replaceChildren(next); });
  }

  var dialog = document.getElementById('dialog');
  var dialogCancel = document.getElementById('dialog-cancel');
  var dialogConfirm = document.getElementById('dialog-confirm');
  dialogCancel.addEventListener('click', function () { dialog.close('cancel'); });
  dialogConfirm.addEventListener('click', function () { dialog.close('confirm'); });
  var dialogQueue = Promise.resolve();
  function ask(title, message, action, danger, notice) {
    var result = dialogQueue.then(function () { return new Promise(function (resolve) {
    document.getElementById('dialog-title').textContent = title;
    document.getElementById('dialog-message').textContent = message;
    dialogCancel.hidden = !!notice;
    dialogConfirm.textContent = action;
    dialogConfirm.className = danger ? 'primary danger' : 'primary';
      dialog.addEventListener('close', function () { resolve(dialog.returnValue === 'confirm'); }, { once: true });
      dialog.returnValue = '';
      dialog.showModal();
      if (notice) dialogConfirm.focus(); else dialogCancel.focus();
    }); });
    dialogQueue = result.then(function () {});
    return result;
  }

  async function removeRuns(runs, message) {
    if (!await ask(runs.length === 1 ? 'Delete Run?' : 'Delete all Done Runs?', message, 'Delete', true)) return;
    var failed = [];
    for (var i = 0; i < runs.length; i++) {
      try {
        var response = await fetch('/api/runs/' + encodeURIComponent(runs[i].id), { method: 'DELETE' });
        if (!response.ok) failed.push(runs[i].title + ' (' + (await response.text()) + ')');
      } catch (err) { failed.push(runs[i].title); }
    }
    if (failed.length) await ask('Could not delete', failed.join(', '), 'Close', false, true);
    poll();
  }

  async function mergeRun(run) {
    if (!await ask('Squash and merge?', 'Merge the pull request for "' + run.title + '"?\n' + run.pr, 'Squash and merge', false)) return;
    try {
      var response = await fetch('/api/runs/' + encodeURIComponent(run.id) + '/merge', { method: 'POST' });
      if (!response.ok) await ask('Could not merge', await response.text(), 'Close', false, true);
    } catch (err) { await ask('Could not merge', run.title, 'Close', false, true); }
    poll();
  }

  function render(entries) {
    var focused = document.activeElement;
    var focusCard = focused && focused.closest && focused.closest('.card');
    var focusId = focusCard && focusCard.dataset.id;
    var focusLabel = focused && focused.getAttribute && focused.getAttribute('aria-label');
    var focusText = focused && focused.textContent;
    var hadBoardFocus = focused && board.contains && board.contains(focused);
    lastEntries = entries;
    var runs = (Array.isArray(entries) ? entries : []);
    var n = runs.filter(function (r) { return r.waiting; }).length;
    // Runs waiting on the user are never hidden.
    var older = runs.filter(function (r) { var a = ageMs(r.updated); return a !== null && a > OLD_MS && !r.waiting; });
    if (!showOlder) runs = runs.filter(function (r) { return older.indexOf(r) < 0; });
    olderBtn.hidden = older.length === 0;
    olderBtn.textContent = showOlder ? 'Hide older runs' : 'Show older (' + older.length + ')';
    // Newest first within a column; unreadable and undated records sort last.
    runs.sort(function (a, b) { return b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id); });
    var cols = COLUMNS.map(function (c) {
      var section = el('section', 'column');
      section.dataset.stage = c.key;
      var h = el('h2', null, c.label, c.help);
      h.tabIndex = 0;
      h.setAttribute('tabindex', '0');
      h.id = 'col-' + c.key;
      section.setAttribute('aria-labelledby', h.id);
      section.appendChild(h);
      if (c.key === 'done') {
        var doneRuns = lastEntries.filter(function (r) { return r.column === 'done'; });
        if (doneRuns.length) {
          var delAll = el('button', null, 'Delete all');
          delAll.type = 'button';
          delAll.addEventListener('click', function () { removeRuns(doneRuns, 'Permanently delete all ' + doneRuns.length + ' Done Runs and their records, summaries, and Factory-created Run worktrees, including hidden older Runs?'); });
          section.appendChild(delAll);
        }
      }
      var list = el('ul', 'cards');
      var mine = runs.filter(function (r) { return r.column === c.key; });
      mine.forEach(function (r) { list.appendChild(renderCard(r)); });
      section.appendChild(list);
      if (!mine.length) section.appendChild(el('div', 'empty', 'No runs'));
      return section;
    });
    board.replaceChildren.apply(board, cols);
    if (hadBoardFocus) {
      var target = Array.from(board.querySelectorAll('button, a, .card')).find(function (candidate) {
        var card = candidate.closest('.card');
        return (card ? card.dataset.id : null) === (focusId || null) &&
          (focusLabel ? candidate.getAttribute('aria-label') === focusLabel : candidate.textContent === focusText);
      });
      (target || board).focus();
    }
    renderDetail(runs);
    document.title = (n ? '(' + n + ') ' : '') + BASE_TITLE;
  }

  olderBtn.addEventListener('click', function () { showOlder = !showOlder; render(lastEntries); });

  function poll() {
    fetch('/api/views', { cache: 'no-store' })
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then(function (data) {
        if (!dialog.open) render(data);
        statusEl.className = '';
        statusEl.textContent = 'Updated ' + new Date().toLocaleTimeString();
      })
      .catch(function (err) {
        statusEl.className = 'error';
        statusEl.textContent = 'Cannot reach the server (' + err.message + '); showing last data. Retrying...';
      });
  }

  fetch('/api/info', { cache: 'no-store' })
    .then(function (res) { return res.json(); })
    .then(function (info) { document.getElementById('project').textContent = str(info.project); })
    .catch(function () {});

  render([]);
  poll();
  setInterval(poll, POLL_MS);
})();
