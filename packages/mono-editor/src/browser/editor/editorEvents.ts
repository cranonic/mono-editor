import type { MonoEditorOptions } from '../../common/config/editorOptions';
import type { SelectionState } from '../../common/core/SelectionState';
import type {
  IContentSizeChangedEvent,
  IEditorLayoutInfo,
  IEditorMouseEvent,
  IModelChangedEvent,
  IModelContentChange,
  IModelDecorationsChangedEvent,
  IModelLanguageChangedEvent,
  IModelOptionsChangedEvent,
  IPasteEvent,
  IPosition,
  ISelection,
  MonoDisposable,
} from '../../common/core/types';
import type { IMarker } from '../../common/decorations/types';
import type { IInlayHintClickEvent } from '../../common/languages/providers/types';
import type { ModelChange, TextModel } from '../../common/model/TextModel';
import type {
  ICursorPositionChangedEvent,
  ICursorSelectionChangedEvent,
  IScrollEvent,
  MonoContentChangeEvent,
} from './editorTypes';

function safeEmit<T>(set: Set<(arg: T) => void>, arg: T): void {
  if (!set.size) return;
  for (const l of set) {
    try { l(arg); } catch { /* listener error isolated */ }
  }
}

function safeEmitVoid(set: Set<() => void>): void {
  if (!set.size) return;
  for (const l of set) {
    try { l(); } catch { /* listener error isolated */ }
  }
}

function add<T>(set: Set<T>, fn: T): MonoDisposable {
  set.add(fn);
  return { dispose: () => set.delete(fn) };
}

/**
 * Typed event emitter hub for a single MonoEditor instance.
 * Keeps event subscription bookkeeping out of the MonoEditor composition root.
 */
export class EditorEventBus {
  private contentListeners = new Set<(e: MonoContentChangeEvent) => void>();
  private languageListeners = new Set<(e: IModelLanguageChangedEvent) => void>();
  private modelOptionsListeners = new Set<(e: IModelOptionsChangedEvent) => void>();
  private decorationsListeners = new Set<(e: IModelDecorationsChangedEvent) => void>();
  private configListeners = new Set<(e: Partial<MonoEditorOptions>) => void>();
  private layoutListeners = new Set<(e: IEditorLayoutInfo) => void>();
  private contentSizeListeners = new Set<(e: IContentSizeChangedEvent) => void>();
  private cursorPosListeners = new Set<(e: ICursorPositionChangedEvent) => void>();
  private cursorSelListeners = new Set<(e: ICursorSelectionChangedEvent) => void>();
  private scrollListeners = new Set<(e: IScrollEvent) => void>();
  private focusListeners = new Set<() => void>();
  private blurListeners = new Set<() => void>();
  private widgetFocusListeners = new Set<() => void>();
  private widgetBlurListeners = new Set<() => void>();
  private pasteListeners = new Set<(e: IPasteEvent) => void>();
  private compStartListeners = new Set<() => void>();
  private compEndListeners = new Set<() => void>();
  private mouseDownListeners = new Set<(e: IEditorMouseEvent) => void>();
  private mouseUpListeners = new Set<(e: IEditorMouseEvent) => void>();
  private mouseMoveListeners = new Set<(e: IEditorMouseEvent) => void>();
  private mouseLeaveListeners = new Set<(e: IEditorMouseEvent) => void>();
  private contextMenuListeners = new Set<(e: IEditorMouseEvent) => void>();
  private keyDownListeners = new Set<(e: KeyboardEvent) => void>();
  private keyUpListeners = new Set<(e: KeyboardEvent) => void>();
  private disposeListeners = new Set<() => void>();
  private markerListeners = new Set<(markers: IMarker[]) => void>();
  private modelListeners = new Set<(e: IModelChangedEvent) => void>();
  private inlayHintClickListeners = new Set<(e: IInlayHintClickEvent) => void>();

  altVersionId = 1;
  private lastChange: ModelChange | undefined;

  recordModelChange(change?: ModelChange): void {
    this.lastChange = change;
  }

