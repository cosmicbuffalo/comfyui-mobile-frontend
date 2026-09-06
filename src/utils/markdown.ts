/**
 * A small, dependency-free CommonMark-ish parser used to render MarkdownNote
 * bodies. It produces a data-only token tree; the React rendering lives in
 * components/WorkflowPanel/NodeCard/MarkdownContent.tsx.
 *
 * Deliberately does NOT support raw HTML — note text is user/workflow-authored
 * and gets rendered as React children, never as innerHTML.
 *
 * Newlines inside a paragraph are hard breaks (GFM "breaks" mode): notes used
 * to render with `whitespace-pre-wrap`, so collapsing single newlines the way
 * strict CommonMark does would silently reflow every existing note.
 */

export type MdInline =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: MdInline[] }
  | { type: 'em'; children: MdInline[] }
  | { type: 'del'; children: MdInline[] }
  | { type: 'codeSpan'; value: string }
  | { type: 'link'; href: string; children: MdInline[] }
  | { type: 'image'; src: string; alt: string }
  | { type: 'break' };

export type MdAlign = 'left' | 'center' | 'right' | null;

export type MdBlock =
  | { type: 'heading'; level: number; children: MdInline[] }
  | { type: 'paragraph'; children: MdInline[] }
  | { type: 'codeBlock'; lang: string | null; value: string }
  | { type: 'list'; ordered: boolean; start: number; loose: boolean; items: MdBlock[][] }
  | { type: 'blockquote'; children: MdBlock[] }
  | { type: 'thematicBreak' }
  | { type: 'table'; align: MdAlign[]; header: MdInline[][]; rows: MdInline[][][] };

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^`\s]*)[^`]*$/;
const HR_RE = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const QUOTE_RE = /^ {0,3}>[ \t]?/;
const ITEM_RE = /^(\s*)([-*+]|\d{1,9}[.)])([ \t]+|$)(.*)$/;
const TABLE_DELIM_RE = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

const SAFE_LINK_RE = /^(?:https?:\/\/|mailto:|tel:|#|\/|\.\.?\/)/i;
const SAFE_IMAGE_RE = /^(?:https?:\/\/|data:image\/[a-z+]+;base64,|\/|\.\.?\/)/i;

function safeLinkHref(raw: string): string | null {
  const href = raw.trim();
  if (!href) return null;
  return SAFE_LINK_RE.test(href) ? href : null;
}

function safeImageSrc(raw: string): string | null {
  const src = raw.trim();
  if (!src) return null;
  return SAFE_IMAGE_RE.test(src) ? src : null;
}

function isBlockStart(line: string): boolean {
  return (
    !line.trim() ||
    FENCE_RE.test(line) ||
    HR_RE.test(line) ||
    HEADING_RE.test(line) ||
    QUOTE_RE.test(line) ||
    ITEM_RE.test(line)
  );
}

/** Number of leading spaces, counting a tab as 4 columns. */
function indentWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    if (ch === ' ') width += 1;
    else if (ch === '\t') width += 4;
    else break;
  }
  return width;
}

function stripIndent(line: string, width: number): string {
  let remaining = width;
  let i = 0;
  while (i < line.length && remaining > 0) {
    if (line[i] === ' ') remaining -= 1;
    else if (line[i] === '\t') remaining -= 4;
    else break;
    i += 1;
  }
  return line.slice(i);
}

function isOrderedMarker(marker: string): boolean {
  return /\d/.test(marker);
}

export function parseMarkdown(source: string): MdBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  return parseBlocks(lines);
}

