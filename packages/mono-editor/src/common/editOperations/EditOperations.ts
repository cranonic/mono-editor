import type { TextModel } from '../model/TextModel';
import type { SelectionState } from '../core/SelectionState';
import type { LanguageConfiguration } from '../languages/languageConfigurationTypes';

function orderedEndpoints(selection: SelectionState) {
  const a = selection.anchor;
  const b = selection.active;
  const forward =
    a.lineNumber < b.lineNumber || (a.lineNumber === b.lineNumber && a.column <= b.column);
  return {
    forward,
    start: forward ? a : b,
    end: forward ? b : a,
  };
}

/**
 * Returns the inclusive 1-based [startLine, endLine] range touched by the current selection.
 * Follows VS Code/Monaco convention: if a multi-line selection ends at column 1 of the last
 * line, that trailing line is NOT included.
 */
function selectedLineSpan(selection: SelectionState): { startLine: number; endLine: number } {
  const { start, end } = orderedEndpoints(selection);
  let endLine = end.lineNumber;
  if (!selection.isEmpty && endLine > start.lineNumber && end.column === 1) {
    endLine--;
  }
  return { startLine: start.lineNumber, endLine };
}

function leadingWhitespace(line: string): string {
  const m = line.match(/^[ \t]*/);
  return m ? m[0]! : '';
}

/**
 * Toggle line comment (`Ctrl+/`) using the language's `comments.lineComment`,
 * falling back to `comments.blockComment` for languages without line comments (CSS, HTML, Markdown).
 * Executes as a single undo step and preserves selection accurately.
 */
export function toggleLineComment(
  model: TextModel,
  selection: SelectionState,
  config: LanguageConfiguration | undefined,
): boolean {
  const lineToken = config?.comments?.lineComment;
  const blockPair = config?.comments?.blockComment;

  if (!lineToken) {
    if (blockPair) return toggleBlockComment(model, selection, config);
    return false;
  }

  const { startLine, endLine } = selectedLineSpan(selection);
  const a = { ...selection.anchor };
  const b = { ...selection.active };

  // Collect lines and determine whether all non-empty lines are already commented
  const rawLines: string[] = [];
  let hasNonEmpty = false;
  let allCommented = true;
  let minIndent = Infinity;

  for (let ln = startLine; ln <= endLine; ln++) {
    const text = model.getLineContent(ln);
    rawLines.push(text);
    const trimmed = text.trimStart();
    if (trimmed.length === 0) continue;
    hasNonEmpty = true;
    const indentLen = text.length - trimmed.length;
    if (indentLen < minIndent) minIndent = indentLen;
    if (!trimmed.startsWith(lineToken)) {
      allCommented = false;
    }
  }

  // If every selected line is blank/whitespace, toggle comment on the first line (or all)
  if (!hasNonEmpty) {
    allCommented = false;
    minIndent = 0;
  }
  if (!Number.isFinite(minIndent)) minIndent = 0;

  const colDelta = new Map<number, number>();
  const nextLines: string[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const ln = startLine + i;
    const text = rawLines[i]!;
    const trimmed = text.trimStart();

    if (trimmed.length === 0) {
      if (!hasNonEmpty) {
        nextLines.push(`${text}${lineToken} `);
        colDelta.set(ln, lineToken.length + 1);
      } else {
        nextLines.push(text);
        colDelta.set(ln, 0);
      }
      continue;
    }

    if (allCommented) {
      const wsLen = text.length - trimmed.length;
      const afterToken = trimmed.slice(lineToken.length);
      const removeSpace = afterToken.startsWith(' ') ? 1 : 0;
      const removedLen = lineToken.length + removeSpace;
      const updated = text.slice(0, wsLen) + afterToken.slice(removeSpace);
      nextLines.push(updated);
      colDelta.set(ln, -removedLen);
    } else {
      const insertAt = Math.min(minIndent, text.length);
      const prefix = `${lineToken} `;
      const updated = text.slice(0, insertAt) + prefix + text.slice(insertAt);
      nextLines.push(updated);
      colDelta.set(ln, prefix.length);
    }
  }

  const adjustPos = (p: { lineNumber: number; column: number }) => {
    const delta = colDelta.get(p.lineNumber) ?? 0;
    const newLine = nextLines[p.lineNumber - startLine];
    const maxCol = newLine != null ? newLine.length + 1 : model.getLineContent(p.lineNumber).length + 1;
    return {
      lineNumber: p.lineNumber,
      column: Math.max(1, Math.min(maxCol, p.column + delta)),
    };
  };

  const nextA = adjustPos(a);
  const nextB = adjustPos(b);

  const from = model.getOffsetAt(startLine, 1);
  const to = model.getOffsetAt(endLine, model.getLineContent(endLine).length + 1);

  model.replaceRange(from, to, nextLines.join('\n'), {
    aLine: nextA.lineNumber,
    aCol: nextA.column,
    bLine: nextB.lineNumber,
    bCol: nextB.column,
  });

  selection.anchor = nextA;
  selection.active = nextB;
  return true;
}

