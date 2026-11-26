import type { LineBracketColor } from '../../common/brackets/bracketColorizerTypes';
import type { ColorMatch } from '../../common/color/colorTypes';
import type {
  CursorBlinkingMode,
  CursorStyleMode,
  MonoErrorLensOptions,
  MonoLineNumbers,
  RenderLineHighlightMode,
  RenderMetrics,
  RenderWhitespaceMode,
} from '../../common/config/editorOptions';
import type { MonoEditorTheme } from '../../common/config/themeTypes';
import type { SelectionState, VirtualSide } from '../../common/core/SelectionState';
import type { IMouseTarget, IPosition, IRange } from '../../common/core/types';
import type { DecorationRenderItem, IMarker } from '../../common/decorations/types';
import {
  computeIndentGuides,
  findMatchingBracket,
  findVisibleOccurrences,
} from '../../common/editOperations/CodeFeatures';
import { getLanguageConfiguration } from '../../common/languages/languageConfigurationRegistry';
import type { DocumentHighlight, DocumentSymbol, ILink } from '../../common/languages/providers/extendedTypes';
import type { SemanticTokenSpan } from '../../common/languages/semanticTokens';
import type { TokenizationSupport } from '../../common/languages/tokenization/TokenizationSupport';
import type { TextModel } from '../../common/model/TextModel';
import type { FoldingModel } from '../../common/viewModel/FoldingModel';
import type { MonoStickyScrollOptions, StickyRenderLine } from '../../common/viewModel/StickyScroll';
import {
  ViewLineProjection,
  type WordWrapMode,
  type WrappingIndentMode,
} from '../../common/viewModel/ViewLineProjection';
import type { InlineGhostRun, ResolvedInlayHint, VirtualGhostRow } from '../../common/virtualText';
import type {
  CanvasRenderer,
  ColorHit,
  FoldHit,
  FreeHandleVisual,
  InlayHintHit,
  LinkHit,
} from '../render/CanvasRenderer';
import {
  computeScreenPosOf,
  computeTargetAtLocalPoint,
  hitTestPosition,
  hitTestVirtualSide,
  lineColumnAtX,
  measureLineColumnX,
  type HitTestContext,
} from './hitTest';
import { computeCenterReveal, quantizeStickyScrollTop } from './scrollReveal';
import { StickyScrollController, type StickyComputeArgs } from './stickyScrollController';
import {
  computeMaxContentWidthPx,
  computeScrollHeight,
  createRowGeometry,
  resolveAllViewZones,
  resolveViewZoneAfterRow,
  type MaxCharsCache,
  type ResolvedViewZone,
  type RowGeometry,
  type ViewZoneSpec,
} from './viewLayout';
import { createEmptyViewProviders, type ViewDataProviders } from './viewProviders';

export interface ViewDisplayPatch {
  lineNumbersMode?: MonoLineNumbers;
  glyphMargin?: boolean;
  renderWhitespace?: RenderWhitespaceMode;
  rulers?: readonly number[];
  renderLineHighlight?: RenderLineHighlightMode;
  cursorStyle?: CursorStyleMode;
  cursorBlinking?: CursorBlinkingMode;
  cursorSurroundingLines?: number;
  errorLens?: boolean | MonoErrorLensOptions;
}

export class ViewController {
  scrollTop = 0;
  scrollLeft = 0;
  handlesVisible = true;
  handleAlpha = 1;
  cssWidth = 0;
  cssHeight = 0;
  freeHandle: FreeHandleVisual | null = null;
  readonly projection = new ViewLineProjection();
  compositionRange: IRange | null = null;

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
  private lineNumbersMode: MonoLineNumbers = 'on';
  private glyphMargin = false;
  private renderWhitespace: RenderWhitespaceMode = 'none';
  private rulers: readonly number[] = [];
  private renderLineHighlight: RenderLineHighlightMode = 'line';
  private cursorStyle: CursorStyleMode = 'line';
  private cursorBlinking: CursorBlinkingMode = 'blink';
  private cursorSurroundingLines = 0;
  private errorLens: MonoErrorLensOptions | null = null;
  private hiddenAreas: IRange[] = [];
  private hiddenAreasVersion = 0;
  private topInsetPx = 0;
  private rightInsetPx = 0;
  private bottomInsetPx = 0;
  private viewZone: ViewZoneSpec | null = null;
  private extraViewZones: ViewZoneSpec[] = [];
  private markersProvider: (() => readonly IMarker[]) | null = null;
  private providers: ViewDataProviders = createEmptyViewProviders();
  private onPaintCb: (() => void) | null = null;
  private paintRaf = 0;
  private maxCharsCache: MaxCharsCache | null = null;

