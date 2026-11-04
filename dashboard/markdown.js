// Turns Markdown text into a plain tree of blocks and inline spans. No DOM access, so a test can run it alone.

/** @typedef {{ t: 'text', v: string } | { t: 'code', v: string } | { t: 'strong', c: Span[] } | { t: 'em', c: Span[] } | { t: 'link', href: string, c: Span[] }} Span */
/** @typedef {{ inline: Span[], sub?: { ordered: boolean, items: ListItem[] } }} ListItem */
/** @typedef {{ type: 'list', ordered: boolean, items: ListItem[] }} ListBlock */
/**
 * @typedef {{ type: 'code', text: string }
 *   | { type: 'heading', level: number, inline: Span[] }
 *   | { type: 'rule' }
 *   | { type: 'table', head: Span[][], rows: Span[][][] }
 *   | { type: 'quote', inline: Span[] }
 *   | ListBlock
 *   | { type: 'paragraph', inline: Span[] }} Block
 */

// The fence and heading scanners below walk the line by hand instead of using a regular expression with `.*`, which backtracks quadratically on a long line that ends in a character `.` does not match (a lone CR, U+2028, U+2029).
/** @param {string} line @returns {number} The index of the first character that is not whitespace. */
function skipSpace(line) {
  let i = 0;
  while (i < line.length && /\s/.test(line[i])) i++;
  return i;
}
/** @param {string} line @param {number} from @param {string} char @returns {number} The index after the run of `char`. */
function runEnd(line, from, char) {
  let i = from;
  while (line[i] === char) i++;
  return i;
}
// An opening fence: 3 or more backticks or tildes after any indentation (lenient: it hides more, never less); a backtick fence info string holds no backtick.
/** @param {string} line */
function fenceOpen(line) {
  const start = skipSpace(line);
  const char = line[start];
  if (char !== '`' && char !== '~') return null;
  const end = runEnd(line, start, char);
  if (end - start < 3 || (char === '`' && line.indexOf('`', end) >= 0)) return null;
  return { char, length: end - start };
}
// A closing fence: only the opener's character, at least as long, trailing spaces only.
/** @param {string} line @param {{ char: string, length: number }} open */
function fenceClose(line, open) {
  const start = skipSpace(line);
  const end = runEnd(line, start, open.char);
  if (end - start < open.length) return false;
  for (let i = end; i < line.length; i++) if (line[i] !== ' ' && line[i] !== '\t') return false;
  return true;
}
// An ATX heading: up to 3 spaces of indent, 1 to 6 `#`, then a space, a tab or the end of the line.
/** @param {string} line */
function atxHeading(line) {
  const indent = runEnd(line, 0, ' ');
  if (indent > 3) return null;
  const end = runEnd(line, indent, '#');
  const level = end - indent;
  if (level < 1 || level > 6 || (end < line.length && line[end] !== ' ' && line[end] !== '\t')) return null;
  // A closing sequence is a run of `#` after a space or tab (or the whole content) and before only spaces and tabs.
  const text = line.slice(end).trim();
  let close = text.length;
  while (close > 0 && text[close - 1] === '#') close--;
  const closing = close < text.length && (close === 0 || text[close - 1] === ' ' || text[close - 1] === '\t');
  return { level, content: closing ? text.slice(0, close).trim() : text };
}