/**
 * Toggle block comment (`Shift+Alt+A`) using the language's `comments.blockComment`.
 * Wraps or unwraps the active selection, or the current line's content when selection is empty.
 */
export function toggleBlockComment(
  model: TextModel,
  selection: SelectionState,
  config: LanguageConfiguration | undefined,
): boolean {
  const pair = config?.comments?.blockComment;
  if (!pair) return false;
  const [open, close] = pair;
  if (!open || !close) return false;

  const { forward, start, end } = orderedEndpoints(selection);
  let fromOffset: number;
  let toOffset: number;
  const wasEmpty = selection.isEmpty;

  if (wasEmpty) {
    // Toggle around the current line's non-whitespace content (or caret if empty line)
    const ln = selection.active.lineNumber;
    const line = model.getLineContent(ln);
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      const off = model.getOffsetAt(ln, selection.active.column);
      const text = `${open}  ${close}`;
      const caretCol = selection.active.column + open.length + 1;
      model.replaceRange(off, off, text, {
        aLine: ln,
        aCol: caretCol,
        bLine: ln,
        bCol: caretCol,
      });
      selection.setCaret(ln, caretCol);
      return true;
    }
    const lead = line.length - line.trimStart().length;
    const trail = line.trimEnd().length;
    fromOffset = model.getOffsetAt(ln, lead + 1);
    toOffset = model.getOffsetAt(ln, trail + 1);
  } else {
    fromOffset = model.getOffsetAt(start.lineNumber, start.column);
    toOffset = model.getOffsetAt(end.lineNumber, end.column);
  }

  const fullText = model.getValue();
  const selected = fullText.slice(fromOffset, toOffset);

  // Check if selected text itself starts with `open` and ends with `close`
  const innerUnwrap =
    selected.startsWith(open) &&
    selected.endsWith(close) &&
    selected.length >= open.length + close.length;

  // Or if `open` immediately precedes fromOffset and `close` immediately follows toOffset
  const outerUnwrap =
    !innerUnwrap &&
    fromOffset >= open.length &&
    fullText.slice(fromOffset - open.length, fromOffset) === open &&
    fullText.slice(toOffset, toOffset + close.length) === close;

  if (innerUnwrap) {
    let unwrapped = selected.slice(open.length, selected.length - close.length);
    if (unwrapped.startsWith(' ') && unwrapped.endsWith(' ') && unwrapped.length >= 2) {
      unwrapped = unwrapped.slice(1, -1);
    }
    const afterStart = model.getPositionAt(fromOffset);
    // Compute post-edit end position using the new unwrapped string
    const parts = unwrapped.split('\n');
    const afterEndLine = afterStart.lineNumber + parts.length - 1;
    const afterEndCol =
      parts.length === 1
        ? afterStart.column + parts[0]!.length
        : parts[parts.length - 1]!.length + 1;
    const afterSel = wasEmpty
      ? { aLine: afterEndLine, aCol: afterEndCol, bLine: afterEndLine, bCol: afterEndCol }
      : forward
        ? {
            aLine: afterStart.lineNumber,
            aCol: afterStart.column,
            bLine: afterEndLine,
            bCol: afterEndCol,
          }
        : {
            aLine: afterEndLine,
            aCol: afterEndCol,
            bLine: afterStart.lineNumber,
            bCol: afterStart.column,
          };
    model.replaceRange(fromOffset, toOffset, unwrapped, afterSel);
    selection.anchor = { lineNumber: afterSel.aLine, column: afterSel.aCol };
    selection.active = { lineNumber: afterSel.bLine, column: afterSel.bCol };
    return true;
  }

  if (outerUnwrap) {
    const startOff = fromOffset - open.length;
    const endOff = toOffset + close.length;
    const afterStart = model.getPositionAt(startOff);
    const parts = selected.split('\n');
    const afterEndLine = afterStart.lineNumber + parts.length - 1;
    const afterEndCol =
      parts.length === 1
        ? afterStart.column + parts[0]!.length
        : parts[parts.length - 1]!.length + 1;
    const afterSel = forward
      ? {
          aLine: afterStart.lineNumber,
          aCol: afterStart.column,
          bLine: afterEndLine,
          bCol: afterEndCol,
        }
      : {
          aLine: afterEndLine,
          aCol: afterEndCol,
          bLine: afterStart.lineNumber,
          bCol: afterStart.column,
        };
    model.replaceRange(startOff, endOff, selected, afterSel);
    selection.anchor = { lineNumber: afterSel.aLine, column: afterSel.aCol };
    selection.active = { lineNumber: afterSel.bLine, column: afterSel.bCol };
    return true;
  }

  // Wrap with block comment
  const wrapped = `${open} ${selected} ${close}`;
  const startPos = model.getPositionAt(fromOffset);
  const parts = wrapped.split('\n');
  const endLine = startPos.lineNumber + parts.length - 1;
  const endCol =
    parts.length === 1
      ? startPos.column + parts[0]!.length
      : parts[parts.length - 1]!.length + 1;

  const afterSel = wasEmpty
    ? { aLine: endLine, aCol: endCol, bLine: endLine, bCol: endCol }
    : forward
      ? { aLine: startPos.lineNumber, aCol: startPos.column, bLine: endLine, bCol: endCol }
      : { aLine: endLine, aCol: endCol, bLine: startPos.lineNumber, bCol: startPos.column };

  model.replaceRange(fromOffset, toOffset, wrapped, afterSel);
  selection.anchor = { lineNumber: afterSel.aLine, column: afterSel.aCol };
  selection.active = { lineNumber: afterSel.bLine, column: afterSel.bCol };
  return true;
}

