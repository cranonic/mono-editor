import type { ColorMatch } from '../../common/color/colorTypes';
import type { RenderMetrics } from '../../common/config/editorOptions';
import type { TextModel } from '../../common/model/TextModel';
import type { ViewLineProjection } from '../../common/viewModel/ViewLineProjection';
import {
  collectInlineVirtualElements,
  mapVirtualXToRealX,
  virtualAdvanceBeforeColumn,
  type InlineGhostRun,
  type InlineVirtualElement,
  type ResolvedInlayHint,
} from '../../common/virtualText';
import { COLOR_SWATCH_ADVANCE, type CanvasRenderer } from '../render/CanvasRenderer';
import { computeRowDocTop, resolveViewZoneAfterRow, type ViewZoneSpec } from './viewLayout';

export interface HitTestContext {
  model: TextModel;
  renderer: CanvasRenderer;
  projection: ViewLineProjection;
  metrics: RenderMetrics;
  contentLeft: number;
  scrollTop: number;
  scrollLeft: number;
  topInsetPx: number;
  viewZone: ViewZoneSpec | null;
  getLineColors: ((lineNumber: number) => readonly ColorMatch[]) | null;
  getLineInlayHints?: ((lineNumber: number) => readonly ResolvedInlayHint[]) | null;
  getLineGhostInline?: ((lineNumber: number) => readonly InlineGhostRun[]) | null;
}

function elementsForLine(
  renderer: CanvasRenderer,
  metrics: RenderMetrics,
  lineNumber: number,
  getLineColors: ((ln: number) => readonly ColorMatch[]) | null,
  getLineInlayHints?: ((ln: number) => readonly ResolvedInlayHint[]) | null,
  getLineGhostInline?: ((ln: number) => readonly InlineGhostRun[]) | null,
): InlineVirtualElement[] {
  const colors = getLineColors?.(lineNumber);
  const inlayHints = getLineInlayHints?.(lineNumber);
  const ghostRuns = getLineGhostInline?.(lineNumber);
  if (!colors?.length && !inlayHints?.length && !ghostRuns?.length) return [];
  return collectInlineVirtualElements({
    colors,
    inlayHints,
    ghostRuns,
    swatchAdvancePx: COLOR_SWATCH_ADVANCE,
    measureText: (t) => renderer.measureTextWidth(t, metrics),
  });
}

/** Line-local pixel X of 1-based column on `lineNumber` (swatches + inlay hints + inline ghost text). */
export function measureLineColumnX(
  model: TextModel,
  renderer: CanvasRenderer,
  metrics: RenderMetrics,
  getLineColors: ((lineNumber: number) => readonly ColorMatch[]) | null,
  lineNumber: number,
  col: number,
  getLineInlayHints?: ((ln: number) => readonly ResolvedInlayHint[]) | null,
  getLineGhostInline?: ((ln: number) => readonly InlineGhostRun[]) | null,
  includeGhostAtSameColumn = true,
): number {
  const line = Math.max(1, Math.min(model.getLineCount(), lineNumber));
  const content = model.getLineContent(line);
  const elems = elementsForLine(renderer, metrics, line, getLineColors, getLineInlayHints, getLineGhostInline);
  return (
    renderer.measureColumnX(content, col, metrics) +
    virtualAdvanceBeforeColumn(elems, col, includeGhostAtSameColumn)
  );
}

/** Map line-local pixel X to 1-based column on `lineNumber` (inverse of virtual layout advance). */
export function lineColumnAtX(
  model: TextModel,
  renderer: CanvasRenderer,
  metrics: RenderMetrics,
  getLineColors: ((lineNumber: number) => readonly ColorMatch[]) | null,
  lineNumber: number,
  textX: number,
  round = true,
  getLineInlayHints?: ((ln: number) => readonly ResolvedInlayHint[]) | null,
  getLineGhostInline?: ((ln: number) => readonly InlineGhostRun[]) | null,
): number {
  const line = Math.max(1, Math.min(model.getLineCount(), lineNumber));
  const content = model.getLineContent(line);
  const elems = elementsForLine(renderer, metrics, line, getLineColors, getLineInlayHints, getLineGhostInline);
  if (!elems.length) {
    return renderer.columnAtX(content, textX, metrics, round);
  }
  const mapped = mapVirtualXToRealX(content, textX, elems, (c, col) =>
    renderer.measureColumnX(c, col, metrics),
  );
  if (mapped.snappedColumn !== undefined) return mapped.snappedColumn;
  return renderer.columnAtX(content, mapped.realX, metrics, round);
}