// Block helpers, also hand scans (see above). `isWhite` is the `\s` of a regular expression.
/** @param {string | undefined} c */
const isWhite = (c) => c !== undefined && /\s/.test(c);
/** @param {string | undefined} c */
const isDigit = (c) => c !== undefined && c >= '0' && c <= '9';
// A thematic break: 3 or more `-` or `*` (one kind), indentation and trailing whitespace only.
/** @param {string} line */
function isRule(line) {
  const start = skipSpace(line);
  const char = line[start];
  if (char !== '-' && char !== '*') return false;
  const end = runEnd(line, start, char);
  return end - start >= 3 && skipSpace(line.slice(end)) === line.length - end;
}
// A block quote line: `>` after any indentation. Returns the text after the marker and one optional whitespace character.
/** @param {string} line */
function quoteText(line) {
  const start = skipSpace(line);
  if (line[start] !== '>') return null;
  return line.slice(start + 1 + (isWhite(line[start + 1]) ? 1 : 0));
}
// A list item: indentation, a bullet or `digits.`, at least one whitespace character, then the text.
/** @param {string} line */
function listItem(line) {
  const indent = skipSpace(line);
  let end = indent + 1;
  const first = line[indent];
  if (first === '-' || first === '*' || first === '+') {
    // A one-character bullet.
  } else if (isDigit(first)) {
    while (isDigit(line[end])) end++;
    if (line[end] !== '.') return null;
    end++;
  } else return null;
  if (!isWhite(line[end])) return null;
  return { indent, ordered: isDigit(first), text: line.slice(end).trim() };
}
// A table separator row: cells of dashes with optional colons, between optional outer pipes.
/** @param {string} line */
function isTableSeparator(line) {
  let t = line.trim();
  if (t[0] === '|') t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').every((cell) => {
    let c = cell.trim();
    if (c[0] === ':') c = c.slice(1);
    if (c.endsWith(':')) c = c.slice(0, -1);
    return c.length > 0 && runEnd(c, 0, '-') === c.length;
  });
}

// The next index at or after `from` where `find` succeeds, remembered so that starts moving to the right never scan the same stretch twice.
/** @param {(from: number) => number} find */
function remember(find) {
  let from = -1;
  let found = -1;
  return (/** @type {number} */ at) => {
    if (from < 0 || at < from || (found >= 0 && found < at)) {
      found = find(at);
      from = at;
    }
    return found;
  };
}
/** @param {string} src @param {number} from */
function nextLineEnd(src, from) {
  for (let i = from; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if (c === 10 || c === 13 || c === 0x2028 || c === 0x2029) return i;
  }
  return -1;
}
// The end of a link target `(...)` that starts after `from`: non-paren, non-whitespace characters and balanced `(...)` items without nesting, closed by `)`. -1 when it is none.
/** @param {string} src @param {number} from */
function linkTargetEnd(src, from) {
  let i = from;
  let items = 0;
  for (;;) {
    const c = src[i];
    if (c === '(') {
      let j = i + 1;
      while (j < src.length && src[j] !== '(' && src[j] !== ')' && !isWhite(src[j])) j++;
      if (src[j] !== ')') return -1;
      i = j + 1;
    } else if (c === ')') return items > 0 ? i + 1 : -1;
    else if (c === undefined || isWhite(c)) return -1;
    else i++;
    items++;
  }
}

/**
 * @param {string} text
 * @returns {Block[]}
 */
