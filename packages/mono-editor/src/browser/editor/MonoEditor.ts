import type { BracketColorizer } from '../../common/brackets';
import type { MonoEditorOptions, RenderMetrics } from '../../common/config/editorOptions';
import type { MonoMenuItem, MonoMenuStyle } from '../../common/config/menuTypes';
import type { MonoEditorTheme } from '../../common/config/themeTypes';
import { SelectionState } from '../../common/core/SelectionState';
import type {
  IContentSizeChangedEvent, IContentWidget, IContextKey, ICursorStateComputer, IDimension,
  IEditorLayoutInfo, IEditorMouseEvent, IEditorViewState, IIdentifiedSingleEditOperation,
  IModelChangedEvent, IModelDecorationsChangedEvent, IModelLanguageChangedEvent,
  IModelOptionsChangedEvent, IMonoTextModel, IMouseTarget, IOverlayWidget, IPasteEvent,
  IPosition, IRange, ISelection, IViewZoneChangeAccessor, MonoDisposable,
} from '../../common/core/types';
import { DecorationsCollection } from '../../common/decorations/DecorationsCollection';
import { MarkerService } from '../../common/decorations/MarkerService';
import type { IEditorDecorationsCollection, IMarker, IMarkerData, IModelDeltaDecoration } from '../../common/decorations/types';
import { registerDefaultLanguages } from '../../common/languages/defaults/registerDefaults';
import { languageFeatures } from '../../common/languages/languageFeaturesService';
import type { DocumentSymbol, GhostTextItem, IInlayHintClickEvent } from '../../common/languages/providers/types';
import { TokenizationSupport } from '../../common/languages/tokenization/TokenizationSupport';
import { DocumentStructureService } from '../../common/structure/StructureBuilder';
import { FoldingModel } from '../../common/viewModel/FoldingModel';
import type { MonoStickyScrollOptions } from '../../common/viewModel/StickyScroll';
import { CommandService } from '../../platform/commands/CommandService';
import type { MonoAction, MonoCommandHandler, MonoRegisteredCommand } from '../../platform/commands/types';
import { KeybindingService, MonoCommands, type MonoKeybinding } from '../../platform/keybindings/KeybindingService';
import { PaletteService } from '../../platform/palette/PaletteService';
import { monoThemeService, registerBuiltinThemes } from '../../platform/theme';
import type { InputController } from '../input/InputController';
import type { PointerController } from '../input/pointer/PointerController';
import type { CanvasRenderer } from '../render/CanvasRenderer';
import type { ViewController } from '../view/ViewController';
import type { EditorWidgetManager } from '../view/WidgetManagers';
import type { HandleVisibility } from '../view/viewParts/HandleVisibility';
import type { MinimapController } from '../view/viewParts/MinimapController';
import type { OverlayScrollbar } from '../view/viewParts/OverlayScrollbar';
import { clampPosition, rangeToISelection, revealLineInCenterImpl, revealLinesImpl, revealLinesInCenterImpl, revealPositionImpl, revealRangeImpl, revealRangeInCenterImpl, setScrollPositionImpl, setSelectionsImpl } from './cursorApi';
import { registerCoreKeybindingsAndActions, syncEditorScrollbar } from './defaultKeybindings';
import { buildContributionHost, createEditorPointer, createEditorSubsystems, createInitialOptionState, createRootDom } from './editorBootstrap';
import { getEditorContributions } from './editorContributions';
import { EditorEventBus } from './editorEvents';
import { applyEditorOptionsPatch, attachRootDomListeners, resolveEditorWidgetTheme, resolveNamedOrPartialTheme, restoreModelViewState, type EditorOptionState } from './editorLifecycle';
import { ContributionIds, type IBreadcrumbsContribution, type IContextMenuContribution, type ICursorPositionChangedEvent, type ICursorSelectionChangedEvent, type IDocumentSymbolsContribution, type IEditorContribution, type IFindContribution, type IFoldingContribution, type IGoToLineRequestEvent, type IInlineSuggestContribution, type IMonoEditor, type IMonoEditorAction, type IPasteEditContribution, type IScrollEvent, type MonoContentChangeEvent } from './editorTypes';
import { computeEditorLayoutInfo, computeEditorMetrics, createEditorContextKey, createEditorDecorationsCollection, getEditorActionById, getEditorOptionByName, getResolvedEditorOptions, listSupportedEditorActions, notifyMonoEditorCreated, restoreEditorViewState, saveEditorViewState, subscribeActiveTextModel } from './editorViewFacade';
import { ModelController } from './modelController';

let nextEditorId = 1;
const activeEditors = new Set<MonoEditor>();
export function getActiveMonoEditors(): IMonoEditor[] { return [...activeEditors]; }

