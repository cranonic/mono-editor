export interface EditStackModelEdit {
  startOffset: number;
  endOffset: number;
  text: string;
}

export interface EditStackModelLike {
  applyEdit(edit: EditStackModelEdit, recordUndo?: boolean): void;
}

type Sel = { aLine: number; aCol: number; bLine: number; bCol: number };

/**
 * What produced an edit — decides whether it may be glued onto the previous
 * undo step (Monaco: EditOperationType).
 *
 *  - `typing`      inserting text at the caret (also typing over a selection, as the FIRST edit of a burst)
 *  - `deleteLeft`  Backspace, one char at a time
 *  - `deleteRight` Delete, one char at a time
 *  - `other`       everything else (paste, cut, Enter, Tab, completion, replace, API edits…) → always its own step
 */
export type UndoKind = 'typing' | 'deleteLeft' | 'deleteRight' | 'other';

type Step = {
  /** Edit that undoes the change (restore previous text) */
  inverse: EditStackModelEdit;
  /** Edit that redoes the change */
  forward: EditStackModelEdit;
};

export type StackEntry = Step & {
  /** Selection before the change (for undo) */
  beforeSel?: Sel;
  /** Selection after the change (for redo) */
  afterSel?: Sel;
  kind: UndoKind;
  /** clock() of the last edit merged into this entry */
  time: number;
  /** Closed: later edits must start a new entry */
  sealed: boolean;
  /**
   * Transaction with several edits (Replace All, executeEdits…): undo applies the
   * inverses in reverse order, redo the forwards in order. `inverse`/`forward`
   * above are the first step (only used as a selection fallback).
   */
  steps?: Step[];
};

const isWs = (ch: string): boolean => ch === ' ' || ch === '\t';

/**
 * Monaco-like undo/redo stack over TextModel.applyEdit, with typing-burst grouping.
 *
 * Consecutive edits are merged into ONE undo step while ALL of these hold:
 *  - same kind (typing / Backspace / Delete) and not `other`
 *  - directly adjacent to the previous edit and the caret has not moved since
 *    (previous `afterSel` == this edit's `beforeSel`)
 *  - no longer than `groupIdleMs` since the previous edit (0 = no time limit)
 *  - not a word boundary: typing a space/tab after a non-space starts a new step,
 *    so Ctrl+Z removes "foo", then " bar", then " baz" (VS Code behaviour)
 *  - the previous entry has not been sealed (undo/redo, `pushStackElement()`)
 */
export class EditStack {
  private undoStack: StackEntry[] = [];
  private redoStack: StackEntry[] = [];
  private maxSize: number;
  /** When true, applyEdit from undo/redo must not push again */
  private applying = false;

  /** Pause (ms) that ends a typing burst. 0 = never split on time. */
  groupIdleMs = 1500;
  /** Injectable clock (tests) */
  clock: () => number = () => Date.now();

  private groupDepth = 0;
  private pending: { step: Step; beforeSel?: Sel; afterSel?: Sel }[] = [];

