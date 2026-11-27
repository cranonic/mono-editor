import type { SelectionState } from '../../common/core/SelectionState';
import type { TextModel, UndoKind } from '../../common/model/TextModel';

export interface CompositionRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

interface ComposingSession {
  startOffset: number;
  endOffset: number;
  text: string;
  replacedText: string;
  beforeSel: { aLine: number; aCol: number; bLine: number; bCol: number };
}

/**
 * IME composition state machine (Bengali, Hindi, CJK, mobile Gboard).
 * Previews live uncommitted glyphs unrecorded, then commits ONE clean undo step on compositionend.
 */
export class CompositionHandler {
  private composing: ComposingSession | null = null;
  private onCompositionChange?: (range: CompositionRange | null) => void;

  constructor(onCompositionChange?: (range: CompositionRange | null) => void) {
    this.onCompositionChange = onCompositionChange;
  }

  isComposing(): boolean {
    return this.composing != null;
  }

  reset(): void {
    this.composing = null;
    this.onCompositionChange?.(null);
  }

  handleStart(model: TextModel, selection: SelectionState): void {
    const a = selection.anchor;
    const b = selection.active;
    const beforeSel = {
      aLine: a.lineNumber,
      aCol: a.column,
      bLine: b.lineNumber,
      bCol: b.column,
    };

    let startOffset: number;
    let replacedText = '';

    if (!selection.isEmpty) {
      const aOff = model.getOffsetAt(a.lineNumber, a.column);
      const bOff = model.getOffsetAt(b.lineNumber, b.column);
      startOffset = Math.min(aOff, bOff);
      const endOffset = Math.max(aOff, bOff);
      replacedText = model.getValue().slice(startOffset, endOffset);
      model.applyEdit({ startOffset, endOffset, text: '' }, false);
      const pos = model.getPositionAt(startOffset);
      selection.setCaret(pos.lineNumber, pos.column);
    } else {
      startOffset = model.getOffsetAt(b.lineNumber, b.column);
    }

    this.composing = {
      startOffset,
      endOffset: startOffset,
      text: '',
      replacedText,
      beforeSel,
    };
  }

  handleUpdate(model: TextModel, selection: SelectionState, data: string): void {
    // The caret left the open composition (tap / arrows between two keystrokes) but the IME never
    // sent compositionend: close that session as its own undo step first, so the new text is typed
    // at the new caret and Ctrl+Z undoes them one at a time.
    if (this.composing && this.caretLeftComposition(model, selection)) {
      this.commitDetached(model, selection);
    }
    if (!this.composing) {
      this.handleStart(model, selection);
    }
    const c = this.composing;
    if (!c) return;
    model.applyEdit({ startOffset: c.startOffset, endOffset: c.endOffset, text: data }, false);
    c.text = data;
    c.endOffset = c.startOffset + data.length;
    const startPos = model.getPositionAt(c.startOffset);
    const endPos = model.getPositionAt(c.endOffset);
    selection.setCaret(endPos.lineNumber, endPos.column);

    this.onCompositionChange?.(
      data.length > 0
        ? {
            startLineNumber: startPos.lineNumber,
            startColumn: startPos.column,
            endLineNumber: endPos.lineNumber,
            endColumn: endPos.column,
          }
        : null,
    );
  }

  private caretLeftComposition(model: TextModel, selection: SelectionState): boolean {
    const c = this.composing;
    if (!c || !selection.isEmpty) return false;
    const off = model.getOffsetAt(selection.active.lineNumber, selection.active.column);
    return off < c.startOffset || off > c.endOffset;
  }

  /** Record the live composition as one undo step without touching the user's current caret. */
  private commitDetached(model: TextModel, selection: SelectionState): void {
    const c = this.composing;
    this.composing = null;
    this.onCompositionChange?.(null);
    if (!c || (c.text.length === 0 && c.replacedText.length === 0)) return;
    const keep = model.getOffsetAt(selection.active.lineNumber, selection.active.column);
    // revert the unrecorded preview, then re-apply it as a recorded edit (document ends up identical)
    model.applyEdit({ startOffset: c.startOffset, endOffset: c.endOffset, text: c.replacedText }, false);
    selection.anchor = { lineNumber: c.beforeSel.aLine, column: c.beforeSel.aCol };
    selection.active = { lineNumber: c.beforeSel.bLine, column: c.beforeSel.bCol };
    model.replaceRange(
      c.startOffset,
      c.startOffset + c.replacedText.length,
      c.text,
      undefined,
      c.text.includes('\n') ? 'other' : 'typing',
    );
    const pos = model.getPositionAt(keep);
    selection.setCaret(pos.lineNumber, pos.column);
  }

  handleEnd(
    model: TextModel,
    selection: SelectionState,
    eventData: string | null | undefined,
    fallbackInsert: (text: string) => void,
  ): { committed: boolean; text: string } {
    const c = this.composing;
    this.composing = null;
    this.onCompositionChange?.(null);

    if (!c) {
      const fallback = eventData ?? '';
      if (fallback) {
        fallbackInsert(fallback);
        return { committed: true, text: fallback };
      }
      return { committed: false, text: '' };
    }

    const finalText = eventData ?? c.text;
    if (c.endOffset !== c.startOffset || c.replacedText.length > 0) {
      model.applyEdit(
        { startOffset: c.startOffset, endOffset: c.endOffset, text: c.replacedText },
        false,
      );
    }

    selection.anchor = { lineNumber: c.beforeSel.aLine, column: c.beforeSel.aCol };
    selection.active = { lineNumber: c.beforeSel.bLine, column: c.beforeSel.bCol };

    if (finalText.length > 0 || c.replacedText.length > 0) {
      const endOff = c.startOffset + c.replacedText.length;
      const undoKind: UndoKind = finalText.includes('\n') ? 'other' : 'typing';
      model.replaceRange(c.startOffset, endOff, finalText, undefined, undoKind);
      const pos = model.getPositionAt(c.startOffset + finalText.length);
      selection.setCaret(pos.lineNumber, pos.column);
      return { committed: true, text: finalText };
    }
    return { committed: false, text: '' };
  }
}
