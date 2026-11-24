import type { BracketColorizer } from '../../common/brackets';
import { computeGutterLayout, type MonoEditorOptions, type RenderMetrics } from '../../common/config/editorOptions';
import type { MonoMenuItem, MonoMenuStyle } from '../../common/config/menuTypes';
import type { MonoEditorTheme } from '../../common/config/themeTypes';
import { SelectionState } from '../../common/core/SelectionState';
import type { IIdentifiedSingleEditOperation, IModelChangedEvent, IMonoTextModel, IPosition, ISelection, MonoDisposable } from '../../common/core/types';
import { DecorationsCollection } from '../../common/decorations/DecorationsCollection';
import { MarkerService } from '../../common/decorations/MarkerService';
import type { IMarker, IMarkerData, IModelDeltaDecoration } from '../../common/decorations/types';
import { registerDefaultLanguages } from '../../common/languages/defaults/registerDefaults';
import { TokenizationSupport } from '../../common/languages/tokenization/TokenizationSupport';
import { FoldingModel } from '../../common/viewModel/FoldingModel';
import type { MonoStickyScrollOptions } from '../../common/viewModel/StickyScroll';
import { CommandService } from '../../platform/commands/CommandService';
import type { MonoAction, MonoCommandHandler, MonoRegisteredCommand } from '../../platform/commands/types';
import { KeybindingService, type MonoKeybinding } from '../../platform/keybindings/KeybindingService';
import { PaletteService } from '../../platform/palette/PaletteService';
import { monoThemeService, registerBuiltinThemes } from '../../platform/theme';
import type { InputController } from '../input/InputController';
import { PointerController } from '../input/pointer/PointerController';
import type { CanvasRenderer } from '../render/CanvasRenderer';
import type { ViewController } from '../view/ViewController';
import type { HandleVisibility } from '../view/viewParts/HandleVisibility';
import type { MinimapController } from '../view/viewParts/MinimapController';
import type { OverlayScrollbar } from '../view/viewParts/OverlayScrollbar';
import { clampPosition, rangeToISelection, revealLineInCenterImpl, revealPositionImpl } from './cursorApi';
import { registerCoreKeybindingsAndActions, syncEditorScrollbar } from './defaultKeybindings';
import { buildContributionHost, createEditorSubsystems, createInitialOptionState, createRootDom } from './editorBootstrap';
import { getEditorContributions } from './editorContributions';
import { EditorEventBus } from './editorEvents';
import {
  applyEditorOptionsPatch, attachRootDomListeners, dispatchPointerInteraction,
  resolveEditorWidgetTheme, resolveNamedOrPartialTheme, restoreModelViewState, type EditorOptionState,
} from './editorLifecycle';
import {
  ContributionIds, type IContextMenuContribution, type ICursorPositionChangedEvent,
  type ICursorSelectionChangedEvent, type IEditorContribution, type IFindContribution,
  type IFoldingContribution, type IMonoEditor, type IMonoEditorAction, type IScrollEvent,
  type MonoContentChangeEvent,
} from './editorTypes';
import { ModelController } from './modelController';

const activeEditors = new Set<MonoEditor>();
export function getActiveMonoEditors(): IMonoEditor[] { return [...activeEditors]; }

/** Thin Monaco-style composition root (<= 400 lines). */
export class MonoEditor implements IMonoEditor {
  private readonly root: HTMLDivElement;
  private readonly modelCtrl: ModelController;
  private readonly selection = new SelectionState();
  private readonly renderer: CanvasRenderer;
  private readonly view: ViewController;
  private readonly input: InputController;
  private readonly pointer: PointerController;
  private readonly tokenization = new TokenizationSupport();
  private readonly keybindings = new KeybindingService();
  private readonly commands: CommandService;
  private readonly palette: PaletteService;
  private readonly decorations = new DecorationsCollection();
  private readonly markers = new MarkerService();
  private readonly folding: FoldingModel;
  private readonly scrollbar: OverlayScrollbar;
  private readonly minimap: MinimapController;
  private readonly bracketColorizer: BracketColorizer;
  private readonly handleVis: HandleVisibility;
  private readonly events = new EditorEventBus();
  private readonly contributions = new Map<string, IEditorContribution>();
  private readonly opts: EditorOptionState;
  private readonly isPeekEditor: boolean;
  private readonly ro: ResizeObserver;
  private readonly detachDomListeners: () => void;
  private themeUnsub: MonoDisposable | null = null;
  private unsubModel: () => void;
  private lastScrollTop = 0;
  private lastScrollLeft = 0;
  private disposed = false;