/** Thin Monaco-style composition root (<= 400 lines). */
export class MonoEditor implements IMonoEditor {
  private readonly id = `mono.editor.${nextEditorId++}`;
  private readonly container: HTMLElement; private readonly root: HTMLDivElement;
  private readonly modelCtrl: ModelController; private readonly selection = new SelectionState();
  private readonly renderer: CanvasRenderer; private readonly view: ViewController;
  private readonly widgets: EditorWidgetManager; private readonly input: InputController;
  private readonly pointer: PointerController; private readonly tokenization = new TokenizationSupport();
  private readonly keybindings = new KeybindingService(); private readonly commands: CommandService;
  private readonly palette: PaletteService; private readonly decorations = new DecorationsCollection();
  private readonly markers = new MarkerService(); private readonly folding: FoldingModel; private readonly structure: DocumentStructureService;
  private readonly scrollbar: OverlayScrollbar; private readonly minimap: MinimapController;
  private readonly bracketColorizer: BracketColorizer; private readonly handleVis: HandleVisibility;
  private readonly events = new EditorEventBus(); private readonly contributions = new Map<string, IEditorContribution>();
  private readonly opts: EditorOptionState; private readonly isPeekEditor: boolean;
  private readonly ro: ResizeObserver; private readonly detachDomListeners: () => void;
  private themeUnsub: MonoDisposable | null = null; private unsubModel: () => void;
  private lastScrollTop = 0; private lastScrollLeft = 0; private lastContentW = 0; private lastContentH = 0; private disposed = false;

