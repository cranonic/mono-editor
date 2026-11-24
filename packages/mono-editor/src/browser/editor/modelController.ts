import type { SelectionState } from '../../common/core/SelectionState';
import type {
  IIdentifiedSingleEditOperation,
  IMonoTextModel,
  IPosition,
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

  constructor(opts: {
    sharedTextModel?: TextModel;
    externalModel?: IMonoTextModel;
    value?: string;
    language?: string;
    undoGroupIdleMs?: number;
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
  }

  attachSelectionCapture(selection: SelectionState): void {
    if (!this.ownsModel) return;
    this.model.setSelectionCapture(() => {
      const a = selection.anchor;
      const b = selection.active;
      return {
        aLine: a.lineNumber,
        aCol: a.column,
        bLine: b.lineNumber,
        bCol: b.column,
      };
    });
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
      setValue: (v: string) => {
        model.setValue(v);
        onSetValue();
      },
      getLineCount: () => model.getLineCount(),
      getLineContent: (ln: number) => model.getLineContent(ln),
      getOffsetAt: (pos: IPosition) => model.getOffsetAt(pos.lineNumber, pos.column),
      getPositionAt: (offset: number) => model.getPositionAt(offset),
      getVersionId: () => model.getVersionId(),
      getAlternativeVersionId: () => getAltVersionId(),
      getLanguageId: () => model.getLanguageId(),
      getEOL: () => model.getEOL(),
      setEOL: (eol: '\n' | '\r\n' | number) => {
        model.setEOL(eol);
        onSetEol();
      },
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
    const line = this.model.getLineContent(lineNumber);
    if (!line) return null;
    let idx = Math.max(0, Math.min(line.length, column - 1));
    const isIdent = (c: string) => /[A-Za-z0-9_$]/.test(c);
    if (idx > 0 && (idx === line.length || !isIdent(line[idx]!)) && isIdent(line[idx - 1]!)) {
      idx--;
    }
    if (idx >= line.length || !isIdent(line[idx]!)) return null;
    let s = idx;
    while (s > 0 && isIdent(line[s - 1]!)) s--;
    let e = idx + 1;
    while (e < line.length && isIdent(line[e]!)) e++;
    return { word: line.slice(s, e), startColumn: s + 1, endColumn: e + 1 };
  }

  getTokenTypeAt(tokenization: TokenizationSupport, lineNumber: number, column: number): string | null {
    const tokens = tokenization.getLineTokens(this.model, lineNumber);
    for (const tok of tokens) {
      if (column >= tok.startColumn && column < tok.endColumn) {
        return tok.type;
      }
    }
    return null;
  }

  executeEdits(
    selection: SelectionState,
    readOnly: boolean,
    edits: IIdentifiedSingleEditOperation[],
  ): boolean {
    if (readOnly || !edits.length) return false;
    const sorted = [...edits].sort((a, b) => {
      if (a.range.startLineNumber !== b.range.startLineNumber) {
        return b.range.startLineNumber - a.range.startLineNumber;
      }
      return b.range.startColumn - a.range.startColumn;
    });
    this.model.transact(() => {
      for (const edit of sorted) {
        const start = this.model.getOffsetAt(edit.range.startLineNumber, edit.range.startColumn);
        const end = this.model.getOffsetAt(edit.range.endLineNumber, edit.range.endColumn);
        const text = edit.text ?? '';
        this.model.replaceRange(start, end, text);
        const pos = this.model.getPositionAt(start + text.length);
        selection.setCaret(pos.lineNumber, pos.column);
      }
    });
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
          const sorted = [...textEdits].sort((a, b) => {
            if (a.range.startLineNumber !== b.range.startLineNumber) {
              return b.range.startLineNumber - a.range.startLineNumber;
            }
            return b.range.startColumn - a.range.startColumn;
          });
          backing.transact(() => {
            for (const ed of sorted) {
              const s = backing.getOffsetAt(ed.range.startLineNumber, ed.range.startColumn);
              const e = backing.getOffsetAt(ed.range.endLineNumber, ed.range.endColumn);
              backing.replaceRange(s, e, ed.text);
            }
          });
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
        const s = entry.beforeSel;
        selection.anchor = { lineNumber: s.aLine, column: s.aCol };
        selection.active = { lineNumber: s.bLine, column: s.bCol };
        return;
      }
      const restored = entry.inverse.text;
      if (restored.length > 0) {
        const start = entry.inverse.startOffset;
        const end = start + restored.length;
        const p1 = this.model.getPositionAt(start);
        const p2 = this.model.getPositionAt(end);
        selection.anchor = { lineNumber: p1.lineNumber, column: p1.column };
        selection.active = { lineNumber: p2.lineNumber, column: p2.column };
        return;
      }
      const pos = this.model.getPositionAt(entry.inverse.startOffset);
      selection.setCaret(pos.lineNumber, pos.column);
      return;
    }
    if (entry.afterSel) {
      const s = entry.afterSel;
      selection.anchor = { lineNumber: s.aLine, column: s.aCol };
      selection.active = { lineNumber: s.bLine, column: s.bCol };
      return;
    }
    const endOff = entry.forward.startOffset + entry.forward.text.length;
    const pos = this.model.getPositionAt(endOff);
    selection.setCaret(pos.lineNumber, pos.column);
  }

  dispose(): void {
    this.viewStates.clear();
  }
}
