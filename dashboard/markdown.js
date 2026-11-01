// Turns Markdown text into a plain tree of blocks and inline spans. No DOM access, so a test can run it alone.
export function parseMarkdown(text) {
  function inline(src) {
    const out = [];
    const re = /`([^`]+)`|\*\*(.+?)\*\*|\*([^\s*](?:.*?[^\s*])?)\*|\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g;
    let last = 0;
    let m;
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
  function cells(line) {
    return line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map(function (c) {
        return inline(c.trim());
      });
  }
  const blocks = [];
  const lines = String(text).split(/\r?\n/);
  let i = 0;
  let m;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^\s*```/.test(line)) {
      const code = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      i++;
      blocks.push({ type: 'code', text: code.join('\n') });
    } else if ((m = /^\s*(#{1,6})\s+(.*)$/.exec(line))) {
      blocks.push({ type: 'heading', level: m[1].length, inline: inline(m[2].trim()) });
      i++;
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push({ type: 'rule' });
      i++;
    } else if (line.indexOf('|') >= 0 && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1] || '')) {
      const head = cells(line),
        rows = [];
      for (i += 2; i < lines.length && lines[i].indexOf('|') >= 0; i++) rows.push(cells(lines[i]));
      blocks.push({ type: 'table', head: head, rows: rows });
    } else if (/^\s*>/.test(line)) {
      const quote = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) quote.push(lines[i].replace(/^\s*>\s?/, ''));
      blocks.push({ type: 'quote', inline: inline(quote.join(' ')) });
    } else if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const items = [],
        ordered = /^\s*\d+\./.test(line),
        base = /^\s*/.exec(line)[0].length;
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
      const para = [];
      for (
        ;
        i < lines.length &&
        lines[i].trim() &&
        !/^\s*(```|#{1,6}\s|>|([-*+]|\d+\.)\s|(-{3,}|\*{3,})\s*$)/.test(lines[i]);
        i++
      )
        para.push(lines[i].trim());
      blocks.push({ type: 'paragraph', inline: inline(para.join(' ')) });
    }
  }
  return blocks;
}
