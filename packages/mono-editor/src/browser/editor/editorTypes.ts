import type { MonoEditorOptions, RenderMetrics } from '../../common/config/editorOptions';
import type { MonoMenuItem, MonoMenuStyle } from '../../common/config/menuTypes';
import type { MonoEditorTheme } from '../../common/config/themeTypes';
import type { SelectionState } from '../../common/core/SelectionState';
import type {
  IIdentifiedSingleEditOperation,
  IModelChangedEvent,
  IMonoTextModel,
  IPosition,
  ISelection,
  MonoDisposable,
} from '../../common/core/types';
import type {
  IMarker,
  IMarkerData,
  IModelDeltaDecoration,
} from '../../common/decorations/types';
import type {
  DocumentSymbol,
  GhostTextItem,
  Location,
  ModelLike,
  TextEdit,
  WorkspaceEdit,
} from '../../common/languages/providers/types';
import type { TokenizationSupport } from '../../common/languages/tokenization/TokenizationSupport';
import type { TextModel } from '../../common/model/TextModel';
import type { FoldingModel } from '../../common/viewModel/FoldingModel';
import type { MonoStickyScrollOptions } from '../../common/viewModel/StickyScroll';
import type { CommandService } from '../../platform/commands/CommandService';
import type { MonoAction } from '../../platform/commands/types';
import type { KeybindingService, MonoKeybinding } from '../../platform/keybindings/KeybindingService';
import type { ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';
import type { InputChangeEvent, InputController } from '../input/InputController';
import type { PointerInteractKind } from '../input/pointer/PointerController';
import type { ColorHit, InlayHintHit, LinkHit } from '../render/CanvasRenderer';
import type { ViewController } from '../view/ViewController';

export interface MonoContentChangeEvent {
  value: string;
}

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

export interface IMonoEditorAction {
  id: string;
  label?: string;
  run: () => unknown | Promise<unknown>;
  isSupported?: () => boolean;
}

export interface IMonoEditor {
  pushUndoStop(): boolean;
  getValue(): string;
  setValue(value: string): void;
  getLanguageId(): string;
  setLanguageId(id: string): void;
  getModelVersionId(): number;
  getAlternativeVersionId(): number;
  getModel(): IMonoTextModel;
  setModel?(model: IMonoTextModel | null): void;
  onDidChangeModel?(listener: (e: IModelChangedEvent) => void): MonoDisposable;
  executeEdits(
    source: string | null | undefined,
    edits: IIdentifiedSingleEditOperation[],
  ): boolean;

  getPosition(): IPosition;
  setPosition(positionOrLine: IPosition | number, column?: number): void;
  getSelection(): ISelection;
  setSelection(selection: ISelection): void;
  getSelections(): ISelection[];
  setSelections?(selections: ISelection[]): void;

  revealLine(lineNumber: number, scrollType?: number): void;
  revealLineInCenter(lineNumber: number): void;
  revealPosition(position: IPosition, scrollType?: number): void;
  revealPositionInCenter(position: IPosition): void;
  revealRange(range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  }): void;
  getScrollTop(): number;
  setScrollTop(scrollTop: number): void;
  getScrollLeft(): number;
  setScrollLeft(scrollLeft: number): void;

  focus(): void;
  blur?(): void;
  hasTextFocus(): boolean;
  layout(): void;

  updateOptions(options: Partial<MonoEditorOptions>): void;
  setTheme(theme: Partial<MonoEditorTheme> | string): void;
  getOption?<T = unknown>(name: string): T | undefined;

  onDidChangeModelContent(listener: (e: MonoContentChangeEvent) => void): MonoDisposable;
  onDidChangeCursorPosition(listener: (e: ICursorPositionChangedEvent) => void): MonoDisposable;
  onDidChangeCursorSelection(listener: (e: ICursorSelectionChangedEvent) => void): MonoDisposable;
  onDidScrollChange(listener: (e: IScrollEvent) => void): MonoDisposable;
  onDidFocusEditorText?(listener: () => void): MonoDisposable;
  onDidBlurEditorText?(listener: () => void): MonoDisposable;

  addAction?(action: MonoAction): MonoDisposable;
  getAction(id: string): IMonoEditorAction | null;

  deltaDecorations(oldDecorations: string[], newDecorations: IModelDeltaDecoration[]): string[];
  setModelMarkers(owner: string, markers: IMarkerData[]): void;
  getModelMarkers(filter?: { owner?: string; take?: number }): IMarker[];

  executeCommand?(id: string, ...args: unknown[]): Promise<unknown>;

  setContextMenuItems?(items: MonoMenuItem[]): void;
  addContextMenuItem?(item: MonoMenuItem): void;
  removeContextMenuItem?(id: string): void;
  setContextMenuStyle?(style: MonoMenuStyle): void;
  hideContextMenu?(): void;
  addKeybinding?(binding: MonoKeybinding): () => void;
  removeKeybinding?(id: string): void;
  listKeybindings?(): MonoKeybinding[];
  setStickyScroll?(opts: MonoStickyScrollOptions): void;
  revealFind?(): void;
  revealReplace?(): void;
  getFoldedCount?(): number;
  foldAll?(): void;
  unfoldAll?(): void;
  toggleFoldAtLine?(lineNumber: number): void;

  // Direct Ghost Text / Copilot / Codex Plugin API
  setGhostTexts?(items: readonly GhostTextItem[]): void;
  clearGhostTexts?(owner?: string): void;
  getGhostTexts?(owner?: string): readonly GhostTextItem[];
  acceptGhostText?(): boolean;
  acceptGhostTextWord?(): boolean;
  acceptGhostTextLine?(): boolean;
  nextGhostText?(): void;
  prevGhostText?(): void;
  dismissGhostText?(): void;
  getDocumentSymbols?(): Promise<DocumentSymbol[]>;

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
} as const;

/** Lifecycle interface implemented by every self-contained feature in `src/contrib/`. */
export interface IEditorContribution {
  readonly id: string;
  dispose(): void;
  onModelChange?(model: TextModel): void;
  onModelContentChange?(versionId: number): void;
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
  /** Return true if the contribution consumed the keydown event. */
  onKeyDown?(e: KeyboardEvent): boolean;
  /** Return true if a wheel event targeting `target` should not scroll the parent editor. */
  shouldAllowWheelTarget?(target: Node): boolean;
  /** Handle a click on a rendered color swatch. */
  onColorSwatchClick?(hit: ColorHit): void;
  /** Handle a click on a rendered inlay hint chip. */
  onInlayHintClick?(hit: InlayHintHit): void;
  /** Handle a Ctrl/Cmd+click or explicit tap on a rendered document link. */
  onLinkClick?(hit: LinkHit, e: PointerEvent): void;
  /** Handle a click on a rendered fold chevron. */
  onFoldToggle?(lineNumber: number): void;
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
  /** Resolve effective embedded language at 1-based (lineNumber, column), e.g. 'css' inside HTML <style>. */
  getLanguageIdAtPosition(lineNumber: number, column: number): string;
  modelAsFeatureLike(): ModelLike;
  wordAtPosition(lineNumber: number, column: number): { word: string; startColumn: number; endColumn: number } | null;
  createNestedEditor(container: HTMLElement, sharedModel: TextModel, extra?: Partial<MonoEditorOptions>): IMonoEditor;
  notifyLayoutChange(): void;
}

/** Optional capability contracts queried via `editor.getContribution<T>(id)`. */
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
