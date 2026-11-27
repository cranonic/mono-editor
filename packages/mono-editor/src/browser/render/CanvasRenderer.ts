import type { RenderMetrics } from '../../common/config/editorOptions';
import {
  buildFrameContext,
  colorAdvanceBefore,
  COLOR_SWATCH_ADVANCE,
  COLOR_SWATCH_GAP,
  COLOR_SWATCH_SIZE,
  getColorSwatchMetrics,
  resolveDynamicCaretColor,
  softenDynamicColor,
  TEARDROP,
  type ColorHit,
  type FoldHit,
  type FreeHandleVisual,
  type InlayHintHit,
  type LinkHit,
  type PaintOptions,
  type RenderPass,
  type TeardropHit,
} from './frameContext';
import { backgroundPass } from './passes/backgroundPass';
import { decorationsAndCaretsPass } from './passes/decorationsAndCaretsPass';
import { gutterPass } from './passes/gutterPass';
import { highlightsPass } from './passes/highlightsPass';
import { inlayBubblePass } from './passes/inlayBubblePass';
import { stickyPass } from './passes/stickyPass';
import { teardropsPass } from './passes/teardropsPass';
import { textPass } from './passes/textPass';
import { TextLayoutCache } from './textLayout';

export {
  colorAdvanceBefore,
  COLOR_SWATCH_ADVANCE,
  COLOR_SWATCH_GAP,
  COLOR_SWATCH_SIZE,
  getColorSwatchMetrics,
  resolveDynamicCaretColor,
  softenDynamicColor,
  TEARDROP,
};
export type {
  ColorHit,
  FoldHit,
  FreeHandleVisual,
  InlayHintHit,
  LinkHit,
  PaintOptions,
  RenderMetrics,
  RenderPass,
  TeardropHit,
};

const DEFAULT_PASSES: readonly RenderPass[] = [
  backgroundPass,
  highlightsPass,
  textPass,
  decorationsAndCaretsPass,
  gutterPass,
  inlayBubblePass,
  teardropsPass,
  stickyPass,
];

export class CanvasRenderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private layoutCache: TextLayoutCache;
  private passes: readonly RenderPass[];
  lastTeardrops: TeardropHit[] = [];
  lastFoldHits: FoldHit[] = [];
  lastColorHits: ColorHit[] = [];
  lastStickyColorHits: ColorHit[] = [];
  lastInlayHits: InlayHintHit[] = [];
  lastLinkHits: LinkHit[] = [];

  constructor(canvas: HTMLCanvasElement, passes: readonly RenderPass[] = DEFAULT_PASSES) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Mono Editor: 2d context unavailable');
    this.ctx = ctx;
    this.passes = passes;
    this.layoutCache = new TextLayoutCache((font, text) => {
      if (this.ctx.font !== font) this.ctx.font = font;
      return this.ctx.measureText(text).width;
    });
  }

  resize(cssWidth: number, cssHeight: number): void {
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.floor(cssWidth * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(cssHeight * this.dpr));
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  measureCharWidth(font: string): number {
    this.ctx.font = font;
    return this.ctx.measureText('M').width || 8;
  }

  /** Line-local pixel X of a 1-based column (fast path on ASCII, grapheme-exact on Indic/Unicode). */
  measureColumnX(line: string, col: number, metrics: RenderMetrics): number {
    const font = `${metrics.fontSize}px ${metrics.fontFamily}`;
    return this.layoutCache.measureColumnX(line, col, font, metrics.charWidth);
  }

  /** Map line-local pixel X to a 1-based column (grapheme-boundary snapped on Indic/Unicode). */
  columnAtX(line: string, textX: number, metrics: RenderMetrics, round = true): number {
    const font = `${metrics.fontSize}px ${metrics.fontFamily}`;
    return this.layoutCache.columnAtX(line, textX, font, metrics.charWidth, round);
  }

  measureTextWidth(text: string, metrics: RenderMetrics, fontOverride?: string): number {
    const font = fontOverride ?? `${metrics.fontSize}px ${metrics.fontFamily}`;
    if (this.ctx.font !== font) this.ctx.font = font;
    return this.ctx.measureText(text).width || text.length * metrics.charWidth;
  }

  paint(opts: PaintOptions): void {
    const { ctx } = this;
    const { fontSize, fontFamily } = opts.metrics;
    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.textBaseline = 'top';

    const frame = buildFrameContext(
      opts,
      (line, col, m) => this.measureColumnX(line, col, m),
      (text, m) => this.measureTextWidth(text, m),
    );
    for (const pass of this.passes) {
      pass.paint(ctx, frame);
    }

    this.lastFoldHits = frame.foldHits;
    this.lastColorHits = frame.colorHits;
    this.lastStickyColorHits = frame.stickyColorHits;
    this.lastInlayHits = frame.inlayHits;
    this.lastLinkHits = frame.linkHits;
    this.lastTeardrops = frame.teardrops;
  }
}