export function parseMarkdown(text) {
  /**
   * Walks the text once, left to right, and tries the same four forms in the same order at each start: code span, strong, emphasis, link. Every search that could rescan a long stretch from each start is remembered, so the whole walk is linear.
   * @param {string} src
   * @returns {Span[]}
   */
  function inline(src) {
    /** @type {Span[]} */
    const out = [];
    const nextTick = remember((at) => src.indexOf('`', at));
    const nextStrong = remember((at) => src.indexOf('**', at));
    const nextBracket = remember((at) => src.indexOf(']', at));
    const nextBreak = remember((at) => nextLineEnd(src, at));
    /** @type {number[] | null} */
    let ends = null;
    let endAt = 0;
    /** @type {Map<number, number>} */
    const targets = new Map();
    /** @param {number} from The first index an emphasis may end on (its last text character). */
    function nextEmphasisEnd(from) {
      if (ends === null) {
        ends = [];
        for (let i = 0; i + 1 < src.length; i++)
          if (src[i + 1] === '*' && src[i] !== '*' && !isWhite(src[i])) ends.push(i);
      }
      while (endAt > 0 && ends[endAt - 1] >= from) endAt--;
      while (endAt < ends.length && ends[endAt] < from) endAt++;
      return endAt < ends.length ? ends[endAt] : -1;
    }
    /** @param {string} v */
    function plain(v) {
      if (v) out.push({ t: 'text', v: v });
    }
    let last = 0;
    let p = 0;
    while (p < src.length) {
      const c = src[p];
      /** @type {Span | null} */
      let span = null;
      let end = p + 1;
      if (c === '`' && p + 1 < src.length && src[p + 1] !== '`') {
        const close = nextTick(p + 1);
        if (close >= 0) {
          span = { t: 'code', v: src.slice(p + 1, close) };
          end = close + 1;
        }
      }
      if (c === '*' && src[p + 1] === '*' && p + 2 < src.length) {
        const close = nextStrong(p + 3);
        const stop = nextBreak(p + 2);
        if (close >= 0 && (stop < 0 || stop >= close)) {
          span = { t: 'strong', c: inline(src.slice(p + 2, close)) };
          end = close + 2;
        }
      }
      if (c === '*' && span === null && p + 1 < src.length && src[p + 1] !== '*' && !isWhite(src[p + 1])) {
        const q = nextEmphasisEnd(p + 2);
        const stop = nextBreak(p + 2);
        if (q >= 0 && (stop < 0 || q < stop)) {
          span = { t: 'em', c: inline(src.slice(p + 1, q + 1)) };
          end = q + 2;
        } else if (src[p + 2] === '*') {
          span = { t: 'em', c: inline(src[p + 1]) };
          end = p + 3;
        }
      }
      if (c === '[' && p + 1 < src.length && src[p + 1] !== ']') {
        const close = nextBracket(p + 1);
        if (close >= 0 && src[close + 1] === '(') {
          let after = targets.get(close);
          if (after === undefined) {
            after = linkTargetEnd(src, close + 2);
            targets.set(close, after);
          }
          if (after >= 0) {
            const href = src.slice(close + 2, after - 1);
            const label = src.slice(p + 1, close);
            end = after;
            span = /^https?:\/\//i.test(href) ? { t: 'link', href: href, c: inline(label) } : { t: 'text', v: label };
          }
        }
      }
      if (span === null) {
        p++;
        continue;
      }
      plain(src.slice(last, p));
      if (span.t === 'text') plain(span.v);
      else out.push(span);
      last = end;
      p = end;
    }
    plain(src.slice(last));
    return out;
  }
  /** @param {string} line */
  function cells(line) {
    return line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map(function (c) {
        return inline(c.trim());
      });
  }
  /** @type {Block[]} */
  const blocks = [];
  const lines = String(text).split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const open = fenceOpen(line);
    const heading = atxHeading(line);
    if (open) {
      /** @type {string[]} */
      const code = [];
      for (i++; i < lines.length && !fenceClose(lines[i], open); i++) code.push(lines[i]);
      i++;
      blocks.push({ type: 'code', text: code.join('\n') });
    } else if (heading) {
      blocks.push({ type: 'heading', level: heading.level, inline: inline(heading.content) });
      i++;
    } else if (isRule(line)) {
      blocks.push({ type: 'rule' });
      i++;
    } else if (line.indexOf('|') >= 0 && isTableSeparator(lines[i + 1] ?? '')) {
      const head = cells(line),
        /** @type {Span[][][]} */
        rows = [];
      for (i += 2; i < lines.length && lines[i].indexOf('|') >= 0; i++) rows.push(cells(lines[i]));
      blocks.push({ type: 'table', head: head, rows: rows });
    } else if (quoteText(line) !== null) {
      /** @type {string[]} */
      const quote = [];
      for (let q; i < lines.length && (q = quoteText(lines[i])) !== null; i++) quote.push(q);
      blocks.push({ type: 'quote', inline: inline(quote.join(' ')) });
    } else if (listItem(line)) {
      /** @type {ListItem[]} */
      const items = [],
        first = listItem(line),
        ordered = first?.ordered ?? false,
        base = first?.indent ?? 0;
      for (let entry; i < lines.length && (entry = listItem(lines[i])); i++) {
        const item = { inline: inline(entry.text) };
        if (entry.indent > base && items.length) {
          const parent = items[items.length - 1];
          parent.sub = parent.sub || { ordered: entry.ordered, items: [] };
          parent.sub.items.push(item);
        } else items.push(item);
      }
      blocks.push({ type: 'list', ordered: ordered, items: items });
    } else {
      /** @type {string[]} */
      const para = [];
      for (
        ;
        i < lines.length &&
        lines[i].trim() &&
        !fenceOpen(lines[i]) &&
        !atxHeading(lines[i]) &&
        quoteText(lines[i]) === null &&
        !listItem(lines[i]) &&
        !isRule(lines[i]);
        i++
      )
        para.push(lines[i].trim());
      blocks.push({ type: 'paragraph', inline: inline(para.join(' ')) });
    }
  }
  return blocks;
}