  constructor(host: HTMLElement, options: MonoEditorOptions = {}) {
    registerDefaultLanguages();
    registerBuiltinThemes();
    this.isPeekEditor = !!options._isPeekEditor;
    if (!this.isPeekEditor) activeEditors.add(this);

    this.opts = createInitialOptionState(options);
    this.modelCtrl = new ModelController({
      sharedTextModel: options._sharedTextModel, externalModel: options.model,
      value: options.value, language: options.language, undoGroupIdleMs: options.undoGroupIdleMs,
    });
    this.folding = new FoldingModel(this.modelCtrl.model);
    this.modelCtrl.attachSelectionCapture(this.selection);

    const { root, canvas } = createRootDom(host, this.opts.theme.background);
    this.root = root;
    this.commands = new CommandService(this.keybindings);
    this.palette = new PaletteService(this.commands);
    this.commands.setContext('editorReadonly', this.opts.readOnly);

    const sub = createEditorSubsystems({
      root, canvas, options, opts: this.opts, overscan: options.overscan ?? 3, isPeekEditor: this.isPeekEditor,
      modelCtrl: this.modelCtrl, selection: this.selection, tokenization: this.tokenization,
      folding: this.folding, decorations: this.decorations, markers: this.markers, contributions: this.contributions,
      getMetrics: (renderer) => this.metrics(renderer),
      onScrollCommit: (top, left) => { this.lastScrollTop = this.view.scrollTop; this.lastScrollLeft = this.view.scrollLeft; this.emitScrollEvent(top, left); },
      onSyncScrollbar: (active) => this.syncScrollbar(active),
      onInputComplete: (ev) => {
        this.view.ensureCaretVisible(); this.syncTextarea(); this.view.paint();
        if (ev.kind === 'composition') { for (const c of this.contributions.values()) c.onInputChange?.(ev); return; }
        this.emitContent();
        this.emitCursorEvents('keyboard', (ev.kind === 'type' && Boolean(ev.text)) || ev.kind === 'backspace');
        for (const c of this.contributions.values()) c.onInputChange?.(ev);
      },
    });
    this.renderer = sub.renderer; this.view = sub.view; this.scrollbar = sub.scrollbar;
    this.minimap = sub.minimap; this.handleVis = sub.handleVis; this.input = sub.input; this.bracketColorizer = sub.bracketColorizer;
    this.input.setKeybindingService(this.keybindings);

    registerCoreKeybindingsAndActions({
      getModel: () => this.modelCtrl.model, selection: this.selection, view: this.view,
      keybindings: this.keybindings, commands: this.commands, isReadOnly: () => this.opts.readOnly,
      getTabSize: () => this.opts.tabSize,
      getLanguageIdAtPosition: (ln, col) => this.tokenization.getLanguageIdAtPosition(this.modelCtrl.model, ln, col),
      syncTextarea: () => this.syncTextarea(), emitContent: () => this.emitContent(), emitCursorEvents: (src) => this.emitCursorEvents(src),
      applyStackSelection: (e, m) => this.modelCtrl.applyStackSelection(this.selection, e, m),
    });

    const contribHost = buildContributionHost({
      editor: this, root: this.root, view: this.view, input: this.input, selection: this.selection,
      commands: this.commands, keybindings: this.keybindings, folding: this.folding, tokenization: this.tokenization,
      markers: this.markers, minimap: this.minimap, modelCtrl: this.modelCtrl, opts: this.opts,
      isPeekEditor: this.isPeekEditor, initialOptions: options, contributions: this.contributions,
      isDisposed: () => this.disposed, getMetrics: () => this.metrics(), syncTextarea: () => this.syncTextarea(),
      emitContent: () => this.emitContent(), emitCursorEvents: (s, k) => this.emitCursorEvents(s, k),
      createNestedEditor: (c, m, extra) => new MonoEditor(c, { _sharedTextModel: m, _isPeekEditor: true, ...extra }),
    });
    for (const desc of getEditorContributions()) this.contributions.set(desc.id, desc.factory(contribHost));
    this.applyAllWidgetThemes();

    this.themeUnsub = monoThemeService.onDidChangeColorTheme(() => {
      if (this.disposed) return;
      this.opts.theme = { ...this.opts.theme, ...monoThemeService.toPartialEditorTheme() };
      this.root.style.background = this.opts.theme.background;
      this.applyAllWidgetThemes(); this.view.paint();
    });

    this.pointer = new PointerController(
      this.root, this.modelCtrl.model, this.selection, this.view, () => this.metrics(),
      () => this.renderer.lastTeardrops,
      (kind) => dispatchPointerInteraction(kind, {
        view: this.view, input: this.input, selection: this.selection, commands: this.commands,
        handleVis: this.handleVis, contributions: this.contributions.values(),
        pushStackElement: () => this.modelCtrl.model.pushStackElement(),
        syncTextarea: () => this.syncTextarea(), emitCursorEvents: (s) => this.emitCursorEvents(s),
        onScrollDelta: () => this.flushScrollDelta(),
      }),
      (ln) => this.toggleFoldAtLine(ln),
      (hit) => { for (const c of this.contributions.values()) c.onColorSwatchClick?.(hit); },
    );

    this.detachDomListeners = attachRootDomListeners({
      root: this.root, textarea: this.input.textarea, isDisposed: () => this.disposed,
      getContributions: () => this.contributions.values(), dispatchKeybinding: (e) => this.keybindings.dispatch(e),
      onOutsidePointerDown: () => { this.input.blur(); for (const c of this.contributions.values()) c.onOutsidePointerDown?.(); },
      onWheelScroll: (dx, dy) => {
        for (const c of this.contributions.values()) c.onPointerInteract?.('scroll');
        this.handleVis.onScrollStart(); this.view.scrollBy(dx, dy); this.flushScrollDelta();
      },
      onWheelEnd: () => { this.handleVis.onScrollEnd(); for (const c of this.contributions.values()) c.onScrollEnd?.(); },
    });

    this.unsubModel = this.subscribeActiveModel();
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(this.root);
    requestAnimationFrame(() => { this.layout(); this.syncTextarea(); });
    if (options.readOnly) this.input.textarea.readOnly = true;
  }

