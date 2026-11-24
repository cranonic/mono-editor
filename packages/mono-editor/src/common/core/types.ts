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

/** Thin model surface app hooks expect (Monaco ITextModel subset). */
export interface IMonoTextModel {
  uri?: { toString(): string };
  getValue(): string;
  setValue(value: string): void;
  getLineCount(): number;
  getLineContent(lineNumber: number): string;
  getOffsetAt(position: IPosition): number;
  getPositionAt(offset: number): IPosition;
  getVersionId(): number;
  getAlternativeVersionId(): number;
  getLanguageId(): string;
  getEOL?(): '\n' | '\r\n';
  setEOL?(eol: number): void;
  uriString?: string;
}

export interface IModelChangedEvent {
  oldModelUrl: { toString(): string } | null;
  newModelUrl: { toString(): string } | null;
}
