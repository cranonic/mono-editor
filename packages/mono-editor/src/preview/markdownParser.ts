/**
 * Pure, DOM-free Markdown block & inline parser for `@mono/editor/preview`.
 * Supports GFM tables, task lists, fenced code blocks (incl. Mermaid),
 * display (`$$...$$`) and inline (`$...$`) LaTeX math, headings, blockquotes,
 * links/images (with safe URL protocol filtering), bold/italic/strike, and inline code.
 */

export type MarkdownInline =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'math'; value: string }
  | { type: 'strong'; children: MarkdownInline[] }
  | { type: 'emphasis'; children: MarkdownInline[] }
  | { type: 'strike'; children: MarkdownInline[] }
  | { type: 'link'; label: MarkdownInline[]; href: string }
  | { type: 'image'; alt: string; src: string };

export type TableAlign = 'left' | 'center' | 'right' | null;

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; inlines: MarkdownInline[] }
  | { type: 'paragraph'; inlines: MarkdownInline[] }
  | { type: 'code'; language: string; code: string }
  | { type: 'mathBlock'; expression: string }
  | { type: 'blockquote'; blocks: MarkdownBlock[] }
  | {
      type: 'list';
      ordered: boolean;
      items: Array<{ checked?: boolean; inlines: MarkdownInline[] }>;
    }
  | {
      type: 'table';
      headers: MarkdownInline[][];
      alignments: TableAlign[];
      rows: MarkdownInline[][][];
    }
  | { type: 'hr' };

export interface MarkdownFeatureScan {
  readonly hasMath: boolean;
  readonly hasMermaid: boolean;
}

const SAFE_URL_PROTOCOLS = /^(https?:|mailto:|#|\/)/i;

export function sanitizePreviewUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (SAFE_URL_PROTOCOLS.test(trimmed)) return trimmed;
  // Disallow javascript:, vbscript:, data:text/html, etc.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Fast, code-fence-aware detector used to decide whether `katex` and/or `mermaid`
 * should be dynamically imported via `import()`.
 */
export function scanMarkdownFeatures(markdown: string): MarkdownFeatureScan {
  let hasMath = false;
  let hasMermaid = false;
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let inFence: { ch: string; len: number; isMermaid: boolean } | null = null;
  let inMathBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (inFence) {
      const closeRe = inFence.ch === '`' ? /^(`{3,})\s*$/ : /^(~{3,})\s*$/;
      const m = closeRe.exec(trimmed);
      if (m && m[1]!.length >= inFence.len) {
        inFence = null;
      }
      continue;
    }

    const openFence = /^(`{3,}|~{3,})\s*([a-zA-Z0-9_+-]*)/.exec(trimmed);
    if (openFence) {
      const lang = (openFence[2] || '').toLowerCase();
      const isMermaid = lang === 'mermaid';
      if (isMermaid) hasMermaid = true;
      inFence = { ch: openFence[1]![0]!, len: openFence[1]!.length, isMermaid };
      if (hasMath && hasMermaid) return { hasMath, hasMermaid };
      continue;
    }

    if (inMathBlock) {
      hasMath = true;
      if (trimmed.endsWith('$$')) inMathBlock = false;
      if (hasMath && hasMermaid) return { hasMath, hasMermaid };
      continue;
    }

    if (trimmed.startsWith('$$')) {
      hasMath = true;
      if (trimmed === '$$' || !trimmed.slice(2).includes('$$')) {
        inMathBlock = true;
      }
      if (hasMath && hasMermaid) return { hasMath, hasMermaid };
      continue;
    }

    if (!hasMath && line.includes('$')) {
      // Strip inline code spans before testing for inline `$...$` math.
      const withoutCode = line.replace(/`[^`]*`/g, '');
      if (/(^|[^\\])\$(?!\s)([^\n$`]+?)(?<!\s)\$/.test(withoutCode) || /\$\$[^$]+\$\$/.test(withoutCode)) {
        hasMath = true;
        if (hasMath && hasMermaid) return { hasMath, hasMermaid };
      }
    }
  }

  return { hasMath, hasMermaid };
}

function splitTableCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function parseTableSeparator(line: string): TableAlign[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes('-')) return null;
  const cells = splitTableCells(trimmed);
  if (cells.length === 0) return null;
  const aligns: TableAlign[] = [];
  for (const cell of cells) {
    if (!/^:?-{1,}:?$/.test(cell)) return null;
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    aligns.push(left && right ? 'center' : right ? 'right' : left ? 'left' : null);
  }
  return aligns;
}

export function parseMarkdownInlines(text: string): MarkdownInline[] {
  const out: MarkdownInline[] = [];
  let i = 0;
  const n = text.length;
  let buf = '';

  const flushBuf = () => {
    if (buf) {
      out.push({ type: 'text', value: buf });
      buf = '';
    }
  };

  while (i < n) {
    // Escaped punctuation
    if (text[i] === '\\' && i + 1 < n) {
      buf += text[i + 1]!;
      i += 2;
      continue;
    }

    // Inline code `...`
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i + 1) {
        flushBuf();
        out.push({ type: 'code', value: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // Inline math $...$ (non-empty, not space-padded)
    if (text[i] === '$' && text[i + 1] !== '$' && text[i + 1] !== ' ') {
      let end = i + 1;
      while (end < n) {
        if (text[end] === '\\' && end + 1 < n) {
          end += 2;
          continue;
        }
        if (text[end] === '$') break;
        end++;
      }
      if (end < n && end > i + 1 && text[end - 1] !== ' ') {
        flushBuf();
        out.push({ type: 'math', value: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // Image ![alt](src)
    if (text[i] === '!' && text[i + 1] === '[') {
      const closeB = text.indexOf(']', i + 2);
      if (closeB > i + 1 && text[closeB + 1] === '(') {
        const closeP = text.indexOf(')', closeB + 2);
        if (closeP > closeB + 2) {
          const safe = sanitizePreviewUrl(text.slice(closeB + 2, closeP));
          if (safe) {
            flushBuf();
            out.push({ type: 'image', alt: text.slice(i + 2, closeB), src: safe });
            i = closeP + 1;
            continue;
          }
        }
      }
    }

    // Link [label](href)
    if (text[i] === '[') {
      const closeB = text.indexOf(']', i + 1);
      if (closeB > i + 1 && text[closeB + 1] === '(') {
        const closeP = text.indexOf(')', closeB + 2);
        if (closeP > closeB + 2) {
          const safe = sanitizePreviewUrl(text.slice(closeB + 2, closeP));
          if (safe) {
            flushBuf();
            out.push({
              type: 'link',
              label: parseMarkdownInlines(text.slice(i + 1, closeB)),
              href: safe,
            });
            i = closeP + 1;
            continue;
          }
        }
      }
    }

    // Strong **...** or __...__
    if ((text[i] === '*' && text[i + 1] === '*') || (text[i] === '_' && text[i + 1] === '_')) {
      const delim = text.slice(i, i + 2);
      const end = text.indexOf(delim, i + 2);
      if (end > i + 2) {
        flushBuf();
        out.push({ type: 'strong', children: parseMarkdownInlines(text.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }

    // Strikethrough ~~...~~
    if (text[i] === '~' && text[i + 1] === '~') {
      const end = text.indexOf('~~', i + 2);
      if (end > i + 2) {
        flushBuf();
        out.push({ type: 'strike', children: parseMarkdownInlines(text.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }

    // Emphasis *...* or _..._
    if ((text[i] === '*' || text[i] === '_') && text[i + 1] !== ' ') {
      const ch = text[i]!;
      const end = text.indexOf(ch, i + 1);
      if (end > i + 1 && text[end - 1] !== ' ') {
        flushBuf();
        out.push({ type: 'emphasis', children: parseMarkdownInlines(text.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }

    buf += text[i]!;
    i++;
  }

  flushBuf();
  return out;
}

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Fenced code block ```lang or ~~~lang
    const fenceOpen = /^(`{3,}|~{3,})\s*([a-zA-Z0-9_+-]*)/.exec(trimmed);
    if (fenceOpen) {
      const ch = fenceOpen[1]![0]!;
      const len = fenceOpen[1]!.length;
      const language = (fenceOpen[2] || '').toLowerCase();
      const closeRe = ch === '`' ? /^(`{3,})\s*$/ : /^(~{3,})\s*$/;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length) {
        const cm = closeRe.exec(lines[i]!.trim());
        if (cm && cm[1]!.length >= len) {
          i++;
          break;
        }
        codeLines.push(lines[i]!);
        i++;
      }
      blocks.push({ type: 'code', language, code: codeLines.join('\n') });
      continue;
    }

    // Display math block $$...$$
    if (trimmed.startsWith('$$')) {
      const after = trimmed.slice(2);
      const sameLineEnd = after.indexOf('$$');
      if (sameLineEnd >= 0) {
        blocks.push({ type: 'mathBlock', expression: after.slice(0, sameLineEnd).trim() });
        i++;
        continue;
      }
      const mathLines: string[] = [];
      if (after.trim()) mathLines.push(after);
      i++;
      while (i < lines.length) {
        const ml = lines[i]!;
        const idx = ml.indexOf('$$');
        if (idx >= 0) {
          if (ml.slice(0, idx).trim()) mathLines.push(ml.slice(0, idx));
          i++;
          break;
        }
        mathLines.push(ml);
        i++;
      }
      blocks.push({ type: 'mathBlock', expression: mathLines.join('\n').trim() });
      continue;
    }

    // Horizontal rule
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // Heading #..######
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      const level = Math.min(6, Math.max(1, heading[1]!.length)) as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ type: 'heading', level, inlines: parseMarkdownInlines(heading[2]!.trim()) });
      i++;
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('>')) {
      const qLines: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('>')) {
        qLines.push(lines[i]!.trim().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'blockquote', blocks: parseMarkdownBlocks(qLines.join('\n')) });
      continue;
    }

    // GFM Table
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      parseTableSeparator(lines[i + 1]!) !== null
    ) {
      const alignments = parseTableSeparator(lines[i + 1]!)!;
      const headers = splitTableCells(line).map((c) => parseMarkdownInlines(c));
      i += 2;
      const rows: MarkdownInline[][][] = [];
      while (i < lines.length && lines[i]!.trim() && lines[i]!.includes('|')) {
        rows.push(splitTableCells(lines[i]!).map((c) => parseMarkdownInlines(c)));
        i++;
      }
      blocks.push({ type: 'table', headers, alignments, rows });
      continue;
    }

    // Lists (unordered / task / ordered)
    const ulMatch = /^[-*+]\s+(.*)$/.exec(trimmed);
    const olMatch = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (ulMatch || olMatch) {
      const ordered = Boolean(olMatch);
      const items: Array<{ checked?: boolean; inlines: MarkdownInline[] }> = [];
      while (i < lines.length) {
        const cur = lines[i]!.trim();
        const m = ordered ? /^\d+\.\s+(.*)$/.exec(cur) : /^[-*+]\s+(.*)$/.exec(cur);
        if (!m) break;
        let body = m[1]!;
        let checked: boolean | undefined;
        const task = /^\[([ xX])\]\s+(.*)$/.exec(body);
        if (task) {
          checked = task[1]!.toLowerCase() === 'x';
          body = task[2]!;
        }
        items.push({ checked, inlines: parseMarkdownInlines(body) });
        i++;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    // Paragraph: gather until blank line or block starter
    const pLines: string[] = [];
    while (i < lines.length) {
      const cur = lines[i]!;
      const ct = cur.trim();
      if (
        !ct ||
        /^(`{3,}|~{3,})/.test(ct) ||
        ct.startsWith('$$') ||
        /^#{1,6}\s+/.test(ct) ||
        ct.startsWith('>') ||
        /^(?:-{3,}|\*{3,}|_{3,})$/.test(ct) ||
        /^[-*+]\s+/.test(ct) ||
        /^\d+\.\s+/.test(ct)
      ) {
        break;
      }
      if (cur.includes('|') && i + 1 < lines.length && parseTableSeparator(lines[i + 1]!) !== null) {
        break;
      }
      pLines.push(cur.trim());
      i++;
    }
    if (pLines.length > 0) {
      blocks.push({ type: 'paragraph', inlines: parseMarkdownInlines(pLines.join(' ')) });
    } else {
      i++;
    }
  }

  return blocks;
}