  getContribution<T extends IEditorContribution>(id: string): T | undefined { return this.contributions.get(id) as T | undefined; }
  getValue(): string { return this.modelCtrl.model.getValue(); }
  setValue(value: string): void {
    this.modelCtrl.model.setValue(value); this.folding.updateSync(); this.folding.unfoldAll();
    this.view.invalidateScopes(); this.selection.setCaret(1, 1); this.view.scrollTop = 0; this.view.scrollLeft = 0;
    this.view.paint(); this.syncTextarea(); this.emitContent();
  }
  getLanguageId(): string { return this.modelCtrl.model.getLanguageId(); }
  setLanguageId(id: string): void {
    this.modelCtrl.model.setLanguageId(id); this.tokenization.invalidate(); this.bracketColorizer.setLanguageId(id);
    this.folding.updateSync(); this.view.invalidateScopes(); this.view.paint();
  }
  getModelVersionId(): number { return this.modelCtrl.model.getVersionId(); }
  getAlternativeVersionId(): number { return this.events.altVersionId; }
  pushUndoStop(): boolean { this.modelCtrl.model.pushStackElement(); return true; }
  getModel(): IMonoTextModel {
    return this.modelCtrl.getModelFacade(() => this.events.altVersionId, () => { this.view.paint(); this.emitContent(); }, () => this.emitContent());
  }
  setModel(nextModel: IMonoTextModel | null): void {
    if (this.disposed) return;
    this.modelCtrl.saveViewState(this.view.scrollTop, this.view.scrollLeft, this.selection, this.folding);
    this.view.setViewZone(null); this.unsubModel();
    const { oldUri, newUri, saved } = this.modelCtrl.swapModel(nextModel);
    const m = this.modelCtrl.model;
    this.modelCtrl.attachSelectionCapture(this.selection);
    this.folding.setModel(m); this.view.setModel(m); this.minimap.setModel(m); this.input.setModel(m); this.pointer.setModel(m);
    this.tokenization.invalidate(); this.bracketColorizer.setLanguageId(m.getLanguageId()); this.bracketColorizer.invalidateAll();
    for (const c of this.contributions.values()) c.onModelChange?.(m);
    restoreModelViewState({ saved, model: m, folding: this.folding, view: this.view, selection: this.selection, clampPos: (l, c) => clampPosition(m, l, c) });
    this.unsubModel = this.subscribeActiveModel();
    this.view.clampScrollPublic(); this.view.paint(); this.syncTextarea();
    this.emitCursorEvents('model'); this.events.emitModelChanged({ oldModelUrl: oldUri, newModelUrl: newUri });
  }
  onDidChangeModel(listener: (e: IModelChangedEvent) => void): MonoDisposable { return this.events.onDidChangeModel(listener); }
  executeEdits(source: string | null | undefined, edits: IIdentifiedSingleEditOperation[]): boolean {
    if (!this.modelCtrl.executeEdits(this.selection, this.opts.readOnly, edits)) return false;
    this.events.altVersionId++; this.view.ensureCaretVisible(); this.syncTextarea(); this.view.paint();
    this.emitContent(); this.emitCursorEvents(source || 'executeEdits'); return true;
  }