  constructor(
    model: TextModel, selection: SelectionState, renderer: CanvasRenderer,
    getMetrics: () => RenderMetrics, getTheme: () => MonoEditorTheme,
    showLineNumbers: () => boolean, overscan: number,
    tokenization: TokenizationSupport | null = null,
    stickyScroll?: MonoStickyScrollOptions, scrollBeyondLastLine = true,
  ) {
    this.sticky = new StickyScrollController(model, stickyScroll);
    this.scrollBeyondLastLine = scrollBeyondLastLine;
    this.model = model; this.selection = selection; this.renderer = renderer;
    this.getMetrics = getMetrics; this.getTheme = getTheme; this.showLineNumbers = showLineNumbers;
    this.overscan = overscan; this.tokenization = tokenization;
  }

  get lastSticky(): StickyRenderLine[] { return this.sticky.lastSticky; }
  get lastStickyHeight(): number { return this.sticky.lastStickyHeight; }
  get lastBottomSticky(): { lineNumber: number; caretColumn: number } | null { return this.sticky.lastBottomSticky; }
  set lastBottomSticky(val: { lineNumber: number; caretColumn: number } | null) { this.sticky.lastBottomSticky = val; }
  get contentLeft(): number { return this.showLineNumbers() || this.glyphMargin ? this.getMetrics().gutterWidth : 0; }

  setOnPaint(cb: (() => void) | null): void { this.onPaintCb = cb; }
  setMarkersProvider(fn: (() => readonly IMarker[]) | null): void { this.markersProvider = fn; }
  setTokenTypeProvider(fn: ((lineNumber: number, column: number) => string | null) | null): void { this.providers.getTokenTypeAt = fn; }
  setLineColorsProvider(fn: ((lineNumber: number) => readonly ColorMatch[]) | null): void { this.providers.getLineColors = fn; }
  setLineBracketsProvider(get: ((ln: number) => readonly LineBracketColor[]) | null, resolve: ((e: LineBracketColor) => string) | null): void {
    this.providers.getLineBrackets = get; this.providers.resolveBracketColor = resolve;
  }
  setDecorationRenderProvider(fn: (() => DecorationRenderItem[]) | null): void { this.providers.getDecorationRender = fn; }
  setFindDecorationsProvider(fn: ViewDataProviders['getFindDecorations']): void { this.providers.getFindDecorations = fn; }
  setLineInlayHintsProvider(fn: ((ln: number) => readonly ResolvedInlayHint[]) | null): void { this.providers.getLineInlayHints = fn; }
  setLineSemanticTokensProvider(fn: ((ln: number) => readonly SemanticTokenSpan[]) | null): void { this.providers.getLineSemanticTokens = fn; }
  setLineLinksProvider(fn: ((ln: number) => readonly ILink[]) | null): void { this.providers.getLineLinks = fn; }
  setHoverRangeProvider(fn: (() => IRange | null) | null): void { this.providers.getHoverRange = fn; }
  setDocumentHighlightsProvider(fn: (() => readonly DocumentHighlight[]) | null): void { this.providers.getDocumentHighlights = fn; }
  setStickyOutlineSymbols(symbols: readonly DocumentSymbol[] | null): void { this.sticky.setOutlineSymbols(symbols); }
  setGhostTextProviders(opts: {
    getLineGhostInline?: ((ln: number) => readonly InlineGhostRun[]) | null;
    getGhostVersion?: (() => number) | null;
    hasGhostRows?: (() => boolean) | null;
    getLineGhostRows?: ((ln: number, wrapWidthPx: number, effectiveWrap: boolean) => readonly VirtualGhostRow[]) | null;
    getGhostTextItalic?: (() => boolean) | null;
  }): void {
    this.providers.getLineGhostInline = opts.getLineGhostInline ?? null;
    this.providers.getGhostVersion = opts.getGhostVersion ?? null;
    this.providers.hasGhostRows = opts.hasGhostRows ?? null;
    this.providers.getLineGhostRows = opts.getLineGhostRows ?? null;
    this.providers.getGhostTextItalic = opts.getGhostTextItalic ?? null;
    this.projection.invalidate();
  }

