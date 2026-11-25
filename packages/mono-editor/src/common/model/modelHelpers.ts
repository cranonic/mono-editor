import type { FindMatch, IPosition, IRange, IWordAtPosition } from '../core/types';

export interface TextModelReadable {
  getLineCount(): number;
  getLineContent(lineNumber: number): string;
  getOffsetAt(lineNumber: number, column: number): number;
  getPositionAt(offset: number): IPosition;
  getEOL(): '\n' | '\r\n';
}

const DEFAULT_WORD_SEPARATORS = '`~!@#$%^&*()-=+[{]}\\|;:\'",.<>/? \t\r\n';

export function validatePositionOnModel(model: TextModelReadable, position: IPosition): IPosition {
  const maxLine = Math.max(1, model.getLineCount());
  const lineNumber = Math.max(1, Math.min(maxLine, Math.floor(position.lineNumber || 1)));
  const maxCol = model.getLineContent(lineNumber).length + 1;
  const column = Math.max(1, Math.min(maxCol, Math.floor(position.column || 1)));
  return { lineNumber, column };
}

export function validateRangeOnModel(model: TextModelReadable, range: IRange): IRange {
  const start = validatePositionOnModel(model, {
    lineNumber: range.startLineNumber,
    column: range.startColumn,
  });
  const end = validatePositionOnModel(model, {
    lineNumber: range.endLineNumber,
    column: range.endColumn,
  });
  if (
    start.lineNumber > end.lineNumber ||
    (start.lineNumber === end.lineNumber && start.column > end.column)
  ) {
    return {
      startLineNumber: end.lineNumber,
      startColumn: end.column,
      endLineNumber: start.lineNumber,
      endColumn: start.column,
    };
  }
  return {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column,
  };
}

export function getWordAtPositionOnModel(
  model: TextModelReadable,
  position: IPosition,
  wordSeparators = DEFAULT_WORD_SEPARATORS,
): IWordAtPosition | null {
  const pos = validatePositionOnModel(model, position);
  const line = model.getLineContent(pos.lineNumber);
  if (!line.length) return null;

  const isSep = (ch: string) => wordSeparators.includes(ch);
  let idx = pos.column - 1;
  if (idx >= line.length || isSep(line[idx]!)) {
    if (idx > 0 && !isSep(line[idx - 1]!)) {
      idx -= 1;
    } else {
      return null;
    }
  }
  let start = idx;
  while (start > 0 && !isSep(line[start - 1]!)) start--;
  let end = idx + 1;
  while (end < line.length && !isSep(line[end]!)) end++;
  const word = line.slice(start, end);
  if (!word) return null;
  return { word, startColumn: start + 1, endColumn: end + 1 };
}