/**
 * Move the active line or selected line block up or down by 1 line (`Alt+Up` / `Alt+Down`).
 */
export function moveLines(
  model: TextModel,
  selection: SelectionState,
  direction: 'up' | 'down',
): boolean {
  const lineCount = model.getLineCount();
  const { startLine, endLine } = selectedLineSpan(selection);

  if (direction === 'up' && startLine <= 1) return false;
  if (direction === 'down' && endLine >= lineCount) return false;

  const delta = direction === 'up' ? -1 : 1;
  const blockStart = direction === 'up' ? startLine - 1 : startLine;
  const blockEnd = direction === 'up' ? endLine : endLine + 1;

  const movedLines: string[] = [];
  for (let ln = startLine; ln <= endLine; ln++) {
    movedLines.push(model.getLineContent(ln));
  }

  let newLines: string[];
  if (direction === 'up') {
    const swapLine = model.getLineContent(startLine - 1);
    newLines = [...movedLines, swapLine];
  } else {
    const swapLine = model.getLineContent(endLine + 1);
    newLines = [swapLine, ...movedLines];
  }

  const nextA = {
    lineNumber: selection.anchor.lineNumber + delta,
    column: selection.anchor.column,
  };
  const nextB = {
    lineNumber: selection.active.lineNumber + delta,
    column: selection.active.column,
  };

  const from = model.getOffsetAt(blockStart, 1);
  const to = model.getOffsetAt(blockEnd, model.getLineContent(blockEnd).length + 1);

  model.replaceRange(from, to, newLines.join('\n'), {
    aLine: nextA.lineNumber,
    aCol: nextA.column,
    bLine: nextB.lineNumber,
    bCol: nextB.column,
  });

  selection.anchor = nextA;
  selection.active = nextB;
  return true;
}

/**
 * Duplicate the active line or selected line block above or below
 * (`Shift+Alt+Up` / `Shift+Alt+Down`).
 */
