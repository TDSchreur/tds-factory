import fs from 'node:fs';
import path from 'node:path';

// The event log of a Run (ADR 0021): append-only, one JSON object per line. It describes what happened and never feeds a gate or Evidence.
export const EVENTS_FILE = 'events.jsonl';
const WINDOW = 256 * 1024;

const isLink = (file) => { try { return fs.lstatSync(file).isSymbolicLink(); } catch { return false; } };
// Only a plain file with one name: a FIFO would block the open, and a hard link would write through to another file.
const plain = (fd) => { const st = fs.fstatSync(fd); return st.isFile() && st.nlink === 1; };
const NONBLOCK = fs.constants.O_NONBLOCK ?? 0;

// Appends one event. A failure is ignored: the Run record is the source of truth, and an operation must not fail over its history.
export function appendEvent(dir, event) {
  const file = path.join(dir, EVENTS_FILE);
  if (isLink(file)) return false;
  try {
    const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW | NONBLOCK, 0o600);
    try {
      if (!plain(fd)) return false;
      fs.writeSync(fd, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
      return true;
    } finally { fs.closeSync(fd); }
  } catch { return false; }
}

// Reads the end of the log. Lines that cannot be parsed are skipped and counted; the line cut by the read window is neither.
export function readEvents(dir) {
  const file = path.join(dir, EVENTS_FILE);
  if (isLink(file)) return { events: [], damaged: 0, unreadable: true };
  let text;
  try {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | NONBLOCK);
    try {
      if (!plain(fd)) return { events: [], damaged: 0, unreadable: true };
      const { size } = fs.fstatSync(fd);
      const length = Math.min(size, WINDOW), buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, size - length);
      text = buffer.toString('utf8');
      if (size > WINDOW) text = text.slice(text.indexOf('\n') + 1);
    } finally { fs.closeSync(fd); }
  } catch (err) { return err.code === 'ENOENT' ? { events: [], damaged: 0 } : { events: [], damaged: 0, unreadable: true }; }
  const events = [];
  let damaged = 0;
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      const value = JSON.parse(line);
      if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.at === 'string' && typeof value.type === 'string') events.push(value);
      else damaged++;
    } catch { damaged++; }
  }
  return { events, damaged };
}

// The events a change of the Run record stands for, found by comparing the record before and after, so no operation can forget one.
export function deriveEvents(old, next) {
  const events = [];
  if ((next.tickets_done ?? 0) > (old.tickets_done ?? 0)) events.push({ type: 'ticket-done', done: next.tickets_done, total: next.tickets_total ?? 0 });
  if (next.status !== old.status) {
    if (next.status === 'waiting') events.push({ type: 'waiting', reason: next.waiting_reason ?? '' });
    else if (old.status === 'waiting' && next.status === 'running') events.push({ type: 'released' });
    else events.push({ type: 'status', status: next.status, ...(next.status_reason ? { reason: next.status_reason } : {}) });
  }
  if ((next.check_loops ?? 0) > (old.check_loops ?? 0)) events.push({ type: 'rework', loops: next.check_loops });
  if (next.stage !== old.stage) events.push({ type: 'stage', from: old.stage, to: next.stage });
  return events;
}
