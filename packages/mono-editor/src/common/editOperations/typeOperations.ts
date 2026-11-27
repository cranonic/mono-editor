import type { SelectionState } from '../core/SelectionState';
import { getLanguageConfiguration } from '../languages/languageConfigurationRegistry';
import type {
  AutoClosingBehavior,
  AutoSurroundBehavior,
  IAutoClosingPairConditional,
} from '../languages/languageConfigurationTypes';
import type { TextModel, UndoKind } from '../model/TextModel';
import { nextGraphemeOffset } from '../util/grapheme';
import { hasUnmatchedClosingBracket } from './bracketBalance';

export interface TypingPolicy {
  autoClosingBrackets: AutoClosingBehavior;
  autoClosingQuotes: AutoClosingBehavior;
  autoSurround: AutoSurroundBehavior;
  getTokenTypeAt?: (lineNumber: number, column: number) => string | null;
}

export function isQuotePair(open: string, close: string): boolean {
  return open === close && (open === '"' || open === "'" || open === '`');
}

export function normalizeTokenContext(tok: string | null): 'string' | 'comment' | null {
  if (!tok) return null;
  if (tok === 'string' || tok.startsWith('string.')) return 'string';
  if (tok === 'comment' || tok.startsWith('comment.')) return 'comment';
  return null;
}

export function shouldAutoClosePair(
  pair: IAutoClosingPairConditional,
  lineNumber: number,
  column: number,
  lineText: string,
  policy: TypingPolicy,
): boolean {
  const isQuote = isQuotePair(pair.open, pair.close);
  const mode = isQuote ? policy.autoClosingQuotes : policy.autoClosingBrackets;
  if (mode === 'never') return false;

  if (pair.notIn?.length && policy.getTokenTypeAt) {
    const tok =
      normalizeTokenContext(policy.getTokenTypeAt(lineNumber, column)) ??
      (column > 1 ? normalizeTokenContext(policy.getTokenTypeAt(lineNumber, column - 1)) : null);
    if (tok && pair.notIn.includes(tok)) {
      return false;
    }
  }

  const nextCh = column <= lineText.length ? lineText[column - 1]! : '';
  const prevCh = column > 1 ? lineText[column - 2]! : '';

  if (pair.open === "'" && prevCh && /[\p{L}\p{N}_$]/u.test(prevCh)) {
    return false;
  }

  if (mode === 'always') return true;
  if (mode === 'beforeWhitespace') return !nextCh || /\s/.test(nextCh);
  return !nextCh || /[\s\)\]\}\>\,\;\:\.]/.test(nextCh);
}

export function tryAutoSurroundSelection(
  model: TextModel,
  selection: SelectionState,
  ch: string,
  policy: TypingPolicy,
): boolean {
  if (selection.isEmpty || policy.autoSurround === 'never') return false;
  const config = getLanguageConfiguration(model.getLanguageId());
  const pairs = config?.surroundingPairs;
  if (!pairs?.length) return false;

  const match = pairs.find((p) => {
    if (p.open !== ch) return false;
    const isQ = isQuotePair(p.open, p.close);
    if (policy.autoSurround === 'quotes') return isQ;
    if (policy.autoSurround === 'brackets') return !isQ;
    return true;
  });
  if (!match) return false;

  const a = selection.anchor;
  const b = selection.active;
  const aOff = model.getOffsetAt(a.lineNumber, a.column);
  const bOff = model.getOffsetAt(b.lineNumber, b.column);
  const forward = aOff <= bOff;
  const start = Math.min(aOff, bOff);
  const end = Math.max(aOff, bOff);
  const inner = model.getValue().slice(start, end);
  const wrapped = `${match.open}${inner}${match.close}`;

  const startPos = model.getPositionAt(start);
  const innerStartPos = {
    lineNumber: startPos.lineNumber,
    column: startPos.column + match.open.length,
  };
  const innerLines = inner.split('\n');
  const innerEndLine = innerStartPos.lineNumber + innerLines.length - 1;
  const innerEndCol =
    innerLines.length === 1
      ? innerStartPos.column + innerLines[0]!.length
      : innerLines[innerLines.length - 1]!.length + 1;

  const afterSel = forward
    ? { aLine: innerStartPos.lineNumber, aCol: innerStartPos.column, bLine: innerEndLine, bCol: innerEndCol }
    : { aLine: innerEndLine, aCol: innerEndCol, bLine: innerStartPos.lineNumber, bCol: innerStartPos.column };

  model.replaceRange(start, end, wrapped, afterSel, 'other');
  selection.anchor = { lineNumber: afterSel.aLine, column: afterSel.aCol };
  selection.active = { lineNumber: afterSel.bLine, column: afterSel.bCol };
  return true;
}

