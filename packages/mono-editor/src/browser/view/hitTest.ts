import type { ColorMatch } from '../../common/color/colorTypes';
import type { RenderMetrics } from '../../common/config/editorOptions';
import type { TextModel } from '../../common/model/TextModel';
import type { ViewLineProjection } from '../../common/viewModel/ViewLineProjection';
import {
  COLOR_SWATCH_ADVANCE,
  colorAdvanceBefore,
  type CanvasRenderer,
} from '../render/CanvasRenderer';
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
}

/** Line-local pixel X of 1-based column on `lineNumber` (grapheme-aware + inline color bullet advance). */
export function measureLineColumnX(
  model: TextModel,
  renderer: CanvasRenderer,
  metrics: RenderMetrics,
  getLineColors: ((lineNumber: number) => readonly ColorMatch[]) | null,
  lineNumber: number,
  col: number,
): number {
  const line = Math.max(1, Math.min(model.getLineCount(), lineNumber));
  const content = model.getLineContent(line);
  const colors = getLineColors?.(line);
  return renderer.measureColumnX(content, col, metrics) + colorAdvanceBefore(colors, col);
}

/** Map line-local pixel X to 1-based column on `lineNumber` (grapheme-aware + inline color bullet advance). */
export function lineColumnAtX(
  model: TextModel,
  renderer: CanvasRenderer,
  metrics: RenderMetrics,
  getLineColors: ((lineNumber: number) => readonly ColorMatch[]) | null,
  lineNumber: number,
  textX: number,
  round = true,
): number {
  const line = Math.max(1, Math.min(model.getLineCount(), lineNumber));
  const content = model.getLineContent(line);
  const colors = getLineColors?.(line);
  if (!colors || !colors.length) {
    return renderer.columnAtX(content, textX, metrics, round);
  }
  let adjustedX = textX;
  let passed = 0;
  for (const cm of colors) {
    const swatchLeft =
      renderer.measureColumnX(content, cm.startColumn, metrics) + passed * COLOR_SWATCH_ADVANCE;
    if (textX >= swatchLeft + COLOR_SWATCH_ADVANCE) {
      adjustedX -= COLOR_SWATCH_ADVANCE;
      passed++;
    } else if (textX >= swatchLeft) {
      return cm.startColumn;
    } else {
      break;
    }
  }
  return renderer.columnAtX(content, Math.max(0, adjustedX), metrics, round);
}

/** Maps root-local `(localX, localY)` to 1-based `(lineNumber, column)` respecting topInsetPx, viewZone, folding & word wrap. */
export function hitTestPosition(
  ctx: HitTestContext,
  localX: number,
  localY: number,
  round = true,
): { lineNumber: number; column: number } {
  const { model, renderer, projection, metrics, contentLeft, scrollTop, scrollLeft, topInsetPx, viewZone, getLineColors } = ctx;
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
  const textX = localX + scrollLeft - contentLeft - metrics.paddingLeft;
  const originPx =
    seg.startCol === 1
      ? 0
      : measureLineColumnX(model, renderer, metrics, getLineColors, seg.modelLine, seg.startCol);
  const effectiveX = Math.max(0, textX - seg.wrapIndentPx) + originPx;
  let col = lineColumnAtX(model, renderer, metrics, getLineColors, seg.modelLine, effectiveX, round);
  const maxCol = seg.isLastSegment ? seg.endCol : Math.max(seg.startCol, seg.endCol - 1);
  col = Math.max(seg.startCol, Math.min(maxCol, col));
  return { lineNumber: seg.modelLine, column: col };
}

/** Root-local CSS position of an arbitrary line/column (top-left of that character cell). */
export function computeScreenPosOf(
  ctx: HitTestContext,
  line: number,
  col: number,
): { x: number; y: number; h: number } {
  const { model, renderer, projection, metrics, contentLeft, scrollTop, scrollLeft, topInsetPx, viewZone, getLineColors } = ctx;
  const clampedLine = Math.max(1, Math.min(model.getLineCount(), line));
  const mapped = projection.modelToVisual(clampedLine, col);
  const seg = mapped.visualLine;
  const originPx =
    seg.startCol === 1
      ? 0
      : measureLineColumnX(model, renderer, metrics, getLineColors, clampedLine, seg.startCol);
  const colPx = measureLineColumnX(model, renderer, metrics, getLineColors, clampedLine, col);
  const x = contentLeft + metrics.paddingLeft + seg.wrapIndentPx + (colPx - originPx) - scrollLeft;
  const afterRow = resolveViewZoneAfterRow(viewZone, model, projection);
  const y = computeRowDocTop(mapped.visualRow, metrics, topInsetPx, viewZone, afterRow) - scrollTop;
  return { x, y, h: metrics.lineHeight };
}
