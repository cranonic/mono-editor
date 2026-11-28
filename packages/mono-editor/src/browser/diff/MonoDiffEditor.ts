import {
  DEFAULT_MONO_FONT_FAMILY,
  type MonoEditorOptions,
} from '../../common/config/editorOptions';
import type {
  IContentSizeChangedEvent,
  IDimension,
  MonoDisposable,
} from '../../common/core/types';
import {
  computeDiff,
  computeLineDiff,
  type IDiffComputationResult,
  type ILineChange,
} from '../../common/diff/myersDiff';
import { monoThemeService, registerBuiltinThemes } from '../../platform/theme';
import { MonoEditor } from '../editor/MonoEditor';
import type { IMonoEditor } from '../editor/editorTypes';
import { applyDiffVisuals, type DiffVisualState } from './diffDecorations';
import {
  applyDiffTheme,
  createDiffDom,
  createMonoDiffNavigator,
  extractBaseEditorOptions,
  renderDiffRevertArrows,
  resolveDiffColors,
  type DiffDomNodes,
} from './diffDom';
import type {
  DiffUpdateEvent,
  IDiffEditorModel,
  IDiffEditorModelChangedEvent,
  IDiffEditorViewState,
  IMonoDiffEditor,
  MonoDiffEditorOptions,
} from './diffTypes';

export { createMonoDiffNavigator };
export type {
  DiffUpdateEvent,
  IDiffEditorModel,
  IDiffEditorModelChangedEvent,
  IDiffEditorViewState,
  IDiffNavigator,
  IDiffNavigatorOptions,
  IHideUnchangedRegionsOptions,
  IMonoDiffEditor,
  MonoDiffEditorOptions,
} from './diffTypes';

let diffEditorCounter = 1;
const createDiffEditorListeners = new Set<(editor: IMonoDiffEditor) => void>();

export function onDidCreateMonoDiffEditor(listener: (editor: IMonoDiffEditor) => void): MonoDisposable {
  createDiffEditorListeners.add(listener);
  return { dispose: () => createDiffEditorListeners.delete(listener) };
}

/**
 * Dual-MonoEditor Diff Editor with Monaco `IStandaloneDiffEditor` parity:
 *  - Two real `MonoEditor` instances (`originalEditor`, `modifiedEditor`) with syntax highlighting,
 *    selection, find, folding, touch, and independent horizontal scrolling per pane
 *  - Pixel-aligned bidirectional vertical scroll sync via filler view zones (`changeViewZones`)
 *  - Modified pane editable by default (`readOnly: false`), original read-only unless `originalEditable: true`
 *  - Responsive inline mode (`renderSideBySideInlineBreakpoint: 900`) using highlighted deleted view zones
 *  - Live debounced re-diff, character-level highlights, margin revert actions, and hideUnchangedRegions
 */
export class MonoDiffEditor implements IMonoDiffEditor {
  private readonly id = `mono.diffEditor.${diffEditorCounter++}`;
  private readonly dom: DiffDomNodes;
  private readonly originalEditor: MonoEditor;
  private readonly modifiedEditor: MonoEditor;

  private model: IDiffEditorModel | null = null;
  private options: MonoDiffEditorOptions;
  private splitRatio = 0.5;
  private inlineMode = false;
  private diffResult: IDiffComputationResult | null = null;
  private activeHunkIdx = -1;
  private syncingScroll = false;
  private rediffTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  private readonly visualState: DiffVisualState = {
    origZoneIds: [],
    modZoneIds: [],
    origDecIds: [],
    modDecIds: [],
    expandedHiddenKeys: new Set<string>(),
  };

  private readonly updateListeners = new Set<(r: DiffUpdateEvent) => void>();
  private readonly modelListeners = new Set<(e: IDiffEditorModelChangedEvent) => void>();
  private readonly sizeListeners = new Set<(e: IContentSizeChangedEvent) => void>();
  private readonly disposeListeners = new Set<() => void>();
  private readonly subs: MonoDisposable[] = [];
  private modelSubs: MonoDisposable[] = [];
  private ro: ResizeObserver | null = null;

