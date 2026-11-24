import type { LineBracketColor } from '../../common/brackets/bracketColorizerTypes';
import type { ColorMatch } from '../../common/color/colorTypes';
import type { RenderMetrics } from '../../common/config/editorOptions';
import type { MonoEditorTheme } from '../../common/config/themeTypes';
import type { SelectionState } from '../../common/core/SelectionState';
import type { DecorationRenderItem } from '../../common/decorations/types';
import {
  computeIndentGuides,
  findMatchingBracket,
  findVisibleOccurrences,
} from '../../common/editOperations/CodeFeatures';
import { getLanguageConfiguration } from '../../common/languages/languageConfigurationRegistry';
import type { TokenizationSupport } from '../../common/languages/tokenization/TokenizationSupport';
import type { TextModel } from '../../common/model/TextModel';
import type { FoldingModel } from '../../common/viewModel/FoldingModel';
import type { MonoStickyScrollOptions, StickyRenderLine } from '../../common/viewModel/StickyScroll';
import {
  ViewLineProjection,
  type WordWrapMode,
  type WrappingIndentMode,
} from '../../common/viewModel/ViewLineProjection';
import type {
  CanvasRenderer,
  ColorHit,
  FoldHit,
  FreeHandleVisual,
} from '../render/CanvasRenderer';
import {
  computeScreenPosOf,
  hitTestPosition,
  lineColumnAtX,
  measureLineColumnX,
  type HitTestContext,
} from './hitTest';
import { StickyScrollController, type StickyComputeArgs } from './stickyScrollController';
import {
  computeMaxContentWidthPx,
  computeRowDocTop,
  computeScrollHeight,
  resolveViewZoneAfterRow,
  type MaxCharsCache,
  type ViewZoneSpec,
} from './viewLayout';
import { computeCenterReveal, quantizeStickyScrollTop } from './scrollReveal';