  constructor(host: HTMLElement, options: MonoEditorOptions = {}) {
    registerDefaultLanguages(); registerBuiltinThemes();
    this.container = host; this.isPeekEditor = !!options._isPeekEditor;
    if (!this.isPeekEditor) activeEditors.add(this);
    this.opts = createInitialOptionState(options);
    this.modelCtrl = new ModelController({
      sharedTextModel: options._sharedTextModel, externalModel: options.model,
      value: options.value, language: options.language, undoGroupIdleMs: options.undoGroupIdleMs,
      tabSize: this.opts.tabSize, insertSpaces: this.opts.insertSpaces,
      trimAutoWhitespace: this.opts.trimAutoWhitespace, detectIndentation: this.opts.detectIndentation,
    });
    const mOpts = this.modelCtrl.model.getOptions();
    this.opts.tabSize = mOpts.tabSize; this.opts.insertSpaces = mOpts.insertSpaces;
    languageFeatures.fireLanguageActivated(this.modelCtrl.model.getLanguageId());
    this.structure = new DocumentStructureService(this.modelCtrl.model, (ln) => this.tokenization.getLineTokens(this.modelCtrl.model, ln));
    this.folding = new FoldingModel(this.modelCtrl.model);
    this.folding.setStructureRangesProvider(() => this.structure.getFoldingRanges()); this.folding.setStrategy(this.opts.foldingStrategy); this.folding.updateSync();
    this.modelCtrl.attachSelectionCapture(this.selection);
    const { root, canvas } = createRootDom(host, this.opts.theme.background);
    this.root = root; this.commands = new CommandService(this.keybindings); this.palette = new PaletteService(this.commands);
    this.commands.setContext('editorReadonly', this.opts.readOnly);
    const onPasteDone = (range: IRange) => {
      this.events.emitPaste({ range, languageId: this.modelCtrl.model.getLanguageId() });
      if (this.opts.formatOnPaste && !this.opts.readOnly) void this.executeCommand(MonoCommands.FormatDocument);
    };
    const sub = createEditorSubsystems({
      root, canvas, options, opts: this.opts, overscan: options.overscan ?? 3, isPeekEditor: this.isPeekEditor,
      modelCtrl: this.modelCtrl, selection: this.selection, tokenization: this.tokenization,
      folding: this.folding, decorations: this.decorations, markers: this.markers, contributions: this.contributions,
      getMetrics: (r) => this.metrics(r),
      onScrollCommit: (t, l) => { this.lastScrollTop = this.view.scrollTop; this.lastScrollLeft = this.view.scrollLeft; this.emitScrollEvent(t, l); },
      onSyncScrollbar: (active) => this.syncScrollbar(active),
      onCompositionStart: () => this.events.emitCompositionStart(), onCompositionEnd: () => this.events.emitCompositionEnd(),
      onDidPaste: onPasteDone, onKeyDownEvent: (e) => this.events.emitKeyDown(e), onKeyUpEvent: (e) => this.events.emitKeyUp(e),
      onTextFocus: () => { this.commands.setContext('editorFocus', true); this.commands.setContext('editorTextFocus', true); this.commands.setContext('textInputFocus', true); this.events.emitFocus(); },
      onTextBlur: () => { this.commands.setContext('editorFocus', false); this.commands.setContext('editorTextFocus', false); this.commands.setContext('textInputFocus', false); this.events.emitBlur(); },
      onInputComplete: (ev) => {
        this.view.ensureCaretVisible(); this.syncTextarea(); this.view.paint();
        if (ev.kind === 'composition') { for (const c of this.contributions.values()) c.onInputChange?.(ev); return; }
        this.emitContent(); this.emitCursorEvents('keyboard', (ev.kind === 'type' && Boolean(ev.text)) || ev.kind === 'backspace');
        for (const c of this.contributions.values()) c.onInputChange?.(ev);
      },
    });
    this.renderer = sub.renderer; this.view = sub.view; this.widgets = sub.widgets;
    this.scrollbar = sub.scrollbar; this.minimap = sub.minimap; this.handleVis = sub.handleVis;
    this.input = sub.input; this.bracketColorizer = sub.bracketColorizer;
    this.input.setKeybindingService(this.keybindings);
    const tryPaste = async (text: string) => (await this.getContribution<IPasteEditContribution>(ContributionIds.PasteEdit)?.tryHandlePaste(text)) ?? false;
    this.input.setPasteInterceptor(tryPaste);
    registerCoreKeybindingsAndActions({
      getModel: () => this.modelCtrl.model, selection: this.selection, view: this.view,
      keybindings: this.keybindings, commands: this.commands, isReadOnly: () => this.opts.readOnly,
      getTabSize: () => this.opts.tabSize, getInsertSpaces: () => this.opts.insertSpaces,
      getEmptySelectionClipboard: () => this.opts.emptySelectionClipboard, getMultiCursorPaste: () => this.opts.multiCursorPaste, getNativePasteSeq: () => this.input.getNativePasteSeq(), onBeforePaste: tryPaste, onAfterPaste: onPasteDone,
      onSyncIndentOptions: (sp, ts) => { this.opts.insertSpaces = sp; this.opts.tabSize = ts; this.input.setInsertSpaces(sp); this.input.setTabSize(ts); this.view.setTabSize(ts); },
      getLanguageIdAtPosition: (ln, col) => this.tokenization.getLanguageIdAtPosition(this.modelCtrl.model, ln, col),
      syncTextarea: () => this.syncTextarea(), emitContent: () => this.emitContent(), emitCursorEvents: (src) => this.emitCursorEvents(src),
      applyStackSelection: (e, m) => this.modelCtrl.applyStackSelection(this.selection, e, m),
    });
    const contribHost = buildContributionHost({
      editor: this, root: this.root, view: this.view, widgets: this.widgets, input: this.input, selection: this.selection,
      commands: this.commands, keybindings: this.keybindings, folding: this.folding, structure: this.structure, tokenization: this.tokenization,
      markers: this.markers, minimap: this.minimap, modelCtrl: this.modelCtrl, opts: this.opts,
      isPeekEditor: this.isPeekEditor, initialOptions: options, contributions: this.contributions, events: this.events,
      isDisposed: () => this.disposed, getMetrics: () => this.metrics(), syncTextarea: () => this.syncTextarea(),
      emitContent: () => this.emitContent(), emitCursorEvents: (s, k) => this.emitCursorEvents(s, k),
      createNestedEditor: (c, m, extra) => new MonoEditor(c, { _sharedTextModel: m, _isPeekEditor: true, ...extra }),
    });
    for (const desc of getEditorContributions()) this.contributions.set(desc.id, desc.factory(contribHost));
    this.applyAllWidgetThemes();
    this.themeUnsub = monoThemeService.onDidChangeColorTheme(() => {
      if (this.disposed) return;
      this.opts.theme = { ...this.opts.theme, ...monoThemeService.toPartialEditorTheme() };
      this.root.style.background = this.opts.theme.background; this.applyAllWidgetThemes(); this.view.paint();
    });
    this.pointer = createEditorPointer({
      root: this.root, modelCtrl: this.modelCtrl, selection: this.selection, view: this.view, renderer: this.renderer,
      input: this.input, commands: this.commands, handleVis: this.handleVis, events: this.events, opts: this.opts,
      contributions: this.contributions, getMetrics: () => this.metrics(), syncTextarea: () => this.syncTextarea(),
      emitCursorEvents: (s) => this.emitCursorEvents(s), onScrollDelta: () => this.flushScrollDelta(),
      toggleFoldAtLine: (ln) => this.toggleFoldAtLine(ln), updateFontSize: (fontSize) => this.updateOptions({ fontSize }),
    });
    this.detachDomListeners = attachRootDomListeners({
      root: this.root, textarea: this.input.textarea, isDisposed: () => this.disposed,
      getContributions: () => this.contributions.values(), dispatchKeybinding: (e) => this.keybindings.dispatchDetailed(e),
      onOutsidePointerDown: () => { this.input.blur(); this.view.setCursorFocused(false); for (const c of this.contributions.values()) c.onOutsidePointerDown?.(); },
      onWheelScroll: (dx, dy) => { for (const c of this.contributions.values()) c.onPointerInteract?.('scroll'); this.handleVis.onScrollStart(); this.view.scrollBy(dx, dy); this.flushScrollDelta(); },
      onWheelEnd: () => { this.handleVis.onScrollEnd(); for (const c of this.contributions.values()) c.onScrollEnd?.(); },
    });
    this.unsubModel = this.subscribeActiveModel();
    this.ro = new ResizeObserver(() => this.layout()); this.ro.observe(this.root);
    requestAnimationFrame(() => { this.layout(); this.syncTextarea(); });
    if (options.readOnly) this.input.textarea.readOnly = true;
    if (!this.isPeekEditor) notifyMonoEditorCreated(this);
  }

