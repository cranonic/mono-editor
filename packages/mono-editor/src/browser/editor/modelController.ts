import type { SelectionState } from '../../common/core/SelectionState';
import type {
  ICursorStateComputer,
  IIdentifiedSingleEditOperation,
  IMonoTextModel,
  IPosition,
  IRange,
  ISelection,
} from '../../common/core/types';
import { Uri } from '../../common/core/uri';
import type {
  ModelLike,
  TextEdit,
  WorkspaceEdit,
} from '../../common/languages/providers/types';
import type { TokenizationSupport } from '../../common/languages/tokenization/TokenizationSupport';
import { TextModel } from '../../common/model/TextModel';
import {
  getBackingTextModel,
  getRegisteredStandaloneModel,
} from '../../common/model/modelRegistry';
import type { FoldingModel } from '../../common/viewModel/FoldingModel';

export interface SavedModelViewState {
  scrollTop: number;
  scrollLeft: number;
  anchor: IPosition;
  active: IPosition;
  collapsedLines: number[];
}

export interface StackEntrySelectionInfo {
  inverse: { startOffset: number; endOffset: number; text: string };
  forward: { startOffset: number; endOffset: number; text: string };
  beforeSel?: { aLine: number; aCol: number; bLine: number; bCol: number };
  afterSel?: { aLine: number; aCol: number; bLine: number; bCol: number };
}

/**
 * Manages active TextModel binding, per-URI viewState cache, selection capture,
 * atomic edit execution, and workspace edits.
 */
export class ModelController {
  model: TextModel;
  currentModelWrapper: IMonoTextModel | null = null;
  modelUriKey = 'inmemory://editor/default';
  readonly ownsModel: boolean;
  private viewStates = new Map<string, SavedModelViewState>();
  private disposed = false;

  constructor(opts: {
    sharedTextModel?: TextModel;
    externalModel?: IMonoTextModel;
    value?: string;
    language?: string;
    undoGroupIdleMs?: number;
    tabSize?: number;
    insertSpaces?: boolean;
    trimAutoWhitespace?: boolean;
    detectIndentation?: boolean;
  }) {
    if (opts.sharedTextModel) {
      this.model = opts.sharedTextModel;
      this.ownsModel = false;
      this.modelUriKey = 'inmemory://editor/peek';
    } else if (opts.externalModel) {
      const backing =
        getBackingTextModel(opts.externalModel) ??
        new TextModel(opts.externalModel.getValue(), opts.externalModel.getLanguageId());
      this.model = backing;
      this.ownsModel = true;
      this.currentModelWrapper = opts.externalModel;
      this.modelUriKey =
        opts.externalModel.uri?.toString() ?? opts.externalModel.uriString ?? 'inmemory://editor/default';
    } else {
      this.model = new TextModel(opts.value ?? '', opts.language ?? 'plaintext');
      this.ownsModel = true;
    }
    if (opts.undoGroupIdleMs != null) {
      this.model.editStack.groupIdleMs = Math.max(0, opts.undoGroupIdleMs);
    }
    if (opts.tabSize != null || opts.insertSpaces != null || opts.trimAutoWhitespace != null) {
      this.model.updateOptions({
        tabSize: opts.tabSize,
        insertSpaces: opts.insertSpaces,
        trimAutoWhitespace: opts.trimAutoWhitespace,
      });
    }
    if (opts.detectIndentation && this.model.getValue().length > 0) {
      this.model.detectIndentation(opts.insertSpaces ?? true, opts.tabSize ?? 2);
    }
  }

  attachSelectionCapture(selection: SelectionState): void {
    if (!this.ownsModel) return;
    this.model.setSelectionCapture(() => ({
      aLine: selection.anchor.lineNumber,
      aCol: selection.anchor.column,
      bLine: selection.active.lineNumber,
      bCol: selection.active.column,
    }));
  }

  saveViewState(scrollTop: number, scrollLeft: number, selection: SelectionState, folding: FoldingModel): void {
    this.viewStates.set(this.modelUriKey, {
      scrollTop,
      scrollLeft,
      anchor: { ...selection.anchor },
      active: { ...selection.active },
      collapsedLines: folding.getCollapsedLines(),
    });
  }

