import type { ColorMatch } from '../../common/color/colorTypes';
import type { RenderMetrics } from '../../common/config/editorOptions';
import { MouseTargetType } from '../../common/core/enums';
import type { VirtualSide } from '../../common/core/SelectionState';
import type { IMouseTarget } from '../../common/core/types';
import type { TextModel } from '../../common/model/TextModel';
import type { ViewLineProjection } from '../../common/viewModel/ViewLineProjection';
import {
  collectInlineVirtualElements,
  mapVirtualXToRealX,
  virtualAdvanceBeforeColumn,
  virtualSideAtX,
  type InlineGhostRun,
  type InlineVirtualElement,
  type ResolvedInlayHint,
} from '../../common/virtualText';
import { COLOR_SWATCH_ADVANCE, type CanvasRenderer } from '../render/CanvasRenderer';
import {
  computeRowDocTop,
  createRowGeometry,
  resolveViewZoneAfterRow,
  type ResolvedViewZone,
  type ViewZoneSpec,
} from './viewLayout';

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
  resolvedZones?: readonly ResolvedViewZone[];
  glyphMargin?: boolean;
  showLineNumbers?: boolean;
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

export function hitTestPosition(
  ctx: HitTestContext,
  localX: number,
  localY: number,
  round = true,
): { lineNumber: number; column: number } {
  const { lineNumber, column } = resolveHit(ctx, localX, localY, round);
  return { lineNumber, column };
}

/**
 * Which half (before / after) of an inline virtual block (inlay hint, ghost text, swatch) the
 * point falls on, when the resolved column carries one. Used by teardrop drags so the caret /
 * selection edge lands on the side the finger is on.
 */
export function hitTestVirtualSide(ctx: HitTestContext, localX: number, localY: number): VirtualSide | undefined {
  return resolveHit(ctx, localX, localY, true).side;
}

function resolveHit(
  ctx: HitTestContext,
  localX: number,
  localY: number,
  round: boolean,
): { lineNumber: number; column: number; side?: VirtualSide } {
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
    resolvedZones,
    getLineColors,
    getLineInlayHints,
    getLineGhostInline,
  } = ctx;
  const zones: readonly ResolvedViewZone[] =
    resolvedZones && resolvedZones.length
      ? resolvedZones
      : viewZone
        ? [{ id: viewZone.id, afterVisualRow: resolveViewZoneAfterRow(viewZone, model, projection), heightPx: viewZone.heightPx }]
        : [];
  const geom = createRowGeometry(metrics, topInsetPx, zones);
  const hit = geom.rowAtDocY(localY + scrollTop);
  const totalRows = projection.getVisualLineCount();
  const rawRow = hit.row;
  if (rawRow >= totalRows) {
    const lastSeg = projection.getVisualLine(totalRows - 1);
    const lastLine = model.getLineContent(lastSeg.modelLine);
    return { lineNumber: lastSeg.modelLine, column: lastLine.length + 1 };
  }
  const row = Math.max(0, rawRow);
  const seg = projection.getVisualLine(row);
  if (seg.isVirtualGhost) {
    const anchorContent = model.getLineContent(seg.modelLine);
    return { lineNumber: seg.modelLine, column: Math.min(anchorContent.length + 1, Math.max(1, seg.endCol)) };
  }
  const textX = localX + scrollLeft - contentLeft - metrics.paddingLeft;
  const originPx =
    seg.startCol === 1
      ? 0
      : measureLineColumnX(
          model, renderer, metrics, getLineColors, seg.modelLine, seg.startCol, getLineInlayHints, getLineGhostInline,
        );
  const effectiveX = Math.max(0, textX - seg.wrapIndentPx) + originPx;
  let col = lineColumnAtX(
    model, renderer, metrics, getLineColors, seg.modelLine, effectiveX, round, getLineInlayHints, getLineGhostInline,
  );
  const maxCol = seg.isLastSegment ? seg.endCol : Math.max(seg.startCol, seg.endCol - 1);
  col = Math.max(seg.startCol, Math.min(maxCol, col));
  const elems = elementsForLine(renderer, metrics, seg.modelLine, getLineColors, getLineInlayHints, getLineGhostInline);
  const side = elems.length
    ? virtualSideAtX(model.getLineContent(seg.modelLine), effectiveX, elems, col, (c, cc) => renderer.measureColumnX(c, cc, metrics))
    : undefined;
  return { lineNumber: seg.modelLine, column: col, side };
}