  getId() { return this.id; }
  getEditorType() { return 'vs.editor.ICodeEditor'; }
  getDomNode() { return this.disposed ? null : this.root; }
  getContainerDomNode() { return this.container; }
  getContribution<T extends IEditorContribution>(id: string): T | undefined { return this.contributions.get(id) as T | undefined; }
  getValue() { return this.modelCtrl.model.getValue(); }
  setValue(value: string) {
    this.modelCtrl.model.setValue(value); this.structure.invalidate(); this.folding.updateSync(); this.folding.unfoldAll();
    this.view.invalidateScopes(); this.selection.setCaret(1, 1); this.view.scrollTop = 0; this.view.scrollLeft = 0;
    this.view.paint(); this.syncTextarea(); this.emitContent();
  }
  getLanguageId() { return this.modelCtrl.model.getLanguageId(); }
  setLanguageId(id: string) {
    this.modelCtrl.model.setLanguageId(id); languageFeatures.fireLanguageActivated(id);
    this.tokenization.invalidate(); this.bracketColorizer.setLanguageId(id); this.structure.invalidate(); this.folding.updateSync(); this.view.invalidateScopes(); this.view.paint();
  }
  getModelVersionId() { return this.modelCtrl.model.getVersionId(); }
  getAlternativeVersionId() { return this.events.altVersionId; }
  pushUndoStop() { this.modelCtrl.model.pushStackElement(); return true; }
  getModel(): IMonoTextModel { return this.modelCtrl.getModelFacade(() => this.events.altVersionId, () => { this.view.paint(); this.emitContent(); }, () => this.emitContent()); }
  setModel(nextModel: IMonoTextModel | null) {
    if (this.disposed) return;
    this.modelCtrl.saveViewState(this.view.scrollTop, this.view.scrollLeft, this.selection, this.folding);
    this.view.setViewZone(null); this.unsubModel();
    const { oldUri, newUri, saved } = this.modelCtrl.swapModel(nextModel);
    const m = this.modelCtrl.model;
    languageFeatures.fireLanguageActivated(m.getLanguageId()); this.modelCtrl.attachSelectionCapture(this.selection);
    this.structure.setModel(m); this.folding.setModel(m); this.view.setModel(m); this.minimap.setModel(m); this.input.setModel(m); this.pointer.setModel(m);
    this.tokenization.invalidate(); this.bracketColorizer.setLanguageId(m.getLanguageId()); this.bracketColorizer.invalidateAll();
    for (const c of this.contributions.values()) c.onModelChange?.(m);
    restoreModelViewState({ saved, model: m, folding: this.folding, view: this.view, selection: this.selection, clampPos: (l, c) => clampPosition(m, l, c) });
    this.unsubModel = this.subscribeActiveModel();
    this.view.clampScrollPublic(); this.view.paint(); this.syncTextarea();
    this.emitCursorEvents('model'); this.events.emitModelChanged({ oldModelUrl: oldUri, newModelUrl: newUri });
  }
  executeEdits(source: string | null | undefined, edits: IIdentifiedSingleEditOperation[], endCursorState?: ISelection[] | ICursorStateComputer) {
    if (!this.modelCtrl.executeEdits(this.selection, this.opts.readOnly, edits, endCursorState)) return false;
    this.events.altVersionId++; this.view.ensureCaretVisible(); this.syncTextarea(); this.view.paint();
    this.emitContent(); this.emitCursorEvents(source || 'executeEdits'); return true;
  }
  pushEditOperations(before: ISelection[] | null, ops: readonly IIdentifiedSingleEditOperation[], computer?: ICursorStateComputer) {
    this.executeEdits('pushEditOperations', [...ops], computer); return this.getSelections() ?? before;
  }
  getPosition(): IPosition { return { lineNumber: this.selection.active.lineNumber, column: this.selection.active.column }; }
  setPosition(positionOrLine: IPosition | number, column?: number) {
    const raw = typeof positionOrLine === 'number' ? { lineNumber: positionOrLine, column: column ?? 1 } : positionOrLine;
    const pos = clampPosition(this.modelCtrl.model, raw.lineNumber, raw.column);
    if (this.folding.isLineHidden(pos.lineNumber)) { this.folding.unfoldContaining(pos.lineNumber); this.view.projection.invalidate(); }
    this.selection.setCaret(pos.lineNumber, pos.column); this.view.notifyCaretActivity('explicit'); this.view.ensureCaretVisible(); this.syncTextarea(); this.view.paint(); this.emitCursorEvents('api');
  }
  getSelection(): ISelection { return rangeToISelection(this.selection.anchor, this.selection.active); }
  setSelection(sel: ISelection) { this.setSelections([sel]); }
  getSelections(): ISelection[] { return this.selection.selections.map((s) => rangeToISelection(s.anchor, s.active)); }
  setSelections(sels: ISelection[]) {
    if (!setSelectionsImpl(this.revealCtx(), sels)) return;
    this.syncTextarea(); this.view.paint(); this.emitCursorEvents('api');
  }