function parseBlocks(lines: string[]): MdBlock[] {
  const blocks: MdBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[1][0];
      const closeRe = new RegExp(`^ {0,3}${marker === '`' ? '`' : '~'}{${fence[1].length},}[ \t]*$`);
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !closeRe.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // consume the closing fence (or run off the end)
      blocks.push({ type: 'codeBlock', lang: fence[2] || null, value: body.join('\n') });
      continue;
    }

    if (HR_RE.test(line)) {
      blocks.push({ type: 'thematicBreak' });
      i += 1;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      const text = (heading[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '');
      blocks.push({ type: 'heading', level: heading[1].length, children: parseInline(text) });
      i += 1;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && (QUOTE_RE.test(lines[i]) || (lines[i].trim() && body.length))) {
        body.push(QUOTE_RE.test(lines[i]) ? lines[i].replace(QUOTE_RE, '') : lines[i]);
        i += 1;
      }
      blocks.push({ type: 'blockquote', children: parseBlocks(body) });
      continue;
    }

    if (ITEM_RE.test(line)) {
      const [list, next] = parseList(lines, i);
      blocks.push(list);
      i = next;
      continue;
    }

    const table = parseTable(lines, i);
    if (table) {
      blocks.push(table.block);
      i = table.next;
      continue;
    }

    // Paragraph: run until a blank line or the start of another block.
    const paragraph: string[] = [line];
    i += 1;
    while (i < lines.length && !isBlockStart(lines[i]) && !parseTable(lines, i)) {
      paragraph.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n')) });
  }

  return blocks;
}

function parseList(lines: string[], start: number): [MdBlock, number] {
  const first = ITEM_RE.exec(lines[start])!;
  const ordered = isOrderedMarker(first[2]);
  const baseIndent = indentWidth(first[1]);
  const startNumber = ordered ? parseInt(first[2], 10) : 1;

  const items: string[][] = [];
  let current: string[] = [];
  let contentIndent = baseIndent + first[2].length + Math.max(1, first[3].length);
  let i = start;
  let sawBlank = false;
  let loose = false;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      // A blank line only ends the list if what follows isn't part of it.
      const next = lines[i + 1];
      if (next === undefined) break;
      const nextItem = ITEM_RE.exec(next);
      const continues =
        (nextItem && indentWidth(nextItem[1]) >= baseIndent && isOrderedMarker(nextItem[2]) === ordered) ||
        (next.trim() && indentWidth(next) >= contentIndent);
      if (!continues) break;
      sawBlank = true;
      current.push('');
      i += 1;
      continue;
    }

    const item = ITEM_RE.exec(line);
    const itemIndent = item ? indentWidth(item[1]) : 0;

    if (item && itemIndent < contentIndent) {
      if (itemIndent < baseIndent || isOrderedMarker(item[2]) !== ordered) break;
      if (current.length || items.length) {
        if (sawBlank) loose = true;
        sawBlank = false;
      }
      if (items.length || current.length) items.push(current);
      current = [item[4]];
      contentIndent = itemIndent + item[2].length + Math.max(1, item[3].length);
      i += 1;
      continue;
    }

    if (indentWidth(line) >= contentIndent) {
      current.push(stripIndent(line, contentIndent));
      i += 1;
      continue;
    }

    // Lazy paragraph continuation of the current item.
    if (!sawBlank && current.length && current[current.length - 1].trim() && !isBlockStart(line)) {
      current.push(line);
      i += 1;
      continue;
    }

    break;
  }

  items.push(current);

  const parsed = items.map((item) => parseBlocks(item));

  return [{ type: 'list', ordered, start: startNumber, loose, items: parsed }, i];
}

function splitTableRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);

  const cells: string[] = [];
  let buf = '';
  for (let i = 0; i < row.length; i += 1) {
    const ch = row[i];
    if (ch === '\\' && row[i + 1] === '|') {
      buf += '|';
      i += 1;
      continue;
    }
    if (ch === '|') {
      cells.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  cells.push(buf.trim());
  return cells;
}

function parseTable(lines: string[], start: number): { block: MdBlock; next: number } | null {
  const header = lines[start];
  const delim = lines[start + 1];
  if (!header || !delim) return null;
  if (!header.includes('|') || !TABLE_DELIM_RE.test(delim) || !delim.includes('-')) return null;

  const headerCells = splitTableRow(header);
  const alignCells = splitTableRow(delim);
  if (headerCells.length !== alignCells.length) return null;

  const align: MdAlign[] = alignCells.map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return null;
  });

  const rows: MdInline[][][] = [];
  let i = start + 2;
  while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
    const cells = splitTableRow(lines[i]);
    while (cells.length < headerCells.length) cells.push('');
    rows.push(cells.slice(0, headerCells.length).map(parseInline));
    i += 1;
  }

  return {
    block: { type: 'table', align, header: headerCells.map(parseInline), rows },
    next: i,
  };
}

