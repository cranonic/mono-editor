import { EditStack, type UndoKind } from './EditStack';
import { EndOfLineSequence } from '../core/enums';

export type { UndoKind };

export type ModelEdit = {
  startOffset: number;
  endOffset: number;
  text: string;
};

/**
 * What an edit touched, so listeners (tokenizer, scopes…) can update
 * incrementally instead of rebuilding from line 1.
 *
 * Lines [startLine .. startLine+oldLineCount-1] (before the edit) were
 * replaced by [startLine .. startLine+newLineCount-1] (after the edit).
 */
export type ModelChange = {
  /** 1-based first line touched */
  startLine: number;
  oldLineCount: number;
  newLineCount: number;
  /** whole document replaced (setValue / setEOL) — drop every cache */
  full?: boolean;
};

export type ModelChangeListener = (versionId: number, change?: ModelChange) => void;

type SelSnapshot = { aLine: number; aCol: number; bLine: number; bCol: number };

export class TextModel {
  private lines: string[] = [''];
  private eol: '\n' | '\r\n' = '\n';
  private versionId = 1;
  private languageId = 'plaintext';
  private listeners = new Set<ModelChangeListener>();
  readonly editStack = new EditStack();
  /** Optional: snapshot selection before each recorded edit */
  private selCapture: (() => SelSnapshot | null) | null = null;

  /**
   * Line start offsets, computed lazily and only as far as needed.
   * starts[i] is valid for i <= startsValid. An edit on line L keeps starts[0..L]
   * (those lines didn't move) and invalidates the rest.
   */
  private starts: number[] = [0];
  private startsValid = 0;
  /** getValue() cache — one join per version, not per call */
  private valueCache: { version: number; value: string } | null = null;

  constructor(value = '', languageId = 'plaintext') {
    this.setValue(value);
    this.languageId = languageId;
  }

  getVersionId(): number {
    return this.versionId;
  }

  getLanguageId(): string {
    return this.languageId;
  }

  setLanguageId(id: string): void {
    this.languageId = id;
  }

  getEOL(): '\n' | '\r\n' {
    return this.eol;
  }

  setEOL(eol: '\n' | '\r\n' | number): void {
    const next: '\n' | '\r\n' =
      eol === '\r\n' || eol === EndOfLineSequence.CRLF ? '\r\n' : '\n';
    if (next === this.eol) return;
    this.eol = next;
    this.starts = [0];
    this.startsValid = 0;
    this.valueCache = null;
    this.editStack.seal();
    this.bump({
      startLine: 1,
      oldLineCount: this.lines.length,
      newLineCount: this.lines.length,
      full: true,
    });
  }

  /** Normalizes arbitrary `\r\n`, `\r`, or `\n` newlines in `text` to the model's active EOL. */
  normalizeEol(text: string): string {
    if (!text.includes('\r') && !text.includes('\n')) return text;
    const lf = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    return this.eol === '\r\n' ? lf.replace(/\n/g, '\r\n') : lf;
  }

  getLineCount(): number {
    return this.lines.length;
  }

  getLineContent(lineNumber: number): string {
    return this.lines[lineNumber - 1] ?? '';
  }

  getValue(): string {
    const c = this.valueCache;
    if (c && c.version === this.versionId) return c.value;
    const value = this.lines.join(this.eol);
    this.valueCache = { version: this.versionId, value };
    return value;
  }

  setValue(value: string, clearHistory = true): void {
    const oldCount = this.lines.length;
    if (value.includes('\r\n')) {
      this.eol = '\r\n';
    } else if (value.includes('\n')) {
      this.eol = '\n';
    }
    const normalized = value.includes('\r')
      ? value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      : value;
    this.lines = normalized.length === 0 ? [''] : normalized.split('\n');
    this.starts = [0];
    this.startsValid = 0;
    this.valueCache = null;
    if (clearHistory) this.editStack.clear();
    else this.editStack.seal();
    this.bump({
      startLine: 1,
      oldLineCount: oldCount,
      newLineCount: this.lines.length,
      full: true,
    });
  }

  private ensureStarts(upToLineIndex: number): void {
    const s = this.starts;
    const lines = this.lines;
    const eolLen = this.eol.length;
    let i = this.startsValid;
    if (i >= upToLineIndex) return;
    while (i < upToLineIndex) {
      s[i + 1] = s[i]! + lines[i]!.length + eolLen;
      i++;
    }
    this.startsValid = i;
  }

  getOffsetAt(lineNumber: number, column: number): number {
    if (lineNumber < 1) return 0;
    const n = this.lines.length;
    const li = Math.min(lineNumber, n) - 1;
    this.ensureStarts(li);
    const line = this.lines[li]!;
    // Past the last line → end of document
    const col = lineNumber > n ? line.length : Math.max(0, Math.min(column - 1, line.length));
    return this.starts[li]! + col;
  }

  getPositionAt(offset: number): { lineNumber: number; column: number } {
    const n = this.lines.length;
    this.ensureStarts(n - 1);
    const s = this.starts;
    const lastLen = this.lines[n - 1]!.length;
    const total = s[n - 1]! + lastLen;
    if (offset <= 0) return { lineNumber: 1, column: 1 };
    if (offset >= total) return { lineNumber: n, column: lastLen + 1 };
    // largest line index whose start <= offset
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    // Clamp if offset landed between \r and \n of a CRLF break
    const lineLen = this.lines[lo]!.length;
    const col = Math.min(offset - s[lo]!, lineLen) + 1;
    return { lineNumber: lo + 1, column: col };
  }

