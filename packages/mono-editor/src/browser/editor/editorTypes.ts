import type { MonoEditorOptions, RenderMetrics } from '../../common/config/editorOptions';
import type { MonoMenuItem, MonoMenuStyle } from '../../common/config/menuTypes';
import type { MonoEditorTheme } from '../../common/config/themeTypes';
import type { SelectionState } from '../../common/core/SelectionState';
import type {
  IContentSizeChangedEvent,
  IContentWidget,
  IContextKey,
  ICursorStateComputer,
  IDimension,
  IEditorLayoutInfo,
  IEditorMouseEvent,
  IEditorViewState,
  IIdentifiedSingleEditOperation,
  IModelChangedEvent,
  IModelContentChangedEvent,
  IModelDecorationsChangedEvent,
  IModelLanguageChangedEvent,
  IModelOptionsChangedEvent,
  IMonoTextModel,
  IMouseTarget,
  IOverlayWidget,
  IPasteEvent,
  IPosition,
  IRange,
  ISelection,
  IViewZoneChangeAccessor,
  MonoDisposable,
} from '../../common/core/types';
import type {
  IEditorDecorationsCollection,
  IMarker,
  IMarkerData,
  IModelDeltaDecoration,
} from '../../common/decorations/types';
import type {
  DocumentSymbol,
  GhostTextItem,
  IInlayHintClickEvent,
  Location,
  ModelLike,
  TextEdit,
  WorkspaceEdit,
} from '../../common/languages/providers/types';
import type { IBreadcrumbsModel, IBreadcrumbsSnapshot } from '../../common/breadcrumbs/breadcrumbsTypes';
import type { TokenizationSupport } from '../../common/languages/tokenization/TokenizationSupport';
import type { ModelChange, TextModel } from '../../common/model/TextModel';
import type { IDocumentStructure } from '../../common/structure/types';
import type { FoldingModel } from '../../common/viewModel/FoldingModel';
import type { MonoStickyScrollOptions } from '../../common/viewModel/StickyScroll';
import type { CommandService } from '../../platform/commands/CommandService';
import type { MonoAction, MonoCommandHandler, MonoPaletteCommandItem, MonoRegisteredCommand } from '../../platform/commands/types';
import type { KeybindingService, MonoKeybinding } from '../../platform/keybindings/KeybindingService';
import type { PaletteService } from '../../platform/palette/PaletteService';
import type { ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';
import type { InputChangeEvent, InputController } from '../input/InputController';
import type { InlayHintClickMeta, PointerInteractKind } from '../input/pointer/PointerController';
import type { ColorHit, InlayHintHit, LinkHit } from '../render/CanvasRenderer';
import type { ViewController } from '../view/ViewController';

export interface WidgetBoxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type MonoContentChangeEvent = IModelContentChangedEvent;

export interface ICursorPositionChangedEvent {
  position: IPosition;
  secondaryPositions: IPosition[];
  reason: number;
  source: string;
}

export interface ICursorSelectionChangedEvent {
  selection: ISelection;
  secondarySelections: ISelection[];
  modelVersionId: number;
  oldSelections: ISelection[] | null;
  oldModelVersionId: number;
  source: string;
  reason: number;
}

export interface IScrollEvent {
  scrollTop: number;
  scrollLeft: number;
  scrollWidth: number;
  scrollHeight: number;
  scrollTopChanged: boolean;
  scrollLeftChanged: boolean;
}

export interface IGoToLineRequestEvent {
  readonly lineNumber: number;
  readonly column: number;
  readonly lineCount: number;
}

export interface IMonoEditorAction {
  id: string;
  label?: string;
  run: () => unknown | Promise<unknown>;
  isSupported?: () => boolean;
}

export interface IMonoEditor {
  getId(): string;
  getEditorType(): string;
  getDomNode(): HTMLElement | null;
  getContainerDomNode(): HTMLElement;

  pushUndoStop(): boolean;
  getValue(): string;
  setValue(value: string): void;
  getLanguageId(): string;
  setLanguageId(id: string): void;
  getModelVersionId(): number;
  getAlternativeVersionId(): number;
  getModel(): IMonoTextModel;
  setModel(model: IMonoTextModel | null): void;
  onDidChangeModel(listener: (e: IModelChangedEvent) => void): MonoDisposable;
  executeEdits(
    source: string | null | undefined,
    edits: IIdentifiedSingleEditOperation[],
    endCursorState?: ISelection[] | ICursorStateComputer,
  ): boolean;
  pushEditOperations?(
    beforeCursorState: ISelection[] | null,
    editOperations: readonly IIdentifiedSingleEditOperation[],
    cursorStateComputer?: ICursorStateComputer,
  ): ISelection[] | null;

  getPosition(): IPosition;
  setPosition(positionOrLine: IPosition | number, column?: number): void;
  getSelection(): ISelection;
  setSelection(selection: ISelection): void;
  getSelections(): ISelection[];
  setSelections(selections: ISelection[]): void;

  revealLine(lineNumber: number, scrollType?: number): void;
  revealLineInCenter(lineNumber: number, scrollType?: number): void;
  revealLines(startLineNumber: number, endLineNumber: number, scrollType?: number): void;
  revealLinesInCenter(startLineNumber: number, endLineNumber: number, scrollType?: number): void;
  revealPosition(position: IPosition, scrollType?: number): void;
  revealPositionInCenter(position: IPosition, scrollType?: number): void;
  revealRange(range: IRange, scrollType?: number): void;
  revealRangeInCenter(range: IRange, scrollType?: number): void;

  getScrollTop(): number;
  setScrollTop(scrollTop: number, scrollType?: number): void;
  getScrollLeft(): number;
  setScrollLeft(scrollLeft: number, scrollType?: number): void;
  setScrollPosition(pos: { scrollTop?: number; scrollLeft?: number }, scrollType?: number): void;
  getScrollHeight(): number;
  getScrollWidth(): number;
  getContentHeight(): number;
  getContentWidth(): number;

  getVisibleRanges(): IRange[];
  getLayoutInfo(): IEditorLayoutInfo;
  getTargetAtClientPoint(clientX: number, clientY: number): IMouseTarget | null;
  getScrolledVisiblePosition(position: IPosition): { top: number; left: number; height: number } | null;
  getTopForLineNumber(lineNumber: number): number;
  getBottomForLineNumber(lineNumber: number): number;
  getOffsetForColumn(lineNumber: number, column: number): number;
  setHiddenAreas(ranges: readonly IRange[]): void;

  addContentWidget(widget: IContentWidget): void;
  layoutContentWidget(widget: IContentWidget): void;
  removeContentWidget(widget: IContentWidget): void;
  addOverlayWidget(widget: IOverlayWidget): void;
  layoutOverlayWidget(widget: IOverlayWidget): void;
  removeOverlayWidget(widget: IOverlayWidget): void;
  changeViewZones(callback: (accessor: IViewZoneChangeAccessor) => void): void;

  saveViewState(): IEditorViewState | null;
  restoreViewState(state: IEditorViewState | null): void;

  focus(): void;
  blur(): void;
  hasTextFocus(): boolean;
  hasWidgetFocus(): boolean;
  layout(dimension?: IDimension): void;

  updateOptions(options: Partial<MonoEditorOptions>): void;
  getOptions(): Readonly<MonoEditorOptions>;
  getRawOptions(): Readonly<MonoEditorOptions>;
  setTheme(theme: Partial<MonoEditorTheme> | string): void;
  getOption<T = unknown>(name: string): T | undefined;

  onDidChangeModelContent(listener: (e: MonoContentChangeEvent) => void): MonoDisposable;
  onDidChangeModelLanguage(listener: (e: IModelLanguageChangedEvent) => void): MonoDisposable;
  onDidChangeModelOptions(listener: (e: IModelOptionsChangedEvent) => void): MonoDisposable;
  onDidChangeModelDecorations(listener: (e: IModelDecorationsChangedEvent) => void): MonoDisposable;
  onDidChangeConfiguration(listener: (e: Partial<MonoEditorOptions>) => void): MonoDisposable;
  onDidLayoutChange(listener: (e: IEditorLayoutInfo) => void): MonoDisposable;
  onDidContentSizeChange(listener: (e: IContentSizeChangedEvent) => void): MonoDisposable;
  onDidChangeCursorPosition(listener: (e: ICursorPositionChangedEvent) => void): MonoDisposable;
  onDidChangeCursorSelection(listener: (e: ICursorSelectionChangedEvent) => void): MonoDisposable;
  onDidScrollChange(listener: (e: IScrollEvent) => void): MonoDisposable;
  onDidFocusEditorText(listener: () => void): MonoDisposable;
  onDidBlurEditorText(listener: () => void): MonoDisposable;
  onDidFocusEditorWidget(listener: () => void): MonoDisposable;
  onDidBlurEditorWidget(listener: () => void): MonoDisposable;
  onDidPaste(listener: (e: IPasteEvent) => void): MonoDisposable;
  onDidCompositionStart(listener: () => void): MonoDisposable;
  onDidCompositionEnd(listener: () => void): MonoDisposable;
  onMouseDown(listener: (e: IEditorMouseEvent) => void): MonoDisposable;
  onMouseUp(listener: (e: IEditorMouseEvent) => void): MonoDisposable;
  onMouseMove(listener: (e: IEditorMouseEvent) => void): MonoDisposable;
  onMouseLeave(listener: (e: IEditorMouseEvent) => void): MonoDisposable;
  onContextMenu(listener: (e: IEditorMouseEvent) => void): MonoDisposable;
  onKeyDown(listener: (e: KeyboardEvent) => void): MonoDisposable;
  onKeyUp(listener: (e: KeyboardEvent) => void): MonoDisposable;
  onDidDispose(listener: () => void): MonoDisposable;
  onDidChangeMarkers(listener: (markers: IMarker[]) => void): MonoDisposable;
  onDidClickInlayHint(listener: (e: IInlayHintClickEvent) => void): MonoDisposable;
  onDidRequestGoToLine(listener: (e: IGoToLineRequestEvent) => void): MonoDisposable;
  onDidRequestGoToSymbol(listener: () => void): MonoDisposable;
  onDidChangeBreadcrumbs(listener: (snapshot: IBreadcrumbsSnapshot) => void): MonoDisposable;

  addAction(action: MonoAction): MonoDisposable;
  getAction(id: string): IMonoEditorAction | null;
  getSupportedActions(): IMonoEditorAction[];
  trigger(source: string | null | undefined, handlerId: string, payload?: unknown): void;
  createContextKey<T = boolean | string | number>(key: string, defaultValue: T): IContextKey<T>;
  setContext(key: string, value: boolean | string | number): void;
  registerCommand(id: string, handler: MonoCommandHandler, meta?: Omit<MonoRegisteredCommand, 'id' | 'handler'>): MonoDisposable;
  executeCommand(id: string, ...args: unknown[]): Promise<unknown>;
  getCommandsForPalette(filter?: string): MonoPaletteCommandItem[];
  getPaletteService(): PaletteService;

  deltaDecorations(oldDecorations: string[], newDecorations: IModelDeltaDecoration[]): string[];
  createDecorationsCollection(decorations?: IModelDeltaDecoration[]): IEditorDecorationsCollection;
  setModelMarkers(owner: string, markers: IMarkerData[]): void;
  getModelMarkers(filter?: { owner?: string; take?: number }): IMarker[];

  setContextMenuItems(items: MonoMenuItem[]): void;
  addContextMenuItem(item: MonoMenuItem): void;
  removeContextMenuItem(id: string): void;
  setContextMenuStyle(style: MonoMenuStyle): void;
  hideContextMenu(): void;
  showContextMenu(): void;
  addKeybinding(binding: MonoKeybinding): () => void;
  removeKeybinding(id: string): void;
  listKeybindings(): MonoKeybinding[];
  setStickyScroll(opts: MonoStickyScrollOptions): void;
  revealFind(): void;
  revealReplace(): void;
  getFoldedCount(): number;
  foldAll(): void;
  unfoldAll(): void;
  toggleFoldAtLine(lineNumber: number): void;

  // Direct Ghost Text / Copilot / Codex Plugin API
  setGhostTexts(items: readonly GhostTextItem[]): void;
  clearGhostTexts(owner?: string): void;
  getGhostTexts(owner?: string): readonly GhostTextItem[];
  acceptGhostText(): boolean;
  acceptGhostTextWord(): boolean;
  acceptGhostTextLine(): boolean;
  nextGhostText(): void;
  prevGhostText(): void;
  dismissGhostText(): void;
  getDocumentSymbols(): Promise<DocumentSymbol[]>;
  getStructure(): IDocumentStructure;
  getBreadcrumbs(): IBreadcrumbsModel | undefined;

  dispose(): void;
}

/** Standard IDs for built-in editor contributions (avoids browser -> contrib imports). */
export const ContributionIds = {
  Find: 'editor.contrib.find',
  Suggest: 'editor.contrib.suggest',
  Hover: 'editor.contrib.hover',
  SignatureHelp: 'editor.contrib.signatureHelp',
  ColorDecorator: 'editor.contrib.colorDecorator',
  ContextMenu: 'editor.contrib.contextMenu',
  Folding: 'editor.contrib.folding',
  MultiCursor: 'editor.contrib.multiCursor',
  Format: 'editor.contrib.format',
  Definition: 'editor.contrib.definition',
  ReferencesPeek: 'editor.contrib.referencesPeek',
  Rename: 'editor.contrib.rename',
  CodeAction: 'editor.contrib.codeAction',
  InlineSuggest: 'editor.contrib.inlineSuggest',
  InlayHints: 'editor.contrib.inlayHints',
  SemanticTokens: 'editor.contrib.semanticTokens',
  DocumentHighlight: 'editor.contrib.documentHighlight',
  DocumentSymbols: 'editor.contrib.documentSymbols',
  Links: 'editor.contrib.links',
  SelectionRange: 'editor.contrib.selectionRange',
  PasteEdit: 'editor.contrib.pasteEdit',
  QuickNav: 'editor.contrib.quickNav',
  LinkedEditing: 'editor.contrib.linkedEditing',
  CodeLens: 'editor.contrib.codeLens',
  MobileAccessory: 'editor.contrib.mobileAccessory',
  Breadcrumbs: 'editor.contrib.breadcrumbs',
} as const;

/** Lifecycle interface implemented by every self-contained feature in `src/contrib/`. */
export interface IEditorContribution {
  readonly id: string;
  dispose(): void;
  onModelChange?(model: TextModel): void;
  onModelContentChange?(versionId: number, change?: ModelChange): void;
  onInputChange?(ev: InputChangeEvent): void;
  onCursorChange?(source: string, keepSuggest?: boolean): void;
  onScroll?(): void;
  onScrollEnd?(): void;
  onPointerInteract?(kind: PointerInteractKind): void;
  onThemeChange?(widgetTheme: ResolvedWidgetTheme, editorTheme: MonoEditorTheme): void;
  onOptionsChange?(patch: Partial<MonoEditorOptions>): void;
  onMarkersChange?(): void;
  onOutsidePointerDown?(): void;
  onPaint?(): void;
  onLayout?(): void;
  onKeyDown?(e: KeyboardEvent): boolean;
  shouldAllowWheelTarget?(target: Node): boolean;
  onColorSwatchClick?(hit: ColorHit): void;
  onInlayHintClick?(hit: InlayHintHit, meta?: InlayHintClickMeta): void;
  onLinkClick?(hit: LinkHit, e: PointerEvent): void;
  onFoldToggle?(lineNumber: number): void;
  onPointerTapMeta?(info: { clientX: number; clientY: number; pointerType: string }): void;
}

/** Narrow capability interface for contributions interacting with the host editor. */
export interface IEditorContributionHost {
  readonly root: HTMLDivElement;
  readonly view: ViewController;
  readonly input: InputController;
  readonly selection: SelectionState;
  readonly commands: CommandService;
  readonly keybindings: KeybindingService;
  readonly folding: FoldingModel;
  readonly tokenization: TokenizationSupport;
  readonly isPeekEditor: boolean;
  readonly initialOptions: MonoEditorOptions;

  isDisposed(): boolean;
  isReadOnly(): boolean;
  isFoldingEnabled(): boolean;
  getTabSize(): number;
  getMultiCursorLimit?(): number;
  getFontFamily(): string;
  getFontSize(): number;
  getLineHeight(): number;
  showLineNumbers(): boolean;
  getTheme(): MonoEditorTheme;
  getMinimapWidth(): number;
  getHandlesShown(): boolean;
  getModel(): TextModel;
  getModelUriKey(): string;
  getMarkers(filter?: { owner?: string; take?: number }): IMarker[];
  getMetrics(): RenderMetrics;
  getPosition(): IPosition;
  getSelection(): ISelection;

  focus(): void;
  syncTextarea(): void;
  emitContent(): void;
  emitCursorEvents(source: string, keepSuggest?: boolean): void;
  setPosition(positionOrLine: IPosition | number, column?: number): void;
  revealPosition(position: IPosition): void;
  revealPositionInCenter(position: IPosition): void;
  executeEdits(source: string | null | undefined, edits: IIdentifiedSingleEditOperation[]): boolean;
  applyTextEditsAtomic(edits: TextEdit[], source: string): boolean;
  applyWorkspaceEdit(edit: WorkspaceEdit, source: string): boolean;
  jumpToLocation(loc: Location): void;
  executeCommand(id: string, ...args: unknown[]): Promise<unknown>;
  getTokenTypeAt(lineNumber: number, column: number): string | null;
  getLanguageIdAtPosition(lineNumber: number, column: number): string;
  modelAsFeatureLike(): ModelLike;
  wordAtPosition(lineNumber: number, column: number): { word: string; startColumn: number; endColumn: number } | null;
  createNestedEditor(container: HTMLElement, sharedModel: TextModel, extra?: Partial<MonoEditorOptions>): IMonoEditor;
  notifyLayoutChange(): void;
  changeViewZones(callback: (accessor: IViewZoneChangeAccessor) => void): void;
  addContentWidget(widget: IContentWidget): void;
  layoutContentWidget(widget: IContentWidget): void;
  removeContentWidget(widget: IContentWidget): void;
  addOverlayWidget(widget: IOverlayWidget): void;
  layoutOverlayWidget(widget: IOverlayWidget): void;
  removeOverlayWidget(widget: IOverlayWidget): void;
  announce(message: string): void;
  getDocumentSymbols(): Promise<DocumentSymbol[]>;
  getStructure(): IDocumentStructure;
  setExternalStructureSymbols(symbols: readonly DocumentSymbol[] | null): void;
  emitInlayHintClick(e: IInlayHintClickEvent): void;
  emitRequestGoToLine(e: IGoToLineRequestEvent): void;
  emitRequestGoToSymbol(): void;
  setContext(key: string, value: boolean | string | number): void;
  getContext(key: string): boolean | string | number | undefined;
  setSuggestWidgetRect(rect: WidgetBoxRect | null): void;
  getSuggestWidgetRect(): WidgetBoxRect | null;
  isSuggestVisible(): boolean;
  setGhostTexts(items: readonly GhostTextItem[]): void;
  clearGhostTexts(owner?: string): void;
  getGhostTexts(owner?: string): readonly GhostTextItem[];
  showContextMenu(): void;
  hideContextMenu(): void;
}

export interface IFindContribution extends IEditorContribution {
  startFind(): void;
  startFindReplace(): void;
  getMatches(): { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }[];
  getCurrentIndex(): number;
}

export interface IContextMenuContribution extends IEditorContribution {
  setItems(items: MonoMenuItem[]): void;
  addItem(item: MonoMenuItem): void;
  removeItem(id: string): void;
  setStyle(style: MonoMenuStyle): void;
  hide(): void;
  show(): void;
}

export interface IFoldingContribution extends IEditorContribution {
  toggleFoldAtLine(lineNumber: number): void;
  foldAll(): void;
  unfoldAll(): void;
}

export interface IInlineSuggestContribution extends IEditorContribution {
  setGhostTexts(items: readonly GhostTextItem[]): void;
  clearGhostTexts(owner?: string): void;
  getGhostTexts(owner?: string): readonly GhostTextItem[];
  accept(): boolean;
  acceptWord(): boolean;
  acceptLine(): boolean;
  next(): void;
  prev(): void;
  dismiss(): void;
}

export interface IDocumentSymbolsContribution extends IEditorContribution {
  getDocumentSymbols(): Promise<DocumentSymbol[]>;
}

export interface IPasteEditContribution extends IEditorContribution {
  tryHandlePaste(text: string): Promise<boolean>;
}

export interface IBreadcrumbsContribution extends IEditorContribution {
  getBreadcrumbs(): IBreadcrumbsModel;
  onDidChangeBreadcrumbs(listener: (snapshot: IBreadcrumbsSnapshot) => void): MonoDisposable;
}