  swapModel(nextModel: IMonoTextModel | null): { oldUri: Uri; newUri: Uri | null; saved: SavedModelViewState | undefined } {
    const oldUri = Uri.parse(this.modelUriKey);
    if (nextModel === null) {
      this.model = new TextModel('', 'plaintext');
      this.currentModelWrapper = null;
      this.modelUriKey = 'inmemory://editor/empty';
    } else {
      const backing =
        getBackingTextModel(nextModel) ??
        new TextModel(nextModel.getValue(), nextModel.getLanguageId());
      this.model = backing;
      this.currentModelWrapper = nextModel;
      this.modelUriKey =
        nextModel.uri?.toString() ?? nextModel.uriString ?? 'inmemory://editor/default';
    }
    const newUri = nextModel ? Uri.parse(this.modelUriKey) : null;
    return { oldUri, newUri, saved: this.viewStates.get(this.modelUriKey) };
  }

  getModelFacade(
    getAltVersionId: () => number,
    onSetValue: () => void,
    onSetEol: () => void,
  ): IMonoTextModel {
    if (this.currentModelWrapper) return this.currentModelWrapper;
    const model = this.model;
    const uriKey = this.modelUriKey;
    return {
      uri: Uri.parse(uriKey),
      uriString: uriKey,
      getValue: () => model.getValue(),
      setValue: (v: string) => { model.setValue(v); onSetValue(); },
      getValueInRange: (r: IRange) => model.getValueInRange(r),
      getLineCount: () => model.getLineCount(),
      getLineContent: (ln: number) => model.getLineContent(ln),
      getLineLength: (ln: number) => model.getLineLength(ln),
      getLineMinColumn: (ln: number) => model.getLineMinColumn(ln),
      getLineMaxColumn: (ln: number) => model.getLineMaxColumn(ln),
      getLineFirstNonWhitespaceColumn: (ln: number) => model.getLineFirstNonWhitespaceColumn(ln),
      getLineLastNonWhitespaceColumn: (ln: number) => model.getLineLastNonWhitespaceColumn(ln),
      getLinesContent: () => model.getLinesContent(),
      getFullModelRange: () => model.getFullModelRange(),
      getOffsetAt: (pos: IPosition) => model.getOffsetAt(pos.lineNumber, pos.column),
      getPositionAt: (offset: number) => model.getPositionAt(offset),
      validatePosition: (pos: IPosition) => model.validatePosition(pos),
      validateRange: (range: IRange) => model.validateRange(range),
      modifyPosition: (pos: IPosition, off: number) => model.modifyPosition(pos, off),
      getWordAtPosition: (pos: IPosition) => model.getWordAtPosition(pos),
      getWordUntilPosition: (pos: IPosition) => model.getWordUntilPosition(pos),
      findMatches: (s, r, re, mc, ws, cm, lim) => model.findMatches(s, r, re, mc, ws, cm, lim),
      findNextMatch: (s, st, re, mc, ws, cm) => model.findNextMatch(s, st, re, mc, ws, cm),
      findPreviousMatch: (s, st, re, mc, ws, cm) => model.findPreviousMatch(s, st, re, mc, ws, cm),
      getVersionId: () => model.getVersionId(),
      getAlternativeVersionId: () => getAltVersionId(),
      getLanguageId: () => model.getLanguageId(),
      getEOL: () => model.getEOL(),
      setEOL: (eol: '\n' | '\r\n' | number) => { model.setEOL(eol); onSetEol(); },
      getOptions: () => model.getOptions(),
      updateOptions: (opts) => model.updateOptions(opts),
      detectIndentation: (sp, ts) => model.detectIndentation(sp, ts),
      pushStackElement: () => model.pushStackElement(),
      applyEdits: (ops) => { model.applyEdits(ops); onSetValue(); },
      pushEditOperations: (before, ops, computer) => {
        const res = model.applyEdits(ops);
        onSetValue();
        return computer ? computer(res) : before;
      },
      isDisposed: () => this.disposed,
      isAttachedToEditor: () => !this.disposed,
    };
  }

  asFeatureLike(): ModelLike {
    const model = this.model;
    return {
      getValue: () => model.getValue(),
      getLineContent: (n: number) => model.getLineContent(n),
      getLineCount: () => model.getLineCount(),
      getOffsetAt: (l: number, c: number) => model.getOffsetAt(l, c),
      getPositionAt: (o: number) => model.getPositionAt(o),
      getLanguageId: () => model.getLanguageId(),
      uri: Uri.parse(this.modelUriKey),
      uriString: this.modelUriKey,
    };
  }