  setDisplayOptions(patch: ViewDisplayPatch): void {
    if (patch.lineNumbersMode !== undefined) this.lineNumbersMode = patch.lineNumbersMode;
    if (patch.glyphMargin !== undefined) { this.glyphMargin = patch.glyphMargin; this.projection.invalidate(); }
    if (patch.renderWhitespace !== undefined) this.renderWhitespace = patch.renderWhitespace;
    if (patch.rulers !== undefined) this.rulers = [...patch.rulers];
    if (patch.renderLineHighlight !== undefined) this.renderLineHighlight = patch.renderLineHighlight;
    if (patch.cursorStyle !== undefined) this.cursorStyle = patch.cursorStyle;
    if (patch.cursorBlinking !== undefined) this.cursorBlinking = patch.cursorBlinking;
    if (patch.cursorSurroundingLines !== undefined) this.cursorSurroundingLines = Math.max(0, patch.cursorSurroundingLines);
    if (patch.errorLens !== undefined) {
      this.errorLens = typeof patch.errorLens === 'boolean' ? { enabled: patch.errorLens } : patch.errorLens;
    }
    this.schedulePaint();
  }

  getCursorBlinking(): CursorBlinkingMode { return this.cursorBlinking; }
  getCursorSurroundingLines(): number { return this.cursorSurroundingLines; }

  setHiddenAreas(ranges: readonly IRange[]): void {
    this.hiddenAreas = ranges.map((r) => ({ ...r }));
    this.hiddenAreasVersion++;
    this.projection.invalidate(); this.clampScroll(); this.schedulePaint();
  }
  private isLineInHiddenArea(ln: number): boolean {
    for (const r of this.hiddenAreas) if (ln >= r.startLineNumber && ln <= r.endLineNumber) return true;
    return false;
  }
  isLineHidden(ln: number): boolean {
    return (this.foldingEnabled && (this.foldingModel?.isLineHidden(ln) ?? false)) || this.isLineInHiddenArea(ln);
  }

  measureTextWidth(text: string): number { return this.renderer.measureTextWidth(text, this.getMetrics()); }
  setFoldingModel(folding: FoldingModel | null): void { this.foldingModel = folding; this.projection.invalidate(); }
  setFoldingEnabled(enabled: boolean): void {
    if (this.foldingEnabled === enabled) return;
    this.foldingEnabled = enabled;
    if (!enabled) this.foldingModel?.unfoldAll();
    this.projection.invalidate(); this.clampScroll(); this.schedulePaint();
  }
  setWordWrap(mode: WordWrapMode, indent?: WrappingIndentMode): void {
    this.wordWrap = mode;
    if (indent != null) this.wrappingIndent = indent;
    if (mode === 'on') this.scrollLeft = 0;
    this.projection.invalidate(); this.clampScroll(); this.schedulePaint();
  }
  getWordWrap(): WordWrapMode { return this.wordWrap; }
  setTabSize(size: number): void { this.tabSize = Math.max(1, size); this.projection.invalidate(); }
  setIndentGuides(opts: { indentation?: boolean; highlightActiveIndentation?: boolean }): void {
    if (opts.indentation !== undefined) this.showIndentGuides = opts.indentation;
    if (opts.highlightActiveIndentation !== undefined) this.highlightActiveIndentGuide = opts.highlightActiveIndentation;
    this.schedulePaint();
  }
  setMatchBrackets(mode: 'always' | 'near' | 'never'): void { this.matchBrackets = mode; this.schedulePaint(); }
  setOccurrencesHighlight(enabled: boolean): void { this.occurrencesHighlight = enabled; this.schedulePaint(); }
  setDynamicCaretColor(enabled: boolean): void { this.dynamicCaretColor = enabled; this.schedulePaint(); }
  getDynamicCaretColor(): boolean { return this.dynamicCaretColor; }

  setTopInset(px: number): void {
    const next = Math.max(0, Math.round(px));
    if (this.topInsetPx === next) return;
    const delta = next - this.topInsetPx;
    this.topInsetPx = next; this.scrollTop = Math.max(0, this.scrollTop + delta);
    this.clampScroll(); this.paint();
  }
  getTopInset(): number { return this.topInsetPx; }
  setRightInset(px: number): void {
    const next = Math.max(0, Math.round(px));
    if (this.rightInsetPx === next) return;
    this.rightInsetPx = next; this.projection.invalidate(); this.clampScroll(); this.paint();
  }
  getRightInset(): number { return this.rightInsetPx; }
  setBottomInset(px: number): void {
    const next = Math.max(0, Math.round(px));
    if (this.bottomInsetPx === next) return;
    this.bottomInsetPx = next; this.clampScroll(); this.schedulePaint();
  }
  getBottomInset(): number { return this.bottomInsetPx; }