export function computeTargetAtLocalPoint(
  ctx: HitTestContext,
  localX: number,
  localY: number,
  cssWidth: number,
  cssHeight: number,
  element: unknown = null,
): IMouseTarget {
  if (localX < 0 || localY < 0 || localX > cssWidth || localY > cssHeight) {
    return {
      element,
      type: MouseTargetType.OUTSIDE_EDITOR,
      position: null,
      mouseColumn: 1,
      range: null,
    };
  }
  const pos = hitTestPosition(ctx, localX, localY, true);
  const range = {
    startLineNumber: pos.lineNumber,
    startColumn: pos.column,
    endLineNumber: pos.lineNumber,
    endColumn: pos.column,
  };
  const glyphW = ctx.glyphMargin ? (ctx.metrics.glyphMarginWidth ?? 18) : 0;
  const foldW = ctx.metrics.foldGutterWidth ?? 0;

  if (localX < ctx.contentLeft) {
    if (glyphW > 0 && localX < glyphW) {
      return { element, type: MouseTargetType.GUTTER_GLYPH_MARGIN, position: pos, mouseColumn: 1, range };
    }
    if (foldW > 0 && localX >= ctx.contentLeft - foldW) {
      return { element, type: MouseTargetType.GUTTER_LINE_DECORATIONS, position: pos, mouseColumn: 1, range };
    }
    return { element, type: MouseTargetType.GUTTER_LINE_NUMBERS, position: pos, mouseColumn: 1, range };
  }

  const lineLen = ctx.model.getLineContent(pos.lineNumber).length;
  const lineEndX =
    ctx.contentLeft +
    ctx.metrics.paddingLeft +
    measureLineColumnX(
      ctx.model, ctx.renderer, ctx.metrics, ctx.getLineColors, pos.lineNumber, lineLen + 1,
      ctx.getLineInlayHints, ctx.getLineGhostInline,
    ) -
    ctx.scrollLeft;

  const type = localX <= lineEndX + 2 ? MouseTargetType.CONTENT_TEXT : MouseTargetType.CONTENT_EMPTY;
  return { element, type, position: pos, mouseColumn: pos.column, range };
}

export function computeScreenPosOf(
  ctx: HitTestContext,
  line: number,
  col: number,
): { x: number; y: number; h: number } {
  const {
    model, renderer, projection, metrics, contentLeft, scrollTop, scrollLeft,
    topInsetPx, viewZone, resolvedZones, getLineColors, getLineInlayHints, getLineGhostInline,
  } = ctx;
  const clampedLine = Math.max(1, Math.min(model.getLineCount(), line));
  const mapped = projection.modelToVisual(clampedLine, col);
  const seg = mapped.visualLine;
  const originPx =
    seg.startCol === 1
      ? 0
      : measureLineColumnX(
          model, renderer, metrics, getLineColors, clampedLine, seg.startCol, getLineInlayHints, getLineGhostInline, true,
        );
  const colPx = measureLineColumnX(
    model, renderer, metrics, getLineColors, clampedLine, col, getLineInlayHints, getLineGhostInline, false,
  );
  const x = contentLeft + metrics.paddingLeft + seg.wrapIndentPx + (colPx - originPx) - scrollLeft;
  const afterRow = resolveViewZoneAfterRow(viewZone, model, projection);
  const y = computeRowDocTop(mapped.visualRow, metrics, topInsetPx, viewZone, afterRow, resolvedZones) - scrollTop;
  return { x, y, h: metrics.lineHeight };
}