/** Maps root-local `(localX, localY)` to 1-based `(lineNumber, column)` respecting virtual ghost rows, folds & wrap. */
export function hitTestPosition(
  ctx: HitTestContext,
  localX: number,
  localY: number,
  round = true,
): { lineNumber: number; column: number } {
  const {
    model,
    renderer,
    projection,
    metrics,
    contentLeft,
    scrollTop,
    scrollLeft,
    topInsetPx,
    viewZone,
    getLineColors,
    getLineInlayHints,
    getLineGhostInline,
  } = ctx;
  let y = localY + scrollTop - topInsetPx - metrics.paddingTop;
  const afterRow = resolveViewZoneAfterRow(viewZone, model, projection);
  if (viewZone && afterRow >= 0) {
    const zoneStartY = (afterRow + 1) * metrics.lineHeight;
    if (y >= zoneStartY + viewZone.heightPx) {
      y -= viewZone.heightPx;
    } else if (y >= zoneStartY) {
      y = afterRow * metrics.lineHeight;
    }
  }
  const totalRows = projection.getVisualLineCount();
  const rawRow = Math.floor(y / metrics.lineHeight);
  if (rawRow >= totalRows) {
    const lastSeg = projection.getVisualLine(totalRows - 1);
    const lastLine = model.getLineContent(lastSeg.modelLine);
    return { lineNumber: lastSeg.modelLine, column: lastLine.length + 1 };
  }
  const row = Math.max(0, rawRow);
  const seg = projection.getVisualLine(row);
  if (seg.isVirtualGhost) {
    // Tapping a virtual multiline ghost continuation row lands cleanly at the end of its anchor line
    const anchorContent = model.getLineContent(seg.modelLine);
    return { lineNumber: seg.modelLine, column: Math.min(anchorContent.length + 1, Math.max(1, seg.endCol)) };
  }
  const textX = localX + scrollLeft - contentLeft - metrics.paddingLeft;
  const originPx =
    seg.startCol === 1
      ? 0
      : measureLineColumnX(
          model,
          renderer,
          metrics,
          getLineColors,
          seg.modelLine,
          seg.startCol,
          getLineInlayHints,
          getLineGhostInline,
        );
  const effectiveX = Math.max(0, textX - seg.wrapIndentPx) + originPx;
  let col = lineColumnAtX(
    model,
    renderer,
    metrics,
    getLineColors,
    seg.modelLine,
    effectiveX,
    round,
    getLineInlayHints,
    getLineGhostInline,
  );
  const maxCol = seg.isLastSegment ? seg.endCol : Math.max(seg.startCol, seg.endCol - 1);
  col = Math.max(seg.startCol, Math.min(maxCol, col));
  return { lineNumber: seg.modelLine, column: col };
}

/** Root-local CSS position of an arbitrary line/column (caret sits LEFT of inline ghost text at `col`). */
export function computeScreenPosOf(
  ctx: HitTestContext,
  line: number,
  col: number,
): { x: number; y: number; h: number } {
  const {
    model,
    renderer,
    projection,
    metrics,
    contentLeft,
    scrollTop,
    scrollLeft,
    topInsetPx,
    viewZone,
    getLineColors,
    getLineInlayHints,
    getLineGhostInline,
  } = ctx;
  const clampedLine = Math.max(1, Math.min(model.getLineCount(), line));
  const mapped = projection.modelToVisual(clampedLine, col);
  const seg = mapped.visualLine;
  const originPx =
    seg.startCol === 1
      ? 0
      : measureLineColumnX(
          model,
          renderer,
          metrics,
          getLineColors,
          clampedLine,
          seg.startCol,
          getLineInlayHints,
          getLineGhostInline,
          true,
        );
  const colPx = measureLineColumnX(
    model,
    renderer,
    metrics,
    getLineColors,
    clampedLine,
    col,
    getLineInlayHints,
    getLineGhostInline,
    false,
  );
  const x = contentLeft + metrics.paddingLeft + seg.wrapIndentPx + (colPx - originPx) - scrollLeft;
  const afterRow = resolveViewZoneAfterRow(viewZone, model, projection);
  const y = computeRowDocTop(mapped.visualRow, metrics, topInsetPx, viewZone, afterRow) - scrollTop;
  return { x, y, h: metrics.lineHeight };
}