  setViewZone(zone: ViewZoneSpec | null): void {
    this.viewZone = zone
      ? { id: zone.id, afterLineNumber: Math.max(1, zone.afterLineNumber), heightPx: Math.max(0, Math.round(zone.heightPx)) }
      : null;
    this.clampScroll(); this.paint();
  }
  getViewZone(): ViewZoneSpec | null { return this.viewZone; }
  setExtraViewZones(zones: readonly ViewZoneSpec[]): void {
    const anchorRow = this.scrollTop > 0 ? this.getRowGeometry().rowAtDocY(this.scrollTop + this.topInsetPx + 1).row : -1;
    const prevTop = anchorRow >= 0 ? this.getRowGeometry().topOfRow(anchorRow) : 0;
    this.extraViewZones = zones.map((z) => ({ ...z }));
    if (anchorRow >= 0) this.scrollTop = Math.max(0, this.scrollTop + (this.getRowGeometry().topOfRow(anchorRow) - prevTop));
    this.clampScroll(); this.paint();
  }
  hasViewZones(): boolean { return this.viewZone !== null || this.extraViewZones.length > 0; }
  private getCombinedZoneSpecs(): ViewZoneSpec[] {
    return this.viewZone ? [this.viewZone, ...this.extraViewZones] : this.extraViewZones;
  }
  private getResolvedZones(): ResolvedViewZone[] {
    const specs = this.getCombinedZoneSpecs();
    return specs.length ? resolveAllViewZones(specs, this.model, this.projection) : [];
  }
  getRowGeometry(metrics: RenderMetrics = this.getMetrics()): RowGeometry {
    return createRowGeometry(metrics, this.topInsetPx, this.getResolvedZones());
  }

  getViewZoneScreenRect(): { top: number; height: number; afterVisualRow: number } | null {
    if (!this.viewZone) return null;
    this.syncProjection();
    const m = this.getMetrics();
    const afterRow = resolveViewZoneAfterRow(this.viewZone, this.model, this.projection);
    if (afterRow < 0) return null;
    const geom = this.getRowGeometry(m);
    const top = geom.topOfRow(afterRow) + m.lineHeight - this.scrollTop;
    return { top, height: this.viewZone.heightPx, afterVisualRow: afterRow };
  }

  getZoneTopForLine(afterLineNumber: number, zoneId: string): number {
    this.syncProjection();
    const geom = this.getRowGeometry();
    const afterRow =
      afterLineNumber <= 0
        ? -1
        : resolveViewZoneAfterRow({ id: zoneId, afterLineNumber, heightPx: 1 }, this.model, this.projection);
    return geom.zoneDocTop(afterRow, zoneId) - this.scrollTop;
  }

  getColorHits(): ColorHit[] { return this.renderer.lastColorHits; }
  getStickyColorHits(): ColorHit[] { return this.renderer.lastStickyColorHits; }
  getFoldHits(): FoldHit[] { return this.renderer.lastFoldHits; }
  getInlayHits(): InlayHintHit[] { return this.renderer.lastInlayHits; }
  getLinkHits(): LinkHit[] { return this.renderer.lastLinkHits; }

  getVisibleLineRange(): { startLineNumber: number; endLineNumber: number } {
    this.syncProjection();
    const geom = this.getRowGeometry();
    const total = this.projection.getVisualLineCount();
    const firstRow = Math.max(0, geom.rowAtDocY(this.scrollTop).row - this.overscan);
    const lastRow = Math.min(total - 1, geom.rowAtDocY(this.scrollTop + (this.cssHeight || 400)).row + this.overscan);
    return {
      startLineNumber: this.projection.getVisualLine(firstRow).modelLine,
      endLineNumber: this.projection.getVisualLine(Math.max(firstRow, lastRow)).modelLine,
    };
  }

