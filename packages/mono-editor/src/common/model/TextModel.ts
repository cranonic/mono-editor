import { EditStack, type UndoKind } from './EditStack';
import { EndOfLineSequence } from '../core/enums';
import type {
  FindMatch,
  IIdentifiedSingleEditOperation,
  IModelContentChange,
  IModelLanguageChangedEvent,
  IModelOptionsChangedEvent,
  IPosition,
  IRange,
  ITextModelResolvedOptions,
  ITextModelUpdateOptions,
  IWordAtPosition,
} from '../core/types';
import {
  detectIndentationOnModel,
  findMatchesOnModel,
  findNextMatchOnModel,
  findPreviousMatchOnModel,
  getWordAtPositionOnModel,
  getWordUntilPositionOnModel,
  validatePositionOnModel,
  validateRangeOnModel,
} from './modelHelpers';

export type { UndoKind };

export type ModelEdit = {
  startOffset: number;
  endOffset: number;
  text: string;
};

/**
 * What an edit touched, so listeners (tokenizer, scopes, LSP sync…) can update
 * incrementally instead of rebuilding from line 1.
 */
export type ModelChange = {
  /** 1-based first line touched */
  startLine: number;
  oldLineCount: number;
  newLineCount: number;
  /** whole document replaced (setValue / setEOL) — drop every cache */
  full?: boolean;
  /** Granular Monaco-compatible content change deltas. */
  changes?: IModelContentChange[];
  isUndoing?: boolean;
  isRedoing?: boolean;
  isFlush?: boolean;
};

export type ModelChangeListener = (versionId: number, change?: ModelChange) => void;

type SelSnapshot = { aLine: number; aCol: number; bLine: number; bCol: number };

export class TextModel {
  private lines: string[] = [''];
  private eol: '\n' | '\r\n' = '\n';
  private versionId = 1;
  private languageId = 'plaintext';
  private options: ITextModelResolvedOptions = {
    tabSize: 2,
    indentSize: 2,
    insertSpaces: true,
    trimAutoWhitespace: true,
  };
  private listeners = new Set<ModelChangeListener>();
  private languageListeners = new Set<(e: IModelLanguageChangedEvent) => void>();
  private optionsListeners = new Set<(e: IModelOptionsChangedEvent) => void>();
  readonly editStack = new EditStack();
  private selCapture: (() => SelSnapshot | null) | null = null;
  private applySource: 'normal' | 'undo' | 'redo' = 'normal';

