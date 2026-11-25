import type { RenderMetrics } from '../../common/config/editorOptions';
import type { TextModel } from '../../common/model/TextModel';
import type { ViewLineProjection, WordWrapMode } from '../../common/viewModel/ViewLineProjection';
import type { CanvasRenderer } from '../render/CanvasRenderer';

export interface ViewZoneSpec {
  id: string;
  afterLineNumber: number;
  heightPx: number;
}

export interface ResolvedViewZone {
  id: string;
  afterVisualRow: number;
  heightPx: number;
}

export interface MaxCharsCache {
  version: number;
  lines: number;
  chars: number;
  longestLine: number;
}

export function resolveViewZoneAfterRow(
  viewZone: ViewZoneSpec | null,
  model: TextModel,
  projection: ViewLineProjection,
): number {
  if (!viewZone) return -1;
  if (viewZone.afterLineNumber <= 0) return -1;
  const line = Math.max(1, Math.min(model.getLineCount(), viewZone.afterLineNumber));
  const lineLen = model.getLineContent(line).length;
  return projection.modelToVisual(line, lineLen + 1).visualRow;
}

export function resolveAllViewZones(
  zones: readonly ViewZoneSpec[],
  model: TextModel,
  projection: ViewLineProjection,
): ResolvedViewZone[] {
  if (!zones.length) return [];
  const out: ResolvedViewZone[] = [];
  for (const z of zones) {
    if (z.heightPx <= 0) continue;
    const afterVisualRow =
      z.afterLineNumber <= 0
        ? -1
        : resolveViewZoneAfterRow(z, model, projection);
    out.push({ id: z.id, afterVisualRow, heightPx: z.heightPx });
  }
  out.sort((a, b) => a.afterVisualRow - b.afterVisualRow);
  return out;
}

export function sumViewZonesAboveRow(row: number, zones: readonly ResolvedViewZone[]): number {
  if (!zones.length) return 0;
  let total = 0;
  for (const z of zones) {
    if (row > z.afterVisualRow) total += z.heightPx;
  }
  return total;
}

export function totalViewZonesHeight(zones: readonly { heightPx: number }[]): number {
  let total = 0;
  for (const z of zones) total += Math.max(0, z.heightPx);
  return total;
}

/**
 * Single source of truth for vertical row ↔ document-Y geometry across all view zones
 * (CodeLens strips, Peek views, Diff filler zones).
 */
export interface RowGeometry {
  readonly lineHeight: number;
  readonly paddingTop: number;
  readonly topInsetPx: number;
  readonly zones: readonly ResolvedViewZone[];
  readonly totalZoneHeight: number;
  /** Total height of all zones anchored above visual `row` (`z.afterVisualRow < row`). */
  extraAbove(row: number): number;
  /** Total height of zones anchored directly above visual `row` (`z.afterVisualRow === row - 1`). */
  leadingZoneHeight(row: number): number;
  /** Document Y (scroll-space, including `topInsetPx + paddingTop`) of the top of `row`. */
  topOfRow(row: number): number;
  /** Document Y (scroll-space) of the start of `row`'s block including any leading zones above it. */
  blockTopOfRow(row: number): number;
  /** Document Y in sticky-space (`paddingTop`, excluding `topInsetPx`) of the top of `row`. */
  stickyTopOfRow(row: number): number;
  /** Document Y in sticky-space of the start of `row`'s block including leading zones above it. */
  stickyBlockTopOfRow(row: number): number;
  /**
   * Inverse of `topOfRow`: given document Y in scroll-space (`localY + scrollTop`),
   * returns `{ row, inZone }`. A zone after row `r` belongs to row `r + 1` (the line below it).
   */
  rowAtDocY(docY: number): { row: number; inZone: boolean };
  /** Inverse in sticky-space (no `topInsetPx`). */
  rowAtStickyDocY(stickyDocY: number): { row: number; inZone: boolean };
  /** Document Y (scroll-space) of the top of a zone anchored after `afterRow` (preceding zones with same id excluded). */
  zoneDocTop(afterRow: number, zoneId: string): number;
  /** Total content height for `visualLineCount` rows (including `topInsetPx`, `paddingTop`, zones). */
  totalHeight(visualLineCount: number): number;
}

