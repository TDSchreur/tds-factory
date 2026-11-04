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

// An opening fence: 3 or more backticks or tildes after any indentation (lenient: it hides more, never less); a backtick fence info string holds no backtick.
/** @param {string} line */
function fenceOpen(line) {
  const m = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
  if (!m || (m[1][0] === '`' && m[2].includes('`'))) return null;
  return { char: m[1][0], length: m[1].length };
}
// A closing fence: only the opener's character, at least as long, trailing spaces only.
/** @param {string} line @param {{ char: string, length: number }} open */
function fenceClose(line, open) {
  const m = /^\s*(`+|~+)[ \t]*$/.exec(line);
  return !!m && m[1][0] === open.char && m[1].length >= open.length;
}
// An ATX heading: up to 3 spaces of indent, 1 to 6 `#`, then a space, a tab or the end of the line.
/** @param {string} line */
function atxHeading(line) {
  const m = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/.exec(line);
  if (!m) return null;
  // A closing sequence is a run of `#` after a space or tab (or the whole content) and before only spaces and tabs.
  const text = (m[2] ?? '').trim();
  let end = text.length;
  while (end > 0 && text[end - 1] === '#') end--;
  const closing = end < text.length && (end === 0 || text[end - 1] === ' ' || text[end - 1] === '\t');
  return { level: m[1].length, content: closing ? text.slice(0, end).trim() : text };
}

/**
 * @param {string} text
 * @returns {Block[]}
 */
export function parseMarkdown(text) {
  /**
   * @param {string} src
   * @returns {Span[]}
   */
  function inline(src) {
    /** @type {Span[]} */
    const out = [];
    const re = /`([^`]+)`|\*\*(.+?)\*\*|\*([^\s*](?:.*?[^\s*])?)\*|\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g;
    let last = 0;
    let m;
    /** @param {string} v */
    function plain(v) {
      if (v) out.push({ t: 'text', v: v });
    }
    while ((m = re.exec(src))) {
      plain(src.slice(last, m.index));
      last = re.lastIndex;
      if (m[1]) out.push({ t: 'code', v: m[1] });
      else if (m[2]) out.push({ t: 'strong', c: inline(m[2]) });
      else if (m[3]) out.push({ t: 'em', c: inline(m[3]) });
      else if (/^https?:\/\//i.test(m[5])) out.push({ t: 'link', href: m[5], c: inline(m[4]) });
      else plain(m[4]);
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
  /** @type {RegExpExecArray | null} */
  let m;
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
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push({ type: 'rule' });
      i++;
    } else if (line.indexOf('|') >= 0 && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1] || '')) {
      const head = cells(line),
        /** @type {Span[][][]} */
        rows = [];
      for (i += 2; i < lines.length && lines[i].indexOf('|') >= 0; i++) rows.push(cells(lines[i]));
      blocks.push({ type: 'table', head: head, rows: rows });
    } else if (/^\s*>/.test(line)) {
      /** @type {string[]} */
      const quote = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) quote.push(lines[i].replace(/^\s*>\s?/, ''));
      blocks.push({ type: 'quote', inline: inline(quote.join(' ')) });
    } else if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      /** @type {ListItem[]} */
      const items = [],
        ordered = /^\s*\d+\./.test(line),
        base = (/^\s*/.exec(line) ?? [''])[0].length;
      for (; i < lines.length && (m = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(lines[i])); i++) {
        const item = { inline: inline(m[3].trim()) };
        if (m[1].length > base && items.length) {
          const parent = items[items.length - 1];
          parent.sub = parent.sub || { ordered: /\d/.test(m[2]), items: [] };
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
        !/^\s*(>|([-*+]|\d+\.)\s|(-{3,}|\*{3,})\s*$)/.test(lines[i]);
        i++
      )
        para.push(lines[i].trim());
      blocks.push({ type: 'paragraph', inline: inline(para.join(' ')) });
    }
  }
  return blocks;
}