  /** Line start offsets, computed lazily and only as far as needed. */
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
    if (id === this.languageId) return;
    const oldLanguage = this.languageId;
    this.languageId = id;
    const ev: IModelLanguageChangedEvent = { oldLanguage, newLanguage: id };
    for (const l of this.languageListeners) {
      try {
        l(ev);
      } catch {
        /* ignore */
      }
    }
  }

  onDidChangeLanguage(listener: (e: IModelLanguageChangedEvent) => void): () => void {
    this.languageListeners.add(listener);
    return () => this.languageListeners.delete(listener);
  }

  getOptions(): ITextModelResolvedOptions {
    return { ...this.options };
  }

  updateOptions(newOpts: ITextModelUpdateOptions): void {
    const ev: IModelOptionsChangedEvent = {
      tabSize: newOpts.tabSize !== undefined && newOpts.tabSize !== this.options.tabSize,
      indentSize: newOpts.indentSize !== undefined && newOpts.indentSize !== this.options.indentSize,
      insertSpaces:
        newOpts.insertSpaces !== undefined && newOpts.insertSpaces !== this.options.insertSpaces,
      trimAutoWhitespace:
        newOpts.trimAutoWhitespace !== undefined &&
        newOpts.trimAutoWhitespace !== this.options.trimAutoWhitespace,
    };
    if (newOpts.tabSize !== undefined) this.options.tabSize = Math.max(1, newOpts.tabSize);
    if (newOpts.indentSize !== undefined) {
      this.options.indentSize = Math.max(1, newOpts.indentSize);
    } else if (newOpts.tabSize !== undefined) {
      this.options.indentSize = this.options.tabSize;
    }
    if (newOpts.insertSpaces !== undefined) this.options.insertSpaces = newOpts.insertSpaces;
    if (newOpts.trimAutoWhitespace !== undefined) {
      this.options.trimAutoWhitespace = newOpts.trimAutoWhitespace;
    }
    if (ev.tabSize || ev.indentSize || ev.insertSpaces || ev.trimAutoWhitespace) {
      for (const l of this.optionsListeners) {
        try {
          l(ev);
        } catch {
          /* ignore */
        }
      }
    }
  }

  onDidChangeOptions(listener: (e: IModelOptionsChangedEvent) => void): () => void {
    this.optionsListeners.add(listener);
    return () => this.optionsListeners.delete(listener);
  }

  detectIndentation(defaultInsertSpaces = true, defaultTabSize = 2): void {
    const detected = detectIndentationOnModel(this, defaultInsertSpaces, defaultTabSize);
    this.updateOptions({
      insertSpaces: detected.insertSpaces,
      tabSize: detected.tabSize,
      indentSize: detected.tabSize,
    });
  }

  getEOL(): '\n' | '\r\n' {
    return this.eol;
  }

  setEOL(eol: '\n' | '\r\n' | number): void {
    const next: '\n' | '\r\n' =
      eol === '\r\n' || eol === EndOfLineSequence.CRLF ? '\r\n' : '\n';
    if (next === this.eol) return;
    const prevFull = this.getFullModelRange();
    const prevLen = this.getValue().length;
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
      isFlush: true,
      changes: [
        {
          range: prevFull,
          rangeOffset: 0,
          rangeLength: prevLen,
          text: this.getValue(),
        },
      ],
    });
  }

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

  getLineLength(lineNumber: number): number {
    return this.getLineContent(lineNumber).length;
  }

  getLineMinColumn(_lineNumber: number): number {
    return 1;
  }

  getLineMaxColumn(lineNumber: number): number {
    return this.getLineContent(lineNumber).length + 1;
  }

  getLineFirstNonWhitespaceColumn(lineNumber: number): number {
    const line = this.getLineContent(lineNumber);
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch !== ' ' && ch !== '\t') return i + 1;
    }
    return 0;
  }

  getLineLastNonWhitespaceColumn(lineNumber: number): number {
    const line = this.getLineContent(lineNumber);
    for (let i = line.length - 1; i >= 0; i--) {
      const ch = line[i]!;
      if (ch !== ' ' && ch !== '\t') return i + 2;
    }
    return 0;
  }

  getLinesContent(): string[] {
    return [...this.lines];
  }

  getFullModelRange(): IRange {
    const lastLine = this.lines.length;
    return {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: lastLine,
      endColumn: this.lines[lastLine - 1]!.length + 1,
    };
  }

  validatePosition(position: IPosition): IPosition {
    return validatePositionOnModel(this, position);
  }

  validateRange(range: IRange): IRange {
    return validateRangeOnModel(this, range);
  }

  modifyPosition(position: IPosition, offset: number): IPosition {
    const valid = this.validatePosition(position);
    const curOff = this.getOffsetAt(valid.lineNumber, valid.column);
    return this.getPositionAt(curOff + offset);
  }

  getValueInRange(range: IRange): string {
    const r = this.validateRange(range);
    return this.textBetween(
      { lineNumber: r.startLineNumber, column: r.startColumn },
      { lineNumber: r.endLineNumber, column: r.endColumn },
    );
  }

  getWordAtPosition(position: IPosition): IWordAtPosition | null {
    return getWordAtPositionOnModel(this, position);
  }

  getWordUntilPosition(position: IPosition): IWordAtPosition {
    return getWordUntilPositionOnModel(this, position);
  }

  findMatches(
    searchString: string,
    searchOnlyEditableRange: boolean | IRange | IRange[],
    isRegex: boolean,
    matchCase: boolean,
    wordSeparators: string | null,
    captureMatches: boolean,
    limitResultCount?: number,
  ): FindMatch[] {
    return findMatchesOnModel(this, this.getValue(), searchString, searchOnlyEditableRange, isRegex, matchCase, wordSeparators, captureMatches, limitResultCount);
  }

  findNextMatch(searchString: string, searchStart: IPosition, isRegex: boolean, matchCase: boolean, wordSeparators: string | null, captureMatches: boolean): FindMatch | null {
    return findNextMatchOnModel(this, this.getValue(), searchString, searchStart, isRegex, matchCase, wordSeparators, captureMatches);
  }

  findPreviousMatch(searchString: string, searchStart: IPosition, isRegex: boolean, matchCase: boolean, wordSeparators: string | null, captureMatches: boolean): FindMatch | null {
    return findPreviousMatchOnModel(this, this.getValue(), searchString, searchStart, isRegex, matchCase, wordSeparators, captureMatches);
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
    const oldRange = this.getFullModelRange();
    const oldLen = this.lines.join(this.eol).length;
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
    const stored = this.lines.join(this.eol);
    this.bump({
      startLine: 1,
      oldLineCount: oldCount,
      newLineCount: this.lines.length,
      full: true,
      isFlush: true,
      changes: [
        {
          range: oldRange,
          rangeOffset: 0,
          rangeLength: oldLen,
          text: stored,
        },
      ],
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
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    const lineLen = this.lines[lo]!.length;
    const col = Math.min(offset - s[lo]!, lineLen) + 1;
    return { lineNumber: lo + 1, column: col };
  }

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
    const startOffset = this.getOffsetAt(sPos.lineNumber, sPos.column);
    const endOffset = this.getOffsetAt(ePos.lineNumber, ePos.column);
    const replaced = this.textBetween(sPos, ePos);
    const beforeSel = record ? this.selCapture?.() ?? undefined : undefined;

    const normLf = edit.text.includes('\r')
      ? edit.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      : edit.text;
    const inserted = normLf.split('\n');
    const storedText = this.eol === '\r\n' ? inserted.join('\r\n') : normLf;

    const head = this.lines[sPos.lineNumber - 1]!.slice(0, sPos.column - 1);
    const tail = this.lines[ePos.lineNumber - 1]!.slice(ePos.column - 1);
    const block: string[] = new Array(inserted.length);
    for (let i = 0; i < inserted.length; i++) block[i] = inserted[i]!;
    block[0] = head + block[0]!;
    block[block.length - 1] = block[block.length - 1]! + tail;

    const oldLineCount = ePos.lineNumber - sPos.lineNumber + 1;
    if (block.length === oldLineCount) {
      for (let i = 0; i < block.length; i++) this.lines[sPos.lineNumber - 1 + i] = block[i]!;
    } else if (block.length <= 4096) {
      this.lines.splice(sPos.lineNumber - 1, oldLineCount, ...block);
    } else {
      const before = this.lines.slice(0, sPos.lineNumber - 1);
      const after = this.lines.slice(ePos.lineNumber);
      this.lines = before.concat(block, after);
    }

    if (this.startsValid > sPos.lineNumber - 1) this.startsValid = sPos.lineNumber - 1;
    this.valueCache = null;

    const delta: IModelContentChange = {
      range: {
        startLineNumber: sPos.lineNumber,
        startColumn: sPos.column,
        endLineNumber: ePos.lineNumber,
        endColumn: ePos.column,
      },
      rangeOffset: startOffset,
      rangeLength: endOffset - startOffset,
      text: storedText,
    };

    this.bump({
      startLine: sPos.lineNumber,
      oldLineCount,
      newLineCount: block.length,
      changes: [delta],
      isUndoing: this.applySource === 'undo',
      isRedoing: this.applySource === 'redo',
      isFlush: false,
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

  /** Apply Monaco-style `IIdentifiedSingleEditOperation[]` in reverse document order as one undo step. */
  applyEdits(operations: readonly IIdentifiedSingleEditOperation[], record = true): IIdentifiedSingleEditOperation[] {
    const resolved = operations
      .map((op) => {
        const range = this.validateRange(op.range);
        const startOffset = this.getOffsetAt(range.startLineNumber, range.startColumn);
        const endOffset = this.getOffsetAt(range.endLineNumber, range.endColumn);
        return { range, startOffset, endOffset, text: op.text ?? '' };
      })
      .sort((a, b) => b.startOffset - a.startOffset || b.endOffset - a.endOffset);

    const inverses: IIdentifiedSingleEditOperation[] = [];
    const run = () => {
      for (const op of resolved) {
        const oldText = this.getValueInRange(op.range);
        this.applyEdit({ startOffset: op.startOffset, endOffset: op.endOffset, text: op.text }, record);
        const newEnd = this.getPositionAt(op.startOffset + this.normalizeEol(op.text).length);
        inverses.push({
          range: {
            startLineNumber: op.range.startLineNumber,
            startColumn: op.range.startColumn,
            endLineNumber: newEnd.lineNumber,
            endColumn: newEnd.column,
          },
          text: oldText,
        });
      }
    };
    if (record) this.transact(run);
    else run();
    return inverses;
  }

  pushStackElement(): void {
    this.editStack.seal();
  }

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

  undoEntry() {
    this.applySource = 'undo';
    try {
      return this.editStack.undo(this);
    } finally {
      this.applySource = 'normal';
    }
  }

  redoEntry() {
    this.applySource = 'redo';
    try {
      return this.editStack.redo(this);
    } finally {
      this.applySource = 'normal';
    }
  }

  undo(): boolean {
    return this.undoEntry() != null;
  }

  redo(): boolean {
    return this.redoEntry() != null;
  }

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

  insert(offset: number, text: string, kind: UndoKind = 'other'): void {
    this.applyEdit({ startOffset: offset, endOffset: offset, text }, true, undefined, kind);
  }

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
