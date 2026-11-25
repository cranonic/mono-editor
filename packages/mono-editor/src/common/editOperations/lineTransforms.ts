import type { IPosition, IRange } from '../core/types';
import type { TextModel } from '../model/TextModel';

export interface LineTransformResult {
  changed: boolean;
  caret?: IPosition;
  selection?: IRange;
}

function getLineSpan(model: TextModel, selection: IRange): { startLine: number; endLine: number } {
  const startLine = Math.max(1, Math.min(model.getLineCount(), selection.startLineNumber));
  let endLine = Math.max(startLine, Math.min(model.getLineCount(), selection.endLineNumber));
  if (endLine > startLine && selection.endColumn === 1) {
    endLine -= 1;
  }
  return { startLine, endLine };
}

function replaceLines(
  model: TextModel,
  startLine: number,
  endLine: number,
  nextLines: string[],
): LineTransformResult {
  const startOffset = model.getOffsetAt(startLine, 1);
  const endOffset = model.getOffsetAt(endLine, model.getLineContent(endLine).length + 1);
  const nextText = nextLines.join(model.getEOL());
  const prevText = model.getValueInRange({
    startLineNumber: startLine,
    startColumn: 1,
    endLineNumber: endLine,
    endColumn: model.getLineContent(endLine).length + 1,
  });
  if (nextText === prevText) return { changed: false };
  model.replaceRange(startOffset, endOffset, nextText);
  const finalEndLine = startLine + nextLines.length - 1;
  return {
    changed: true,
    selection: {
      startLineNumber: startLine,
      startColumn: 1,
      endLineNumber: finalEndLine,
      endColumn: (nextLines[nextLines.length - 1] ?? '').length + 1,
    },
  };
}

/** Join selected lines (or current line + next line) with a single space. */
export function joinLines(model: TextModel, selection: IRange): LineTransformResult {
  const maxLine = model.getLineCount();
  let { startLine, endLine } = getLineSpan(model, selection);
  if (startLine === endLine) {
    if (startLine >= maxLine) return { changed: false };
    endLine = startLine + 1;
  }
  let joined = model.getLineContent(startLine);
  let caretCol = joined.length + 1;
  for (let ln = startLine + 1; ln <= endLine; ln++) {
    const trimmed = model.getLineContent(ln).trimStart();
    if (joined.length > 0 && !joined.endsWith(' ') && !joined.endsWith('\t') && trimmed.length > 0) {
      joined += ' ' + trimmed;
    } else {
      joined += trimmed;
    }
    if (ln === startLine + 1) caretCol = Math.max(1, joined.length - trimmed.length + 1);
  }
  const res = replaceLines(model, startLine, endLine, [joined]);
  if (!res.changed) return res;
  return { changed: true, caret: { lineNumber: startLine, column: caretCol } };
}

/** Sort selected lines (or entire file if selection is single line) ascending or descending. */
export function sortLines(
  model: TextModel,
  selection: IRange,
  direction: 'asc' | 'desc',
): LineTransformResult {
  const isSingleLine = selection.startLineNumber === selection.endLineNumber;
  const startLine = isSingleLine ? 1 : getLineSpan(model, selection).startLine;
  const endLine = isSingleLine ? model.getLineCount() : getLineSpan(model, selection).endLine;
  if (endLine <= startLine) return { changed: false };
  const lines: string[] = [];
  for (let ln = startLine; ln <= endLine; ln++) lines.push(model.getLineContent(ln));
  const sorted = [...lines].sort((a, b) => {
    const cmp = a.localeCompare(b);
    return direction === 'asc' ? cmp : -cmp;
  });
  return replaceLines(model, startLine, endLine, sorted);
}

/** Delete duplicate lines within selection (or whole file if single line). */
export function deleteDuplicateLines(model: TextModel, selection: IRange): LineTransformResult {
  const isSingleLine = selection.startLineNumber === selection.endLineNumber;
  const startLine = isSingleLine ? 1 : getLineSpan(model, selection).startLine;
  const endLine = isSingleLine ? model.getLineCount() : getLineSpan(model, selection).endLine;
  const seen = new Set<string>();
  const unique: string[] = [];
  for (let ln = startLine; ln <= endLine; ln++) {
    const line = model.getLineContent(ln);
    if (!seen.has(line)) {
      seen.add(line);
      unique.push(line);
    }
  }
  return replaceLines(model, startLine, endLine, unique);
}