export function duplicateLines(
  model: TextModel,
  selection: SelectionState,
  direction: 'up' | 'down',
): boolean {
  const { startLine, endLine } = selectedLineSpan(selection);
  const count = endLine - startLine + 1;
  const lines: string[] = [];
  for (let ln = startLine; ln <= endLine; ln++) {
    lines.push(model.getLineContent(ln));
  }
  const block = lines.join('\n');
  const from = model.getOffsetAt(startLine, 1);
  const to = model.getOffsetAt(endLine, model.getLineContent(endLine).length + 1);

  const shift = direction === 'down' ? count : 0;
  const nextA = {
    lineNumber: selection.anchor.lineNumber + shift,
    column: selection.anchor.column,
  };
  const nextB = {
    lineNumber: selection.active.lineNumber + shift,
    column: selection.active.column,
  };

  model.replaceRange(from, to, `${block}\n${block}`, {
    aLine: nextA.lineNumber,
    aCol: nextA.column,
    bLine: nextB.lineNumber,
    bCol: nextB.column,
  });

  selection.anchor = nextA;
  selection.active = nextB;
  return true;
}

/**
 * Delete the active line or all lines spanned by the current selection (`Ctrl+Shift+K`).
 */
export function deleteLines(model: TextModel, selection: SelectionState): boolean {
  const lineCount = model.getLineCount();
  const { startLine, endLine } = selectedLineSpan(selection);
  const goalCol = selection.active.column;

  if (startLine === 1 && endLine === lineCount) {
    // Deleting every line in the document leaves a single empty line
    const endOff = model.getOffsetAt(endLine, model.getLineContent(endLine).length + 1);
    if (endOff === 0) return false;
    model.replaceRange(0, endOff, '', { aLine: 1, aCol: 1, bLine: 1, bCol: 1 });
    selection.setCaret(1, 1);
    return true;
  }

  let from: number;
  let to: number;
  let nextLine: number;

  if (endLine < lineCount) {
    // Delete from start of startLine through the newline after endLine
    from = model.getOffsetAt(startLine, 1);
    to = model.getOffsetAt(endLine + 1, 1);
    nextLine = startLine;
  } else {
    // Deleting through the last line: remove the preceding newline before startLine too
    const prevLineLen = model.getLineContent(startLine - 1).length;
    from = model.getOffsetAt(startLine - 1, prevLineLen + 1);
    to = model.getOffsetAt(endLine, model.getLineContent(endLine).length + 1);
    nextLine = startLine - 1;
  }

  const remainingLineLen =
    endLine < lineCount
      ? model.getLineContent(endLine + 1).length
      : model.getLineContent(startLine - 1).length;
  const nextCol = Math.max(1, Math.min(remainingLineLen + 1, goalCol));

  model.replaceRange(from, to, '', {
    aLine: nextLine,
    aCol: nextCol,
    bLine: nextLine,
    bCol: nextCol,
  });
  selection.setCaret(nextLine, nextCol);
  return true;
}

/**
 * Insert a properly indented blank line below (`Ctrl+Enter`) or above (`Ctrl+Shift+Enter`)
 * the active line without splitting the current line.
 */
export function insertLine(
  model: TextModel,
  selection: SelectionState,
  position: 'above' | 'below',
  config: LanguageConfiguration | undefined,
  tabSize: number,
): boolean {
  const ln = selection.active.lineNumber;
  const lineText = model.getLineContent(ln);
  const baseIndent = leadingWhitespace(lineText);

  if (position === 'below') {
    let nextIndent = baseIndent;
    if (config?.indentationRules?.increaseIndentPattern?.test(lineText)) {
      nextIndent = baseIndent + ' '.repeat(Math.max(1, tabSize));
    }
    const endOff = model.getOffsetAt(ln, lineText.length + 1);
    const caretLine = ln + 1;
    const caretCol = nextIndent.length + 1;
    model.replaceRange(endOff, endOff, `\n${nextIndent}`, {
      aLine: caretLine,
      aCol: caretCol,
      bLine: caretLine,
      bCol: caretCol,
    });
    selection.setCaret(caretLine, caretCol);
    return true;
  }

  // Insert above
  const startOff = model.getOffsetAt(ln, 1);
  const caretLine = ln;
  const caretCol = baseIndent.length + 1;
  model.replaceRange(startOff, startOff, `${baseIndent}\n`, {
    aLine: caretLine,
    aCol: caretCol,
    bLine: caretLine,
    bCol: caretCol,
  });
  selection.setCaret(caretLine, caretCol);
  return true;
}
