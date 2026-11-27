import { leadingWs, moveAllCursors, wordBoundary } from '../../common/cursor/cursorMotion';
import type { SelectionState } from '../../common/core/SelectionState';
import {
  applyEnterKey,
  indentSelectionLines,
  outdentSelectionLines,
} from '../../common/editOperations/indentOperations';
import {
  deleteMultiCursor,
  replaceSelectionText,
  tryPairBackspaceDelete,
  type TypingPolicy,
} from '../../common/editOperations/typeOperations';
import type { AutoIndentBehavior } from '../../common/languages/languageConfigurationTypes';
import type { TextModel } from '../../common/model/TextModel';
import { nextGraphemeOffset, prevGraphemeOffset } from '../../common/util/grapheme';

export interface KeyboardChangeEvent {
  kind: 'type' | 'backspace' | 'delete' | 'enter' | 'indent' | 'move' | 'composition' | 'other';
  text?: string;
}

export interface KeyboardHandlerState {
  model: TextModel;
  selection: SelectionState;
  readOnly: boolean;
  tabSize: number;
  insertSpaces?: boolean;
  stickyTabStops?: boolean;
  trimAutoWhitespace?: boolean;
  pageSize: number;
  bracketEnterIndent: boolean;
  autoIndent: AutoIndentBehavior;
  typingPolicy: TypingPolicy;
  goalColumn: number | null;
  setGoalColumn: (c: number | null) => void;
  onChange: (ev: KeyboardChangeEvent) => void;
}

function resolveNavigationKey(e: KeyboardEvent): string {
  const k = e.key || '';
  if (k && k !== 'Unidentified' && k !== 'Process') {
    if (k === 'Up') return 'ArrowUp';
    if (k === 'Down') return 'ArrowDown';
    if (k === 'Left') return 'ArrowLeft';
    if (k === 'Right') return 'ArrowRight';
    if (k === 'Esc') return 'Escape';
    if (k === 'Del') return 'Delete';
    return k;
  }
  const kc = e.keyCode || e.which || 0;
  switch (kc) {
    case 8: return 'Backspace';
    case 9: return 'Tab';
    case 13: return 'Enter';
    case 27: return 'Escape';
    case 33: return 'PageUp';
    case 34: return 'PageDown';
    case 35: return 'End';
    case 36: return 'Home';
    case 37: return 'ArrowLeft';
    case 38: return 'ArrowUp';
    case 39: return 'ArrowRight';
    case 40: return 'ArrowDown';
    case 46: return 'Delete';
    case 65: return 'a';
    default: return k;
  }
}