  getVisibleRanges(): IRange[] {
    this.syncProjection();
    const geom = this.getRowGeometry();
    const total = this.projection.getVisualLineCount();
    const firstRow = Math.max(0, Math.min(total - 1, geom.rowAtDocY(this.scrollTop + this.topInsetPx).row));
    const lastRow = Math.max(firstRow, Math.min(total - 1, geom.rowAtDocY(this.scrollTop + Math.max(geom.lineHeight, this.cssHeight)).row));
    const startLine = this.projection.getVisualLine(firstRow).modelLine;
    const endLine = this.projection.getVisualLine(lastRow).modelLine;
    return [{ startLineNumber: startLine, startColumn: 1, endLineNumber: endLine, endColumn: this.model.getLineContent(endLine).length + 1 }];
  }

  getTopForLineNumber(lineNumber: number): number {
    this.syncProjection();
    return this.getRowGeometry().topOfRow(this.projection.modelLineToFirstVisualRow(lineNumber));
  }

  getBottomForLineNumber(lineNumber: number): number {
    this.syncProjection();
    const m = this.getMetrics();
    const lines = this.projection.getVisualLinesForModelLine(lineNumber);
    const lastRow = lines.length ? lines[lines.length - 1]!.visualRow : this.projection.modelLineToFirstVisualRow(lineNumber);
    return this.getRowGeometry(m).topOfRow(lastRow) + m.lineHeight;
  }

  getOffsetForColumn(lineNumber: number, column: number): number { return this.measureColumnX(lineNumber, column); }
  getScrolledVisiblePosition(position: IPosition): { top: number; left: number; height: number } {
    const p = this.screenPosOf(position.lineNumber, position.column);
    return { top: p.y, left: p.x, height: p.h };
  }
  getTargetAtLocalPoint(localX: number, localY: number, element: unknown = null): IMouseTarget {
    this.syncProjection();
    return computeTargetAtLocalPoint(this.buildHitContext(), localX, localY, this.cssWidth, this.cssHeight, element);
  }

  setModel(model: TextModel): void {
    this.model = model; this.maxCharsCache = null; this.viewZone = null; this.hiddenAreas = [];
    this.sticky.setModel(model, this.tabSize); this.projection.invalidate();
  }

  syncProjection(): void {
    const m = this.getMetrics();
    const wrapWidthPx = Math.max(0, this.cssWidth - this.contentLeft - this.rightInsetPx - m.paddingLeft - 16);
    const hasFolds = Boolean((this.foldingEnabled && this.foldingModel?.hasCollapsed()) || this.hiddenAreas.length > 0);
    this.projection.sync({
      model: this.model, modelVersion: this.model.getVersionId(),
      foldVersion: (this.foldingModel?.getVersion() ?? 0) * 31 + this.hiddenAreasVersion,
      hasFolds,
      isLineHidden: (ln) => (this.foldingModel?.isLineHidden(ln) ?? false) || this.isLineInHiddenArea(ln),
      wordWrap: this.wordWrap, wrappingIndent: this.wrappingIndent, wrapWidthPx, tabSize: this.tabSize,
      charWidth: m.charWidth, measureColumnX: (text, col) => this.renderer.measureColumnX(text, col, m),
      ghostVersion: this.providers.getGhostVersion?.() ?? 0,
      hasGhostRows: this.providers.hasGhostRows?.() ?? false,
      getLineGhostRows: this.providers.getLineGhostRows ?? undefined,
    });
  }

  setSize(width: number, height: number): void {
    this.cssWidth = Math.max(0, width); this.cssHeight = Math.max(0, height);
    this.renderer.resize(this.cssWidth, this.cssHeight);
    this.syncProjection(); this.clampScroll(); this.paint();
  }

  scrollBy(dx: number, dy: number): void {
    this.scrollLeft = this.wordWrap === 'on' ? 0 : Math.max(0, this.scrollLeft + dx);
    this.scrollTop = Math.max(0, this.scrollTop + dy);
    this.clampScroll(); this.schedulePaint();
  }
  clampScrollPublic(): void { this.clampScroll(); }
  setScrollBeyondLastLine(enabled: boolean): void {
    if (this.scrollBeyondLastLine === enabled) return;
    this.scrollBeyondLastLine = enabled; this.clampScroll(); this.schedulePaint();
  }
  getScrollBeyondLastLine(): boolean { return this.scrollBeyondLastLine; }