  onDidChangeModelContent(l: (e: MonoContentChangeEvent) => void): MonoDisposable { return add(this.contentListeners, l); }
  onDidChangeModelLanguage(l: (e: IModelLanguageChangedEvent) => void): MonoDisposable { return add(this.languageListeners, l); }
  onDidChangeModelOptions(l: (e: IModelOptionsChangedEvent) => void): MonoDisposable { return add(this.modelOptionsListeners, l); }
  onDidChangeModelDecorations(l: (e: IModelDecorationsChangedEvent) => void): MonoDisposable { return add(this.decorationsListeners, l); }
  onDidChangeConfiguration(l: (e: Partial<MonoEditorOptions>) => void): MonoDisposable { return add(this.configListeners, l); }
  onDidLayoutChange(l: (e: IEditorLayoutInfo) => void): MonoDisposable { return add(this.layoutListeners, l); }
  onDidContentSizeChange(l: (e: IContentSizeChangedEvent) => void): MonoDisposable { return add(this.contentSizeListeners, l); }
  onDidChangeCursorPosition(l: (e: ICursorPositionChangedEvent) => void): MonoDisposable { return add(this.cursorPosListeners, l); }
  onDidChangeCursorSelection(l: (e: ICursorSelectionChangedEvent) => void): MonoDisposable { return add(this.cursorSelListeners, l); }
  onDidScrollChange(l: (e: IScrollEvent) => void): MonoDisposable { return add(this.scrollListeners, l); }
  onDidFocusEditorText(l: () => void): MonoDisposable { return add(this.focusListeners, l); }
  onDidBlurEditorText(l: () => void): MonoDisposable { return add(this.blurListeners, l); }
  onDidFocusEditorWidget(l: () => void): MonoDisposable { return add(this.widgetFocusListeners, l); }
  onDidBlurEditorWidget(l: () => void): MonoDisposable { return add(this.widgetBlurListeners, l); }
  onDidPaste(l: (e: IPasteEvent) => void): MonoDisposable { return add(this.pasteListeners, l); }
  onDidCompositionStart(l: () => void): MonoDisposable { return add(this.compStartListeners, l); }
  onDidCompositionEnd(l: () => void): MonoDisposable { return add(this.compEndListeners, l); }
  onMouseDown(l: (e: IEditorMouseEvent) => void): MonoDisposable { return add(this.mouseDownListeners, l); }
  onMouseUp(l: (e: IEditorMouseEvent) => void): MonoDisposable { return add(this.mouseUpListeners, l); }
  onMouseMove(l: (e: IEditorMouseEvent) => void): MonoDisposable { return add(this.mouseMoveListeners, l); }
  onMouseLeave(l: (e: IEditorMouseEvent) => void): MonoDisposable { return add(this.mouseLeaveListeners, l); }
  onContextMenu(l: (e: IEditorMouseEvent) => void): MonoDisposable { return add(this.contextMenuListeners, l); }
  onKeyDown(l: (e: KeyboardEvent) => void): MonoDisposable { return add(this.keyDownListeners, l); }
  onKeyUp(l: (e: KeyboardEvent) => void): MonoDisposable { return add(this.keyUpListeners, l); }
  onDidDispose(l: () => void): MonoDisposable { return add(this.disposeListeners, l); }
  onDidChangeMarkers(l: (markers: IMarker[]) => void): MonoDisposable { return add(this.markerListeners, l); }
  onDidChangeModel(l: (e: IModelChangedEvent) => void): MonoDisposable { return add(this.modelListeners, l); }
  onDidClickInlayHint(l: (e: IInlayHintClickEvent) => void): MonoDisposable { return add(this.inlayHintClickListeners, l); }

  emitContent(model: TextModel, change?: ModelChange): void {
    this.altVersionId++;
    const effective = change ?? this.lastChange;
    this.lastChange = undefined;
    if (!this.contentListeners.size) return;
    let cached: string | undefined;
    const changes: readonly IModelContentChange[] = effective?.changes ?? [];
    const e: MonoContentChangeEvent = {
      changes,
      eol: model.getEOL(),
      versionId: model.getVersionId(),
      isUndoing: Boolean(effective?.isUndoing),
      isRedoing: Boolean(effective?.isRedoing),
      isFlush: Boolean(effective?.isFlush),
      get value(): string {
        return cached ?? (cached = model.getValue());
      },
    };
    for (const l of this.contentListeners) {
      try { l(e); } catch { /* */ }
    }
  }