  getPosition(): IPosition { return { lineNumber: this.selection.active.lineNumber, column: this.selection.active.column }; }
  setPosition(positionOrLine: IPosition | number, column?: number): void {
    const raw = typeof positionOrLine === 'number' ? { lineNumber: positionOrLine, column: column ?? 1 } : positionOrLine;
    const pos = clampPosition(this.modelCtrl.model, raw.lineNumber, raw.column);
    if (this.folding.isLineHidden(pos.lineNumber)) { this.folding.unfoldContaining(pos.lineNumber); this.view.projection.invalidate(); }
    this.selection.setCaret(pos.lineNumber, pos.column); this.view.ensureCaretVisible(); this.syncTextarea(); this.view.paint();
    this.emitCursorEvents('api');
  }
  getSelection(): ISelection { return rangeToISelection(this.selection.anchor, this.selection.active); }
  setSelection(sel: ISelection): void { this.setSelections([sel]); }
  getSelections(): ISelection[] { return this.selection.selections.map((s) => rangeToISelection(s.anchor, s.active)); }
  setSelections(sels: ISelection[]): void {
    if (!sels.length) return;
    const next = sels.map((sel) => {
      const a = clampPosition(this.modelCtrl.model, sel.selectionStartLineNumber ?? sel.startLineNumber, sel.selectionStartColumn ?? sel.startColumn);
      const b = clampPosition(this.modelCtrl.model, sel.positionLineNumber ?? sel.endLineNumber, sel.positionColumn ?? sel.endColumn);
      if (this.folding.isLineHidden(a.lineNumber)) this.folding.unfoldContaining(a.lineNumber);
      if (this.folding.isLineHidden(b.lineNumber)) this.folding.unfoldContaining(b.lineNumber);
      return { anchor: a, active: b };
    });
    this.view.projection.invalidate();
    if (next.length === 1) { this.selection.anchor = next[0]!.anchor; this.selection.active = next[0]!.active; }
    else this.selection.setSelections(next);
    this.view.ensureCaretVisible(); this.syncTextarea(); this.view.paint(); this.emitCursorEvents('api');
  }