  getContentHeight(): number {
    this.syncProjection();
    return computeScrollHeight(this.projection.getVisualLineCount(), this.getMetrics(), this.topInsetPx, this.viewZone, false, this.cssHeight, this.getCombinedZoneSpecs(), 0);
  }
  getScrollHeight(): number {
    this.syncProjection();
    return computeScrollHeight(this.projection.getVisualLineCount(), this.getMetrics(), this.topInsetPx, this.viewZone, this.scrollBeyondLastLine, this.cssHeight, this.getCombinedZoneSpecs(), this.bottomInsetPx);
  }
  getMaxScrollTop(): number { return Math.max(0, this.getScrollHeight() - this.cssHeight); }
  getContentWidth(): number { return this.maxContentWidthPx(); }
  getScrollWidth(): number { return Math.max(this.cssWidth, this.maxContentWidthPx()); }

  measureColumnX(lineNumber: number, col: number): number {
    return measureLineColumnX(this.model, this.renderer, this.getMetrics(), this.providers.getLineColors, lineNumber, col, this.providers.getLineInlayHints, this.providers.getLineGhostInline, false);
  }
  columnAtX(lineNumber: number, textX: number, round = true): number {
    return lineColumnAtX(this.model, this.renderer, this.getMetrics(), this.providers.getLineColors, lineNumber, textX, round, this.providers.getLineInlayHints, this.providers.getLineGhostInline);
  }
  positionAtPoint(localX: number, localY: number, round = true): { lineNumber: number; column: number } {
    this.syncProjection(); return hitTestPosition(this.buildHitContext(), localX, localY, round);
  }
  virtualSideAtPoint(localX: number, localY: number): VirtualSide | undefined { this.syncProjection(); return hitTestVirtualSide(this.buildHitContext(), localX, localY); }
  screenPosOf(line: number, col: number): { x: number; y: number; h: number } {
    this.syncProjection(); return computeScreenPosOf(this.buildHitContext(), line, col);
  }
  isLineInView(line: number): boolean {
    this.syncProjection();
    const m = this.getMetrics();
    const top = this.getTopForLineNumber(line) - this.scrollTop;
    const visibleTop = Math.max(this.topInsetPx, this.lastStickyHeight);
    const visibleBottom = this.cssHeight - this.bottomInsetPx - (this.lastBottomSticky ? m.lineHeight : 0);
    return top + m.lineHeight > visibleTop && top < visibleBottom;
  }
  caretScreenPos(): { x: number; y: number; h: number } { return this.screenPosOf(this.selection.active.lineNumber, this.selection.active.column); }
  setStickyScroll(opts: MonoStickyScrollOptions): void { this.sticky.setOptions(opts); this.schedulePaint(); }
  invalidateScopes(): void { this.sticky.invalidate(); this.projection.invalidate(); }
  getStickyScrollOptions(): Required<MonoStickyScrollOptions> { return this.sticky.getOptions(); }

  ensureCaretVisible(): void {
    this.syncProjection();
    const m = this.getMetrics();
    const { lineNumber: line, column: col } = this.selection.active;
    const topY = this.getRowGeometry(m).topOfRow(this.projection.modelToVisual(line, col).visualRow);
    const padPx = this.cursorSurroundingLines * m.lineHeight;
    const effectiveH = Math.max(m.lineHeight, this.cssHeight - this.bottomInsetPx);
    if (topY < this.scrollTop + this.topInsetPx + m.paddingTop + padPx) {
      this.scrollTop = Math.max(0, topY - this.topInsetPx - m.paddingTop - padPx);
    }
    if (topY + m.lineHeight + padPx > this.scrollTop + effectiveH) {
      this.scrollTop = topY + m.lineHeight + padPx - effectiveH;
    }
    this.revealCaretHorizontally(line, col);
    this.clampScroll();
  }

  private revealCaretHorizontally(line: number, col: number): void {
    if (this.wordWrap === 'on') { this.scrollLeft = 0; return; }
    const m = this.getMetrics();
    const caretXDoc = this.contentLeft + m.paddingLeft + this.measureColumnX(line, col);
    const margin = Math.max(m.charWidth * 2, 24);
    const viewLeft = this.contentLeft + margin;
    const viewRight = Math.max(viewLeft + 24, this.cssWidth - this.rightInsetPx - margin);
    const screenX = caretXDoc - this.scrollLeft;
    if (screenX < viewLeft) this.scrollLeft = Math.max(0, caretXDoc - viewLeft);
    else if (screenX > viewRight) this.scrollLeft = Math.max(0, caretXDoc - viewRight);
  }

