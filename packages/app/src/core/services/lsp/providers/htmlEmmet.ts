// Emmet for HTML completions, built on `vscode-emmet-helper` — the same engine VS Code's Emmet
// extension uses (official `emmet` expander + VS Code's abbreviation extraction/validation), so
// `!`, `div.`, `p#foo`, `div#pokemon`, `ul>li*3`, `html:5`, `lorem` … behave exactly like VS Code.
//
// This file is pure (no editor/monaco import): `htmlLocationAt` decides *where* Emmet may appear
// (VS Code only offers it in element text — never inside a tag, attribute value, comment, <script>
// or <style>), `htmlEmmetSuggestions` runs the helper and returns neutral items for completion.ts.

import { doComplete, type EmmetConfiguration } from 'vscode-emmet-helper';
import { TextDocument } from 'vscode-languageserver-textdocument';

export type HtmlLocation = 'text' | 'tag' | 'attr-value' | 'comment' | 'script' | 'style';

const RAW_TEXT = new Set(['script', 'style']);

/** Characters that start an Emmet expression; same list as VS Code's Emmet extension for HTML. */
export const HTML_EMMET_TRIGGER_CHARACTERS: readonly string[] = [
  '!', '.', '}', ':', '*', '$', ']', '/', '>', '+',
];

/** Trigger characters advertised by the HTML language server (`vscode-html-languageserver`). */
export const HTML_LS_TRIGGER_CHARACTERS: readonly string[] = ['.', ':', '<', '"', '=', '/'];

/**
 * Classify the position `offset` of an HTML document with a single forward scan.
 * Tolerant of broken markup: a lone `<` followed by a non-name character stays text.
 */
export function htmlLocationAt(text: string, offset: number): HtmlLocation {
  const end = Math.min(Math.max(0, offset), text.length);
  let i = 0;
  while (i < end) {
    if (text.startsWith('<!--', i)) {
      const close = text.indexOf('-->', i + 4);
      if (close < 0 || close + 3 > end) return 'comment';
      i = close + 3;
      continue;
    }
    if (text[i] !== '<' || !/[A-Za-z/!?]/.test(text[i + 1] ?? '')) {
      i++;
      continue;
    }
    // inside a start/end tag: `<name ...>` honouring quoted attribute values
    const nameMatch = /^<([A-Za-z][\w:-]*)/.exec(text.slice(i, i + 64));
    const name = nameMatch ? nameMatch[1]!.toLowerCase() : '';
    let j = i + 1;
    let quote = '';
    let closed = false;
    while (j < end) {
      const c = text[j]!;
      if (quote) {
        if (c === quote) quote = '';
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '>') {
        closed = true;
        break;
      }
      j++;
    }
    if (!closed) return quote ? 'attr-value' : 'tag';
    const selfClosed = text[j - 1] === '/';
    i = j + 1;
    if (name && RAW_TEXT.has(name) && !selfClosed) {
      const re = new RegExp(`</${name}\\s*>`, 'i');
      const m = re.exec(text.slice(i));
      if (!m || i + m.index >= end) return name as HtmlLocation;
      i += m.index + m[0].length;
    }
  }
  return 'text';
}

export interface EmmetSuggestion {
  label: string;
  detail: string;
  /** Markdown preview of the expansion. */
  documentation: string;
  /** Snippet body (`${1}` / `$0` tab stops). */
  insertText: string;
  /** 1-based, single line. */
  startColumn: number;
  endColumn: number;
  sortText?: string;
  filterText?: string;
}

const CONFIG: EmmetConfiguration = {
  showExpandedAbbreviation: 'always',
  showAbbreviationSuggestions: true,
  syntaxProfiles: {},
  variables: {},
  preferences: {},
};

function docText(d: unknown): string {
  if (typeof d === 'string') return d;
  const v = (d as { value?: unknown } | undefined)?.value;
  return typeof v === 'string' ? v : '';
}

/**
 * Emmet suggestions for the caret at (`column`, 1-based) of `lineText`, only when the caret is in
 * element text (`location === 'text'`). Returns [] everywhere else — so the palette stays closed.
 */
export function htmlEmmetSuggestions(
  lineText: string,
  column: number,
  location: HtmlLocation,
): EmmetSuggestion[] {
  if (location !== 'text') return [];
  const before = lineText.slice(0, Math.max(0, column - 1));
  if (!before.trim()) return [];
  let list;
  try {
    // One-line document: the helper only reads the current line, so cost is independent of file size.
    const doc = TextDocument.create('file:///emmet.html', 'html', 1, lineText);
    list = doComplete(doc, { line: 0, character: before.length }, 'html', CONFIG);
  } catch {
    return [];
  }
  const out: EmmetSuggestion[] = [];
  for (const it of list?.items ?? []) {
    const te = it.textEdit as { range?: { start: { character: number }; end: { character: number } }; newText?: string } | undefined;
    const insertText = te?.newText ?? it.insertText;
    if (!insertText) continue;
    out.push({
      label: typeof it.label === 'string' ? it.label : String(it.label),
      detail: it.detail ?? 'Emmet Abbreviation',
      documentation: docText(it.documentation),
      insertText,
      startColumn: (te?.range?.start.character ?? before.length) + 1,
      endColumn: (te?.range?.end.character ?? before.length) + 1,
      sortText: it.sortText,
      filterText: it.filterText,
    });
  }
  return out;
}