const ESCAPABLE_RE = /[\\`*_{}[\]()#+\-.!>~|]/;
const AUTOLINK_RE = /^<((?:https?:\/\/|mailto:)[^>\s]+)>/;
const BARE_URL_RE = /^https?:\/\/[^\s<>]+/;

/** Trailing punctuation shouldn't be swallowed into a bare URL. */
function trimUrlTail(url: string): string {
  let out = url;
  for (;;) {
    const last = out[out.length - 1];
    if (last && '.,;:!?\'"*_~'.includes(last)) {
      out = out.slice(0, -1);
      continue;
    }
    if (last === ')') {
      const opens = (out.match(/\(/g) ?? []).length;
      const closes = (out.match(/\)/g) ?? []).length;
      if (closes > opens) {
        out = out.slice(0, -1);
        continue;
      }
    }
    return out;
  }
}

interface LinkMatch {
  label: string;
  target: string;
  end: number;
}

/** Matches `[label](target)` at `start`, honouring nested brackets and escapes. */
function matchLink(src: string, start: number): LinkMatch | null {
  if (src[start] !== '[') return null;
  let depth = 0;
  let i = start;
  let labelEnd = -1;
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        labelEnd = i;
        break;
      }
    }
  }
  if (labelEnd === -1 || src[labelEnd + 1] !== '(') return null;

  let parens = 0;
  let targetEnd = -1;
  for (i = labelEnd + 1; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '(') parens += 1;
    else if (ch === ')') {
      parens -= 1;
      if (parens === 0) {
        targetEnd = i;
        break;
      }
    } else if (ch === '\n' && src[i + 1] === '\n') {
      return null;
    }
  }
  if (targetEnd === -1) return null;

  return {
    label: src.slice(start + 1, labelEnd),
    target: src.slice(labelEnd + 2, targetEnd),
    end: targetEnd + 1,
  };
}

/** `url "title"` → url. Titles are parsed only so they don't leak into the href. */
function linkDestination(target: string): string {
  const trimmed = target.trim();
  const angled = /^<([^>]*)>/.exec(trimmed);
  if (angled) return angled[1];
  const match = /^(\S+)(?:\s+["'(].*)?$/s.exec(trimmed);
  return match ? match[1] : trimmed;
}

export function parseInline(source: string): MdInline[] {
  const out: MdInline[] = [];
  let buf = '';

  const flush = () => {
    if (buf) {
      out.push({ type: 'text', value: buf });
      buf = '';
    }
  };

  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const rest = source.slice(i);

    if (ch === '\\' && ESCAPABLE_RE.test(source[i + 1] ?? '')) {
      buf += source[i + 1];
      i += 2;
      continue;
    }

    if (ch === '\n') {
      flush();
      out.push({ type: 'break' });
      i += 1;
      continue;
    }

    if (ch === '`') {
      const run = /^`+/.exec(rest)![0];
      const close = source.indexOf(run, i + run.length);
      const isRunEnd = close !== -1 && source[close + run.length] !== '`';
      if (isRunEnd) {
        flush();
        const raw = source.slice(i + run.length, close).replace(/\n/g, ' ');
        out.push({ type: 'codeSpan', value: /^ .* $/.test(raw) ? raw.slice(1, -1) : raw });
        i = close + run.length;
        continue;
      }
    }

    if (ch === '!' && source[i + 1] === '[') {
      const link = matchLink(source, i + 1);
      if (link) {
        const src = safeImageSrc(linkDestination(link.target));
        flush();
        if (src) out.push({ type: 'image', src, alt: link.label });
        else out.push({ type: 'text', value: link.label });
        i = link.end;
        continue;
      }
    }

    if (ch === '[') {
      const link = matchLink(source, i);
      if (link) {
        const href = safeLinkHref(linkDestination(link.target));
        flush();
        const children = parseInline(link.label);
        if (href) out.push({ type: 'link', href, children });
        else out.push(...children);
        i = link.end;
        continue;
      }
    }

    if (ch === '<') {
      // Notes in the wild use a bare <br> for a line break; every other tag
      // stays literal text (no HTML is interpreted).
      // A trailing newline after the tag is the same break, not a second one.
      const br = /^<br\s*\/?>[ \t]*\n?/i.exec(rest);
      if (br) {
        flush();
        out.push({ type: 'break' });
        i += br[0].length;
        continue;
      }
      const auto = AUTOLINK_RE.exec(rest);
      if (auto) {
        const href = safeLinkHref(auto[1]);
        flush();
        if (href) out.push({ type: 'link', href, children: [{ type: 'text', value: auto[1] }] });
        else buf += auto[0];
        i += auto[0].length;
        continue;
      }
    }

    if (ch === 'h' && BARE_URL_RE.test(rest)) {
      const url = trimUrlTail(BARE_URL_RE.exec(rest)![0]);
      flush();
      out.push({ type: 'link', href: url, children: [{ type: 'text', value: url }] });
      i += url.length;
      continue;
    }

    if (ch === '~' && source[i + 1] === '~') {
      const strike = /^~~(?=\S)([\s\S]*?\S)~~/.exec(rest);
      if (strike) {
        flush();
        out.push({ type: 'del', children: parseInline(strike[1]) });
        i += strike[0].length;
        continue;
      }
    }

    if (ch === '*' || ch === '_') {
      // `_` inside a word (snake_case, file_names) is never emphasis.
      const intraword = ch === '_' && /\w/.test(source[i - 1] ?? '');
      if (!intraword) {
        const emphasis = matchEmphasis(rest, ch);
        if (emphasis) {
          flush();
          out.push(emphasis.node);
          i += emphasis.length;
          continue;
        }
      }
    }

    buf += ch;
    i += 1;
  }

  flush();
  return out;
}