  private stickyArgs(renderTop: number, metrics: RenderMetrics = this.getMetrics()): StickyComputeArgs {
    return {
      model: this.model, selection: this.selection, projection: this.projection, metrics,
      renderTop, topInsetPx: this.topInsetPx, cssHeight: this.cssHeight, tabSize: this.tabSize,
      foldingEnabled: this.foldingEnabled, foldingModel: this.foldingModel,
      geometry: this.getRowGeometry(metrics),
    };
  }
  private stickyHeightAt(scrollTop: number): number {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    return this.sticky.peekHeight(this.stickyArgs(quantizeStickyScrollTop(scrollTop, dpr)));
  }

  revealCaretInCenterIfOutside(): void {
    this.syncProjection();
    const m = this.getMetrics();
    const { lineNumber: line, column: col } = this.selection.active;
    const row = this.projection.modelToVisual(line, col).visualRow;
    this.scrollTop = computeCenterReveal({
      scrollTop: this.scrollTop, rowTop: this.getRowGeometry(m).topOfRow(row),
      lineHeight: m.lineHeight, cssHeight: Math.max(m.lineHeight, this.cssHeight - this.bottomInsetPx),
      topInsetPx: this.topInsetPx, maxScrollTop: this.getMaxScrollTop(), stickyHeightAt: (s) => this.stickyHeightAt(s),
    });
    this.revealCaretHorizontally(line, col); this.clampScroll();
  }

  schedulePaint(): void {
    if (this.paintRaf) return;
    this.paintRaf = requestAnimationFrame(() => { this.paintRaf = 0; this.paint(); });
  }

  paint(): void {
    if (this.paintRaf) { cancelAnimationFrame(this.paintRaf); this.paintRaf = 0; }
    if (this.cssWidth <= 0 || this.cssHeight <= 0) return;
    this.syncProjection(); this.clampScroll();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const renderTop = Math.round(this.scrollTop * dpr) / dpr;
    const renderLeft = Math.round(this.scrollLeft * dpr) / dpr;
    const metrics = this.getMetrics();
    const geom = this.getRowGeometry(metrics);
    const stickyLines = this.sticky.compute(this.stickyArgs(quantizeStickyScrollTop(this.scrollTop, dpr), metrics));
    const totalVisualRows = this.projection.getVisualLineCount();
    const firstRow = Math.max(0, geom.rowAtDocY(renderTop).row - this.overscan);
    const lastRow = Math.min(totalVisualRows - 1, geom.rowAtDocY(renderTop + this.cssHeight).row + this.overscan);
    const firstModelLine = this.projection.getVisualLine(firstRow).modelLine;
    const lastModelLine = this.projection.getVisualLine(Math.max(firstRow, lastRow)).modelLine;

    const langConfig = getLanguageConfiguration(this.model.getLanguageId());
    const bracketMatch = this.matchBrackets !== 'never'
      ? findMatchingBracket(this.model, this.selection.active, langConfig, this.providers.getTokenTypeAt ?? undefined) : null;
    const occurrences = this.occurrencesHighlight
      ? findVisibleOccurrences(this.model, this.selection, firstModelLine, lastModelLine) : [];
    const indentGuides = this.showIndentGuides
      ? { info: computeIndentGuides(this.model, firstModelLine, lastModelLine, this.selection.active.lineNumber, this.tabSize), show: true, highlightActive: this.highlightActiveIndentGuide, tabSize: this.tabSize }
      : null;

    const p = this.providers;
    this.renderer.paint({
      model: this.model, selection: this.selection, scrollTop: renderTop, scrollLeft: renderLeft,
      cssWidth: this.cssWidth, cssHeight: this.cssHeight, metrics, theme: this.getTheme(),
      showLineNumbers: this.showLineNumbers(), lineNumbersMode: this.lineNumbersMode,
      glyphMargin: this.glyphMargin, renderWhitespace: this.renderWhitespace,
      rulers: this.rulers, renderLineHighlight: this.renderLineHighlight,
      cursorStyle: this.cursorStyle, errorLens: this.errorLens,
      markers: this.markersProvider?.() ?? [], overscan: this.overscan, projection: this.projection,
      folding: this.foldingModel
        ? { enabled: this.foldingEnabled, isFoldable: (ln) => this.foldingModel!.isFoldable(ln), isCollapsed: (ln) => this.foldingModel!.isCollapsed(ln) }
        : undefined,
      bracketMatch, occurrences, indentGuides,
      getLineTokens: this.tokenization ? (ln) => this.tokenization!.getLineTokens(this.model, ln) : undefined,
      freeHandle: this.freeHandle, handlesVisible: this.handlesVisible, handleAlpha: this.handleAlpha,
      stickyLines, bottomSticky: this.lastBottomSticky,
      decorations: p.getDecorationRender?.() ?? [],
      findMatches: p.getFindDecorations?.().matches ?? [],
      findCurrentIndex: p.getFindDecorations?.().currentIndex ?? -1,
      compositionRange: this.compositionRange, dynamicCaretColor: this.dynamicCaretColor,
      topInsetPx: this.topInsetPx, viewZones: this.getResolvedZones(),
      getLineColors: p.getLineColors ?? undefined, getLineBrackets: p.getLineBrackets ?? undefined,
      resolveBracketColor: p.resolveBracketColor ?? undefined, getLineInlayHints: p.getLineInlayHints ?? undefined,
      getLineGhostInline: p.getLineGhostInline ?? undefined, getLineSemanticTokens: p.getLineSemanticTokens ?? undefined,
      getLineLinks: p.getLineLinks ?? undefined, hoverRange: p.getHoverRange?.() ?? null,
      documentHighlights: p.getDocumentHighlights?.() ?? [], ghostTextItalic: p.getGhostTextItalic?.() ?? false,
    });
    this.onPaintCb?.();
  }
  hitTestSticky(localX: number, localY: number) { return this.sticky.hitTestSticky(localX, localY, this.getMetrics().lineHeight); }
  hitTestBottomSticky(localX: number, localY: number) { return this.sticky.hitTestBottomSticky(localX, localY, this.cssWidth, this.cssHeight, this.getMetrics().lineHeight); }