/** Swap the two characters around the caret (Ctrl+T). */
export function transposeCharacters(model: TextModel, caret: IPosition): LineTransformResult {
  const line = model.getLineContent(caret.lineNumber);
  if (line.length < 2) return { changed: false };
  let idx = caret.column - 1;
  if (idx <= 0) idx = 1;
  if (idx >= line.length) idx = line.length - 1;
  const left = line[idx - 1]!;
  const right = line[idx]!;
  const startOffset = model.getOffsetAt(caret.lineNumber, idx);
  model.replaceRange(startOffset, startOffset + 2, right + left);
  return {
    changed: true,
    caret: { lineNumber: caret.lineNumber, column: idx + 2 },
  };
}

/** Transform selected text (or word under caret) to uppercase, lowercase, or title case. */
export function transformCase(
  model: TextModel,
  selection: IRange,
  mode: 'upper' | 'lower' | 'title',
): LineTransformResult {
  let range = model.validateRange(selection);
  const isEmpty =
    range.startLineNumber === range.endLineNumber && range.startColumn === range.endColumn;
  if (isEmpty) {
    const word = model.getWordAtPosition({
      lineNumber: range.startLineNumber,
      column: range.startColumn,
    });
    if (!word) return { changed: false };
    range = {
      startLineNumber: range.startLineNumber,
      startColumn: word.startColumn,
      endLineNumber: range.startLineNumber,
      endColumn: word.endColumn,
    };
  }
  const text = model.getValueInRange(range);
  let next = text;
  if (mode === 'upper') next = text.toUpperCase();
  else if (mode === 'lower') next = text.toLowerCase();
  else {
    next = text.replace(/\b([a-zA-Z])([a-zA-Z]*)/g, (_, first: string, rest: string) => {
      return first.toUpperCase() + rest.toLowerCase();
    });
  }
  if (next === text) return { changed: false };
  const startOff = model.getOffsetAt(range.startLineNumber, range.startColumn);
  const endOff = model.getOffsetAt(range.endLineNumber, range.endColumn);
  model.replaceRange(startOff, endOff, next);
  return { changed: true, selection: range };
}

/** Remove trailing spaces/tabs from all lines in document. */
export function trimTrailingWhitespace(model: TextModel): LineTransformResult {
  const count = model.getLineCount();
  const nextLines: string[] = [];
  let changed = false;
  for (let ln = 1; ln <= count; ln++) {
    const line = model.getLineContent(ln);
    const trimmed = line.replace(/[ \t]+$/, '');
    if (trimmed !== line) changed = true;
    nextLines.push(trimmed);
  }
  if (!changed) return { changed: false };
  return replaceLines(model, 1, count, nextLines);
}

/** Convert leading indentation across the entire document to spaces or tabs. */
export function convertIndentation(
  model: TextModel,
  toSpaces: boolean,
  tabSize: number,
): LineTransformResult {
  const size = Math.max(1, tabSize);
  const count = model.getLineCount();
  const nextLines: string[] = [];
  let changed = false;
  for (let ln = 1; ln <= count; ln++) {
    const line = model.getLineContent(ln);
    const match = line.match(/^[ \t]+/);
    if (!match) {
      nextLines.push(line);
      continue;
    }
    const lead = match[0];
    let cols = 0;
    for (let i = 0; i < lead.length; i++) {
      cols += lead[i] === '\t' ? size - (cols % size) : 1;
    }
    const nextLead = toSpaces
      ? ' '.repeat(cols)
      : '\t'.repeat(Math.floor(cols / size)) + ' '.repeat(cols % size);
    if (nextLead !== lead) changed = true;
    nextLines.push(nextLead + line.slice(lead.length));
  }
  model.updateOptions({ insertSpaces: toSpaces, tabSize: size });
  if (!changed) return { changed: false };
  return replaceLines(model, 1, count, nextLines);
}