export function handleEditorKeyDown(e: KeyboardEvent, st: KeyboardHandlerState): void {
  const { model, selection } = st;
  const lineCount = model.getLineCount();
  const { lineNumber, column } = selection.active;
  const lineText = model.getLineContent(lineNumber);
  const extend = e.shiftKey;
  const ctrl = e.ctrlKey || e.metaKey;
  const navKey = resolveNavigationKey(e);

  const move = (ln: number, col: number, keepGoal = false) => {
    const clampedLine = Math.max(1, Math.min(lineCount, ln));
    const maxCol = model.getLineContent(clampedLine).length + 1;
    let c = keepGoal && st.goalColumn != null ? st.goalColumn : col;
    c = Math.max(1, Math.min(maxCol, c));
    selection.moveActive(clampedLine, c, extend);
    model.pushStackElement();
    st.onChange({ kind: 'move' });
  };

  if (ctrl && (navKey === 'a' || navKey === 'A')) {
    e.preventDefault();
    selection.anchor = { lineNumber: 1, column: 1 };
    const last = model.getLineCount();
    selection.active = { lineNumber: last, column: model.getLineContent(last).length + 1 };
    st.setGoalColumn(null);
    st.onChange({ kind: 'move' });
    return;
  }

  if (ctrl && navKey === 'Home') {
    e.preventDefault();
    st.setGoalColumn(null);
    move(1, 1);
    return;
  }
  if (ctrl && navKey === 'End') {
    e.preventDefault();
    st.setGoalColumn(null);
    move(lineCount, model.getLineContent(lineCount).length + 1);
    return;
  }

  if (ctrl && navKey === 'ArrowLeft') {
    e.preventDefault();
    st.setGoalColumn(null);
    if (column <= 1) {
      if (lineNumber > 1) move(lineNumber - 1, model.getLineContent(lineNumber - 1).length + 1);
    } else {
      move(lineNumber, wordBoundary(lineText, column, -1));
    }
    return;
  }
  if (ctrl && navKey === 'ArrowRight') {
    e.preventDefault();
    st.setGoalColumn(null);
    if (column >= lineText.length + 1) {
      if (lineNumber < lineCount) move(lineNumber + 1, 1);
      return;
    }
    move(lineNumber, wordBoundary(lineText, column, 1));
    return;
  }

  if (ctrl && navKey === 'Backspace') {
    e.preventDefault();
    if (st.readOnly) return;
    if (!selection.isEmpty) {
      replaceSelectionText(model, selection, '');
      st.setGoalColumn(null);
      st.onChange({ kind: 'backspace' });
      return;
    }
    const dest = wordBoundary(lineText, column, -1);
    const start = model.getOffsetAt(lineNumber, dest);
    const end = model.getOffsetAt(lineNumber, column);
    if (end > start) {
      model.delete(start, end);
      selection.setCaret(lineNumber, dest);
      st.onChange({ kind: 'backspace' });
    } else if (column === 1 && lineNumber > 1) {
      const prev = model.getLineContent(lineNumber - 1);
      const off = model.getOffsetAt(lineNumber, 1);
      model.delete(off - model.getEOL().length, off);
      selection.setCaret(lineNumber - 1, prev.length + 1);
      st.onChange({ kind: 'backspace' });
    }
    return;
  }
  if (ctrl && navKey === 'Delete') {
    e.preventDefault();
    if (st.readOnly) return;
    if (!selection.isEmpty) {
      replaceSelectionText(model, selection, '');
      st.setGoalColumn(null);
      st.onChange({ kind: 'delete' });
      return;
    }
    const dest = wordBoundary(lineText, column, 1);
    const start = model.getOffsetAt(lineNumber, column);
    const end = model.getOffsetAt(lineNumber, dest);
    if (end > start) {
      model.delete(start, end);
      st.onChange({ kind: 'delete' });
    }
    return;
  }

  // Do not treat Alt-modified keys as plain caret movement or text deletion
  if (e.altKey) return;

  switch (navKey) {
    case 'Escape': {
      if (selection.hasMultipleCursors) {
        e.preventDefault();
        selection.collapseToPrimary();
        st.setGoalColumn(null);
        st.onChange({ kind: 'move' });
      }
      break;
    }
    case 'ArrowLeft': {
      e.preventDefault();
      st.setGoalColumn(null);
      if (selection.hasMultipleCursors) {
        moveAllCursors(model, selection, (p) => {
          const lt = model.getLineContent(p.lineNumber);
          if (p.column > 1) return { lineNumber: p.lineNumber, column: prevGraphemeOffset(lt, p.column - 1) + 1 };
          if (p.lineNumber > 1) return { lineNumber: p.lineNumber - 1, column: model.getLineContent(p.lineNumber - 1).length + 1 };
          return p;
        }, extend);
        st.onChange({ kind: 'move' });
        break;
      }
      if (column > 1) move(lineNumber, prevGraphemeOffset(lineText, column - 1) + 1);
      else if (lineNumber > 1) move(lineNumber - 1, model.getLineContent(lineNumber - 1).length + 1);
      break;
    }
    case 'ArrowRight': {
      e.preventDefault();
      st.setGoalColumn(null);
      if (selection.hasMultipleCursors) {
        moveAllCursors(model, selection, (p) => {
          const lt = model.getLineContent(p.lineNumber);
          if (p.column <= lt.length) return { lineNumber: p.lineNumber, column: nextGraphemeOffset(lt, p.column - 1) + 1 };
          if (p.lineNumber < lineCount) return { lineNumber: p.lineNumber + 1, column: 1 };
          return p;
        }, extend);
        st.onChange({ kind: 'move' });
        break;
      }
      if (column <= lineText.length) move(lineNumber, nextGraphemeOffset(lineText, column - 1) + 1);
      else if (lineNumber < lineCount) move(lineNumber + 1, 1);
      break;
    }
    case 'ArrowUp': {
      e.preventDefault();
      if (selection.hasMultipleCursors) {
        moveAllCursors(model, selection, (p) => ({ lineNumber: p.lineNumber - 1, column: p.column }), extend);
        st.onChange({ kind: 'move' });
        break;
      }
      if (st.goalColumn == null) st.setGoalColumn(selection.active.column);
      move(lineNumber - 1, st.goalColumn ?? selection.active.column, true);
      break;
    }
    case 'ArrowDown': {
      e.preventDefault();
      if (selection.hasMultipleCursors) {
        moveAllCursors(model, selection, (p) => ({ lineNumber: p.lineNumber + 1, column: p.column }), extend);
        st.onChange({ kind: 'move' });
        break;
      }
      if (st.goalColumn == null) st.setGoalColumn(selection.active.column);
      move(lineNumber + 1, st.goalColumn ?? selection.active.column, true);
      break;
    }
    case 'PageUp': {
      e.preventDefault();
      if (st.goalColumn == null) st.setGoalColumn(column);
      move(lineNumber - st.pageSize, column, true);
      break;
    }
    case 'PageDown': {
      e.preventDefault();
      if (st.goalColumn == null) st.setGoalColumn(column);
      move(lineNumber + st.pageSize, column, true);
      break;
    }
    case 'Home': {
      e.preventDefault();
      st.setGoalColumn(null);
      if (selection.hasMultipleCursors) {
        moveAllCursors(model, selection, (p) => {
          const ws = leadingWs(model.getLineContent(p.lineNumber)).length;
          return { lineNumber: p.lineNumber, column: p.column > ws + 1 ? ws + 1 : 1 };
        }, extend);
        st.onChange({ kind: 'move' });
        break;
      }
      const ws = leadingWs(lineText).length;
      move(lineNumber, column > ws + 1 ? ws + 1 : 1);
      break;
    }
    case 'End': {
      e.preventDefault();
      st.setGoalColumn(null);
      if (selection.hasMultipleCursors) {
        moveAllCursors(model, selection, (p) => ({
          lineNumber: p.lineNumber,
          column: model.getLineContent(p.lineNumber).length + 1,
        }), extend);
        st.onChange({ kind: 'move' });
        break;
      }
      move(lineNumber, lineText.length + 1);
      break;
    }
    case 'Backspace': {
      e.preventDefault();
      if (st.readOnly) return;
      if (selection.hasMultipleCursors) {
        deleteMultiCursor(model, selection, 'left');
        st.setGoalColumn(null);
        st.onChange({ kind: 'backspace' });
        return;
      }
      if (!selection.isEmpty) {
        replaceSelectionText(model, selection, '');
        st.setGoalColumn(null);
        st.onChange({ kind: 'backspace' });
        return;
      }
      if (tryPairBackspaceDelete(model, selection, st.typingPolicy)) {
        st.setGoalColumn(null);
        st.onChange({ kind: 'backspace' });
        return;
      }
      const offset = model.getOffsetAt(lineNumber, column);
      if (offset > 0) {
        let delLen = 1;
        if (column === 1) {
          delLen = model.getEOL().length;
        } else if (
          st.stickyTabStops &&
          st.tabSize > 1 &&
          /^[ ]+$/.test(lineText.slice(0, column - 1))
        ) {
          const spacesBefore = column - 1;
          const rem = spacesBefore % st.tabSize;
          delLen = rem === 0 ? st.tabSize : rem;
        } else if (column > 2) {
          const lo = lineText.charCodeAt(column - 2);
          const hi = lineText.charCodeAt(column - 3);
          if (hi >= 0xd800 && hi <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff) delLen = 2;
        }
        model.delete(offset - delLen, offset, 'deleteLeft');
        const pos = model.getPositionAt(offset - delLen);
        selection.setCaret(pos.lineNumber, pos.column);
        st.setGoalColumn(null);
        st.onChange({ kind: 'backspace' });
      }
      break;
    }
    case 'Delete': {
      e.preventDefault();
      if (st.readOnly) return;
      if (selection.hasMultipleCursors) {
        deleteMultiCursor(model, selection, 'right');
        st.setGoalColumn(null);
        st.onChange({ kind: 'delete' });
        return;
      }
      if (!selection.isEmpty) {
        replaceSelectionText(model, selection, '');
        st.setGoalColumn(null);
        st.onChange({ kind: 'delete' });
        return;
      }
      const offset = model.getOffsetAt(lineNumber, column);
      if (offset < model.getValue().length) {
        let delLen = 1;
        if (column > lineText.length) delLen = model.getEOL().length;
        else delLen = Math.max(1, nextGraphemeOffset(lineText, column - 1) - (column - 1));
        model.delete(offset, offset + delLen, 'deleteRight');
        st.setGoalColumn(null);
        st.onChange({ kind: 'delete' });
      }
      break;
    }
    case 'Enter': {
      e.preventDefault();
      if (st.readOnly) return;
      const inserted = applyEnterKey(
        model,
        selection,
        st.tabSize,
        st.bracketEnterIndent,
        st.autoIndent,
        st.trimAutoWhitespace !== false,
      );
      st.setGoalColumn(null);
      st.onChange({ kind: 'enter', text: inserted });
      break;
    }
    case 'Tab': {
      e.preventDefault();
      if (st.readOnly) return;
      if (e.shiftKey) {
        outdentSelectionLines(model, selection, st.tabSize);
        st.setGoalColumn(null);
        st.onChange({ kind: 'indent' });
      } else {
        const text = indentSelectionLines(model, selection, st.tabSize, st.insertSpaces !== false);
        st.onChange(text ? { kind: 'indent', text } : { kind: 'indent' });
      }
      break;
    }
    default:
      break;
  }
}