  revealBottomStickyLine(lineNumber: number, localX?: number): void {
    this.syncProjection();
    const m = this.getMetrics();
    const line = Math.max(1, Math.min(this.model.getLineCount(), lineNumber));
    const docY = this.getRowGeometry(m).topOfRow(this.projection.modelLineToFirstVisualRow(line));
    this.scrollTop = Math.max(0, docY - (this.cssHeight - m.lineHeight) / 2);
    this.clampScroll();
    const col = localX != null ? this.columnAtX(line, localX - this.contentLeft - m.paddingLeft + this.scrollLeft, true) : this.selection.active.column;
    this.selection.setCaret(line, col); this.sticky.lastBottomSticky = null; this.paint();
  }

  revealStickyLine(lineNumber: number, index: number, localX?: number): void {
    this.syncProjection();
    const m = this.getMetrics();
    const line = Math.max(1, Math.min(this.model.getLineCount(), lineNumber));
    const docY = this.getRowGeometry(m).topOfRow(this.projection.modelLineToFirstVisualRow(line));
    this.scrollTop = Math.max(0, docY - index * m.lineHeight);
    this.clampScroll();
    const col = localX != null ? this.columnAtX(line, localX - this.contentLeft - m.paddingLeft + this.scrollLeft, true) : 1;
    this.selection.setCaret(line, col); this.paint();
  }

  dispose(): void { if (this.paintRaf) { cancelAnimationFrame(this.paintRaf); this.paintRaf = 0; } }

  private buildHitContext(): HitTestContext {
    return {
      model: this.model, renderer: this.renderer, projection: this.projection, metrics: this.getMetrics(),
      contentLeft: this.contentLeft, scrollTop: this.scrollTop, scrollLeft: this.scrollLeft,
      topInsetPx: this.topInsetPx, viewZone: this.viewZone, resolvedZones: this.getResolvedZones(),
      glyphMargin: this.glyphMargin, showLineNumbers: this.showLineNumbers(),
      getLineColors: this.providers.getLineColors, getLineInlayHints: this.providers.getLineInlayHints,
      getLineGhostInline: this.providers.getLineGhostInline,
    };
  }

  private maxContentWidthPx(): number {
    const res = computeMaxContentWidthPx(this.wordWrap, this.cssWidth, this.contentLeft, this.getMetrics(), this.model, this.renderer, this.maxCharsCache);
    this.maxCharsCache = res.cache;
    return res.widthPx;
  }

  private clampScroll(): void {
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, this.getMaxScrollTop()));
    const maxLeft = Math.max(0, this.maxContentWidthPx() - Math.max(0, this.cssWidth - this.rightInsetPx));
    this.scrollLeft = Math.max(0, Math.min(this.scrollLeft, maxLeft));
  }
}