  constructor(host: HTMLElement, options: MonoDiffEditorOptions = {}) {
    registerBuiltinThemes();
    this.options = {
      fontSize: 13,
      fontFamily: DEFAULT_MONO_FONT_FAMILY,
      renderSideBySide: undefined,
      renderSideBySideInlineBreakpoint: options.renderSideBySideInlineBreakpoint ?? options.inlineBreakpointPx ?? 900,
      inlineBreakpointPx: options.inlineBreakpointPx ?? options.renderSideBySideInlineBreakpoint ?? 900,
      useInlineViewWhenSpaceIsLimited: options.useInlineViewWhenSpaceIsLimited ?? true,
      enableSplitViewResizing: options.enableSplitViewResizing ?? true,
      ignoreTrimWhitespace: options.ignoreTrimWhitespace ?? true,
      renderIndicators: options.renderIndicators ?? true,
      originalEditable: options.originalEditable ?? false,
      readOnly: options.readOnly ?? false,
      renderOverviewRuler: options.renderOverviewRuler ?? true,
      renderMarginRevertIcon: options.renderMarginRevertIcon ?? true,
      maxComputationTime: options.maxComputationTime ?? 5000,
      maxFileSize: options.maxFileSize ?? 50,
      diffAlgorithm: options.diffAlgorithm ?? 'advanced',
      toolbar: options.toolbar ?? true,
      ...options,
    };

    this.dom = createDiffDom({
      id: this.id,
      showToolbar: this.options.toolbar !== false,
      onPrev: () => this.goToDiff('previous'),
      onNext: () => this.goToDiff('next'),
      onToggleMode: () => {
        this.options.renderSideBySide = this.inlineMode;
        this.applyPaneLayout();
        this.applyVisualsNow();
      },
    });
    host.appendChild(this.dom.root);

    const baseOpts = extractBaseEditorOptions(this.options);
    const sharedDiffDefaults: Partial<MonoEditorOptions> = {
      minimap: { enabled: false },
      stickyScroll: { enabled: false },
      glyphMargin: this.options.renderIndicators !== false,
      wordWrap: this.options.diffWordWrap === 'on' ? 'on' : 'off',
      mobileQuickKeys: false,
      ...baseOpts,
    };

    this.originalEditor = new MonoEditor(this.dom.origPane, {
      ...sharedDiffDefaults,
      ...this.options.originalEditorOptions,
      readOnly: this.options.originalEditable === true ? false : true,
    });

    this.modifiedEditor = new MonoEditor(this.dom.modPane, {
      ...sharedDiffDefaults,
      ...this.options.modifiedEditorOptions,
      readOnly: this.options.readOnly === true,
    });

    this.bindScrollSync();
    this.bindSplitterDrag();
    this.bindKeybindings();
    applyDiffTheme(this.dom);
    this.applyPaneLayout();

    this.subs.push(
      monoThemeService.onDidChangeColorTheme(() => {
        if (!this.disposed) {
          applyDiffTheme(this.dom);
          this.applyVisualsNow();
        }
      }),
      this.modifiedEditor.onDidContentSizeChange((e) => {
        for (const l of this.sizeListeners) { try { l(e); } catch { /* */ } }
      }),
      this.originalEditor.onDidContentSizeChange(() => {
        this.renderRevertArrows();
      }),
    );

    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.layout());
      this.ro.observe(this.dom.root);
    }

    for (const l of createDiffEditorListeners) {
      try { l(this); } catch { /* */ }
    }
  }

  getId(): string { return this.id; }
  getEditorType(): string { return 'vs.editor.IDiffEditor'; }
  getContainerDomNode(): HTMLElement { return this.dom.root; }
  getOriginalEditor(): IMonoEditor { return this.originalEditor; }
  getModifiedEditor(): IMonoEditor { return this.modifiedEditor; }

  setModel(model: IDiffEditorModel | null): void {
    const oldModel = this.model;
    this.clearModelSubs();
    this.model = model;
    this.activeHunkIdx = -1;
    this.visualState.expandedHiddenKeys.clear();

    if (model) {
      this.originalEditor.setModel(model.original);
      this.modifiedEditor.setModel(model.modified);
      this.modelSubs.push(
        this.originalEditor.onDidChangeModelContent(() => this.scheduleRecompute()),
        this.modifiedEditor.onDidChangeModelContent(() => this.scheduleRecompute()),
      );
    } else {
      this.originalEditor.setValue('');
      this.modifiedEditor.setValue('');
    }

    this.recomputeNow();
    for (const l of this.modelListeners) {
      try { l({ oldModel, newModel: model }); } catch { /* */ }
    }
  }

  getModel(): IDiffEditorModel | null { return this.model; }

  getLineChanges(): ILineChange[] | null {
    if (!this.diffResult) return null;
    return this.diffResult.changes.map((c) => ({
      ...c,
      ...(c.charChanges ? { charChanges: c.charChanges.map((cc) => ({ ...cc })) } : {}),
    }));
  }

  getDiffComputationResult(): IDiffComputationResult | null {
    return this.diffResult;
  }

  updateOptions(patch: Partial<MonoDiffEditorOptions>): void {
    const prev = this.options;
    this.options = {
      ...prev,
      ...patch,
      renderSideBySideInlineBreakpoint:
        patch.renderSideBySideInlineBreakpoint ??
        patch.inlineBreakpointPx ??
        prev.renderSideBySideInlineBreakpoint,
      inlineBreakpointPx:
        patch.inlineBreakpointPx ??
        patch.renderSideBySideInlineBreakpoint ??
        prev.inlineBreakpointPx,
    };

    if (patch.toolbar !== undefined) {
      this.dom.header.style.display = patch.toolbar === false ? 'none' : 'flex';
    }

    const basePatch = extractBaseEditorOptions(patch);
    const origPatch: Partial<MonoEditorOptions> = {
      ...basePatch,
      ...(patch.renderIndicators !== undefined ? { glyphMargin: patch.renderIndicators } : {}),
      ...(patch.originalEditorOptions ?? {}),
      ...(patch.originalEditable !== undefined ? { readOnly: !patch.originalEditable } : {}),
    };
    const modPatch: Partial<MonoEditorOptions> = {
      ...basePatch,
      ...(patch.renderIndicators !== undefined ? { glyphMargin: patch.renderIndicators } : {}),
      ...(patch.modifiedEditorOptions ?? {}),
      ...(patch.readOnly !== undefined ? { readOnly: patch.readOnly } : {}),
    };

    if (Object.keys(origPatch).length > 0) this.originalEditor.updateOptions(origPatch);
    if (Object.keys(modPatch).length > 0) this.modifiedEditor.updateOptions(modPatch);

    this.applyPaneLayout();

    const needsRecompute =
      patch.ignoreTrimWhitespace !== undefined ||
      patch.maxComputationTime !== undefined ||
      patch.diffAlgorithm !== undefined ||
      patch.experimental !== undefined;

    if (needsRecompute) this.recomputeNow();
    else this.applyVisualsNow();
    this.syncContextKeys();
  }

  layout(dimension?: IDimension): void {
    if (this.disposed) return;
    if (dimension) {
      this.dom.root.style.width = `${Math.max(0, dimension.width)}px`;
      this.dom.root.style.height = `${Math.max(0, dimension.height)}px`;
    }
    const prevInline = this.inlineMode;
    this.applyPaneLayout();
    if (prevInline !== this.inlineMode) {
      this.applyVisualsNow();
    } else {
      this.renderRevertArrows();
    }
  }

  focus(): void { this.modifiedEditor.focus(); }
  hasTextFocus(): boolean { return this.modifiedEditor.hasTextFocus() || this.originalEditor.hasTextFocus(); }

  saveViewState(): IDiffEditorViewState | null {
    if (this.disposed) return null;
    return {
      original: this.originalEditor.saveViewState(),
      modified: this.modifiedEditor.saveViewState(),
    };
  }

  restoreViewState(state: IDiffEditorViewState | null): void {
    if (!state || this.disposed) return;
    if (state.original) this.originalEditor.restoreViewState(state.original);
    if (state.modified) this.modifiedEditor.restoreViewState(state.modified);
  }

  goToDiff(target: 'next' | 'previous'): void {
    const changes = this.diffResult?.changes ?? [];
    if (!changes.length) return;
    const delta = target === 'next' ? 1 : -1;
    this.activeHunkIdx =
      this.activeHunkIdx < 0
        ? (delta > 0 ? 0 : changes.length - 1)
        : (this.activeHunkIdx + delta + changes.length) % changes.length;
    this.revealHunk(changes[this.activeHunkIdx]!);
  }

  revealFirstDiff(): void {
    const changes = this.diffResult?.changes ?? [];
    if (!changes.length) return;
    this.activeHunkIdx = 0;
    this.revealHunk(changes[0]!);
  }

  accessibleDiffViewerNext(): void { this.goToDiff('next'); }
  accessibleDiffViewerPrev(): void { this.goToDiff('previous'); }

  onDidUpdateDiff(listener: (result: DiffUpdateEvent) => void): MonoDisposable {
    this.updateListeners.add(listener);
    return { dispose: () => this.updateListeners.delete(listener) };
  }

  onDidChangeModel(listener: (e: IDiffEditorModelChangedEvent) => void): MonoDisposable {
    this.modelListeners.add(listener);
    return { dispose: () => this.modelListeners.delete(listener) };
  }

  onDidContentSizeChange(listener: (e: IContentSizeChangedEvent) => void): MonoDisposable {
    this.sizeListeners.add(listener);
    return { dispose: () => this.sizeListeners.delete(listener) };
  }

  onDidDispose(listener: () => void): MonoDisposable {
    this.disposeListeners.add(listener);
    return { dispose: () => this.disposeListeners.delete(listener) };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.rediffTimer) { clearTimeout(this.rediffTimer); this.rediffTimer = null; }
    this.ro?.disconnect();
    this.clearModelSubs();
    for (const s of this.subs) s.dispose();
    this.subs.length = 0;
    this.originalEditor.dispose();
    this.modifiedEditor.dispose();
    for (const l of this.disposeListeners) { try { l(); } catch { /* */ } }
    this.updateListeners.clear();
    this.modelListeners.clear();
    this.sizeListeners.clear();
    this.disposeListeners.clear();
    this.dom.root.remove();
  }

  private clearModelSubs(): void {
    for (const s of this.modelSubs) s.dispose();
    this.modelSubs = [];
  }

  private resolveInlineMode(): boolean {
    if (this.options.renderSideBySide === false) return true;
    if (this.options.renderSideBySide === true && this.options.useInlineViewWhenSpaceIsLimited === false) {
      return false;
    }
    const width = this.dom.root.getBoundingClientRect().width || this.dom.root.clientWidth || 1000;
    const bp = this.options.renderSideBySideInlineBreakpoint ?? this.options.inlineBreakpointPx ?? 900;
    if (this.options.useInlineViewWhenSpaceIsLimited !== false && width < bp) return true;
    return false;
  }

  private applyPaneLayout(): void {
    this.inlineMode = this.resolveInlineMode();
    this.dom.modeBtn.textContent = this.inlineMode ? 'Split' : 'Inline';

    const showRevertGutter =
      !this.inlineMode && this.options.renderMarginRevertIcon !== false && !this.options.readOnly;
    const showSplitter = !this.inlineMode;

    this.dom.origPane.style.display = this.inlineMode ? 'none' : 'block';
    this.dom.splitter.style.display = showSplitter ? 'block' : 'none';
    this.dom.splitter.style.cursor = this.options.enableSplitViewResizing !== false ? 'col-resize' : 'default';
    this.dom.revertGutter.style.display = showRevertGutter ? 'block' : 'none';

    if (this.inlineMode) {
      this.dom.modPane.style.flex = '1 1 100%';
    } else {
      const pct = Math.max(15, Math.min(85, this.splitRatio * 100));
      this.dom.origPane.style.flex = `0 0 calc(${pct}% - ${showRevertGutter ? 12 : 2.5}px)`;
      this.dom.modPane.style.flex = '1 1 0%';
    }

    this.originalEditor.layout();
    this.modifiedEditor.layout();
    this.syncContextKeys();
  }

  private bindScrollSync(): void {
    this.subs.push(
      this.originalEditor.onDidScrollChange((e) => {
        if (this.syncingScroll || this.inlineMode || !e.scrollTopChanged) return;
        this.syncingScroll = true;
        try {
          this.modifiedEditor.setScrollTop(e.scrollTop);
          this.renderRevertArrows();
        } finally {
          this.syncingScroll = false;
        }
      }),
      this.modifiedEditor.onDidScrollChange((e) => {
        if (this.syncingScroll || !e.scrollTopChanged) return;
        this.syncingScroll = true;
        try {
          if (!this.inlineMode) this.originalEditor.setScrollTop(e.scrollTop);
          this.renderRevertArrows();
        } finally {
          this.syncingScroll = false;
        }
      }),
    );
  }

  private bindSplitterDrag(): void {
    let dragging = false;
    this.dom.splitter.addEventListener('pointerdown', (e) => {
      if (this.options.enableSplitViewResizing === false || this.inlineMode) return;
      dragging = true;
      this.dom.splitter.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    });
    this.dom.splitter.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const rect = this.dom.panesWrap.getBoundingClientRect();
      if (rect.width <= 0) return;
      this.splitRatio = Math.max(0.15, Math.min(0.85, (e.clientX - rect.left) / rect.width));
      this.applyPaneLayout();
    });
    const endDrag = () => { dragging = false; };
    this.dom.splitter.addEventListener('pointerup', endDrag);
    this.dom.splitter.addEventListener('pointercancel', endDrag);
  }

  private bindKeybindings(): void {
    for (const ed of [this.originalEditor, this.modifiedEditor]) {
      ed.addKeybinding({ id: 'diff.nextChange', primary: 'f7', weight: 6, handler: () => this.goToDiff('next') });
      ed.addKeybinding({ id: 'diff.prevChange', primary: 'shift+f7', weight: 6, handler: () => this.goToDiff('previous') });
    }
  }

  private scheduleRecompute(): void {
    if (this.disposed) return;
    if (this.rediffTimer) clearTimeout(this.rediffTimer);
    this.rediffTimer = setTimeout(() => {
      this.rediffTimer = null;
      if (!this.disposed) this.recomputeNow();
    }, 120);
  }

  private recomputeNow(): void {
    const origText = this.model ? this.model.original.getValue() : this.originalEditor.getValue();
    const modText = this.model ? this.model.modified.getValue() : this.modifiedEditor.getValue();
    const maxBytes = (this.options.maxFileSize ?? 50) * 1024 * 1024;
    if (origText.length + modText.length > maxBytes) {
      this.diffResult = { identical: origText === modText, quitEarly: true, changes: [], moves: [], addedCount: 0, removedCount: 0 };
    } else {
      this.diffResult = computeDiff(origText, modText, {
        ignoreTrimWhitespace: this.options.ignoreTrimWhitespace ?? true,
        maxComputationTime: this.options.maxComputationTime ?? 5000,
        diffAlgorithm: this.options.diffAlgorithm ?? 'advanced',
        computeMoves: Boolean(this.options.experimental?.showMoves),
      });
    }

    this.applyVisualsNow();
    this.syncContextKeys();

    if (this.updateListeners.size > 0) {
      const legacy = computeLineDiff(origText, modText);
      const event: DiffUpdateEvent = { ...legacy, ...this.diffResult };
      for (const l of this.updateListeners) {
        try { l(event); } catch { /* */ }
      }
    }
  }

  private applyVisualsNow(): void {
    const changes = this.diffResult?.changes ?? [];
    const added = this.diffResult?.addedCount ?? 0;
    const removed = this.diffResult?.removedCount ?? 0;
    this.dom.summaryEl.textContent = `${changes.length} change${changes.length === 1 ? '' : 's'}  +${added}  -${removed}`;

    const { wt } = resolveDiffColors();
    const opts = this.modifiedEditor.getOptions();
    const fontSize = opts.fontSize ?? this.options.fontSize ?? 13;
    const lineHeight = opts.lineHeight ?? Math.round(fontSize * 1.5);

    applyDiffVisuals({
      originalEditor: this.originalEditor,
      modifiedEditor: this.modifiedEditor,
      changes,
      inlineMode: this.inlineMode,
      renderIndicators: this.options.renderIndicators !== false,
      renderOverviewRuler: this.options.renderOverviewRuler !== false,
      renderMarginRevertIcon: this.options.renderMarginRevertIcon !== false,
      canRevert: this.options.readOnly !== true,
      hideUnchangedRegions: this.options.hideUnchangedRegions,
      theme: wt,
      fontFamily: opts.fontFamily ?? this.options.fontFamily ?? 'monospace',
      fontSize,
      lineHeight,
      state: this.visualState,
      onRevertHunk: (ch) => this.revertHunk(ch),
      onExpandHiddenRegion: (key) => {
        this.visualState.expandedHiddenKeys.add(key);
        this.applyVisualsNow();
      },
    });
    this.renderRevertArrows();
  }

  private renderRevertArrows(): void {
    renderDiffRevertArrows({
      revertGutter: this.dom.revertGutter,
      modifiedEditor: this.modifiedEditor,
      changes: this.diffResult?.changes ?? [],
      visible: !this.inlineMode && this.options.renderMarginRevertIcon !== false && this.options.readOnly !== true,
      onRevert: (ch) => this.revertHunk(ch),
    });
  }

  private revertHunk(ch: ILineChange): void {
    if (this.options.readOnly === true) return;
    const orig = this.originalEditor.getModel();
    const mod = this.modifiedEditor.getModel();
    const origLines: string[] = [];
    if (ch.originalEndLineNumber > 0) {
      for (let ln = ch.originalStartLineNumber; ln <= ch.originalEndLineNumber; ln++) {
        origLines.push(orig.getLineContent(ln));
      }
    }
    const modLines = mod.getLinesContent();
    const startIdx = ch.modifiedEndLineNumber > 0
      ? Math.max(0, ch.modifiedStartLineNumber - 1)
      : Math.max(0, ch.modifiedStartLineNumber);
    const delCount = ch.modifiedEndLineNumber > 0
      ? ch.modifiedEndLineNumber - ch.modifiedStartLineNumber + 1
      : 0;
    modLines.splice(startIdx, delCount, ...origLines);
    const nextText = modLines.join(mod.getEOL?.() ?? '\n');
    this.modifiedEditor.executeEdits('diff.revert', [
      { range: mod.getFullModelRange(), text: nextText },
    ]);
    this.recomputeNow();
  }

  private revealHunk(ch: ILineChange): void {
    const modLine = Math.max(1, ch.modifiedStartLineNumber || 1);
    const origLine = Math.max(1, ch.originalStartLineNumber || 1);
    this.modifiedEditor.revealLineInCenter(modLine);
    if (!this.inlineMode) this.originalEditor.revealLineInCenter(origLine);
    this.modifiedEditor.setPosition(modLine, 1);
  }

  private syncContextKeys(): void {
    const hasChanges = (this.diffResult?.changes.length ?? 0) > 0;
    const origWritable = this.options.originalEditable === true;
    for (const ed of [this.originalEditor, this.modifiedEditor]) {
      ed.setContext('diffEditorInlineMode', this.inlineMode);
      ed.setContext('diffEditorOriginalWritable', origWritable);
      ed.setContext('diffEditorHasChanges', hasChanges);
    }
  }
}