export function createRowGeometry(
  metrics: { lineHeight: number; paddingTop: number },
  topInsetPx: number,
  zones: readonly ResolvedViewZone[],
): RowGeometry {
  const { lineHeight, paddingTop } = metrics;
  const sorted = zones.length <= 1 ? zones : [...zones].sort((a, b) => a.afterVisualRow - b.afterVisualRow);
  const totalZoneHeight = totalViewZonesHeight(sorted);

  const extraAbove = (row: number): number => sumViewZonesAboveRow(row, sorted);

  const leadingZoneHeight = (row: number): number => {
    if (!sorted.length) return 0;
    const target = row - 1;
    let h = 0;
    for (const z of sorted) {
      if (z.afterVisualRow === target) h += z.heightPx;
      else if (z.afterVisualRow > target) break;
    }
    return h;
  };

  const stickyTopOfRow = (row: number): number => paddingTop + row * lineHeight + extraAbove(row);
  const stickyBlockTopOfRow = (row: number): number => stickyTopOfRow(row) - leadingZoneHeight(row);
  const topOfRow = (row: number): number => topInsetPx + stickyTopOfRow(row);
  const blockTopOfRow = (row: number): number => topInsetPx + stickyBlockTopOfRow(row);

  const rowAtRelativeY = (relY: number): { row: number; inZone: boolean } => {
    if (relY <= 0) return { row: 0, inZone: false };
    if (!sorted.length) {
      return { row: Math.max(0, Math.floor(relY / lineHeight)), inZone: false };
    }
    let cumZone = 0;
    for (const z of sorted) {
      const zoneStart = (z.afterVisualRow + 1) * lineHeight + cumZone;
      if (relY < zoneStart) {
        return { row: Math.max(0, Math.floor((relY - cumZone) / lineHeight)), inZone: false };
      }
      if (relY < zoneStart + z.heightPx) {
        return { row: Math.max(0, z.afterVisualRow + 1), inZone: true };
      }
      cumZone += z.heightPx;
    }
    return { row: Math.max(0, Math.floor((relY - cumZone) / lineHeight)), inZone: false };
  };

  const rowAtStickyDocY = (stickyDocY: number) => rowAtRelativeY(stickyDocY - paddingTop);
  const rowAtDocY = (docY: number) => rowAtRelativeY(docY - topInsetPx - paddingTop);
  const zoneDocTop = (afterRow: number, zoneId: string): number => {
    let extraBefore = 0;
    for (const z of sorted) {
      if (z.id === zoneId) break;
      if (z.afterVisualRow <= afterRow) extraBefore += z.heightPx;
    }
    return topInsetPx + paddingTop + (afterRow + 1) * lineHeight + extraBefore;
  };
  const totalHeight = (visualLineCount: number): number =>
    topInsetPx + paddingTop + visualLineCount * lineHeight + totalZoneHeight;

  return {
    lineHeight,
    paddingTop,
    topInsetPx,
    zones: sorted,
    totalZoneHeight,
    extraAbove,
    leadingZoneHeight,
    topOfRow,
    blockTopOfRow,
    stickyTopOfRow,
    stickyBlockTopOfRow,
    rowAtDocY,
    rowAtStickyDocY,
    zoneDocTop,
    totalHeight,
  };
}

export function computeRowDocTop(
  row: number,
  metrics: RenderMetrics,
  topInsetPx: number,
  viewZone: ViewZoneSpec | null,
  afterRow: number,
  extraZones?: readonly ResolvedViewZone[],
): number {
  let zoneExtra = 0;
  if (extraZones && extraZones.length) {
    zoneExtra = sumViewZonesAboveRow(row, extraZones);
  } else if (viewZone && afterRow >= 0 && row > afterRow) {
    zoneExtra = viewZone.heightPx;
  }
  return topInsetPx + metrics.paddingTop + row * metrics.lineHeight + zoneExtra;
}

export function computeScrollHeight(
  visualLineCount: number,
  metrics: RenderMetrics,
  topInsetPx: number,
  viewZone: ViewZoneSpec | null,
  scrollBeyondLastLine: boolean,
  cssHeight: number,
  allZones?: readonly ViewZoneSpec[],
  bottomInsetPx = 0,
): number {
  const zoneH = allZones && allZones.length
    ? totalViewZonesHeight(allZones)
    : viewZone
      ? viewZone.heightPx
      : 0;
  const contentH =
    topInsetPx + visualLineCount * metrics.lineHeight + metrics.paddingTop + zoneH + bottomInsetPx;
  if (!scrollBeyondLastLine || cssHeight <= 0) return contentH;
  const extra = Math.max(0, cssHeight - metrics.lineHeight - metrics.paddingTop - topInsetPx);
  return contentH + extra;
}

export function computeMaxContentWidthPx(
  wordWrap: WordWrapMode,
  cssWidth: number,
  contentLeft: number,
  metrics: RenderMetrics,
  model: TextModel,
  renderer: CanvasRenderer,
  cache: MaxCharsCache | null,
): { widthPx: number; cache: MaxCharsCache | null } {
  if (wordWrap === 'on') return { widthPx: cssWidth, cache };
  const version = model.getVersionId();
  let c = cache;
  if (!c || c.version !== version) {
    let maxChars = 0;
    let longestLine = 1;
    const n = model.getLineCount();
    for (let i = 1; i <= n; i++) {
      const len = model.getLineContent(i).length;
      if (len > maxChars) {
        maxChars = len;
        longestLine = i;
      }
    }
    c = { version, lines: n, chars: maxChars, longestLine };
  }
  const longestText = model.getLineContent(c.longestLine);
  const measuredLongest = renderer.measureColumnX(longestText, longestText.length + 1, metrics);
  const lineWidthPx = Math.max(c.chars * metrics.charWidth, measuredLongest);
  return {
    widthPx: contentLeft + metrics.paddingLeft + lineWidthPx + metrics.charWidth * 4,
    cache: c,
  };
}