export class ViewController {
  scrollTop = 0;
  scrollLeft = 0;
  handlesVisible = true;
  handleAlpha = 1;
  cssWidth = 0;
  cssHeight = 0;
  freeHandle: FreeHandleVisual | null = null;
  readonly projection = new ViewLineProjection();
  compositionRange: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  } | null = null;

  private model: TextModel;
  private selection: SelectionState;
  private renderer: CanvasRenderer;
  private getMetrics: () => RenderMetrics;
  private getTheme: () => MonoEditorTheme;
  private showLineNumbers: () => boolean;
  private overscan: number;
  private tokenization: TokenizationSupport | null;
  private sticky: StickyScrollController;
  private scrollBeyondLastLine: boolean;
  private wordWrap: WordWrapMode = 'off';
  private wrappingIndent: WrappingIndentMode = 'same';
  private tabSize = 2;
  private foldingEnabled = true;
  private foldingModel: FoldingModel | null = null;
  private showIndentGuides = true;
  private highlightActiveIndentGuide = true;
  private matchBrackets: 'always' | 'near' | 'never' = 'always';
  private occurrencesHighlight = true;
  private dynamicCaretColor = true;
  private topInsetPx = 0;
  private rightInsetPx = 0;
  private viewZone: ViewZoneSpec | null = null;
  private getTokenTypeAt: ((lineNumber: number, column: number) => string | null) | null = null;
  private getLineColors: ((lineNumber: number) => readonly ColorMatch[]) | null = null;
  private getLineBrackets: ((lineNumber: number) => readonly LineBracketColor[]) | null = null;
  private resolveBracketColor: ((entry: LineBracketColor) => string) | null = null;
  private onPaintCb: (() => void) | null = null;
  private paintRaf = 0;
  private maxCharsCache: MaxCharsCache | null = null;
  private getDecorationRender: (() => DecorationRenderItem[]) | null = null;
  private getFindDecorations: (() => {
    matches: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }[];
    currentIndex: number;
  }) | null = null;

  constructor(
    model: TextModel,
    selection: SelectionState,
    renderer: CanvasRenderer,
    getMetrics: () => RenderMetrics,
    getTheme: () => MonoEditorTheme,
    showLineNumbers: () => boolean,
    overscan: number,
    tokenization: TokenizationSupport | null = null,
    stickyScroll?: MonoStickyScrollOptions,
    scrollBeyondLastLine = true,
  ) {
    this.sticky = new StickyScrollController(model, stickyScroll);
    this.scrollBeyondLastLine = scrollBeyondLastLine;
    this.model = model;
    this.selection = selection;
    this.renderer = renderer;
    this.getMetrics = getMetrics;
    this.getTheme = getTheme;
    this.showLineNumbers = showLineNumbers;
    this.overscan = overscan;
    this.tokenization = tokenization;
  }

  get lastSticky(): StickyRenderLine[] { return this.sticky.lastSticky; }
  get lastStickyHeight(): number { return this.sticky.lastStickyHeight; }
  get lastBottomSticky(): { lineNumber: number; caretColumn: number } | null {
    return this.sticky.lastBottomSticky;
  }
  set lastBottomSticky(val: { lineNumber: number; caretColumn: number } | null) {
    this.sticky.lastBottomSticky = val;
  }

  get contentLeft(): number {
    return this.showLineNumbers() ? this.getMetrics().gutterWidth : 0;
  }

  setOnPaint(cb: (() => void) | null): void { this.onPaintCb = cb; }
  setTokenTypeProvider(fn: ((lineNumber: number, column: number) => string | null) | null): void { this.getTokenTypeAt = fn; }
  setLineColorsProvider(fn: ((lineNumber: number) => readonly ColorMatch[]) | null): void { this.getLineColors = fn; }
  setLineBracketsProvider(get: ((ln: number) => readonly LineBracketColor[]) | null, resolve: ((e: LineBracketColor) => string) | null): void {
    this.getLineBrackets = get; this.resolveBracketColor = resolve;
  }
  setDecorationRenderProvider(fn: (() => DecorationRenderItem[]) | null): void { this.getDecorationRender = fn; }
  setFindDecorationsProvider(fn: (() => { matches: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }[]; currentIndex: number }) | null): void {
    this.getFindDecorations = fn;
  }

  setFoldingModel(folding: FoldingModel | null): void {
    this.foldingModel = folding;
    this.projection.invalidate();
  }

  setFoldingEnabled(enabled: boolean): void {
    if (this.foldingEnabled === enabled) return;
    this.foldingEnabled = enabled;
    if (!enabled) this.foldingModel?.unfoldAll();
    this.projection.invalidate();
    this.clampScroll();
    this.schedulePaint();
  }

  setWordWrap(mode: WordWrapMode, indent?: WrappingIndentMode): void {
    this.wordWrap = mode;
    if (indent != null) this.wrappingIndent = indent;
    if (mode === 'on') this.scrollLeft = 0;
    this.projection.invalidate();
    this.clampScroll();
    this.schedulePaint();
  }

  getWordWrap(): WordWrapMode { return this.wordWrap; }

  setTabSize(size: number): void {
    this.tabSize = Math.max(1, size);
    this.projection.invalidate();
  }

  setIndentGuides(opts: { indentation?: boolean; highlightActiveIndentation?: boolean }): void {
    if (opts.indentation !== undefined) this.showIndentGuides = opts.indentation;
    if (opts.highlightActiveIndentation !== undefined) this.highlightActiveIndentGuide = opts.highlightActiveIndentation;
    this.schedulePaint();
  }

  setMatchBrackets(mode: 'always' | 'near' | 'never'): void { this.matchBrackets = mode; this.schedulePaint(); }
  setOccurrencesHighlight(enabled: boolean): void { this.occurrencesHighlight = enabled; this.schedulePaint(); }
  setDynamicCaretColor(enabled: boolean): void { this.dynamicCaretColor = enabled; this.schedulePaint(); }
  getDynamicCaretColor(): boolean { return this.dynamicCaretColor; }

  /**
   * Reserves `px` above line 1 (Find widget). Content is drawn `topInsetPx` lower than the doc origin, so the scroll
   * position moves by the same delta: nothing jumps on open/close, and the gap above line 1 only shows once the
   * user scrolls to the very top (sticky headers use `scrollTop - topInsetPx`, i.e. are unaffected).
   */
  setTopInset(px: number): void {
    const next = Math.max(0, Math.round(px));
    if (this.topInsetPx === next) return;
    const delta = next - this.topInsetPx;
    this.topInsetPx = next;
    this.scrollTop = Math.max(0, this.scrollTop + delta);
    this.clampScroll();
    this.paint();
  }
  getTopInset(): number { return this.topInsetPx; }

  setRightInset(px: number): void {
    const next = Math.max(0, Math.round(px));
    if (this.rightInsetPx === next) return;
    this.rightInsetPx = next;
    this.projection.invalidate();
    this.clampScroll();
    this.paint();
  }
  getRightInset(): number { return this.rightInsetPx; }

  setViewZone(zone: ViewZoneSpec | null): void {
    this.viewZone = zone
      ? { id: zone.id, afterLineNumber: Math.max(1, zone.afterLineNumber), heightPx: Math.max(0, Math.round(zone.heightPx)) }
      : null;
    this.clampScroll();
    this.paint();
  }
  getViewZone(): ViewZoneSpec | null { return this.viewZone; }

  getViewZoneScreenRect(): { top: number; height: number; afterVisualRow: number } | null {
    if (!this.viewZone) return null;
    this.syncProjection();
    const m = this.getMetrics();
    const afterRow = resolveViewZoneAfterRow(this.viewZone, this.model, this.projection);
    if (afterRow < 0) return null;
    const top = this.topInsetPx + m.paddingTop + (afterRow + 1) * m.lineHeight - this.scrollTop;
    return { top, height: this.viewZone.heightPx, afterVisualRow: afterRow };
  }

  getColorHits(): ColorHit[] { return this.renderer.lastColorHits; }
  getFoldHits(): FoldHit[] { return this.renderer.lastFoldHits; }

  setModel(model: TextModel): void {
    this.model = model;
    this.maxCharsCache = null;
    this.viewZone = null;
    this.sticky.setModel(model, this.tabSize);
    this.projection.invalidate();
  }

  syncProjection(): void {
    const m = this.getMetrics();
    const wrapWidthPx = Math.max(0, this.cssWidth - this.contentLeft - this.rightInsetPx - m.paddingLeft - 16);
    const hasFolds = Boolean(this.foldingEnabled && this.foldingModel?.hasCollapsed());
    this.projection.sync({
      model: this.model,
      modelVersion: this.model.getVersionId(),
      foldVersion: this.foldingModel?.getVersion() ?? 0,
      hasFolds,
      isLineHidden: (ln) => this.foldingModel?.isLineHidden(ln) ?? false,
      wordWrap: this.wordWrap,
      wrappingIndent: this.wrappingIndent,
      wrapWidthPx,
      tabSize: this.tabSize,
      charWidth: m.charWidth,
      measureColumnX: (text, col) => this.renderer.measureColumnX(text, col, m),
    });
  }

  setSize(width: number, height: number): void {
    this.cssWidth = Math.max(0, width);
    this.cssHeight = Math.max(0, height);
    this.renderer.resize(this.cssWidth, this.cssHeight);
    this.syncProjection();
    this.clampScroll();
    this.paint();
  }

  scrollBy(dx: number, dy: number): void {
    if (this.wordWrap === 'on') this.scrollLeft = 0;
    else this.scrollLeft = Math.max(0, this.scrollLeft + dx);
    this.scrollTop = Math.max(0, this.scrollTop + dy);
    this.clampScroll();
    this.schedulePaint();
  }

  clampScrollPublic(): void { this.clampScroll(); }

  setScrollBeyondLastLine(enabled: boolean): void {
    if (this.scrollBeyondLastLine === enabled) return;
    this.scrollBeyondLastLine = enabled;
    this.clampScroll();
    this.schedulePaint();
  }
  getScrollBeyondLastLine(): boolean { return this.scrollBeyondLastLine; }

  getScrollHeight(): number {
    this.syncProjection();
    return computeScrollHeight(
      this.projection.getVisualLineCount(),
      this.getMetrics(),
      this.topInsetPx,
      this.viewZone,
      this.scrollBeyondLastLine,
      this.cssHeight,
    );
  }

  getMaxScrollTop(): number { return Math.max(0, this.getScrollHeight() - this.cssHeight); }

  getScrollWidth(): number { return Math.max(this.cssWidth, this.maxContentWidthPx()); }

  measureColumnX(lineNumber: number, col: number): number {
    return measureLineColumnX(this.model, this.renderer, this.getMetrics(), this.getLineColors, lineNumber, col);
  }

  columnAtX(lineNumber: number, textX: number, round = true): number {
    return lineColumnAtX(this.model, this.renderer, this.getMetrics(), this.getLineColors, lineNumber, textX, round);
  }

  positionAtPoint(localX: number, localY: number, round = true): { lineNumber: number; column: number } {
    this.syncProjection();
    return hitTestPosition(this.buildHitContext(), localX, localY, round);
  }

  screenPosOf(line: number, col: number): { x: number; y: number; h: number } {
    this.syncProjection();
    return computeScreenPosOf(this.buildHitContext(), line, col);
  }

  isLineInView(line: number): boolean {
    this.syncProjection();
    const m = this.getMetrics();
    const row = this.projection.modelLineToFirstVisualRow(line);
    const afterRow = resolveViewZoneAfterRow(this.viewZone, this.model, this.projection);
    const top = computeRowDocTop(row, m, this.topInsetPx, this.viewZone, afterRow) - this.scrollTop;
    const visibleTop = Math.max(this.topInsetPx, this.lastStickyHeight);
    const visibleBottom = this.cssHeight - (this.lastBottomSticky ? m.lineHeight : 0);
    return top + m.lineHeight > visibleTop && top < visibleBottom;
  }

  caretScreenPos(): { x: number; y: number; h: number } {
    return this.screenPosOf(this.selection.active.lineNumber, this.selection.active.column);
  }

  setStickyScroll(opts: MonoStickyScrollOptions): void {
    this.sticky.setOptions(opts);
    this.schedulePaint();
  }

  invalidateScopes(): void {
    this.sticky.invalidate();
    this.projection.invalidate();
  }

  getStickyScrollOptions(): Required<MonoStickyScrollOptions> { return this.sticky.getOptions(); }

  ensureCaretVisible(): void {
    this.syncProjection();
    const m = this.getMetrics();
    const line = this.selection.active.lineNumber;
    const col = this.selection.active.column;
    const mapped = this.projection.modelToVisual(line, col);
    const afterRow = resolveViewZoneAfterRow(this.viewZone, this.model, this.projection);
    const topY = computeRowDocTop(mapped.visualRow, m, this.topInsetPx, this.viewZone, afterRow);

    const minVisibleY = this.scrollTop + this.topInsetPx + m.paddingTop;
    if (topY < minVisibleY) this.scrollTop = Math.max(0, topY - this.topInsetPx - m.paddingTop);
    if (topY + m.lineHeight > this.scrollTop + this.cssHeight) {
      this.scrollTop = topY + m.lineHeight - this.cssHeight;
    }

    this.revealCaretHorizontally(line, col);
    this.clampScroll();
  }

  private revealCaretHorizontally(line: number, col: number): void {
    if (this.wordWrap === 'on') {
      this.scrollLeft = 0;
      return;
    }
    const m = this.getMetrics();
    const contentLeft = this.contentLeft;
    const caretXDoc = contentLeft + m.paddingLeft + this.measureColumnX(line, col);
    const margin = Math.max(m.charWidth * 2, 24);
    const viewLeft = contentLeft + margin;
    const viewRight = Math.max(viewLeft + 24, this.cssWidth - this.rightInsetPx - margin);
    const screenX = caretXDoc - this.scrollLeft;
    if (screenX < viewLeft) this.scrollLeft = Math.max(0, caretXDoc - viewLeft);
    else if (screenX > viewRight) this.scrollLeft = Math.max(0, caretXDoc - viewRight);
  }

  /** Height of the top sticky stack that would be shown at `scrollTop` (no state change). */
  private stickyArgs(renderTop: number, metrics: RenderMetrics = this.getMetrics()): StickyComputeArgs {
    return {
      model: this.model,
      selection: this.selection,
      projection: this.projection,
      metrics,
      renderTop,
      topInsetPx: this.topInsetPx,
      cssHeight: this.cssHeight,
      tabSize: this.tabSize,
      foldingEnabled: this.foldingEnabled,
      foldingModel: this.foldingModel,
    };
  }

  private stickyHeightAt(scrollTop: number): number {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    return this.sticky.peekHeight(this.stickyArgs(quantizeStickyScrollTop(scrollTop, dpr)));
  }

  /** Find next / previous: centre the caret line when it is under the widget / sticky stack / bottom bar. */
  revealCaretInCenterIfOutside(): void {
    this.syncProjection();
    const m = this.getMetrics();
    const { lineNumber: line, column: col } = this.selection.active;
    const row = this.projection.modelToVisual(line, col).visualRow;
    const afterRow = resolveViewZoneAfterRow(this.viewZone, this.model, this.projection);
    this.scrollTop = computeCenterReveal({
      scrollTop: this.scrollTop,
      rowTop: computeRowDocTop(row, m, this.topInsetPx, this.viewZone, afterRow),
      lineHeight: m.lineHeight,
      cssHeight: this.cssHeight,
      topInsetPx: this.topInsetPx,
      maxScrollTop: this.getMaxScrollTop(),
      stickyHeightAt: (s) => this.stickyHeightAt(s),
    });
    this.revealCaretHorizontally(line, col);
    this.clampScroll();
  }

  schedulePaint(): void {
    if (this.paintRaf) return;
    this.paintRaf = requestAnimationFrame(() => {
      this.paintRaf = 0;
      this.paint();
    });
  }

  paint(): void {
    if (this.paintRaf) {
      cancelAnimationFrame(this.paintRaf);
      this.paintRaf = 0;
    }
    if (this.cssWidth <= 0 || this.cssHeight <= 0) return;

    this.syncProjection();
    this.clampScroll();

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const renderTop = Math.round(this.scrollTop * dpr) / dpr;
    const renderLeft = Math.round(this.scrollLeft * dpr) / dpr;
    const metrics = this.getMetrics();

    const stickyLines = this.sticky.compute(this.stickyArgs(quantizeStickyScrollTop(this.scrollTop, dpr), metrics));

    const totalVisualRows = this.projection.getVisualLineCount();
    const firstRow = Math.max(0, Math.floor(renderTop / metrics.lineHeight) - this.overscan);
    const lastRow = Math.min(totalVisualRows - 1, firstRow + Math.ceil(this.cssHeight / metrics.lineHeight) + this.overscan * 2);
    const firstModelLine = this.projection.getVisualLine(firstRow).modelLine;
    const lastModelLine = this.projection.getVisualLine(lastRow).modelLine;

    const langConfig = getLanguageConfiguration(this.model.getLanguageId());
    const bracketMatch =
      this.matchBrackets !== 'never'
        ? findMatchingBracket(this.model, this.selection.active, langConfig, this.getTokenTypeAt ?? undefined)
        : null;
    const occurrences = this.occurrencesHighlight
      ? findVisibleOccurrences(this.model, this.selection, firstModelLine, lastModelLine)
      : [];
    const indentGuides = this.showIndentGuides
      ? {
          info: computeIndentGuides(this.model, firstModelLine, lastModelLine, this.selection.active.lineNumber, this.tabSize),
          show: true,
          highlightActive: this.highlightActiveIndentGuide,
          tabSize: this.tabSize,
        }
      : null;

    const afterRow = resolveViewZoneAfterRow(this.viewZone, this.model, this.projection);
    const resolvedViewZone = this.viewZone && afterRow >= 0 ? { afterVisualRow: afterRow, heightPx: this.viewZone.heightPx } : null;

    this.renderer.paint({
      model: this.model,
      selection: this.selection,
      scrollTop: renderTop,
      scrollLeft: renderLeft,
      cssWidth: this.cssWidth,
      cssHeight: this.cssHeight,
      metrics,
      theme: this.getTheme(),
      showLineNumbers: this.showLineNumbers(),
      overscan: this.overscan,
      projection: this.projection,
      folding: this.foldingModel
        ? {
            enabled: this.foldingEnabled,
            isFoldable: (ln) => this.foldingModel!.isFoldable(ln),
            isCollapsed: (ln) => this.foldingModel!.isCollapsed(ln),
          }
        : undefined,
      bracketMatch,
      occurrences,
      indentGuides,
      getLineTokens: this.tokenization ? (ln) => this.tokenization!.getLineTokens(this.model, ln) : undefined,
      freeHandle: this.freeHandle,
      handlesVisible: this.handlesVisible,
      handleAlpha: this.handleAlpha,
      stickyLines,
      bottomSticky: this.lastBottomSticky,
      decorations: this.getDecorationRender?.() ?? [],
      findMatches: this.getFindDecorations?.().matches ?? [],
      findCurrentIndex: this.getFindDecorations?.().currentIndex ?? -1,
      compositionRange: this.compositionRange,
      dynamicCaretColor: this.dynamicCaretColor,
      topInsetPx: this.topInsetPx,
      viewZone: resolvedViewZone,
      getLineColors: this.getLineColors ?? undefined,
      getLineBrackets: this.getLineBrackets ?? undefined,
      resolveBracketColor: this.resolveBracketColor ?? undefined,
    });
    this.onPaintCb?.();
  }

  hitTestSticky(localX: number, localY: number): { index: number; lineNumber: number } | null {
    return this.sticky.hitTestSticky(localX, localY, this.getMetrics().lineHeight);
  }

  hitTestBottomSticky(localX: number, localY: number): { lineNumber: number } | null {
    return this.sticky.hitTestBottomSticky(localX, localY, this.cssWidth, this.cssHeight, this.getMetrics().lineHeight);
  }

  revealBottomStickyLine(lineNumber: number, localX?: number): void {
    this.syncProjection();
    const m = this.getMetrics();
    const line = Math.max(1, Math.min(this.model.getLineCount(), lineNumber));
    const docY = m.paddingTop + this.projection.modelLineToFirstVisualRow(line) * m.lineHeight;
    this.scrollTop = Math.max(0, docY - (this.cssHeight - m.lineHeight) / 2);
    this.clampScroll();

    let col = this.selection.active.column;
    if (localX != null) {
      const textX = localX - this.contentLeft - m.paddingLeft + this.scrollLeft;
      col = this.columnAtX(line, textX, true);
    }
    this.selection.setCaret(line, col);
    this.sticky.lastBottomSticky = null;
    this.paint();
  }

  revealStickyLine(lineNumber: number, index: number, localX?: number): void {
    this.syncProjection();
    const m = this.getMetrics();
    const line = Math.max(1, Math.min(this.model.getLineCount(), lineNumber));
    const docY = m.paddingTop + this.projection.modelLineToFirstVisualRow(line) * m.lineHeight;
    // sticky slot `index` sits at viewport y = index*lh; content is drawn topInsetPx lower than doc space
    this.scrollTop = Math.max(0, docY + this.topInsetPx - index * m.lineHeight);
    this.clampScroll();

    let col = 1;
    if (localX != null) {
      const textX = localX - this.contentLeft - m.paddingLeft + this.scrollLeft;
      col = this.columnAtX(line, textX, true);
    }
    this.selection.setCaret(line, col);
    this.paint();
  }

  dispose(): void { if (this.paintRaf) { cancelAnimationFrame(this.paintRaf); this.paintRaf = 0; } }

  private buildHitContext(): HitTestContext {
    return { model: this.model, renderer: this.renderer, projection: this.projection, metrics: this.getMetrics(), contentLeft: this.contentLeft, scrollTop: this.scrollTop, scrollLeft: this.scrollLeft, topInsetPx: this.topInsetPx, viewZone: this.viewZone, getLineColors: this.getLineColors };
  }

  private maxContentWidthPx(): number {
    const res = computeMaxContentWidthPx(
      this.wordWrap,
      this.cssWidth,
      this.contentLeft,
      this.getMetrics(),
      this.model,
      this.renderer,
      this.maxCharsCache,
    );
    this.maxCharsCache = res.cache;
    return res.widthPx;
  }

  private clampScroll(): void {
    const maxTop = this.getMaxScrollTop();
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, maxTop));
    const maxLeft = Math.max(0, this.maxContentWidthPx() - Math.max(0, this.cssWidth - this.rightInsetPx));
    this.scrollLeft = Math.max(0, Math.min(this.scrollLeft, maxLeft));
  }
}