  revealLine(ln: number, _st?: number) { this.revealPosition({ lineNumber: ln, column: 1 }, _st); }
  revealLineInCenter(ln: number, _st?: number) { revealLineInCenterImpl(this.revealCtx(), ln); }
  revealLines(s: number, e: number, _st?: number) { revealLinesImpl(this.revealCtx(), s, e); }
  revealLinesInCenter(s: number, e: number, _st?: number) { revealLinesInCenterImpl(this.revealCtx(), s, e); }
  revealPosition(p: IPosition, _st?: number) { revealPositionImpl(this.revealCtx(), p); }
  revealPositionInCenter(p: IPosition, _st?: number) { this.revealLineInCenter(p.lineNumber); this.revealPosition(p); }
  revealRange(r: IRange, _st?: number) { revealRangeImpl(this.revealCtx(), r); }
  revealRangeInCenter(r: IRange, _st?: number) { revealRangeInCenterImpl(this.revealCtx(), r); }
  getScrollTop() { return this.view.scrollTop; }
  setScrollTop(scrollTop: number, _st?: number) { setScrollPositionImpl(this.revealCtx(), { scrollTop }); }
  getScrollLeft() { return this.view.scrollLeft; }
  setScrollLeft(scrollLeft: number, _st?: number) { setScrollPositionImpl(this.revealCtx(), { scrollLeft }); }
  setScrollPosition(pos: { scrollTop?: number; scrollLeft?: number }, _st?: number) { setScrollPositionImpl(this.revealCtx(), pos); }
  getScrollHeight() { return this.view.getScrollHeight(); }
  getScrollWidth() { return this.view.getScrollWidth(); }
  getContentHeight() { return this.view.getContentHeight(); }
  getContentWidth() { return this.view.getContentWidth(); }
  getVisibleRanges() { return this.view.getVisibleRanges(); }
  getLayoutInfo(): IEditorLayoutInfo { return computeEditorLayoutInfo({ width: this.view.cssWidth, height: this.view.cssHeight, metrics: this.metrics(), minimapWidth: this.minimap.getWidth(), glyphMargin: this.opts.glyphMargin, showLineNumbers: this.opts.lineNumbers }); }
  getTargetAtClientPoint(x: number, y: number): IMouseTarget | null { const r = this.root.getBoundingClientRect(); return this.view.getTargetAtLocalPoint(x - r.left, y - r.top); }
  getScrolledVisiblePosition(p: IPosition) { return this.view.getScrolledVisiblePosition(p); }
  getTopForLineNumber(ln: number) { return this.view.getTopForLineNumber(ln); }
  getBottomForLineNumber(ln: number) { return this.view.getBottomForLineNumber(ln); }
  getOffsetForColumn(ln: number, col: number) { return this.view.getOffsetForColumn(ln, col); }
  setHiddenAreas(ranges: readonly IRange[]) { this.view.setHiddenAreas(ranges); }
  addContentWidget(w: IContentWidget) { this.widgets.addContentWidget(w); }
  layoutContentWidget(w: IContentWidget) { this.widgets.layoutContentWidget(w); }
  removeContentWidget(w: IContentWidget) { this.widgets.removeContentWidget(w); }
  addOverlayWidget(w: IOverlayWidget) { this.widgets.addOverlayWidget(w); }
  layoutOverlayWidget(w: IOverlayWidget) { this.widgets.layoutOverlayWidget(w); }
  removeOverlayWidget(w: IOverlayWidget) { this.widgets.removeOverlayWidget(w); }
  changeViewZones(cb: (a: IViewZoneChangeAccessor) => void) { this.widgets.changeViewZones(cb); }
  saveViewState(): IEditorViewState | null { return this.disposed ? null : saveEditorViewState(this.selection, this.view, this.folding); }
  restoreViewState(s: IEditorViewState | null) { restoreEditorViewState(s, this.modelCtrl.model, this.selection, this.view, this.folding); this.view.paint(); this.syncTextarea(); }