function markerRunLength(src: string, index: number, marker: string): number {
  let length = 0;
  while (src[index + length] === marker) length += 1;
  return length;
}

/**
 * Matches an emphasis span opening at the start of `rest`. Scans for the
 * closing run by hand rather than with a lazy regex so nested spans pair up
 * correctly — a lazy `*...*` would close on the first `**` of
 * `*a **b** c*` and strand the rest as literal asterisks.
 */
function matchEmphasis(rest: string, marker: string): { node: MdInline; length: number } | null {
  const openRun = Math.min(markerRunLength(rest, 0, marker), 3);
  if (openRun === 0) return null;
  const opensOn = rest[openRun];
  if (opensOn === undefined || /\s/.test(opensOn)) return null;

  let i = openRun;
  while (i < rest.length) {
    const ch = rest[i];

    if (ch === '\\') {
      i += 2;
      continue;
    }

    // A marker inside a code span is literal, so step over the whole span.
    if (ch === '`') {
      const run = /^`+/.exec(rest.slice(i))![0];
      const close = rest.indexOf(run, i + run.length);
      i = close === -1 ? i + run.length : close + run.length;
      continue;
    }

    if (ch !== marker) {
      i += 1;
      continue;
    }

    const runLength = markerRunLength(rest, i, marker);
    const previous = rest[i - 1];
    const following = rest[i + runLength];
    const closes =
      i > openRun &&
      previous !== undefined &&
      !/\s/.test(previous) &&
      runLength >= openRun &&
      // A `**` run belongs to a nested strong span, not to a single-marker em.
      !(openRun === 1 && runLength === 2) &&
      (marker !== '_' || following === undefined || !/\w/.test(following));

    if (closes) {
      const children = parseInline(rest.slice(openRun, i));
      const length = i + openRun;
      if (openRun === 3) {
        return { node: { type: 'strong', children: [{ type: 'em', children }] }, length };
      }
      if (openRun === 2) return { node: { type: 'strong', children }, length };
      return { node: { type: 'em', children }, length };
    }

    i += runLength;
  }

  return null;
}