export function getWordUntilPositionOnModel(
  model: TextModelReadable,
  position: IPosition,
  wordSeparators = DEFAULT_WORD_SEPARATORS,
): IWordAtPosition {
  const pos = validatePositionOnModel(model, position);
  const line = model.getLineContent(pos.lineNumber);
  const isSep = (ch: string) => wordSeparators.includes(ch);
  let start = pos.column - 1;
  while (start > 0 && !isSep(line[start - 1]!)) start--;
  return {
    word: line.slice(start, pos.column - 1),
    startColumn: start + 1,
    endColumn: pos.column,
  };
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isBoundaryChar(ch: string | undefined, wordSeparators: string): boolean {
  return !ch || wordSeparators.includes(ch);
}

export function findMatchesOnModel(
  model: TextModelReadable,
  fullText: string,
  searchString: string,
  searchScope: boolean | IRange | IRange[],
  isRegex: boolean,
  matchCase: boolean,
  wordSeparators: string | null,
  captureMatches: boolean,
  limitResultCount = 9999,
): FindMatch[] {
  if (!searchString) return [];
  let re: RegExp;
  try {
    const flags = matchCase ? 'g' : 'gi';
    re = new RegExp(isRegex ? searchString : escapeRegExp(searchString), flags);
  } catch {
    return [];
  }

  const scopes: IRange[] =
    typeof searchScope === 'boolean'
      ? [
          {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: model.getLineCount(),
            endColumn: model.getLineContent(model.getLineCount()).length + 1,
          },
        ]
      : Array.isArray(searchScope)
        ? searchScope
        : [searchScope];

  const out: FindMatch[] = [];
  const sep = wordSeparators ?? '';

  for (const rawScope of scopes) {
    const scope = validateRangeOnModel(model, rawScope);
    const startOff = model.getOffsetAt(scope.startLineNumber, scope.startColumn);
    const endOff = model.getOffsetAt(scope.endLineNumber, scope.endColumn);
    const slice = fullText.slice(startOff, endOff);
    re.lastIndex = 0;

    let m: RegExpExecArray | null;
    while ((m = re.exec(slice)) !== null) {
      const mStart = startOff + m.index;
      const mEnd = mStart + m[0].length;
      if (m[0].length === 0) {
        re.lastIndex++;
        if (re.lastIndex > slice.length) break;
        continue;
      }
      if (sep) {
        const before = mStart > 0 ? fullText[mStart - 1] : undefined;
        const after = mEnd < fullText.length ? fullText[mEnd] : undefined;
        if (!isBoundaryChar(before, sep) || !isBoundaryChar(after, sep)) {
          continue;
        }
      }
      const sp = model.getPositionAt(mStart);
      const ep = model.getPositionAt(mEnd);
      out.push({
        range: {
          startLineNumber: sp.lineNumber,
          startColumn: sp.column,
          endLineNumber: ep.lineNumber,
          endColumn: ep.column,
        },
        matches: captureMatches ? Array.from(m) : null,
      });
      if (out.length >= limitResultCount) return out;
    }
  }
  return out;
}

export function findNextMatchOnModel(
  model: TextModelReadable,
  fullText: string,
  searchString: string,
  searchStart: IPosition,
  isRegex: boolean,
  matchCase: boolean,
  wordSeparators: string | null,
  captureMatches: boolean,
): FindMatch | null {
  const all = findMatchesOnModel(model, fullText, searchString, true, isRegex, matchCase, wordSeparators, captureMatches);
  if (!all.length) return null;
  const startOff = model.getOffsetAt(searchStart.lineNumber, searchStart.column);
  for (const m of all) {
    if (model.getOffsetAt(m.range.startLineNumber, m.range.startColumn) >= startOff) return m;
  }
  return all[0]!;
}

export function findPreviousMatchOnModel(
  model: TextModelReadable,
  fullText: string,
  searchString: string,
  searchStart: IPosition,
  isRegex: boolean,
  matchCase: boolean,
  wordSeparators: string | null,
  captureMatches: boolean,
): FindMatch | null {
  const all = findMatchesOnModel(model, fullText, searchString, true, isRegex, matchCase, wordSeparators, captureMatches);
  if (!all.length) return null;
  const startOff = model.getOffsetAt(searchStart.lineNumber, searchStart.column);
  for (let i = all.length - 1; i >= 0; i--) {
    const m = all[i]!;
    if (model.getOffsetAt(m.range.startLineNumber, m.range.startColumn) < startOff) return m;
  }
  return all[all.length - 1]!;
}

export function detectIndentationOnModel(
  model: TextModelReadable,
  defaultInsertSpaces: boolean,
  defaultTabSize: number,
): { insertSpaces: boolean; tabSize: number } {
  const maxLines = Math.min(model.getLineCount(), 500);
  let tabLines = 0;
  let spaceLines = 0;
  const diffCounts = new Map<number, number>();
  let prevSpaces = 0;

  for (let ln = 1; ln <= maxLines; ln++) {
    const line = model.getLineContent(ln);
    if (!line.trim()) continue;
    if (line[0] === '\t') {
      tabLines++;
      prevSpaces = 0;
    } else if (line[0] === ' ') {
      let sp = 0;
      while (sp < line.length && line[sp] === ' ') sp++;
      spaceLines++;
      const diff = Math.abs(sp - prevSpaces);
      if (diff >= 2 && diff <= 8) {
        diffCounts.set(diff, (diffCounts.get(diff) ?? 0) + 1);
      } else if (sp >= 2 && sp <= 8) {
        diffCounts.set(sp, (diffCounts.get(sp) ?? 0) + 1);
      }
      prevSpaces = sp;
    } else {
      prevSpaces = 0;
    }
  }

  if (tabLines === 0 && spaceLines === 0) {
    return { insertSpaces: defaultInsertSpaces, tabSize: defaultTabSize };
  }

  const insertSpaces = spaceLines >= tabLines;
  let bestSize = defaultTabSize;
  let bestScore = 0;
  for (const candidate of [2, 4, 8, 3, 6]) {
    const count = diffCounts.get(candidate) ?? 0;
    if (count > bestScore) {
      bestScore = count;
      bestSize = candidate;
    }
  }
  return { insertSpaces, tabSize: bestSize };
}