export function tryOvertypeOrAutoCloseChar(
  model: TextModel,
  selection: SelectionState,
  ch: string,
  policy: TypingPolicy,
): 'overtype' | 'autoclose' | null {
  if (!selection.isEmpty || ch.length !== 1) return null;
  const config = getLanguageConfiguration(model.getLanguageId());
  const pairs = config?.autoClosingPairs;
  if (!pairs?.length) return null;

  const { lineNumber, column } = selection.active;
  const lineText = model.getLineContent(lineNumber);
  const nextCh = column <= lineText.length ? lineText[column - 1]! : '';

  const closePair = pairs.find((p) => p.close === ch && p.open.length === 1 && p.close.length === 1);
  if (closePair && nextCh === ch) {
    const isQuote = isQuotePair(closePair.open, closePair.close);
    const mode = isQuote ? policy.autoClosingQuotes : policy.autoClosingBrackets;
    if (mode !== 'never') {
      let shouldOvertype = true;
      if (isQuote) {
        let count = 0;
        for (let i = 0; i < column - 1; i++) {
          if (lineText[i] === ch && (i === 0 || lineText[i - 1] !== '\\')) count++;
        }
        shouldOvertype = count % 2 === 1;
      }
      if (shouldOvertype) {
        selection.setCaret(lineNumber, column + 1);
        model.pushStackElement();
        return 'overtype';
      }
    }
  }

  const openPair = pairs.find((p) => p.open === ch && p.close.length === 1);
  if (openPair && shouldAutoClosePair(openPair, lineNumber, column, lineText, policy)) {
    const isQuote = isQuotePair(openPair.open, openPair.close);
    if (
      !isQuote &&
      hasUnmatchedClosingBracket(model, lineNumber, column, openPair.open, openPair.close)
    ) {
      return null;
    }
    const off = model.getOffsetAt(lineNumber, column);
    const caretCol = column + openPair.open.length;
    model.replaceRange(
      off,
      off,
      openPair.open + openPair.close,
      { aLine: lineNumber, aCol: caretCol, bLine: lineNumber, bCol: caretCol },
      'other',
    );
    selection.setCaret(lineNumber, caretCol);
    return 'autoclose';
  }
  return null;
}

export function tryPairBackspaceDelete(
  model: TextModel,
  selection: SelectionState,
  policy: TypingPolicy,
): boolean {
  if (!selection.isEmpty) return false;
  const config = getLanguageConfiguration(model.getLanguageId());
  const pairs = config?.autoClosingPairs;
  if (!pairs?.length) return false;

  const { lineNumber, column } = selection.active;
  const lineText = model.getLineContent(lineNumber);
  if (column <= 1 || column > lineText.length) return false;

  const prevCh = lineText[column - 2]!;
  const nextCh = lineText[column - 1]!;
  const match = pairs.find((p) => p.open === prevCh && p.close === nextCh);
  if (!match) return false;

  const isQuote = isQuotePair(match.open, match.close);
  const mode = isQuote ? policy.autoClosingQuotes : policy.autoClosingBrackets;
  if (mode === 'never') return false;

  const offset = model.getOffsetAt(lineNumber, column);
  model.delete(offset - 1, offset + 1, 'other');
  selection.setCaret(lineNumber, column - 1);
  return true;
}

