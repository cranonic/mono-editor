import type {
  ContentWidgetPositionPreference,
  MouseTargetType,
  OverlayWidgetPositionPreference,
} from './enums';

export type MonoDisposable = { dispose: () => void };

/** Monaco-compatible position (1-based line & column). */
export interface IPosition {
  lineNumber: number;
  column: number;
}

/** Monaco-compatible range (1-based inclusive start, 1-based exclusive end). */
export interface IRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

/** Monaco-compatible selection (anchor = selection start, active = caret). */
export interface ISelection {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  /** Selection direction: anchor → active */
  selectionStartLineNumber?: number;
  selectionStartColumn?: number;
  positionLineNumber?: number;
  positionColumn?: number;
}

export interface IIdentifiedSingleEditOperation {
  range: IRange;
  text: string | null;
  forceMoveMarkers?: boolean;
}

/** Monaco-compatible single delta inside `onDidChangeModelContent`. */
export interface IModelContentChange {
  readonly range: IRange;
  readonly rangeOffset: number;
  readonly rangeLength: number;
  readonly text: string;
}

/** Granular model content change event (Monaco `IModelContentChangedEvent` compatible). */
export interface IModelContentChangedEvent {
  readonly changes: readonly IModelContentChange[];
  readonly eol: '\n' | '\r\n';
  readonly versionId: number;
  readonly isUndoing: boolean;
  readonly isRedoing: boolean;
  readonly isFlush: boolean;
  /** Back-compat lazy document value getter. */
  readonly value: string;
}

export interface IModelLanguageChangedEvent {
  readonly oldLanguage: string;
  readonly newLanguage: string;
}

export interface ITextModelResolvedOptions {
  tabSize: number;
  indentSize: number;
  insertSpaces: boolean;
  trimAutoWhitespace: boolean;
}

export interface ITextModelUpdateOptions {
  tabSize?: number;
  indentSize?: number;
  insertSpaces?: boolean;
  trimAutoWhitespace?: boolean;
}

export interface IModelOptionsChangedEvent {
  readonly tabSize: boolean;
  readonly indentSize: boolean;
  readonly insertSpaces: boolean;
  readonly trimAutoWhitespace: boolean;
}

export interface IWordAtPosition {
  readonly word: string;
  readonly startColumn: number;
  readonly endColumn: number;
}

export interface FindMatch {
  readonly range: IRange;
  readonly matches: string[] | null;
}

export interface IModelDecorationsChangedEvent {
  readonly affectsMinimap?: boolean;
  readonly affectsOverviewRuler?: boolean;
}

export type ICursorStateComputer = (
  inverseEditOperations: readonly IIdentifiedSingleEditOperation[],
) => ISelection[] | null;

/** Thin model surface app hooks expect (Monaco ITextModel parity). */
export interface IMonoTextModel {
  uri?: { toString(): string };
  uriString?: string;
  getValue(): string;
  setValue(value: string): void;
  getValueInRange?(range: IRange): string;
  getLineCount(): number;
  getLineContent(lineNumber: number): string;
  getLineLength?(lineNumber: number): number;
  getLineMinColumn?(lineNumber: number): number;
  getLineMaxColumn?(lineNumber: number): number;
  getLineFirstNonWhitespaceColumn?(lineNumber: number): number;
  getLineLastNonWhitespaceColumn?(lineNumber: number): number;
  getLinesContent?(): string[];
  getFullModelRange?(): IRange;
  getOffsetAt(position: IPosition): number;
  getPositionAt(offset: number): IPosition;
  validatePosition?(position: IPosition): IPosition;
  validateRange?(range: IRange): IRange;
  modifyPosition?(position: IPosition, offset: number): IPosition;
  getWordAtPosition?(position: IPosition): IWordAtPosition | null;
  getWordUntilPosition?(position: IPosition): IWordAtPosition;
  findMatches?(
    searchString: string,
    searchOnlyEditableRange: boolean | IRange | IRange[],
    isRegex: boolean,
    matchCase: boolean,
    wordSeparators: string | null,
    captureMatches: boolean,
    limitResultCount?: number,
  ): FindMatch[];
  findNextMatch?(
    searchString: string,
    searchStart: IPosition,
    isRegex: boolean,
    matchCase: boolean,
    wordSeparators: string | null,
    captureMatches: boolean,
  ): FindMatch | null;
  findPreviousMatch?(
    searchString: string,
    searchStart: IPosition,
    isRegex: boolean,
    matchCase: boolean,
    wordSeparators: string | null,
    captureMatches: boolean,
  ): FindMatch | null;
  getVersionId(): number;
  getAlternativeVersionId(): number;
  getLanguageId(): string;
  getEOL?(): '\n' | '\r\n';
  setEOL?(eol: number | '\n' | '\r\n'): void;
  getOptions?(): ITextModelResolvedOptions;
  updateOptions?(newOpts: ITextModelUpdateOptions): void;
  detectIndentation?(defaultInsertSpaces: boolean, defaultTabSize: number): void;
  pushStackElement?(): void;
  pushEditOperations?(
    beforeCursorState: ISelection[] | null,
    editOperations: readonly IIdentifiedSingleEditOperation[],
    cursorStateComputer?: ICursorStateComputer,
  ): ISelection[] | null;
  applyEdits?(operations: readonly IIdentifiedSingleEditOperation[]): void;
  isDisposed?(): boolean;
  isAttachedToEditor?(): boolean;
}