  focus() { this.syncTextarea(); this.input.focus(); this.view.setCursorFocused(true); this.events.emitFocus(); }
  blur() { this.input.blur(); this.view.setCursorFocused(false); this.events.emitBlur(); }
  hasTextFocus() { return document.activeElement === this.input.textarea; }
  hasWidgetFocus() { const a = document.activeElement; return Boolean(a && (a === this.input.textarea || this.root.contains(a))); }
  layout(dimension?: IDimension) {
    if (this.disposed) return;
    const rect = dimension ?? this.root.getBoundingClientRect();
    this.view.setSize(rect.width, rect.height); this.minimap.syncLayout(); this.minimap.paint(); this.widgets.layoutAll();
    for (const c of this.contributions.values()) c.onLayout?.();
    this.input.setPageSize(Math.max(1, Math.floor(rect.height / Math.max(1, this.metrics().lineHeight)) - 2));
    this.syncTextarea(); this.events.emitLayout(this.getLayoutInfo()); this.checkContentSizeChanged();
  }
  updateOptions(options: Partial<MonoEditorOptions>) {
    applyEditorOptionsPatch(this.opts, options, {
      root: this.root, modelCtrl: this.modelCtrl, selection: this.selection, view: this.view, input: this.input, commands: this.commands,
      scrollbar: this.scrollbar, minimap: this.minimap, tokenization: this.tokenization, bracketColorizer: this.bracketColorizer, folding: this.folding, isPeekEditor: this.isPeekEditor,
      applyAllWidgetThemes: () => this.applyAllWidgetThemes(), setLanguageId: (id) => this.setLanguageId(id),
      setValue: (v) => this.setValue(v), notifyContributions: (p) => { for (const c of this.contributions.values()) c.onOptionsChange?.(p); },
    });
    this.events.emitConfig(options); this.view.paint(); this.syncTextarea();
  }
  getOptions() { return getResolvedEditorOptions(this.opts); }
  getRawOptions() { return { ...this.opts.rawOptions }; }
  getOption<T = unknown>(name: string) { return getEditorOptionByName<T>(this.opts, name); }
  setTheme(theme: Partial<MonoEditorTheme> | string) { this.opts.theme = resolveNamedOrPartialTheme(this.opts.theme, theme); this.root.style.background = this.opts.theme.background; this.applyAllWidgetThemes(); this.view.paint(); }

  onDidChangeModel(l: (e: IModelChangedEvent) => void) { return this.events.onDidChangeModel(l); }
  onDidChangeModelContent(l: (e: MonoContentChangeEvent) => void) { return this.events.onDidChangeModelContent(l); }
  onDidChangeModelLanguage(l: (e: IModelLanguageChangedEvent) => void) { return this.events.onDidChangeModelLanguage(l); }
  onDidChangeModelOptions(l: (e: IModelOptionsChangedEvent) => void) { return this.events.onDidChangeModelOptions(l); }
  onDidChangeModelDecorations(l: (e: IModelDecorationsChangedEvent) => void) { return this.events.onDidChangeModelDecorations(l); }
  onDidChangeConfiguration(l: (e: Partial<MonoEditorOptions>) => void) { return this.events.onDidChangeConfiguration(l); }
  onDidLayoutChange(l: (e: IEditorLayoutInfo) => void) { return this.events.onDidLayoutChange(l); }
  onDidContentSizeChange(l: (e: IContentSizeChangedEvent) => void) { return this.events.onDidContentSizeChange(l); }
  onDidChangeCursorPosition(l: (e: ICursorPositionChangedEvent) => void) { return this.events.onDidChangeCursorPosition(l); }
  onDidChangeCursorSelection(l: (e: ICursorSelectionChangedEvent) => void) { return this.events.onDidChangeCursorSelection(l); }
  onDidScrollChange(l: (e: IScrollEvent) => void) { return this.events.onDidScrollChange(l); }
  onDidFocusEditorText(l: () => void) { return this.events.onDidFocusEditorText(l); }
  onDidBlurEditorText(l: () => void) { return this.events.onDidBlurEditorText(l); }
  onDidFocusEditorWidget(l: () => void) { return this.events.onDidFocusEditorWidget(l); }
  onDidBlurEditorWidget(l: () => void) { return this.events.onDidBlurEditorWidget(l); }
  onDidPaste(l: (e: IPasteEvent) => void) { return this.events.onDidPaste(l); }
  onDidCompositionStart(l: () => void) { return this.events.onDidCompositionStart(l); }
  onDidCompositionEnd(l: () => void) { return this.events.onDidCompositionEnd(l); }
  onMouseDown(l: (e: IEditorMouseEvent) => void) { return this.events.onMouseDown(l); }
  onMouseUp(l: (e: IEditorMouseEvent) => void) { return this.events.onMouseUp(l); }
  onMouseMove(l: (e: IEditorMouseEvent) => void) { return this.events.onMouseMove(l); }
  onMouseLeave(l: (e: IEditorMouseEvent) => void) { return this.events.onMouseLeave(l); }
  onContextMenu(l: (e: IEditorMouseEvent) => void) { return this.events.onContextMenu(l); }
  onKeyDown(l: (e: KeyboardEvent) => void) { return this.events.onKeyDown(l); }
  onKeyUp(l: (e: KeyboardEvent) => void) { return this.events.onKeyUp(l); }
  onDidDispose(l: () => void) { return this.events.onDidDispose(l); }
  onDidChangeMarkers(l: (markers: IMarker[]) => void) { return this.events.onDidChangeMarkers(l); }
  onDidClickInlayHint(l: (e: IInlayHintClickEvent) => void) { return this.events.onDidClickInlayHint(l); }
  onDidRequestGoToLine(l: (e: IGoToLineRequestEvent) => void) { return this.events.onDidRequestGoToLine(l); }
  onDidRequestGoToSymbol(l: () => void) { return this.events.onDidRequestGoToSymbol(l); }
  onDidChangeBreadcrumbs(l: (s: import('../../common/breadcrumbs/breadcrumbsTypes').IBreadcrumbsSnapshot) => void) { return this.getContribution<IBreadcrumbsContribution>(ContributionIds.Breadcrumbs)?.onDidChangeBreadcrumbs(l) ?? { dispose: () => {} }; }