export function replaceSelectionText(
  model: TextModel,
  selection: SelectionState,
  text: string,
  kind?: UndoKind,
): void {
  const undoKind: UndoKind = kind ?? (text === '' || text.includes('\n') ? 'other' : 'typing');
  const storedLen = model.normalizeEol(text).length;

  if (selection.hasMultipleCursors) {
    const items = selection.selections.map((s, idx) => {
      const aOff = model.getOffsetAt(s.anchor.lineNumber, s.anchor.column);
      const bOff = model.getOffsetAt(s.active.lineNumber, s.active.column);
      return { idx, start: Math.min(aOff, bOff), end: Math.max(aOff, bOff) };
    });
    const sortedAsc = [...items].sort((x, y) => x.start - y.start || x.end - y.end);
    const sortedDesc = [...sortedAsc].reverse();
    const lines = text.split('\n');
    const perCursor = lines.length === sortedAsc.length && lines.length > 1;
    const textForAscIdx = (ascIdx: number) => (perCursor ? lines[ascIdx]! : text);

    const finalOffsets = new Array<number>(sortedAsc.length);
    let delta = 0;
    for (let i = 0; i < sortedAsc.length; i++) {
      const it = sortedAsc[i]!;
      const piece = model.normalizeEol(textForAscIdx(i));
      finalOffsets[i] = it.start + delta + piece.length;
      delta += piece.length - (it.end - it.start);
    }

    model.transact(() => {
      for (let k = 0; k < sortedDesc.length; k++) {
        const it = sortedDesc[k]!;
        const ascIdx = sortedAsc.length - 1 - k;
        model.replaceRange(it.start, it.end, textForAscIdx(ascIdx), undefined, 'other');
      }
    });

    const nextSels = sortedAsc.map((it, i) => {
      const pos = model.getPositionAt(finalOffsets[i]!);
      return { origIdx: it.idx, range: { anchor: pos, active: { ...pos } } };
    });
    nextSels.sort((a, b) => a.origIdx - b.origIdx);
    selection.setSelections(nextSels.map((x) => x.range));
    return;
  }

  if (!selection.isEmpty) {
    const a = selection.anchor;
    const b = selection.active;
    const aOff = model.getOffsetAt(a.lineNumber, a.column);
    const bOff = model.getOffsetAt(b.lineNumber, b.column);
    const start = Math.min(aOff, bOff);
    const end = Math.max(aOff, bOff);
    model.replaceRange(start, end, text, undefined, undoKind);
    const pos = model.getPositionAt(start + storedLen);
    selection.setCaret(pos.lineNumber, pos.column);
  } else {
    const off = model.getOffsetAt(selection.active.lineNumber, selection.active.column);
    model.insert(off, text, undoKind);
    const pos = model.getPositionAt(off + storedLen);
    selection.setCaret(pos.lineNumber, pos.column);
  }
}

export function deleteMultiCursor(
  model: TextModel,
  selection: SelectionState,
  direction: 'left' | 'right',
): void {
  const totalLen = model.getValue().length;
  const eolLen = model.getEOL().length;
  const items = selection.selections.map((s, idx) => {
    const aOff = model.getOffsetAt(s.anchor.lineNumber, s.anchor.column);
    const bOff = model.getOffsetAt(s.active.lineNumber, s.active.column);
    let start = Math.min(aOff, bOff);
    let end = Math.max(aOff, bOff);
    if (start === end) {
      if (direction === 'left' && start > 0) {
        const line = model.getLineContent(s.active.lineNumber);
        let delLen = 1;
        if (s.active.column === 1) delLen = eolLen;
        else if (s.active.column > 2) {
          const lo = line.charCodeAt(s.active.column - 2);
          const hi = line.charCodeAt(s.active.column - 3);
          if (hi >= 0xd800 && hi <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff) delLen = 2;
        }
        start = Math.max(0, start - delLen);
      } else if (direction === 'right' && end < totalLen) {
        const line = model.getLineContent(s.active.lineNumber);
        let delLen = 1;
        if (s.active.column > line.length) delLen = eolLen;
        else {
          const nextOff = nextGraphemeOffset(line, s.active.column - 1);
          delLen = Math.max(1, nextOff - (s.active.column - 1));
        }
        end = Math.min(totalLen, end + delLen);
      }
    }
    return { idx, start, end };
  });

  const sortedAsc = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: { idxList: number[]; start: number; end: number }[] = [];
  for (const it of sortedAsc) {
    const prev = merged[merged.length - 1];
    if (prev && it.start <= prev.end) {
      prev.end = Math.max(prev.end, it.end);
      prev.idxList.push(it.idx);
    } else {
      merged.push({ idxList: [it.idx], start: it.start, end: it.end });
    }
  }

  const finalOffsets: { origIdx: number; offset: number }[] = [];
  let removed = 0;
  for (const m of merged) {
    const posOff = m.start - removed;
    for (const origIdx of m.idxList) finalOffsets.push({ origIdx, offset: posOff });
    removed += m.end - m.start;
  }

  model.transact(() => {
    for (let i = merged.length - 1; i >= 0; i--) {
      const m = merged[i]!;
      if (m.end > m.start) model.delete(m.start, m.end, 'other');
    }
  });

  finalOffsets.sort((a, b) => a.origIdx - b.origIdx);
  selection.setSelections(
    finalOffsets.map((f) => {
      const p = model.getPositionAt(f.offset);
      return { anchor: p, active: { ...p } };
    }),
  );
}
