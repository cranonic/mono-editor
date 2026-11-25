import {
  DEFAULT_RAINBOW_BRACKET_COLORS,
  DEFAULT_UNEXPECTED_BRACKET_COLOR,
  type LineBracketColor,
} from '../../common/brackets/bracketColorizerTypes';
import type { ColorMatch } from '../../common/color/colorTypes';
import { hexToRgba, hslToRgba, rgbaToHsl } from '../../common/color/colorParse';
import { rgbaToHex } from '../../common/color/colorFormat';
import type {
  CursorStyleMode,
  MonoErrorLensOptions,
  MonoLineNumbers,
  RenderLineHighlightMode,
  RenderMetrics,
  RenderWhitespaceMode,
} from '../../common/config/editorOptions';
import type { MonoEditorTheme } from '../../common/config/themeTypes';
import type { SelectionState } from '../../common/core/SelectionState';
import type {
  BracketMatchPair,
  IndentGuideInfo,
  OccurrenceHighlight,
} from '../../common/editOperations/CodeFeatures';
import type { IRange } from '../../common/core/types';
import type { IMarker, MarkerTag } from '../../common/decorations/types';
import { DEFAULT_TOKEN_COLORS, type MonoToken } from '../../common/languages/tokenization/tokenTypes';
import type { SemanticTokenSpan } from '../../common/languages/semanticTokens';
import type { TextModel } from '../../common/model/TextModel';
import type { StickyRenderLine } from '../../common/viewModel/StickyScroll';
import type { ViewLineProjection, VisualLine } from '../../common/viewModel/ViewLineProjection';
import {
  collectInlineVirtualElements,
  virtualAdvanceBeforeColumn,
  virtualElementStartX,
  type InlineGhostRun,
  type InlineVirtualElement,
  type ResolvedInlayHint,
} from '../../common/virtualText';

export type { RenderMetrics };

/** Horizontal pixel advance reserved for each inline Monaco-style color bullet swatch. */
export const COLOR_SWATCH_SIZE = 11;
export const COLOR_SWATCH_GAP = 5;
export const COLOR_SWATCH_ADVANCE = COLOR_SWATCH_SIZE + COLOR_SWATCH_GAP;

/** Smaller width; body hangs below tip (tip stays on baseline). */
export const TEARDROP = { w: 26, h: 34 };

