import type { TextModel } from '../model/TextModel';
import type { SelectionState } from '../core/SelectionState';
import type { IPosition } from '../core/types';
import type { CharacterPair, LanguageConfiguration } from '../languages/languageConfigurationTypes';

export interface BracketMatchPair {
  open: { lineNumber: number; column: number; length: number };
  close: { lineNumber: number; column: number; length: number };
}

export interface OccurrenceHighlight {
  lineNumber: number;
  startColumn: number;
  endColumn: number;
}

export interface IndentGuideInfo {
  /** Leading indent columns (in spaces) for each visible line in the requested range. */
  levels: Map<number, number>;
  /** 1-based indent guide index (1, 2, ...) of the active scope around caretLine, or 0 if none. */
  activeLevel: number;
  /** Inclusive model line span `[startLine, endLine]` of the active indent scope. */
  activeStartLine: number;
  activeEndLine: number;
}

const DEFAULT_BRACKETS: CharacterPair[] = [
  ['{', '}'],
  ['[', ']'],
  ['(', ')'],
];

function isIgnoredToken(tok: string | null): boolean {
  if (!tok) return false;
  return (
    tok === 'string' ||
    tok.startsWith('string.') ||
    tok === 'comment' ||
    tok.startsWith('comment.') ||
    tok === 'regexp'
  );
}

/**
 * Finds the matching opening/closing bracket pair adjacent to `position`.
 * Uses `config.brackets` and ignores brackets inside string/comment tokens.
 */
export function findMatchingBracket(
  model: TextModel,
  position: IPosition,
  config: LanguageConfiguration | undefined,
  getTokenTypeAt?: (lineNumber: number, column: number) => string | null,
  maxScanLines = 600,
): BracketMatchPair | null {
  const pairs = (config?.brackets?.length ? config.brackets : DEFAULT_BRACKETS).filter(
    ([o, c]) => o.length === 1 && c.length === 1 && o !== c,
  );
  if (!pairs.length) return null;

  const openToClose = new Map<string, string>();
  const closeToOpen = new Map<string, string>();
  for (const [o, c] of pairs) {
    openToClose.set(o, c);
    closeToOpen.set(c, o);
  }

  const lineText = model.getLineContent(position.lineNumber);
  const candidates: number[] = [];
  // Prefer bracket immediately before caret, then immediately after caret (VS Code order)
  if (position.column > 1) candidates.push(position.column - 1);
  if (position.column <= lineText.length) candidates.push(position.column);

  let foundCol = -1;
  let foundChar = '';
  for (const col of candidates) {
    const ch = lineText[col - 1]!;
    if (!openToClose.has(ch) && !closeToOpen.has(ch)) continue;
    if (getTokenTypeAt && isIgnoredToken(getTokenTypeAt(position.lineNumber, col))) continue;
    foundCol = col;
    foundChar = ch;
    break;
  }

  if (foundCol < 0) return null;

  const totalLines = model.getLineCount();

  // Forward search for matching closing bracket
  if (openToClose.has(foundChar)) {
    const target = openToClose.get(foundChar)!;
    let depth = 1;
    const endLine = Math.min(totalLines, position.lineNumber + maxScanLines);
    for (let ln = position.lineNumber; ln <= endLine; ln++) {
      const text = model.getLineContent(ln);
      const startIdx = ln === position.lineNumber ? foundCol : 0;
      for (let i = startIdx; i < text.length; i++) {
        const ch = text[i]!;
        if (ch !== foundChar && ch !== target) continue;
        if (getTokenTypeAt && isIgnoredToken(getTokenTypeAt(ln, i + 1))) continue;
        if (ch === foundChar) depth++;
        else depth--;
        if (depth === 0) {
          return {
            open: { lineNumber: position.lineNumber, column: foundCol, length: 1 },
            close: { lineNumber: ln, column: i + 1, length: 1 },
          };
        }
      }
    }
    return null;
  }

  // Backward search for matching opening bracket
  const target = closeToOpen.get(foundChar)!;
  let depth = 1;
  const startLine = Math.max(1, position.lineNumber - maxScanLines);
  for (let ln = position.lineNumber; ln >= startLine; ln--) {
    const text = model.getLineContent(ln);
    const startIdx = ln === position.lineNumber ? foundCol - 2 : text.length - 1;
    for (let i = startIdx; i >= 0; i--) {
      const ch = text[i]!;
      if (ch !== foundChar && ch !== target) continue;
      if (getTokenTypeAt && isIgnoredToken(getTokenTypeAt(ln, i + 1))) continue;
      if (ch === foundChar) depth++;
      else depth--;
      if (depth === 0) {
        return {
          open: { lineNumber: ln, column: i + 1, length: 1 },
          close: { lineNumber: position.lineNumber, column: foundCol, length: 1 },
        };
      }
    }
  }
  return null;
}

const WORD_CHAR_RE = /[\p{L}\p{M}\p{N}_$]/u;
const IDENTIFIER_RE = /^[\p{L}\p{M}\p{N}_$]+$/u;

/**
 * Finds all matching occurrences of the active word (or single-line selection)
 * inside the visible model line window `[firstLine..lastLine]`.
 */