export interface IModelChangedEvent {
  oldModelUrl: { toString(): string } | null;
  newModelUrl: { toString(): string } | null;
}

export interface IEditorLayoutInfo {
  readonly width: number;
  readonly height: number;
  readonly glyphMarginLeft: number;
  readonly glyphMarginWidth: number;
  readonly lineNumbersLeft: number;
  readonly lineNumbersWidth: number;
  readonly decorationsLeft: number;
  readonly decorationsWidth: number;
  readonly contentLeft: number;
  readonly contentWidth: number;
  readonly contentHeight: number;
  readonly minimapWidth: number;
  readonly verticalScrollbarWidth: number;
  readonly horizontalScrollbarHeight: number;
}

export interface IEditorViewState {
  cursorState: {
    inSelectionMode: boolean;
    selectionStart: IPosition;
    position: IPosition;
  }[];
  viewState: {
    scrollLeft: number;
    scrollTop: number;
    firstPosition?: IPosition;
  };
  contributionsState: Record<string, unknown>;
}

export interface IMouseTarget {
  readonly element: unknown;
  readonly type: MouseTargetType;
  readonly position: IPosition | null;
  readonly mouseColumn: number;
  readonly range: IRange | null;
  readonly detail?: unknown;
}

export interface IEditorMouseEvent {
  readonly event: {
    readonly clientX: number;
    readonly clientY: number;
    readonly button: number;
    readonly buttons: number;
    readonly ctrlKey: boolean;
    readonly shiftKey: boolean;
    readonly altKey: boolean;
    readonly metaKey: boolean;
    preventDefault(): void;
    stopPropagation(): void;
  };
  readonly target: IMouseTarget;
}

export interface IContentWidgetPosition {
  position: IPosition | null;
  range?: IRange | null;
  preference: readonly ContentWidgetPositionPreference[];
}

export interface IContentWidget {
  readonly allowEditorOverflow?: boolean;
  readonly suppressMouseDown?: boolean;
  getId(): string;
  getDomNode(): unknown;
  getPosition(): IContentWidgetPosition | null;
}

export interface IOverlayWidgetPosition {
  preference: OverlayWidgetPositionPreference | null;
}

export interface IOverlayWidget {
  getId(): string;
  getDomNode(): unknown;
  getPosition(): IOverlayWidgetPosition | null;
}

export interface IViewZone {
  afterLineNumber: number;
  afterColumn?: number;
  heightInLines?: number;
  heightInPx?: number;
  minWidthInPx?: number;
  domNode: unknown;
  marginDomNode?: unknown;
  suppressMouseDown?: boolean;
  onDomNodeTop?: (top: number) => void;
  onComputedHeight?: (height: number) => void;
}

export interface IViewZoneChangeAccessor {
  addZone(zone: IViewZone): string;
  removeZone(id: string): void;
  layoutZone(id: string): void;
}

export interface IContextKey<T = unknown> {
  set(value: T | undefined): void;
  reset(): void;
  get(): T | undefined;
}

export interface IContentSizeChangedEvent {
  readonly contentWidth: number;
  readonly contentHeight: number;
  readonly contentWidthChanged: boolean;
  readonly contentHeightChanged: boolean;
}

export interface IPasteEvent {
  readonly range: IRange;
  readonly languageId?: string;
}

export interface IDimension {
  width: number;
  height: number;
}