  constructor(maxSize = 500) {
    this.maxSize = maxSize;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Number of undo steps (tests / UI) */
  get undoDepth(): number {
    return this.undoStack.length;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.pending = [];
    this.groupDepth = 0;
  }

  /** Close the current step: the next edit starts a new one (Monaco `pushStackElement`). */
  seal(): void {
    const top = this.undoStack[this.undoStack.length - 1];
    if (top) top.sealed = true;
  }

  /** Everything recorded until the matching `endGroup()` becomes ONE undo step. Nestable. */
  beginGroup(): void {
    this.groupDepth++;
  }

  endGroup(): void {
    if (this.groupDepth === 0) return;
    if (--this.groupDepth > 0) return;
    const list = this.pending;
    this.pending = [];
    if (!list.length) return;
    const first = list[0]!;
    const last = list[list.length - 1]!;
    this.commit({
      inverse: first.step.inverse,
      forward: first.step.forward,
      beforeSel: first.beforeSel,
      afterSel: last.afterSel,
      kind: 'other',
      time: this.clock(),
      sealed: false,
      steps: list.length > 1 ? list.map((p) => p.step) : undefined,
    });
  }

  /**
   * Record a user edit. `replaced` is the text that was at [start,end) before.
   */
  push(
    startOffset: number,
    endOffset: number,
    replaced: string,
    inserted: string,
    beforeSel?: Sel,
    afterSel?: Sel,
    kind: UndoKind = 'other',
  ): void {
    if (this.applying) return;
    if (startOffset === endOffset && inserted === '') return;
    const step: Step = {
      inverse: {
        startOffset,
        endOffset: startOffset + inserted.length,
        text: replaced,
      },
      forward: {
        startOffset,
        endOffset: startOffset + replaced.length,
        text: inserted,
      },
    };
    if (this.groupDepth > 0) {
      this.pending.push({ step, beforeSel, afterSel });
      return;
    }
    const now = this.clock();
    const top = this.undoStack[this.undoStack.length - 1];
    if (top && kind !== 'other' && this.tryMerge(top, kind, step, replaced, inserted, beforeSel, afterSel, now)) {
      this.redoStack = [];
      return;
    }
    this.commit({ ...step, beforeSel, afterSel, kind, time: now, sealed: false });
  }

  undo(model: EditStackModelLike): StackEntry | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.applying = true;
    try {
      if (entry.steps) {
        for (let i = entry.steps.length - 1; i >= 0; i--) {
          model.applyEdit(entry.steps[i]!.inverse, false);
        }
      } else {
        model.applyEdit(entry.inverse, false);
      }
      this.redoStack.push(entry);
    } finally {
      this.applying = false;
    }
    // typing after an undo must not glue itself onto the entry we landed on
    this.seal();
    return entry;
  }

  redo(model: EditStackModelLike): StackEntry | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.applying = true;
    try {
      if (entry.steps) {
        for (const s of entry.steps) model.applyEdit(s.forward, false);
      } else {
        model.applyEdit(entry.forward, false);
      }
      entry.sealed = true;
      this.undoStack.push(entry);
    } finally {
      this.applying = false;
    }
    return entry;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private commit(entry: StackEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.maxSize) this.undoStack.shift();
    this.redoStack = [];
  }

  private tryMerge(
    top: StackEntry,
    kind: UndoKind,
    step: Step,
    replaced: string,
    inserted: string,
    beforeSel: Sel | undefined,
    afterSel: Sel | undefined,
    now: number,
  ): boolean {
    if (top.kind !== kind || top.sealed || top.steps) return false;
    if (this.groupIdleMs > 0 && now - top.time > this.groupIdleMs) return false;
    // caret moved (tap, arrows, teardrop, API) between the two edits → new step
    if (top.afterSel && beforeSel && !sameSel(top.afterSel, beforeSel)) return false;

    const s = top.forward.startOffset; // where the top entry starts (stable for typing / deleteRight)
    const prevInserted = top.forward.text;
    const prevReplaced = top.inverse.text;
    const start = step.forward.startOffset;
    const end = step.forward.endOffset;

    if (kind === 'typing') {
      if (replaced !== '' || start !== end) return false; // typing over a selection starts a burst, never joins one
      if (start !== s + prevInserted.length) return false; // not adjacent
      if (inserted.includes('\n')) return false;
      // word boundary: whitespace after a non-whitespace char
      const last = prevInserted.length ? prevInserted[prevInserted.length - 1]! : '';
      if (isWs(inserted[0]!) && !isWs(last) && last !== '') return false;
      const text = prevInserted + inserted;
      top.forward = { startOffset: s, endOffset: s + prevReplaced.length, text };
      top.inverse = { startOffset: s, endOffset: s + text.length, text: prevReplaced };
    } else if (kind === 'deleteLeft') {
      if (inserted !== '' || end !== s) return false; // not the char right before the previous deletion
      const text = replaced + prevReplaced;
      top.forward = { startOffset: start, endOffset: start + text.length, text: '' };
      top.inverse = { startOffset: start, endOffset: start, text };
    } else {
      // deleteRight
      if (inserted !== '' || start !== s) return false;
      const text = prevReplaced + replaced;
      top.forward = { startOffset: s, endOffset: s + text.length, text: '' };
      top.inverse = { startOffset: s, endOffset: s, text };
    }
    top.afterSel = afterSel;
    top.time = now;
    return true;
  }
}

function sameSel(a: Sel, b: Sel): boolean {
  return a.aLine === b.aLine && a.aCol === b.aCol && a.bLine === b.bLine && a.bCol === b.bCol;
}
