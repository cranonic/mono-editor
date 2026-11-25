import type { TrackedRangeStickiness } from '../core/enums';

/** Monaco-compatible decorations & markers (diagnostics). */

export interface IRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export type MarkerSeverity = 1 | 2 | 4 | 8; // Hint, Info, Warning, Error (Monaco values)

export const MarkerSeverity = {
  Hint: 1 as MarkerSeverity,
  Info: 2 as MarkerSeverity,
  Warning: 4 as MarkerSeverity,
  Error: 8 as MarkerSeverity,
};

/** Diagnostic display tags (matches Monaco MarkerTag). */
export const MarkerTag = {
  /** Unused / unreachable code — rendered dimmed. */
  Unnecessary: 1,
  /** Deprecated symbol — rendered with strikethrough. */
  Deprecated: 2,
} as const;
export type MarkerTag = (typeof MarkerTag)[keyof typeof MarkerTag];

export interface IMarkerData {
  severity: MarkerSeverity;
  message: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  source?: string;
  code?: string | { value: string; target?: string };
  tags?: MarkerTag[];
  relatedInformation?: unknown[];
}

export interface IMarker extends IMarkerData {
  owner: string;
  resource?: string;
}

export interface IModelDecorationOptions {
  /** CSS class name (used for class-based heuristics & styling) */
  className?: string | null;
  /** Underline / squiggle */
  inlineClassName?: string | null;
  isWholeLine?: boolean;
  hoverMessage?: string | { value: string } | Array<{ value: string }>;
  glyphMarginHoverMessage?: string | { value: string } | Array<{ value: string }>;
  overviewRuler?: { color: string; position?: number } | null;
  minimap?: { color: string; position?: number } | null;
  glyphMarginClassName?: string | null;
  /** Mono canvas: direct glyph margin dot/badge color (e.g. `#e51400` for breakpoints). */
  glyphMarginColor?: string;
  /** Mono canvas: optional single-char or icon symbol in glyph margin (e.g. `●`, `◆`, `▸`). */
  glyphMarginSymbol?: string;
  linesDecorationsClassName?: string | null;
  stickiness?: TrackedRangeStickiness;
  zIndex?: number;
  /** Mono canvas: explicit underline style */
  monoUnderline?: 'none' | 'squiggle' | 'solid' | 'dots';
  monoUnderlineColor?: string;
  monoBackgroundColor?: string;
}

export interface IModelDeltaDecoration {
  range: IRange;
  options: IModelDecorationOptions;
}

export interface IModelDecoration {
  id: string;
  ownerId: number;
  range: IRange;
  options: IModelDecorationOptions;
}

export interface DecorationRenderItem {
  range: IRange;
  underline: 'none' | 'squiggle' | 'solid' | 'dots';
  color: string;
  background?: string;
  isWholeLine?: boolean;
  severity?: MarkerSeverity;
  tags?: MarkerTag[];
  glyphMarginColor?: string;
  glyphMarginSymbol?: string;
  glyphMarginClassName?: string | null;
}

export interface IEditorDecorationsCollection {
  readonly length: number;
  set(newDecorations: readonly IModelDeltaDecoration[]): string[];
  append(newDecorations: readonly IModelDeltaDecoration[]): string[];
  clear(): void;
  getRange(index: number): IRange | null;
  getRanges(): IRange[];
  has(decoration: IModelDecoration): boolean;
}