  /** Text between two (already clamped) positions, without building the whole value. */
  private textBetween(
    s: { lineNumber: number; column: number },
    e: { lineNumber: number; column: number },
  ): string {
    if (s.lineNumber === e.lineNumber) {
      return this.lines[s.lineNumber - 1]!.slice(s.column - 1, e.column - 1);
    }
    const parts: string[] = [this.lines[s.lineNumber - 1]!.slice(s.column - 1)];
    for (let ln = s.lineNumber + 1; ln < e.lineNumber; ln++) parts.push(this.lines[ln - 1]!);
    parts.push(this.lines[e.lineNumber - 1]!.slice(0, e.column - 1));
    return parts.join(this.eol);
  }

  applyEdit(
    edit: ModelEdit,
    record = true,
    afterSelOverride?: SelSnapshot,
    kind: UndoKind = 'other',
  ): void {
    const sPos = this.getPositionAt(Math.max(0, edit.startOffset));
    const ePos = this.getPositionAt(Math.max(edit.endOffset, edit.startOffset, 0));
    // Offsets clamped to the document — the undo stack must record what was REALLY replaced
    const startOffset = this.getOffsetAt(sPos.lineNumber, sPos.column);
    const endOffset = this.getOffsetAt(ePos.lineNumber, ePos.column);
    const replaced = this.textBetween(sPos, ePos);
    const beforeSel = record ? this.selCapture?.() ?? undefined : undefined;

    // Normalize inserted text to model's active EOL
    const normLf = edit.text.includes('\r')
      ? edit.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      : edit.text;
    const inserted = normLf.split('\n');
    const storedText = this.eol === '\r\n' ? inserted.join('\r\n') : normLf;

    // Splice only the touched lines instead of join + split of the whole document
    const head = this.lines[sPos.lineNumber - 1]!.slice(0, sPos.column - 1);
    const tail = this.lines[ePos.lineNumber - 1]!.slice(ePos.column - 1);
    const block: string[] = new Array(inserted.length);
    for (let i = 0; i < inserted.length; i++) block[i] = inserted[i]!;
    block[0] = head + block[0]!;
    block[block.length - 1] = block[block.length - 1]! + tail;

    const oldLineCount = ePos.lineNumber - sPos.lineNumber + 1;
    if (block.length === oldLineCount) {
      // same shape (typing, in-line replace) — overwrite in place, no splice
      for (let i = 0; i < block.length; i++) this.lines[sPos.lineNumber - 1 + i] = block[i]!;
    } else if (block.length <= 4096) {
      this.lines.splice(sPos.lineNumber - 1, oldLineCount, ...block);
    } else {
      // huge paste: avoid spread-argument limits
      const before = this.lines.slice(0, sPos.lineNumber - 1);
      const after = this.lines.slice(ePos.lineNumber);
      this.lines = before.concat(block, after);
    }

    // Lines before the edit didn't move → keep their cached offsets
    if (this.startsValid > sPos.lineNumber - 1) this.startsValid = sPos.lineNumber - 1;
    this.valueCache = null;

    this.bump({
      startLine: sPos.lineNumber,
      oldLineCount,
      newLineCount: block.length,
    });

    if (record) {
      const endPos = this.getPositionAt(startOffset + storedText.length);
      const afterSel = afterSelOverride ?? {
        aLine: endPos.lineNumber,
        aCol: endPos.column,
        bLine: endPos.lineNumber,
        bCol: endPos.column,
      };
      this.editStack.push(
        startOffset,
        endOffset,
        replaced,
        storedText,
        beforeSel ?? undefined,
        afterSel,
        kind,
      );
    }
  }

  /**
   * Close the current undo step: the next edit starts a new one (Monaco `pushStackElement`).
   * Call it when something other than an edit should separate two typing bursts.
   */
  pushStackElement(): void {
    this.editStack.seal();
  }

  /**
   * Run several edits as ONE undo step (Replace All, multi-cursor style API edits, formatters…).
   * Nestable. Undo restores everything and the selection from before the first edit.
   */
  transact<T>(fn: () => T): T {
    this.editStack.beginGroup();
    try {
      return fn();
    } finally {
      this.editStack.endGroup();
    }
  }

  setSelectionCapture(fn: (() => SelSnapshot | null) | null): void {
    this.selCapture = fn;
  }

  /** Undo and return stack entry (for selection restore). */
  undoEntry() {
    return this.editStack.undo(this);
  }

  redoEntry() {
    return this.editStack.redo(this);
  }

  undo(): boolean {
    return this.undoEntry() != null;
  }

  redo(): boolean {
    return this.redoEntry() != null;
  }

  /**
   * Replace [start, end) with `text` as ONE undo step.
   */
  replaceRange(
    startOffset: number,
    endOffset: number,
    text: string,
    afterSel?: SelSnapshot,
    kind: UndoKind = 'other',
  ): void {
    if (endOffset <= startOffset && text === '') return;
    this.applyEdit({ startOffset, endOffset, text }, true, afterSel, kind);
  }

  /** `kind: 'typing'` lets consecutive keystrokes merge into one undo step. */
  insert(offset: number, text: string, kind: UndoKind = 'other'): void {
    this.applyEdit({ startOffset: offset, endOffset: offset, text }, true, undefined, kind);
  }

  /** `kind: 'deleteLeft' | 'deleteRight'` lets consecutive Backspace / Delete merge. */
  delete(startOffset: number, endOffset: number, kind: UndoKind = 'other'): void {
    if (endOffset <= startOffset) return;
    this.applyEdit({ startOffset, endOffset, text: '' }, true, undefined, kind);
  }

  onDidChange(listener: ModelChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private bump(change?: ModelChange): void {
    this.versionId++;
    for (const l of this.listeners) l(this.versionId, change);
  }
}