  emitCursor(
    model: TextModel,
    selectionState: SelectionState,
    position: IPosition,
    allSelections: ISelection[],
    fallbackSelection: ISelection,
    source: string,
  ): void {
    const selection = allSelections[0] ?? fallbackSelection;
    const secondaryPositions = selectionState.selections.slice(1).map((s) => ({
      lineNumber: s.active.lineNumber,
      column: s.active.column,
    }));
    const secondarySelections = allSelections.slice(1);
    safeEmit(this.cursorPosListeners, { position, secondaryPositions, reason: 0, source });
    safeEmit(this.cursorSelListeners, {
      selection, secondarySelections, modelVersionId: model.getVersionId(),
      oldSelections: null, oldModelVersionId: model.getVersionId(), source, reason: 0,
    });
  }

  emitModelLanguage(ev: IModelLanguageChangedEvent): void { safeEmit(this.languageListeners, ev); }
  emitModelOptions(ev: IModelOptionsChangedEvent): void { safeEmit(this.modelOptionsListeners, ev); }
  emitModelDecorations(ev: IModelDecorationsChangedEvent = {}): void { safeEmit(this.decorationsListeners, ev); }
  emitConfig(patch: Partial<MonoEditorOptions>): void { safeEmit(this.configListeners, patch); }
  emitLayout(info: IEditorLayoutInfo): void { safeEmit(this.layoutListeners, info); }
  emitContentSize(ev: IContentSizeChangedEvent): void { safeEmit(this.contentSizeListeners, ev); }
  emitScroll(ev: IScrollEvent): void { safeEmit(this.scrollListeners, ev); }
  emitFocus(): void { safeEmitVoid(this.focusListeners); safeEmitVoid(this.widgetFocusListeners); }
  emitBlur(): void { safeEmitVoid(this.blurListeners); safeEmitVoid(this.widgetBlurListeners); }
  emitPaste(ev: IPasteEvent): void { safeEmit(this.pasteListeners, ev); }
  emitCompositionStart(): void { safeEmitVoid(this.compStartListeners); }
  emitCompositionEnd(): void { safeEmitVoid(this.compEndListeners); }
  emitMouse(kind: 'down' | 'up' | 'move' | 'leave' | 'contextmenu', ev: IEditorMouseEvent): void {
    if (kind === 'down') safeEmit(this.mouseDownListeners, ev);
    else if (kind === 'up') safeEmit(this.mouseUpListeners, ev);
    else if (kind === 'move') safeEmit(this.mouseMoveListeners, ev);
    else if (kind === 'leave') safeEmit(this.mouseLeaveListeners, ev);
    else safeEmit(this.contextMenuListeners, ev);
  }
  emitKeyDown(e: KeyboardEvent): void { safeEmit(this.keyDownListeners, e); }
  emitKeyUp(e: KeyboardEvent): void { safeEmit(this.keyUpListeners, e); }
  emitMarkers(markers: IMarker[]): void { safeEmit(this.markerListeners, markers); }
  emitModelChanged(ev: IModelChangedEvent): void { safeEmit(this.modelListeners, ev); }
  emitInlayHintClick(ev: IInlayHintClickEvent): void { safeEmit(this.inlayHintClickListeners, ev); }
  emitDispose(): void { safeEmitVoid(this.disposeListeners); }

  dispose(): void {
    this.contentListeners.clear(); this.languageListeners.clear();
    this.modelOptionsListeners.clear(); this.decorationsListeners.clear();
    this.configListeners.clear(); this.layoutListeners.clear(); this.contentSizeListeners.clear();
    this.cursorPosListeners.clear(); this.cursorSelListeners.clear(); this.scrollListeners.clear();
    this.focusListeners.clear(); this.blurListeners.clear();
    this.widgetFocusListeners.clear(); this.widgetBlurListeners.clear();
    this.pasteListeners.clear(); this.compStartListeners.clear(); this.compEndListeners.clear();
    this.mouseDownListeners.clear(); this.mouseUpListeners.clear(); this.mouseMoveListeners.clear();
    this.mouseLeaveListeners.clear(); this.contextMenuListeners.clear();
    this.keyDownListeners.clear(); this.keyUpListeners.clear(); this.disposeListeners.clear();
    this.markerListeners.clear(); this.modelListeners.clear(); this.inlayHintClickListeners.clear();
  }
}
