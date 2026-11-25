import type { RenderMetrics } from '../../common/config/editorOptions';
import type { SelectionState } from '../../common/core/SelectionState';
import type { DocumentSymbol } from '../../common/languages/providers/extendedTypes';
import type { TextModel } from '../../common/model/TextModel';
import type { FoldingModel } from '../../common/viewModel/FoldingModel';
import { MarkdownScopeFinder, OutlineScopeFinder } from '../../common/viewModel/markdownSticky';
import {
  DEFAULT_STICKY_SCROLL,
  IndentScopeFinder,
  layoutStickyForScroll,
  type IScopeFinder,
  type MonoStickyScrollOptions,
  type StickyRenderLine,
} from '../../common/viewModel/StickyScroll';
import type { ViewLineProjection } from '../../common/viewModel/ViewLineProjection';
import { createRowGeometry, type RowGeometry } from './viewLayout';

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
  geometry?: RowGeometry;
}

function isMarkdownLanguage(langId: string): boolean {
  const id = langId.toLowerCase();
  return id === 'markdown' || id === 'md' || id === 'mdx';
}

function toStickyGeometry(geometry?: RowGeometry) {
  if (!geometry) return undefined;
  return {
    topOfRow: (row: number) => geometry.stickyTopOfRow(row),
    blockTopOfRow: (row: number) => geometry.stickyBlockTopOfRow(row),
    rowAtDocY: (docY: number) => geometry.rowAtStickyDocY(docY),
  };
}

/**
 * Manages top sticky scope headers and bottom active-line sticky bar state & hit-testing.
 * Scope strategy priority:
 *  1. `OutlineScopeFinder` (when DocumentSymbolProvider supplies outline symbols & not forced to indent)
 *  2. `MarkdownScopeFinder` (automatic for Markdown `#`/`##`/`###` headings ignoring fenced code blocks)
 *  3. `IndentScopeFinder` fallback
 */
export class StickyScrollController {
  private opts: Required<MonoStickyScrollOptions>;
  private indentFinder: IndentScopeFinder;
  private markdownFinder: MarkdownScopeFinder;
  private outlineFinder: OutlineScopeFinder;
  private hasOutlineSymbols = false;
  lastSticky: StickyRenderLine[] = [];
  lastStickyHeight = 0;
  lastBottomSticky: { lineNumber: number; caretColumn: number } | null = null;

  constructor(model: TextModel, stickyScroll?: MonoStickyScrollOptions) {
    this.opts = { ...DEFAULT_STICKY_SCROLL, ...stickyScroll };
    this.indentFinder = new IndentScopeFinder(model);
    this.markdownFinder = new MarkdownScopeFinder(model);
    this.outlineFinder = new OutlineScopeFinder(model);
  }

  setModel(model: TextModel, tabSize: number): void {
    this.indentFinder.sync(model, tabSize);
    this.markdownFinder.sync(model, tabSize);
    this.outlineFinder.sync(model, tabSize);
    this.outlineFinder.setSymbols(null);
    this.hasOutlineSymbols = false;
    this.invalidate();
  }

  setOutlineSymbols(symbols: readonly DocumentSymbol[] | null): void {
    this.outlineFinder.setSymbols(symbols);
    this.hasOutlineSymbols = Boolean(symbols && symbols.length > 0);
  }

  setOptions(opts: MonoStickyScrollOptions): void {
    this.opts = { ...DEFAULT_STICKY_SCROLL, ...opts };
    this.invalidate();
  }

  getOptions(): Required<MonoStickyScrollOptions> {
    return this.opts;
  }

  invalidate(): void {
    this.indentFinder.invalidate();
    this.markdownFinder.invalidate();
    this.outlineFinder.invalidate();
  }

  private resolveFinder(model: TextModel, tabSize: number): IScopeFinder {
    if (this.opts.defaultModel !== 'indentationModel' && this.hasOutlineSymbols) {
      this.outlineFinder.sync(model, tabSize);
      return this.outlineFinder;
    }
    if (isMarkdownLanguage(model.getLanguageId())) {
      this.markdownFinder.sync(model, tabSize);
      return this.markdownFinder;
    }
    this.indentFinder.sync(model, tabSize);
    return this.indentFinder;
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
      geometry,
    } = args;

    const finder = this.resolveFinder(model, tabSize);
    const caretLine = selection.active.lineNumber;
    const caretCol = selection.active.column;
    const isLineHidden =
      foldingEnabled && foldingModel?.hasCollapsed()
        ? (ln: number) => foldingModel.isLineHidden(ln)
        : undefined;

    const stickyScrollTop = renderTop - topInsetPx;
    const stickyGeom = toStickyGeometry(geometry);
    const layout = layoutStickyForScroll(
      finder,
      stickyScrollTop,
      metrics,
      this.opts.maxLineCount,
      this.opts.scrollWithEditor,
      caretLine,
      caretCol,
      this.opts.activeLineSticky,
      projection,
      isLineHidden,
      stickyGeom,
    );
    this.lastSticky = layout.lines;
    this.lastStickyHeight = layout.height;

    if (this.opts.bottomActiveSticky && !(isLineHidden && isLineHidden(caretLine))) {
      const caretRow = projection.modelToVisual(caretLine, caretCol).visualRow;
      const docY = (geometry ?? createRowGeometry(metrics, 0, [])).stickyTopOfRow(caretRow);
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
    const finder = this.resolveFinder(args.model, args.tabSize);
    const isLineHidden =
      args.foldingEnabled && args.foldingModel?.hasCollapsed()
        ? (ln: number) => args.foldingModel!.isLineHidden(ln)
        : undefined;
    return layoutStickyForScroll(
      finder,
      args.renderTop - args.topInsetPx,
      args.metrics,
      this.opts.maxLineCount,
      this.opts.scrollWithEditor,
      undefined,
      undefined,
      false,
      args.projection,
      isLineHidden,
      toStickyGeometry(args.geometry),
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
