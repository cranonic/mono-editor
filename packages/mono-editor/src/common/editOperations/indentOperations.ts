import type { SelectionState } from '../core/SelectionState';
import { getLanguageConfiguration } from '../languages/languageConfigurationRegistry';
import type { AutoIndentBehavior } from '../languages/languageConfigurationTypes';
import { evaluateOnEnter } from '../languages/onEnterEngine';
import type { TextModel } from '../model/TextModel';
import { replaceSelectionText } from './typeOperations';

export function indentSelectionLines(
  model: TextModel,
  selection: SelectionState,
  tabSize: number,
  insertSpaces = true,
): string | undefined {
  const pad = insertSpaces ? ' '.repeat(tabSize) : '\t';
  const padLen = pad.length;
  const a = selection.anchor;
  const b = selection.active;
  const startLine = Math.min(a.lineNumber, b.lineNumber);
  const endLine = Math.max(a.lineNumber, b.lineNumber);
  if (selection.isEmpty) {
    replaceSelectionText(model, selection, pad, 'other');
    return pad;
  }
  const from = model.getOffsetAt(startLine, 1);
  const to = model.getOffsetAt(endLine, model.getLineContent(endLine).length + 1);
  const lines: string[] = [];
  for (let ln = startLine; ln <= endLine; ln++) lines.push(pad + model.getLineContent(ln));
  const nextA = { lineNumber: a.lineNumber, column: a.column + padLen };
  const nextB = { lineNumber: b.lineNumber, column: b.column + padLen };
  model.replaceRange(from, to, lines.join('\n'), {
    aLine: nextA.lineNumber,
    aCol: nextA.column,
    bLine: nextB.lineNumber,
    bCol: nextB.column,
  });
  selection.anchor = nextA;
  selection.active = nextB;
  return undefined;
}

export function outdentSelectionLines(
  model: TextModel,
  selection: SelectionState,
  tabSize: number,
): void {
  const a = { ...selection.anchor };
  const b = { ...selection.active };
  const startLine = Math.min(a.lineNumber, b.lineNumber);
  const endLine = Math.max(a.lineNumber, b.lineNumber);
  const removedAt: Record<number, number> = {};
  const lines: string[] = [];
  let any = false;
  for (let ln = startLine; ln <= endLine; ln++) {
    const content = model.getLineContent(ln);
    let remove = 0;
    if (content.startsWith('\t')) remove = 1;
    else {
      while (remove < tabSize && remove < content.length && content[remove] === ' ') {
        remove++;
      }
    }
    if (remove > 0) {
      removedAt[ln] = remove;
      any = true;
    }
    lines.push(content.slice(remove));
  }
  const adj = (pos: { lineNumber: number; column: number }) => {
    const r = removedAt[pos.lineNumber] ?? 0;
    return {
      lineNumber: pos.lineNumber,
      column: Math.max(1, pos.column - r),
    };
  };
  const nextA = adj(a);
  const nextB = adj(b);
  if (any) {
    const from = model.getOffsetAt(startLine, 1);
    const to = model.getOffsetAt(endLine, model.getLineContent(endLine).length + 1);
    model.replaceRange(from, to, lines.join('\n'), {
      aLine: nextA.lineNumber,
      aCol: nextA.column,
      bLine: nextB.lineNumber,
      bCol: nextB.column,
    });
  }
  selection.anchor = nextA;
  selection.active = nextB;
}

export function applyEnterKey(
  model: TextModel,
  selection: SelectionState,
  tabSize: number,
  bracketEnterIndent: boolean,
  autoIndent: AutoIndentBehavior,
  trimAutoWhitespace = true,
): string {
  if (selection.hasMultipleCursors) {
    replaceSelectionText(model, selection, '\n', 'other');
    return '\n';
  }
  const a = selection.anchor;
  const b = selection.active;
  const aOff = model.getOffsetAt(a.lineNumber, a.column);
  const bOff = model.getOffsetAt(b.lineNumber, b.column);
  let startOff = Math.min(aOff, bOff);
  const endOff = Math.max(aOff, bOff);
  const startPos = model.getPositionAt(startOff);
  const endPos = model.getPositionAt(endOff);

  const startLineText = model.getLineContent(startPos.lineNumber);
  const endLineText = model.getLineContent(endPos.lineNumber);
  const effectiveLineText =
    startLineText.slice(0, startPos.column - 1) + endLineText.slice(endPos.column - 1);
  const prevLineText =
    startPos.lineNumber > 1 ? model.getLineContent(startPos.lineNumber - 1) : '';

  const effectiveAutoIndent: AutoIndentBehavior = bracketEnterIndent ? autoIndent : 'keep';
  const config = getLanguageConfiguration(model.getLanguageId());
  const result = evaluateOnEnter(
    config,
    effectiveLineText,
    startPos.column,
    prevLineText,
    tabSize,
    effectiveAutoIndent,
  );

  // trimAutoWhitespace: if current line is whitespace-only before caret and nothing after, clean it on Enter
  if (
    trimAutoWhitespace &&
    startPos.lineNumber === endPos.lineNumber &&
    startPos.column > 1 &&
    /^[ \t]+$/.test(startLineText.slice(0, startPos.column - 1)) &&
    endLineText.slice(endPos.column - 1).length === 0
  ) {
    startOff = model.getOffsetAt(startPos.lineNumber, 1);
  }

  const caretLine = startPos.lineNumber + result.caretLineDelta;
  const caretCol = result.caretColumn;
  model.replaceRange(startOff, endOff, result.insertText, {
    aLine: caretLine,
    aCol: caretCol,
    bLine: caretLine,
    bCol: caretCol,
  });
  selection.setCaret(caretLine, caretCol);
  return result.insertText;
}
