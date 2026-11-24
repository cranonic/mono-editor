import type { SelectionState } from '../core/SelectionState';
import type { TextModel } from '../model/TextModel';

export function isWordChar(ch: string): boolean {
  return /[\p{L}\p{M}\p{N}_$]/u.test(ch);
}

/**
 * Find next/prev word boundary column (1-based) on a line.
 * direction: -1 left, +1 right
 */
export function wordBoundary(line: string, column: number, direction: -1 | 1): number {
  let i = column - 1;
  if (direction > 0) {
    if (i >= line.length) return line.length + 1;
    if (i < line.length && isWordChar(line[i]!)) {
      while (i < line.length && isWordChar(line[i]!)) i++;
    } else {
      while (i < line.length && !isWordChar(line[i]!) && line[i] !== ' ' && line[i] !== '\t') i++;
      while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;
      while (i < line.length && isWordChar(line[i]!)) i++;
    }
    return i + 1;
  }
  if (i <= 0) return 1;
  i--;
  while (i > 0 && (line[i] === ' ' || line[i] === '\t')) i--;
  if (i >= 0 && isWordChar(line[i]!)) {
    while (i > 0 && isWordChar(line[i - 1]!)) i--;
    return i + 1;
  }
  while (i > 0 && !isWordChar(line[i - 1]!) && line[i - 1] !== ' ' && line[i - 1] !== '\t') i--;
  return i + 1;
}

export function leadingWs(line: string): string {
  const m = line.match(/^[ \t]*/);
  return m ? m[0]! : '';
}

export function moveAllCursors(
  model: TextModel,
  selection: SelectionState,
  computeNext: (pos: { lineNumber: number; column: number }) => { lineNumber: number; column: number },
  extend: boolean,
): void {
  const lineCount = model.getLineCount();
  const next = selection.selections.map((s) => {
    const raw = computeNext(s.active);
    const ln = Math.max(1, Math.min(lineCount, raw.lineNumber));
    const maxCol = model.getLineContent(ln).length + 1;
    const col = Math.max(1, Math.min(maxCol, raw.column));
    const nextActive = { lineNumber: ln, column: col };
    return {
      anchor: extend ? { ...s.anchor } : { ...nextActive },
      active: nextActive,
    };
  });
  selection.setSelections(next);
  model.pushStackElement();
}
