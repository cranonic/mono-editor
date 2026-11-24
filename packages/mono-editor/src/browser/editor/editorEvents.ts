import type { SelectionState } from '../../common/core/SelectionState';
import type {
  IModelChangedEvent,
  IPosition,
  ISelection,
  MonoDisposable,
} from '../../common/core/types';
import type { IMarker } from '../../common/decorations/types';
import type { TextModel } from '../../common/model/TextModel';
import type {
  ICursorPositionChangedEvent,
  ICursorSelectionChangedEvent,
  IScrollEvent,
  MonoContentChangeEvent,
} from './editorTypes';

/**
 * Typed event emitter hub for a single MonoEditor instance.
 * Keeps event subscription bookkeeping out of the MonoEditor composition root.
 */
export class EditorEventBus {
  private contentListeners = new Set<(e: MonoContentChangeEvent) => void>();
  private cursorPosListeners = new Set<(e: ICursorPositionChangedEvent) => void>();
  private cursorSelListeners = new Set<(e: ICursorSelectionChangedEvent) => void>();
  private scrollListeners = new Set<(e: IScrollEvent) => void>();
  private focusListeners = new Set<() => void>();
  private blurListeners = new Set<() => void>();
  private markerListeners = new Set<(markers: IMarker[]) => void>();
  private modelListeners = new Set<(e: IModelChangedEvent) => void>();
  altVersionId = 1;

  onDidChangeModelContent(listener: (e: MonoContentChangeEvent) => void): MonoDisposable {
    this.contentListeners.add(listener);
    return { dispose: () => this.contentListeners.delete(listener) };
  }

  onDidChangeCursorPosition(listener: (e: ICursorPositionChangedEvent) => void): MonoDisposable {
    this.cursorPosListeners.add(listener);
    return { dispose: () => this.cursorPosListeners.delete(listener) };
  }

  onDidChangeCursorSelection(listener: (e: ICursorSelectionChangedEvent) => void): MonoDisposable {
    this.cursorSelListeners.add(listener);
    return { dispose: () => this.cursorSelListeners.delete(listener) };
  }

  onDidScrollChange(listener: (e: IScrollEvent) => void): MonoDisposable {
    this.scrollListeners.add(listener);
    return { dispose: () => this.scrollListeners.delete(listener) };
  }

  onDidFocusEditorText(listener: () => void): MonoDisposable {
    this.focusListeners.add(listener);
    return { dispose: () => this.focusListeners.delete(listener) };
  }

  onDidBlurEditorText(listener: () => void): MonoDisposable {
    this.blurListeners.add(listener);
    return { dispose: () => this.blurListeners.delete(listener) };
  }

  onDidChangeMarkers(listener: (markers: IMarker[]) => void): MonoDisposable {
    this.markerListeners.add(listener);
    return { dispose: () => this.markerListeners.delete(listener) };
  }

  onDidChangeModel(listener: (e: IModelChangedEvent) => void): MonoDisposable {
    this.modelListeners.add(listener);
    return { dispose: () => this.modelListeners.delete(listener) };
  }

  emitContent(model: TextModel): void {
    this.altVersionId++;
    if (!this.contentListeners.size) return;
    let cached: string | undefined;
    const e: MonoContentChangeEvent = {
      get value(): string {
        return cached ?? (cached = model.getValue());
      },
    };
    for (const l of this.contentListeners) l(e);
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
    const posEv: ICursorPositionChangedEvent = {
      position,
      secondaryPositions,
      reason: 0,
      source,
    };
    const selEv: ICursorSelectionChangedEvent = {
      selection,
      secondarySelections,
      modelVersionId: model.getVersionId(),
      oldSelections: null,
      oldModelVersionId: model.getVersionId(),
      source,
      reason: 0,
    };
    for (const l of this.cursorPosListeners) {
      try { l(posEv); } catch { /* */ }
    }
    for (const l of this.cursorSelListeners) {
      try { l(selEv); } catch { /* */ }
    }
  }

  emitScroll(ev: IScrollEvent): void {
    if (!this.scrollListeners.size) return;
    for (const l of this.scrollListeners) {
      try { l(ev); } catch { /* */ }
    }
  }

  emitFocus(): void {
    for (const l of this.focusListeners) {
      try { l(); } catch { /* */ }
    }
  }

  emitBlur(): void {
    for (const l of this.blurListeners) {
      try { l(); } catch { /* */ }
    }
  }

  emitMarkers(markers: IMarker[]): void {
    for (const l of this.markerListeners) {
      try { l(markers); } catch { /* */ }
    }
  }

  emitModelChanged(ev: IModelChangedEvent): void {
    for (const l of this.modelListeners) {
      try { l(ev); } catch { /* */ }
    }
  }

  dispose(): void {
    this.contentListeners.clear();
    this.cursorPosListeners.clear();
    this.cursorSelListeners.clear();
    this.scrollListeners.clear();
    this.focusListeners.clear();
    this.blurListeners.clear();
    this.markerListeners.clear();
    this.modelListeners.clear();
  }
}