export function findVisibleOccurrences(
  model: TextModel,
  selection: SelectionState,
  firstLine: number,
  lastLine: number,
): OccurrenceHighlight[] {
  let needle = '';
  let wholeWord = true;

  if (!selection.isEmpty) {
    const a = selection.anchor;
    const b = selection.active;
    if (a.lineNumber !== b.lineNumber) return [];
    const line = model.getLineContent(a.lineNumber);
    const s = Math.min(a.column, b.column) - 1;
    const e = Math.max(a.column, b.column) - 1;
    const selected = line.slice(s, e);
    if (!selected.trim() || selected.length > 80) return [];
    needle = selected;
    wholeWord = IDENTIFIER_RE.test(selected);
  } else {
    const { lineNumber, column } = selection.active;
    const line = model.getLineContent(lineNumber);
    if (!line.length) return [];
    let idx = column - 1;
    if (idx >= line.length || !WORD_CHAR_RE.test(line[idx]!)) {
      if (idx > 0 && WORD_CHAR_RE.test(line[idx - 1]!)) idx--;
      else return [];
    }
    let start = idx;
    let end = idx + 1;
    while (start > 0 && WORD_CHAR_RE.test(line[start - 1]!)) start--;
    while (end < line.length && WORD_CHAR_RE.test(line[end]!)) end++;
    needle = line.slice(start, end);
    if (needle.length < 2) return [];
  }

  const out: OccurrenceHighlight[] = [];
  const lo = Math.max(1, firstLine);
  const hi = Math.min(model.getLineCount(), lastLine);

  for (let ln = lo; ln <= hi; ln++) {
    const text = model.getLineContent(ln);
    let from = 0;
    while (from <= text.length - needle.length) {
      const idx = text.indexOf(needle, from);
      if (idx < 0) break;
      const end = idx + needle.length;
      if (wholeWord) {
        const beforeOk = idx === 0 || !WORD_CHAR_RE.test(text[idx - 1]!);
        const afterOk = end >= text.length || !WORD_CHAR_RE.test(text[end]!);
        if (beforeOk && afterOk) {
          out.push({ lineNumber: ln, startColumn: idx + 1, endColumn: end + 1 });
        }
      } else {
        out.push({ lineNumber: ln, startColumn: idx + 1, endColumn: end + 1 });
      }
      from = idx + Math.max(1, needle.length);
      if (out.length >= 200) return out;
    }
  }

  // Only show occurrence highlights when the symbol appears more than once (or when explicitly selected)
  if (selection.isEmpty && out.length < 2) return [];
  return out;
}

function lineIndentSpaces(line: string, tabSize: number): number {
  let spaces = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === ' ') spaces += 1;
    else if (ch === '\t') spaces += tabSize;
    else return spaces;
  }
  return -1; // empty / whitespace-only line
}

/**
 * Computes indent guide levels for visible lines `[firstLine..lastLine]` and
 * determines the active enclosing indentation block around `caretLine`.
 */
export function computeIndentGuides(
  model: TextModel,
  firstLine: number,
  lastLine: number,
  caretLine: number,
  tabSize: number,
): IndentGuideInfo {
  const total = model.getLineCount();
  const unit = Math.max(1, tabSize);
  const lo = Math.max(1, firstLine);
  const hi = Math.min(total, lastLine);

  const rawCache = new Map<number, number>();
  const getRaw = (ln: number): number => {
    const cached = rawCache.get(ln);
    if (cached !== undefined) return cached;
    const val = lineIndentSpaces(model.getLineContent(ln), unit);
    rawCache.set(ln, val);
    return val;
  };

  const effectiveSpaces = (ln: number): number => {
    const r = getRaw(ln);
    if (r >= 0) return r;
    // Empty line inherits the minimum indent of the nearest surrounding non-empty lines
    let prev = 0;
    for (let p = ln - 1; p >= Math.max(1, ln - 40); p--) {
      const v = getRaw(p);
      if (v >= 0) {
        prev = v;
        break;
      }
    }
    let next = 0;
    for (let n = ln + 1; n <= Math.min(total, ln + 40); n++) {
      const v = getRaw(n);
      if (v >= 0) {
        next = v;
        break;
      }
    }
    return Math.min(prev, next);
  };

  const levels = new Map<number, number>();
  for (let ln = lo; ln <= hi; ln++) {
    const spaces = effectiveSpaces(ln);
    levels.set(ln, Math.floor(spaces / unit));
  }

  // Compute active indent guide level around caretLine
  let activeSpaces = effectiveSpaces(caretLine);
  // If caret is on a block header (next non-empty line is deeper), highlight that inner block
  for (let n = caretLine + 1; n <= Math.min(total, caretLine + 10); n++) {
    const v = getRaw(n);
    if (v >= 0) {
      if (v > activeSpaces) activeSpaces = v;
      break;
    }
  }
  const activeLevel = Math.floor(activeSpaces / unit);
  let activeStartLine = caretLine;
  let activeEndLine = caretLine;

  if (activeLevel > 0) {
    const minSpaces = activeLevel * unit;
    for (let p = caretLine - 1; p >= Math.max(1, caretLine - 400); p--) {
      const v = getRaw(p);
      if (v >= 0 && v < minSpaces) {
        activeStartLine = p + 1;
        break;
      }
      activeStartLine = p;
    }
    for (let n = caretLine + 1; n <= Math.min(total, caretLine + 400); n++) {
      const v = getRaw(n);
      if (v >= 0 && v < minSpaces) {
        activeEndLine = n - 1;
        break;
      }
      activeEndLine = n;
    }
  }

  return { levels, activeLevel, activeStartLine, activeEndLine };
}