  addAction(action: MonoAction) { return this.commands.addAction(action); }
  registerCommand(id: string, h: MonoCommandHandler, m?: Omit<MonoRegisteredCommand, 'id' | 'handler'>) { return this.commands.registerCommand(id, h, m); }
  executeCommand(id: string, ...args: unknown[]): Promise<unknown> {
    if (!this.commands.getCommands().some((c) => c.id === id)) { window.dispatchEvent(new CustomEvent('mono:executeCommand', { detail: { id, args } })); return Promise.resolve(undefined); }
    return this.commands.executeCommand(id, ...args);
  }
  trigger(_s: string | null | undefined, id: string, payload?: unknown) { void this.executeCommand(id, payload); }
  getAction(id: string): IMonoEditorAction | null { return getEditorActionById(this.commands, id); }
  getSupportedActions(): IMonoEditorAction[] { return listSupportedEditorActions(this.commands); }
  getCommandsForPalette(filter?: string) { return this.commands.getCommandsForPalette(filter); }
  getPaletteService() { return this.palette; }
  setContext(k: string, v: boolean | string | number) { this.commands.setContext(k, v); }
  createContextKey<T = boolean | string | number>(k: string, v: T): IContextKey<T> { return createEditorContextKey(this.commands, k, v); }
  deltaDecorations(o: string[], n: IModelDeltaDecoration[]) { const ids = this.decorations.deltaDecorations(o, n); this.view.paint(); this.events.emitModelDecorations(); return ids; }
  createDecorationsCollection(d?: IModelDeltaDecoration[]): IEditorDecorationsCollection { return createEditorDecorationsCollection(this.decorations, () => { this.view.paint(); this.events.emitModelDecorations(); }, d); }
  setModelMarkers(owner: string, m: IMarkerData[]) { this.markers.setModelMarkers(owner, m); this.view.paint(); for (const c of this.contributions.values()) c.onMarkersChange?.(); this.events.emitMarkers(this.markers.getModelMarkers()); }
  getModelMarkers(f?: { owner?: string; take?: number }) { return this.markers.getModelMarkers(f); }
  setContextMenuItems(i: MonoMenuItem[]) { this.getContribution<IContextMenuContribution>(ContributionIds.ContextMenu)?.setItems(i); }
  addContextMenuItem(i: MonoMenuItem) { this.getContribution<IContextMenuContribution>(ContributionIds.ContextMenu)?.addItem(i); }
  removeContextMenuItem(id: string) { this.getContribution<IContextMenuContribution>(ContributionIds.ContextMenu)?.removeItem(id); }
  setContextMenuStyle(s: MonoMenuStyle) { this.getContribution<IContextMenuContribution>(ContributionIds.ContextMenu)?.setStyle(s); }
  hideContextMenu() { this.getContribution<IContextMenuContribution>(ContributionIds.ContextMenu)?.hide(); }
  showContextMenu() { this.getContribution<IContextMenuContribution>(ContributionIds.ContextMenu)?.show(); }
  addKeybinding(b: MonoKeybinding) { return this.keybindings.add(b); }
  removeKeybinding(id: string) { this.keybindings.remove(id); }
  listKeybindings() { return this.keybindings.list(); }
  setStickyScroll(opts: MonoStickyScrollOptions) { this.view.setStickyScroll(opts); }
  revealFind() { this.getContribution<IFindContribution>(ContributionIds.Find)?.startFind(); }
  revealReplace() { this.getContribution<IFindContribution>(ContributionIds.Find)?.startFindReplace(); }
  getFoldedCount() { return this.folding.getFoldedCount(); }
  toggleFoldAtLine(ln: number) { this.getContribution<IFoldingContribution>(ContributionIds.Folding)?.toggleFoldAtLine(ln); }
  foldAll() { this.getContribution<IFoldingContribution>(ContributionIds.Folding)?.foldAll(); }
  unfoldAll() { this.getContribution<IFoldingContribution>(ContributionIds.Folding)?.unfoldAll(); }
  private ghostContrib() { return this.getContribution<IInlineSuggestContribution>(ContributionIds.InlineSuggest); }
  setGhostTexts(items: readonly GhostTextItem[]) { this.ghostContrib()?.setGhostTexts(items); }
  clearGhostTexts(owner?: string) { this.ghostContrib()?.clearGhostTexts(owner); }
  getGhostTexts(owner?: string) { return this.ghostContrib()?.getGhostTexts(owner) ?? []; }
  acceptGhostText() { return this.ghostContrib()?.accept() ?? false; }
  acceptGhostTextWord() { return this.ghostContrib()?.acceptWord() ?? false; }
  acceptGhostTextLine() { return this.ghostContrib()?.acceptLine() ?? false; }
  nextGhostText() { this.ghostContrib()?.next(); }
  prevGhostText() { this.ghostContrib()?.prev(); }
  dismissGhostText() { this.ghostContrib()?.dismiss(); }
  getDocumentSymbols(): Promise<DocumentSymbol[]> { return this.getContribution<IDocumentSymbolsContribution>(ContributionIds.DocumentSymbols)?.getDocumentSymbols() ?? Promise.resolve([]); }
  getStructure() { return this.structure; }
  getBreadcrumbs() { return this.getContribution<IBreadcrumbsContribution>(ContributionIds.Breadcrumbs)?.getBreadcrumbs(); }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; activeEditors.delete(this); this.events.emitDispose();
    this.unsubModel(); this.ro.disconnect(); this.detachDomListeners(); this.pointer.dispose();
    for (const c of this.contributions.values()) c.dispose();
    this.contributions.clear(); this.commands.dispose(); this.minimap.dispose(); this.scrollbar.dispose();
    this.widgets.dispose(); this.view.setViewZone(null); this.view.dispose(); this.input.dispose();
    this.themeUnsub?.dispose(); this.themeUnsub = null; this.handleVis.dispose(); this.events.dispose(); this.modelCtrl.dispose(); this.root.remove();
  }
  private metrics(r: CanvasRenderer = this.renderer): RenderMetrics { return computeEditorMetrics(r, this.opts, this.modelCtrl.model.getLineCount()); }
  private revealCtx() { return { model: this.modelCtrl.model, selection: this.selection, folding: this.folding, view: this.view, metrics: () => this.metrics(), showLineNumbers: () => this.opts.lineNumbers, onScrollChanged: (t: boolean, l: boolean) => { this.lastScrollTop = this.view.scrollTop; this.lastScrollLeft = this.view.scrollLeft; this.emitScrollEvent(t, l); } }; }
  private subscribeActiveModel() { return subscribeActiveTextModel({ model: this.modelCtrl.model, events: this.events, tokenization: this.tokenization, bracketColorizer: this.bracketColorizer, folding: this.folding, structure: this.structure, selection: this.selection, view: this.view, contributions: this.contributions, onContentSizeCheck: () => this.checkContentSizeChanged() }); }
  private checkContentSizeChanged() {
    const w = this.view.getContentWidth(), h = this.view.getContentHeight();
    if (w !== this.lastContentW || h !== this.lastContentH) { const wc = w !== this.lastContentW, hc = h !== this.lastContentH; this.lastContentW = w; this.lastContentH = h; this.events.emitContentSize({ contentWidth: w, contentHeight: h, contentWidthChanged: wc, contentHeightChanged: hc }); }
  }
  private flushScrollDelta() { const t = Math.abs(this.view.scrollTop - this.lastScrollTop) > 0.01, l = Math.abs(this.view.scrollLeft - this.lastScrollLeft) > 0.01; this.lastScrollTop = this.view.scrollTop; this.lastScrollLeft = this.view.scrollLeft; if (t || l) this.emitScrollEvent(t, l); }
  private applyAllWidgetThemes() { const wt = resolveEditorWidgetTheme(this.opts.theme); this.minimap.applyTheme(wt); for (const c of this.contributions.values()) c.onThemeChange?.(wt, this.opts.theme); }
  private syncScrollbar(activeScroll: boolean, activeAxes?: { vertical?: boolean; horizontal?: boolean }) {
    if (this.disposed) return;
    syncEditorScrollbar({ scrollbar: this.scrollbar, theme: this.opts.theme, model: this.modelCtrl.model, view: this.view, markers: this.markers.getModelMarkers(), findMatches: this.getContribution<IFindContribution>(ContributionIds.Find)?.getMatches() ?? [], rightInset: this.minimap.getWidth(), activeScroll, activeAxes });
  }
  private syncTextarea() { const p = this.view.caretScreenPos(); this.input.moveTo(p.x, p.y, p.h); }
  private emitContent() { this.events.emitContent(this.modelCtrl.model); }
  private emitCursorEvents(source: string, keepSuggest = false) {
    for (const c of this.contributions.values()) c.onCursorChange?.(source, keepSuggest);
    this.events.emitCursor(this.modelCtrl.model, this.selection, this.getPosition(), this.getSelections(), this.getSelection(), source);
    this.commands.setContext('editorHasSelection', !this.selection.isEmpty);
  }
  private emitScrollEvent(t: boolean, l: boolean) {
    for (const c of this.contributions.values()) c.onScroll?.();
    this.syncScrollbar(true, { vertical: t, horizontal: l });
    this.events.emitScroll({ scrollTop: this.view.scrollTop, scrollLeft: this.view.scrollLeft, scrollWidth: this.view.getScrollWidth(), scrollHeight: this.view.getScrollHeight(), scrollTopChanged: t, scrollLeftChanged: l });
  }
}
