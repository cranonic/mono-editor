import type { RenderMetrics } from '../../common/config/editorOptions';
import type { SelectionState } from '../../common/core/SelectionState';
import type { TextModel } from '../../common/model/TextModel';
import type { FoldingModel } from '../../common/viewModel/FoldingModel';
import {
  DEFAULT_STICKY_SCROLL,
  IndentScopeFinder,
  layoutStickyForScroll,
  type MonoStickyScrollOptions,
  type StickyRenderLine,
} from '../../common/viewModel/StickyScroll';
import type { ViewLineProjection } from '../../common/viewModel/ViewLineProjection';

export interface StickyComputeArgs {
  model: TextModel;
  selection: SelectionState;
  projection: ViewLineProjection;
  metrics: RenderMetrics;
  renderTop: number;
  topInsetPx: number;
  cssHeight: number;
  tabSize: number;
  foldingEnabled: boolean;
  foldingModel: FoldingModel | null;
}

/**
 * Manages top sticky scope headers and bottom active-line sticky bar state & hit-testing.
 * Top sticky is ALWAYS pinned to the real top of the editor (y = 0); Find floats above it.
 */
export class StickyScrollController {
  private opts: Required<MonoStickyScrollOptions>;
  private scopeFinder: IndentScopeFinder;
  lastSticky: StickyRenderLine[] = [];
  lastStickyHeight = 0;
  lastBottomSticky: { lineNumber: number; caretColumn: number } | null = null;

  constructor(model: TextModel, stickyScroll?: MonoStickyScrollOptions) {
    this.opts = { ...DEFAULT_STICKY_SCROLL, ...stickyScroll };
    this.scopeFinder = new IndentScopeFinder(model);
  }

  setModel(model: TextModel, tabSize: number): void {
    this.scopeFinder.sync(model, tabSize);
    this.scopeFinder.invalidate();
  }

  setOptions(opts: MonoStickyScrollOptions): void {
    this.opts = { ...DEFAULT_STICKY_SCROLL, ...opts };
    this.scopeFinder.invalidate();
  }

  getOptions(): Required<MonoStickyScrollOptions> {
    return this.opts;
  }

  invalidate(): void {
    this.scopeFinder.invalidate();
  }

  compute(args: StickyComputeArgs): StickyRenderLine[] {
    if (!this.opts.enabled) {
      this.lastSticky = [];
      this.lastStickyHeight = 0;
      this.lastBottomSticky = null;
      return [];
    }

    const {
      model,
      selection,
      projection,
      metrics,
      renderTop,
      topInsetPx,
      cssHeight,
      tabSize,
      foldingEnabled,
      foldingModel,
    } = args;

    this.scopeFinder.sync(model, tabSize);
    const caretLine = selection.active.lineNumber;
    const caretCol = selection.active.column;
    const isLineHidden =
      foldingEnabled && foldingModel?.hasCollapsed()
        ? (ln: number) => foldingModel.isLineHidden(ln)
        : undefined;

    // Content is drawn `topInsetPx` lower than the doc origin (Find bar clearance) but the sticky stack
    // stays at the real top, so the headers must be computed for the row that is actually under it.
    const stickyScrollTop = renderTop - topInsetPx;
    const layout = layoutStickyForScroll(
      this.scopeFinder,
      stickyScrollTop,
      metrics,
      this.opts.maxLineCount,
      this.opts.scrollWithEditor,
      caretLine,
      caretCol,
      this.opts.activeLineSticky,
      projection,
      isLineHidden,
    );
    this.lastSticky = layout.lines;
    this.lastStickyHeight = layout.height;

    if (this.opts.bottomActiveSticky && !(isLineHidden && isLineHidden(caretLine))) {
      const caretRow = projection.modelToVisual(caretLine, caretCol).visualRow;
      const docY = metrics.paddingTop + caretRow * metrics.lineHeight;
      const viewBottom = stickyScrollTop + cssHeight;
      const viewTop = stickyScrollTop + Math.max(topInsetPx, this.lastStickyHeight);
      const lineBottom = docY + metrics.lineHeight;
      const fullyVisible = docY >= viewTop + 1 && lineBottom <= viewBottom - 1;
      const pastBottom = lineBottom > viewBottom - 2;
      if (fullyVisible) {
        this.lastBottomSticky = null;
      } else if (pastBottom) {
        this.lastBottomSticky = { lineNumber: caretLine, caretColumn: caretCol };
      } else if (this.lastBottomSticky && this.lastBottomSticky.lineNumber === caretLine) {
        this.lastBottomSticky = { lineNumber: caretLine, caretColumn: caretCol };
      } else {
        this.lastBottomSticky = null;
      }
    } else {
      this.lastBottomSticky = null;
    }

    return layout.lines;
  }

  /** Stack height for `args.renderTop` without touching the live sticky state (used by reveal logic). */
  peekHeight(args: StickyComputeArgs): number {
    if (!this.opts.enabled) return 0;
    this.scopeFinder.sync(args.model, args.tabSize);
    const isLineHidden =
      args.foldingEnabled && args.foldingModel?.hasCollapsed()
        ? (ln: number) => args.foldingModel!.isLineHidden(ln)
        : undefined;
    return layoutStickyForScroll(
      this.scopeFinder,
      args.renderTop - args.topInsetPx,
      args.metrics,
      this.opts.maxLineCount,
      this.opts.scrollWithEditor,
      undefined,
      undefined,
      false,
      args.projection,
      isLineHidden,
    ).height;
  }

  hitTestSticky(_localX: number, localY: number, lineHeight: number): { index: number; lineNumber: number } | null {
    const relY = localY;
    if (!this.lastSticky.length || relY < 0 || relY > this.lastStickyHeight + 2) return null;
    for (let i = 0; i < this.lastSticky.length; i++) {
      const s = this.lastSticky[i]!;
      if (relY >= s.y && relY < s.y + lineHeight) {
        return { index: i, lineNumber: s.lineNumber };
      }
    }
    const idx = Math.floor(relY / lineHeight);
    if (idx >= 0 && idx < this.lastSticky.length) {
      return { index: idx, lineNumber: this.lastSticky[idx]!.lineNumber };
    }
    return null;
  }

  hitTestBottomSticky(localX: number, localY: number, cssWidth: number, cssHeight: number, lineHeight: number): { lineNumber: number } | null {
    const b = this.lastBottomSticky;
    if (!b || localX < 0 || localX > cssWidth) return null;
    if (localY < cssHeight - lineHeight - 1 || localY > cssHeight) return null;
    return { lineNumber: b.lineNumber };
  }
}