export interface TeardropHit {
  type: 'cursor' | 'start' | 'end';
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FoldHit {
  lineNumber: number;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'chevron' | 'badge';
}

export interface ColorHit {
  match: ColorMatch;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface InlayHintHit {
  hint: ResolvedInlayHint;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LinkHit {
  range: IRange;
  url?: string;
  tooltip?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FreeHandleVisual {
  type: 'cursor' | 'start' | 'end';
  x: number;
  y: number;
}

export interface OrderedSelectionSlice {
  isEmpty: boolean;
  caretLine: number;
  caretCol: number;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export interface PaintDecorationSpec {
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
  underline: 'none' | 'squiggle' | 'solid' | 'dots';
  color: string;
  background?: string;
  isWholeLine?: boolean;
  tags?: MarkerTag[];
  glyphMarginColor?: string;
  glyphMarginSymbol?: string;
  glyphMarginClassName?: string | null;
}

export interface PaintOptions {
  model: TextModel;
  selection: SelectionState;
  scrollTop: number;
  scrollLeft: number;
  cssWidth: number;
  cssHeight: number;
  metrics: RenderMetrics;
  theme: MonoEditorTheme;
  showLineNumbers: boolean;
  overscan: number;
  showTeardrops?: boolean;
  handlesVisible?: boolean;
  handleAlpha?: number;
  freeHandle?: FreeHandleVisual | null;
  projection?: ViewLineProjection;
  folding?: {
    enabled: boolean;
    isFoldable: (lineNumber: number) => boolean;
    isCollapsed: (lineNumber: number) => boolean;
  };
  bracketMatch?: BracketMatchPair | null;
  occurrences?: OccurrenceHighlight[];
  indentGuides?: {
    info: IndentGuideInfo;
    show: boolean;
    highlightActive: boolean;
    tabSize: number;
  } | null;
  getLineTokens?: (lineNumber: number) => MonoToken[];
  stickyLines?: StickyRenderLine[];
  bottomSticky?: { lineNumber: number; caretColumn: number } | null;
  findMatches?: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }[];
  findCurrentIndex?: number;
  decorations?: PaintDecorationSpec[];
  compositionRange?: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  } | null;
  dynamicCaretColor?: boolean;
  topInsetPx?: number;
  viewZone?: { afterVisualRow: number; heightPx: number } | null;
  viewZones?: readonly { afterVisualRow: number; heightPx: number }[];
  lineNumbersMode?: MonoLineNumbers;
  glyphMargin?: boolean;
  renderWhitespace?: RenderWhitespaceMode;
  rulers?: readonly number[];
  renderLineHighlight?: RenderLineHighlightMode;
  cursorStyle?: CursorStyleMode;
  cursorOpacity?: number;
  errorLens?: MonoErrorLensOptions | null;
  markers?: readonly IMarker[];
  getLineColors?: (lineNumber: number) => readonly ColorMatch[];
  getLineBrackets?: (lineNumber: number) => readonly LineBracketColor[];
  resolveBracketColor?: (entry: LineBracketColor) => string;
  getLineInlayHints?: (lineNumber: number) => readonly ResolvedInlayHint[];
  getLineGhostInline?: (lineNumber: number) => readonly InlineGhostRun[];
  getLineSemanticTokens?: (lineNumber: number) => readonly SemanticTokenSpan[];
  getLineLinks?: (lineNumber: number) => readonly { range: IRange; url?: string | { toString(): string }; tooltip?: string }[];
  hoverRange?: IRange | null;
  documentHighlights?: readonly { range: IRange; kind?: number }[];
  ghostTextItalic?: boolean;
}

export interface FrameContext {
  opts: PaintOptions;
  dark: boolean;
  glyphMarginWidth: number;
  foldGutterWidth: number;
  gutterNumberPad: number;
  contentLeft: number;
  textX0: number;
  firstRow: number;
  lastRow: number;
  tokenColors: Record<string, string | undefined>;
  orderedSelections: OrderedSelectionSlice[];
  primaryRange: { startLine: number; startCol: number; endLine: number; endCol: number };
  hasSelection: boolean;
  caretLine: number;
  caretCol: number;
  rowTopY: (row: number) => number;
  getVisualLine: (row: number) => VisualLine;
  colorsForLine: (lineNumber: number) => readonly ColorMatch[];
  inlayHintsForLine: (lineNumber: number) => readonly ResolvedInlayHint[];
  ghostInlineForLine: (lineNumber: number) => readonly InlineGhostRun[];
  semanticTokensForLine: (lineNumber: number) => readonly SemanticTokenSpan[];
  linksForLine: (lineNumber: number) => readonly { range: IRange; url?: string | { toString(): string }; tooltip?: string }[];
  virtualElementsForLine: (lineNumber: number) => readonly InlineVirtualElement[];
  bracketsForLine: (lineNumber: number) => readonly LineBracketColor[];
  bracketColorOf: (entry: LineBracketColor) => string;
  measureColumnX: (line: string, col: number) => number;
  measureText: (text: string) => number;
  /** Real text X at `col` (shifts past swatches, inlay hints, and inline ghost text at `<= col`). */
  segX: (content: string, seg: VisualLine, col: number) => number;
  /** Caret X at `col` (sits to the LEFT of inline ghost text anchored at `col`). */
  segCaretX: (content: string, seg: VisualLine, col: number) => number;
  /** Element start X inside `seg` for a virtual element (0=swatch, 1=inlay, 2=ghost). */
  segVirtualX: (content: string, seg: VisualLine, col: number, order: number, idx?: number) => number;
  tokenColorAt: (lineNumber: number, col: number) => string;
  foldHits: FoldHit[];
  colorHits: ColorHit[];
  inlayHits: InlayHintHit[];
  linkHits: LinkHit[];
  teardrops: TeardropHit[];
}

export interface RenderPass {
  readonly name: string;
  paint(ctx: CanvasRenderingContext2D, frame: FrameContext): void;
}

export function isDarkHex(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return true;
  const n = parseInt(m[1]!, 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum < 0.5;
}

export function orderedSelection(sel: SelectionState): {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
} {
  const a = sel.anchor;
  const b = sel.active;
  const aBefore =
    a.lineNumber < b.lineNumber ||
    (a.lineNumber === b.lineNumber && a.column <= b.column);
  return aBefore
    ? { startLine: a.lineNumber, startCol: a.column, endLine: b.lineNumber, endCol: b.column }
    : { startLine: b.lineNumber, startCol: b.column, endLine: a.lineNumber, endCol: a.column };
}

/**
 * Converts a raw syntax token hex color into a softened, perceptually balanced tint
 * tuned to the active editor theme polarity.
 */
export function softenDynamicColor(hex: string, isDark: boolean): string {
  const rgba = hexToRgba(hex);
  if (!rgba) return hex;
  const hsl = rgbaToHsl(rgba);
  const sat = hsl.s < 8 ? Math.min(hsl.s, 10) : Math.max(40, Math.min(64, Math.round(hsl.s * 0.78)));
  const lit = isDark
    ? Math.max(66, Math.min(76, Math.round(hsl.l * 0.42 + 44)))
    : Math.max(34, Math.min(44, Math.round(hsl.l * 0.38 + 22)));
  return rgbaToHex(hslToRgba(hsl.h, sat, lit, 1), false);
}

/**
 * Resolves the dynamic caret / teardrop color at a 1-based column from syntax tokens.
 */
export function resolveDynamicCaretColor(
  tokens: readonly MonoToken[] | undefined,
  col: number,
  tokenColors: Record<string, string | undefined>,
  fallback: string,
  enabled = true,
  isDark = true,
): string {
  if (!enabled || !tokens || !tokens.length) return fallback;
  let matched: MonoToken | undefined;
  for (const tok of tokens) {
    if (col >= tok.startColumn && col < tok.endColumn) {
      matched = tok;
      break;
    }
  }
  if ((!matched || matched.type === 'plain') && col > 1) {
    const prevCol = col - 1;
    for (const tok of tokens) {
      if (prevCol >= tok.startColumn && prevCol < tok.endColumn) {
        matched = tok;
        break;
      }
    }
  }
  if (!matched || matched.type === 'plain') return fallback;
  const rawColor = tokenColors?.[matched.type];
  if (!rawColor) return fallback;
  return softenDynamicColor(rawColor, isDark);
}

export function colorAdvanceBefore(colors: readonly ColorMatch[] | undefined, col: number): number {
  if (!colors || !colors.length) return 0;
  let count = 0;
  for (const c of colors) {
    if (c.startColumn <= col) count++;
    else break;
  }
  return count * COLOR_SWATCH_ADVANCE;
}

export function buildFrameContext(
  opts: PaintOptions,
  measureColumnXFn: (line: string, col: number, metrics: RenderMetrics) => number,
  measureTextFn?: (text: string, metrics: RenderMetrics) => number,
): FrameContext {
  const {
    model,
    selection,
    scrollTop,
    scrollLeft,
    cssHeight,
    metrics,
    theme,
    showLineNumbers,
    overscan,
    projection,
    folding,
    getLineTokens,
    dynamicCaretColor = true,
    topInsetPx = 0,
    viewZone = null,
    getLineColors,
  } = opts;
  const { lineHeight, gutterWidth, paddingLeft, paddingTop } = metrics;
  const glyphMarginWidth = opts.glyphMargin ? (metrics.glyphMarginWidth ?? 18) : 0;
  const foldGutterWidth = folding?.enabled ? (metrics.foldGutterWidth ?? 16) : 0;
  const gutterNumberPad = metrics.gutterNumberPad ?? 6;
  const dark = isDarkHex(theme.background);

  const allZones = opts.viewZones && opts.viewZones.length
    ? opts.viewZones
    : viewZone
      ? [viewZone]
      : [];

  const totalVisualRows = projection ? projection.getVisualLineCount() : model.getLineCount();
  const rowTopY = (row: number): number => {
    let zoneExtra = 0;
    for (const z of allZones) {
      if (row > z.afterVisualRow) zoneExtra += z.heightPx;
    }
    return topInsetPx + paddingTop + row * lineHeight + zoneExtra - scrollTop;
  };

  const yStartDoc = Math.max(0, scrollTop - topInsetPx - paddingTop);
  let totalZonesH = 0;
  for (const z of allZones) totalZonesH += z.heightPx;
  const approxFirstRow = Math.max(0, Math.floor(Math.max(0, yStartDoc - totalZonesH) / lineHeight));
  const firstRow = Math.max(0, approxFirstRow - overscan);
  const visibleCount = Math.ceil((cssHeight + totalZonesH) / lineHeight) + overscan * 2 + 2;
  const lastRow = Math.min(totalVisualRows - 1, firstRow + visibleCount);

  const contentLeft = showLineNumbers || opts.glyphMargin ? gutterWidth : 0;
  const textX0 = contentLeft + paddingLeft - scrollLeft;

  const getVisualLine = (row: number): VisualLine => {
    if (projection) return projection.getVisualLine(row);
    const ln = row + 1;
    const len = model.getLineContent(ln).length;
    return {
      visualRow: row,
      modelLine: ln,
      startCol: 1,
      endCol: len + 1,
      isFirstSegment: true,
      isLastSegment: true,
      wrapIndentPx: 0,
    };
  };

  const lineColorCache = new Map<number, readonly ColorMatch[]>();
  const colorsForLine = (ln: number): readonly ColorMatch[] => {
    if (!getLineColors) return [];
    let c = lineColorCache.get(ln);
    if (!c) {
      c = getLineColors(ln);
      lineColorCache.set(ln, c);
    }
    return c;
  };

  const getLineBrackets = opts.getLineBrackets;
  const lineBracketCache = new Map<number, readonly LineBracketColor[]>();
  const bracketsForLine = (ln: number): readonly LineBracketColor[] => {
    if (!getLineBrackets) return [];
    let b = lineBracketCache.get(ln);
    if (!b) {
      b = getLineBrackets(ln);
      lineBracketCache.set(ln, b);
    }
    return b;
  };
  const fallbackRainbow =
    theme.rainbowBrackets && theme.rainbowBrackets.length > 0
      ? theme.rainbowBrackets
      : DEFAULT_RAINBOW_BRACKET_COLORS;
  const fallbackUnexpected = theme.unexpectedBracketColor ?? DEFAULT_UNEXPECTED_BRACKET_COLOR;
  const bracketColorOf = (entry: LineBracketColor): string => {
    if (opts.resolveBracketColor) return opts.resolveBracketColor(entry);
    if (entry.unexpected) return fallbackUnexpected;
    return fallbackRainbow[Math.max(0, entry.level) % fallbackRainbow.length] ?? fallbackUnexpected;
  };

  const measureColumnX = (line: string, col: number): number => measureColumnXFn(line, col, metrics);
  const measureText = (text: string): number =>
    measureTextFn ? measureTextFn(text, metrics) : measureColumnXFn(text, text.length + 1, metrics);

  const lineInlayCache = new Map<number, readonly ResolvedInlayHint[]>();
  const inlayHintsForLine = (ln: number): readonly ResolvedInlayHint[] => {
    if (!opts.getLineInlayHints) return [];
    let res = lineInlayCache.get(ln);
    if (!res) { res = opts.getLineInlayHints(ln); lineInlayCache.set(ln, res); }
    return res;
  };

  const lineGhostCache = new Map<number, readonly InlineGhostRun[]>();
  const ghostInlineForLine = (ln: number): readonly InlineGhostRun[] => {
    if (!opts.getLineGhostInline) return [];
    let res = lineGhostCache.get(ln);
    if (!res) { res = opts.getLineGhostInline(ln); lineGhostCache.set(ln, res); }
    return res;
  };

  const lineSemanticCache = new Map<number, readonly SemanticTokenSpan[]>();
  const semanticTokensForLine = (ln: number): readonly SemanticTokenSpan[] => {
    if (!opts.getLineSemanticTokens) return [];
    let res = lineSemanticCache.get(ln);
    if (!res) { res = opts.getLineSemanticTokens(ln); lineSemanticCache.set(ln, res); }
    return res;
  };

  const lineLinkCache = new Map<number, readonly { range: IRange; url?: string | { toString(): string }; tooltip?: string }[]>();
  const linksForLine = (ln: number) => {
    if (!opts.getLineLinks) return [];
    let res = lineLinkCache.get(ln);
    if (!res) { res = opts.getLineLinks(ln); lineLinkCache.set(ln, res); }
    return res;
  };

  const lineVirtualCache = new Map<number, readonly InlineVirtualElement[]>();
  const virtualElementsForLine = (ln: number): readonly InlineVirtualElement[] => {
    let els = lineVirtualCache.get(ln);
    if (!els) {
      const colors = colorsForLine(ln);
      const inlays = inlayHintsForLine(ln);
      const ghosts = ghostInlineForLine(ln);
      els = !colors.length && !inlays.length && !ghosts.length
        ? []
        : collectInlineVirtualElements({
            colors, inlayHints: inlays, ghostRuns: ghosts,
            swatchAdvancePx: COLOR_SWATCH_ADVANCE, measureText,
          });
      lineVirtualCache.set(ln, els);
    }
    return els;
  };

  const segXInternal = (content: string, seg: VisualLine, col: number, includeGhostAtSame: boolean): number => {
    const vels = virtualElementsForLine(seg.modelLine);
    const colAdv = virtualAdvanceBeforeColumn(vels, col, includeGhostAtSame);
    const originAdv = seg.startCol === 1 ? 0 : virtualAdvanceBeforeColumn(vels, seg.startCol, true);
    if (seg.startCol === 1 && seg.wrapIndentPx === 0) {
      return textX0 + measureColumnX(content, col) + colAdv;
    }
    const originPx = seg.startCol === 1 ? 0 : measureColumnX(content, seg.startCol);
    return textX0 + seg.wrapIndentPx + (measureColumnX(content, col) - originPx) + (colAdv - originAdv);
  };

  const segX = (content: string, seg: VisualLine, col: number): number => segXInternal(content, seg, col, true);
  const segCaretX = (content: string, seg: VisualLine, col: number): number => segXInternal(content, seg, col, false);
  const segVirtualX = (content: string, seg: VisualLine, col: number, order: number, idx = 0): number => {
    const vels = virtualElementsForLine(seg.modelLine);
    const originAdv = seg.startCol === 1 ? 0 : virtualAdvanceBeforeColumn(vels, seg.startCol, true);
    const originPx = seg.startCol === 1 ? 0 : measureColumnX(content, seg.startCol);
    const baseRealX = measureColumnX(content, col);
    return textX0 + seg.wrapIndentPx + virtualElementStartX(baseRealX, vels, col, order, idx) - originPx - originAdv;
  };

  const tokenColors: Record<string, string | undefined> = {
    ...DEFAULT_TOKEN_COLORS,
    ...(theme.tokenColors ?? {}),
  };
  const fallbackCaretColor = theme.caret || '#007acc';
  const tokenColorAt = (ln: number, col: number): string =>
    resolveDynamicCaretColor(
      getLineTokens?.(ln),
      col,
      tokenColors,
      fallbackCaretColor,
      dynamicCaretColor,
      dark,
    );

  const orderedSelections: OrderedSelectionSlice[] = selection.selections.map((s) => {
    const a = s.anchor;
    const b = s.active;
    const aBefore =
      a.lineNumber < b.lineNumber || (a.lineNumber === b.lineNumber && a.column <= b.column);
    return {
      isEmpty: a.lineNumber === b.lineNumber && a.column === b.column,
      caretLine: b.lineNumber,
      caretCol: b.column,
      startLine: aBefore ? a.lineNumber : b.lineNumber,
      startCol: aBefore ? a.column : b.column,
      endLine: aBefore ? b.lineNumber : a.lineNumber,
      endCol: aBefore ? b.column : a.column,
    };
  });

  return {
    opts,
    dark,
    glyphMarginWidth,
    foldGutterWidth,
    gutterNumberPad,
    contentLeft,
    textX0,
    firstRow,
    lastRow,
    tokenColors,
    orderedSelections,
    primaryRange: orderedSelection(selection),
    hasSelection: !selection.isEmpty,
    caretLine: selection.active.lineNumber,
    caretCol: selection.active.column,
    rowTopY,
    getVisualLine,
    colorsForLine,
    inlayHintsForLine,
    ghostInlineForLine,
    semanticTokensForLine,
    linksForLine,
    virtualElementsForLine,
    bracketsForLine,
    bracketColorOf,
    measureColumnX,
    measureText,
    segX,
    segCaretX,
    segVirtualX,
    tokenColorAt,
    foldHits: [],
    colorHits: [],
    inlayHits: [],
    linkHits: [],
    teardrops: [],
  };
}