  revealLine(lineNumber: number, _scrollType?: number): void { this.revealPosition({ lineNumber, column: 1 }, _scrollType); }
  revealLineInCenter(lineNumber: number): void { revealLineInCenterImpl(this.revealCtx(), lineNumber); }
  revealPosition(position: IPosition, _scrollType?: number): void { revealPositionImpl(this.revealCtx(), position); }
  revealPositionInCenter(position: IPosition): void { this.revealLineInCenter(position.lineNumber); this.revealPosition(position); }
  revealRange(range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }): void { this.revealPosition({ lineNumber: range.startLineNumber, column: range.startColumn }); }
  getScrollTop(): number { return this.view.scrollTop; }
  setScrollTop(scrollTop: number): void {
    const prev = this.view.scrollTop; this.view.scrollTop = Math.max(0, scrollTop); this.view.clampScrollPublic();
    this.lastScrollTop = this.view.scrollTop;
    if (Math.abs(this.view.scrollTop - prev) > 0.01) { this.emitScrollEvent(true, false); this.view.schedulePaint(); }
  }
  getScrollLeft(): number { return this.view.scrollLeft; }
  setScrollLeft(scrollLeft: number): void {
    const prev = this.view.scrollLeft; this.view.scrollLeft = Math.max(0, scrollLeft); this.view.clampScrollPublic();
    this.lastScrollLeft = this.view.scrollLeft;
    if (Math.abs(this.view.scrollLeft - prev) > 0.01) { this.emitScrollEvent(false, true); this.view.schedulePaint(); }
  }

  focus(): void { this.syncTextarea(); this.input.focus(); this.events.emitFocus(); }
  blur(): void { this.input.blur(); this.events.emitBlur(); }
  hasTextFocus(): boolean { return document.activeElement === this.input.textarea; }
  layout(): void {
    if (this.disposed) return;
    const rect = this.root.getBoundingClientRect();
    this.view.setSize(rect.width, rect.height); this.minimap.syncLayout(); this.minimap.paint();
    for (const c of this.contributions.values()) c.onLayout?.();
    this.input.setPageSize(Math.max(1, Math.floor(rect.height / Math.max(1, this.metrics().lineHeight)) - 2));
    this.syncTextarea();
  }
  updateOptions(options: Partial<MonoEditorOptions>): void {
    applyEditorOptionsPatch(this.opts, options, {
      root: this.root, modelCtrl: this.modelCtrl, view: this.view, input: this.input, commands: this.commands,
      scrollbar: this.scrollbar, minimap: this.minimap, tokenization: this.tokenization, bracketColorizer: this.bracketColorizer, isPeekEditor: this.isPeekEditor,
      applyAllWidgetThemes: () => this.applyAllWidgetThemes(), setLanguageId: (id) => this.setLanguageId(id),
      setValue: (v) => this.setValue(v), notifyContributions: (p) => { for (const c of this.contributions.values()) c.onOptionsChange?.(p); },
    });
    this.view.paint(); this.syncTextarea();
  }
  setTheme(theme: Partial<MonoEditorTheme> | string): void {
    this.opts.theme = resolveNamedOrPartialTheme(this.opts.theme, theme);
    this.root.style.background = this.opts.theme.background;
    this.applyAllWidgetThemes(); this.view.paint();
  }

  onDidChangeModelContent(l: (e: MonoContentChangeEvent) => void): MonoDisposable { return this.events.onDidChangeModelContent(l); }
  onDidChangeCursorPosition(l: (e: ICursorPositionChangedEvent) => void): MonoDisposable { return this.events.onDidChangeCursorPosition(l); }
  onDidChangeCursorSelection(l: (e: ICursorSelectionChangedEvent) => void): MonoDisposable { return this.events.onDidChangeCursorSelection(l); }
  onDidScrollChange(l: (e: IScrollEvent) => void): MonoDisposable { return this.events.onDidScrollChange(l); }
  onDidFocusEditorText(l: () => void): MonoDisposable { return this.events.onDidFocusEditorText(l); }
  onDidBlurEditorText(l: () => void): MonoDisposable { return this.events.onDidBlurEditorText(l); }
  onDidChangeMarkers(l: (markers: IMarker[]) => void): MonoDisposable { return this.events.onDidChangeMarkers(l); }

  addAction(action: MonoAction): MonoDisposable { return this.commands.addAction(action); }
  registerCommand(id: string, handler: MonoCommandHandler, meta?: Omit<MonoRegisteredCommand, 'id' | 'handler'>): MonoDisposable { return this.commands.registerCommand(id, handler, meta); }
  executeCommand(id: string, ...args: unknown[]): Promise<unknown> {
    if (!this.commands.getCommands().some((c) => c.id === id)) { window.dispatchEvent(new CustomEvent('mono:executeCommand', { detail: { id, args } })); return Promise.resolve(undefined); }
    return this.commands.executeCommand(id, ...args);
  }
  getAction(id: string): IMonoEditorAction | null {
    if (!this.commands.getCommands().some((c) => c.id === id)) return null;
    return { id, label: id, run: async () => { await this.commands.executeCommand(id); }, isSupported: () => true };
  }
  getCommandsForPalette(filter?: string) { return this.commands.getCommandsForPalette(filter); }
  getPaletteService(): PaletteService { return this.palette; }
  setContext(key: string, value: boolean | string | number): void { this.commands.setContext(key, value); }

  deltaDecorations(oldDecorations: string[], newDecorations: IModelDeltaDecoration[]): string[] { const ids = this.decorations.deltaDecorations(oldDecorations, newDecorations); this.view.paint(); return ids; }
  setModelMarkers(owner: string, markers: IMarkerData[]): void {
    this.markers.setModelMarkers(owner, markers); this.view.paint();
    for (const c of this.contributions.values()) c.onMarkersChange?.();
    this.events.emitMarkers(this.markers.getModelMarkers());
  }
  getModelMarkers(filter?: { owner?: string; take?: number }): IMarker[] { return this.markers.getModelMarkers(filter); }

  setContextMenuItems(items: MonoMenuItem[]): void { this.getContribution<IContextMenuContribution>(ContributionIds.ContextMenu)?.setItems(items); }
  addContextMenuItem(item: MonoMenuItem): void { this.getContribution<IContextMenuContribution>(ContributionIds.ContextMenu)?.addItem(item); }
  removeContextMenuItem(id: string): void { this.getContribution<IContextMenuContribution>(ContributionIds.ContextMenu)?.removeItem(id); }
  setContextMenuStyle(style: MonoMenuStyle): void { this.getContribution<IContextMenuContribution>(ContributionIds.ContextMenu)?.setStyle(style); }
  hideContextMenu(): void { this.getContribution<IContextMenuContribution>(ContributionIds.ContextMenu)?.hide(); }
  showContextMenu(): void { this.getContribution<IContextMenuContribution>(ContributionIds.ContextMenu)?.show(); }
  addKeybinding(binding: MonoKeybinding): () => void { return this.keybindings.add(binding); }
  removeKeybinding(id: string): void { this.keybindings.remove(id); }
  listKeybindings(): MonoKeybinding[] { return this.keybindings.list(); }
  setStickyScroll(opts: MonoStickyScrollOptions): void { this.view.setStickyScroll(opts); }
  revealFind(): void { this.getContribution<IFindContribution>(ContributionIds.Find)?.startFind(); }
  revealReplace(): void { this.getContribution<IFindContribution>(ContributionIds.Find)?.startFindReplace(); }
  getFoldedCount(): number { return this.folding.getFoldedCount(); }
  toggleFoldAtLine(lineNumber: number): void { this.getContribution<IFoldingContribution>(ContributionIds.Folding)?.toggleFoldAtLine(lineNumber); }
  foldAll(): void { this.getContribution<IFoldingContribution>(ContributionIds.Folding)?.foldAll(); }
  unfoldAll(): void { this.getContribution<IFoldingContribution>(ContributionIds.Folding)?.unfoldAll(); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; activeEditors.delete(this);
    this.unsubModel(); this.ro.disconnect(); this.detachDomListeners(); this.pointer.dispose();
    for (const c of this.contributions.values()) c.dispose();
    this.contributions.clear(); this.commands.dispose(); this.minimap.dispose(); this.scrollbar.dispose();
    this.view.setViewZone(null); this.view.dispose(); this.input.dispose();
    this.themeUnsub?.dispose(); this.themeUnsub = null;
    this.handleVis.dispose(); this.events.dispose(); this.modelCtrl.dispose(); this.root.remove();
  }

  /** `renderer` is passed explicitly only during bootstrap, before `this.renderer` is assigned. */
  private metrics(renderer: CanvasRenderer = this.renderer): RenderMetrics {
    const charWidth = renderer.measureCharWidth(`${this.opts.fontSize}px ${this.opts.fontFamily}`);
    const { gutterWidth, foldGutterWidth, gutterNumberPad } = computeGutterLayout({
      lineNumbers: this.opts.lineNumbers, foldingEnabled: this.opts.foldingEnabled,
      lineNumbersMinChars: this.opts.lineNumbersMinChars, lineCount: this.modelCtrl.model.getLineCount(), charWidth,
    });
    return { fontFamily: this.opts.fontFamily, fontSize: this.opts.fontSize, lineHeight: this.opts.lineHeight, gutterWidth, foldGutterWidth, gutterNumberPad, charWidth, paddingLeft: 8, paddingTop: 4 };
  }
  private revealCtx() {
    return {
      model: this.modelCtrl.model, selection: this.selection, folding: this.folding, view: this.view,
      metrics: () => this.metrics(), showLineNumbers: () => this.opts.lineNumbers,
      onScrollChanged: (top: boolean, left: boolean) => { this.lastScrollTop = this.view.scrollTop; this.lastScrollLeft = this.view.scrollLeft; this.emitScrollEvent(top, left); },
    };
  }
  private subscribeActiveModel(): () => void {
    return this.modelCtrl.model.onDidChange((versionId, change) => {
      this.tokenization.applyChange(change, versionId);
      if (!change || change.full) this.bracketColorizer.invalidateAll();
      else this.bracketColorizer.applyChange(change.startLine, change.newLineCount - change.oldLineCount, versionId);
      this.folding.updateSync();
      if (this.folding.isLineHidden(this.selection.active.lineNumber)) this.folding.unfoldContaining(this.selection.active.lineNumber);
      for (const c of this.contributions.values()) c.onModelContentChange?.(versionId);
      this.view.invalidateScopes(); this.view.paint();
    });
  }
  private flushScrollDelta(): void {
    const top = Math.abs(this.view.scrollTop - this.lastScrollTop) > 0.01, left = Math.abs(this.view.scrollLeft - this.lastScrollLeft) > 0.01;
    this.lastScrollTop = this.view.scrollTop; this.lastScrollLeft = this.view.scrollLeft;
    if (top || left) this.emitScrollEvent(top, left);
  }
  private applyAllWidgetThemes(): void { const wt = resolveEditorWidgetTheme(this.opts.theme); this.minimap.applyTheme(wt); for (const c of this.contributions.values()) c.onThemeChange?.(wt, this.opts.theme); }
  private syncScrollbar(activeScroll: boolean, activeAxes?: { vertical?: boolean; horizontal?: boolean }): void {
    if (this.disposed) return;
    syncEditorScrollbar({
      scrollbar: this.scrollbar, theme: this.opts.theme, model: this.modelCtrl.model, view: this.view,
      markers: this.markers.getModelMarkers(), findMatches: this.getContribution<IFindContribution>(ContributionIds.Find)?.getMatches() ?? [],
      rightInset: this.minimap.getWidth(), activeScroll, activeAxes,
    });
  }
  private syncTextarea(): void { const p = this.view.caretScreenPos(); this.input.moveTo(p.x, p.y, p.h); }
  private emitContent(): void { this.events.emitContent(this.modelCtrl.model); }
  private emitCursorEvents(source: string, keepSuggest = false): void {
    for (const c of this.contributions.values()) c.onCursorChange?.(source, keepSuggest);
    this.events.emitCursor(this.modelCtrl.model, this.selection, this.getPosition(), this.getSelections(), this.getSelection(), source);
    this.commands.setContext('editorHasSelection', !this.selection.isEmpty);
  }
  private emitScrollEvent(topChanged: boolean, leftChanged: boolean): void {
    for (const c of this.contributions.values()) c.onScroll?.();
    this.syncScrollbar(true, { vertical: topChanged, horizontal: leftChanged });
    this.events.emitScroll({ scrollTop: this.view.scrollTop, scrollLeft: this.view.scrollLeft, scrollWidth: this.view.getScrollWidth(), scrollHeight: this.view.getScrollHeight(), scrollTopChanged: topChanged, scrollLeftChanged: leftChanged });
  }
}