  wordAtPosition(lineNumber: number, column: number): { word: string; startColumn: number; endColumn: number } | null {
    return this.model.getWordAtPosition({ lineNumber, column });
  }

  getTokenTypeAt(tokenization: TokenizationSupport, lineNumber: number, column: number): string | null {
    const tokens = tokenization.getLineTokens(this.model, lineNumber);
    for (const tok of tokens) {
      if (column >= tok.startColumn && column < tok.endColumn) return tok.type;
    }
    return null;
  }

  executeEdits(
    selection: SelectionState,
    readOnly: boolean,
    edits: readonly IIdentifiedSingleEditOperation[],
    endCursorState?: ISelection[] | ICursorStateComputer,
  ): boolean {
    if (readOnly || !edits.length) return false;
    const inverse = this.model.applyEdits(edits);
    const nextCursor = typeof endCursorState === 'function' ? endCursorState(inverse) : endCursorState;
    if (nextCursor && nextCursor.length > 0) {
      const mapped = nextCursor.map((sel) => ({
        anchor: this.model.validatePosition({ lineNumber: sel.selectionStartLineNumber ?? sel.startLineNumber, column: sel.selectionStartColumn ?? sel.startColumn }),
        active: this.model.validatePosition({ lineNumber: sel.positionLineNumber ?? sel.endLineNumber, column: sel.positionColumn ?? sel.endColumn }),
      }));
      if (mapped.length === 1) {
        selection.anchor = mapped[0]!.anchor;
        selection.active = mapped[0]!.active;
      } else {
        selection.setSelections(mapped);
      }
    } else {
      const last = edits[edits.length - 1]!;
      const startOff = this.model.getOffsetAt(last.range.startLineNumber, last.range.startColumn);
      const pos = this.model.getPositionAt(Math.min(this.model.getValue().length, startOff + (last.text ?? '').length));
      selection.setCaret(pos.lineNumber, pos.column);
    }
    return true;
  }

  applyWorkspaceEdit(
    edit: WorkspaceEdit,
    applyCurrentEdits: (edits: TextEdit[]) => boolean,
  ): boolean {
    if (!edit?.edits?.length) return false;
    const currentKey = this.modelUriKey;
    const byUri = new Map<string, TextEdit[]>();
    for (const item of edit.edits) {
      const key = item.resource ? item.resource.toString() : currentKey;
      const list = byUri.get(key) ?? [];
      list.push(item.textEdit);
      byUri.set(key, list);
    }
    let applied = false;
    for (const [uriKey, textEdits] of byUri.entries()) {
      if (uriKey === currentKey) {
        applied = applyCurrentEdits(textEdits) || applied;
      } else {
        const target = getRegisteredStandaloneModel(uriKey);
        const backing = getBackingTextModel(target);
        if (backing && textEdits.length) {
          backing.applyEdits(textEdits.map((te) => ({ range: te.range, text: te.text })));
          applied = true;
        }
      }
    }
    return applied;
  }

  applyStackSelection(
    selection: SelectionState,
    entry: StackEntrySelectionInfo | null,
    mode: 'undo' | 'redo',
  ): void {
    if (!entry) return;
    if (mode === 'undo') {
      if (entry.beforeSel) {
        selection.anchor = { lineNumber: entry.beforeSel.aLine, column: entry.beforeSel.aCol };
        selection.active = { lineNumber: entry.beforeSel.bLine, column: entry.beforeSel.bCol };
        return;
      }
      const restored = entry.inverse.text;
      if (restored.length > 0) {
        const start = entry.inverse.startOffset;
        const p1 = this.model.getPositionAt(start);
        const p2 = this.model.getPositionAt(start + restored.length);
        selection.anchor = { lineNumber: p1.lineNumber, column: p1.column };
        selection.active = { lineNumber: p2.lineNumber, column: p2.column };
        return;
      }
      const pos = this.model.getPositionAt(entry.inverse.startOffset);
      selection.setCaret(pos.lineNumber, pos.column);
      return;
    }
    if (entry.afterSel) {
      selection.anchor = { lineNumber: entry.afterSel.aLine, column: entry.afterSel.aCol };
      selection.active = { lineNumber: entry.afterSel.bLine, column: entry.afterSel.bCol };
      return;
    }
    const pos = this.model.getPositionAt(entry.forward.startOffset + entry.forward.text.length);
    selection.setCaret(pos.lineNumber, pos.column);
  }

  dispose(): void {
    this.disposed = true;
    this.viewStates.clear();
  }
}
