import type { RenderMetrics } from '../../common/config/editorOptions';
import type { TextModel } from '../../common/model/TextModel';
import type { ViewLineProjection, WordWrapMode } from '../../common/viewModel/ViewLineProjection';
import type { CanvasRenderer } from '../render/CanvasRenderer';

export interface ViewZoneSpec {
  id: string;
  afterLineNumber: number;
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
  const line = Math.max(1, Math.min(model.getLineCount(), viewZone.afterLineNumber));
  const lineLen = model.getLineContent(line).length;
  return projection.modelToVisual(line, lineLen + 1).visualRow;
}

export function computeRowDocTop(
  row: number,
  metrics: RenderMetrics,
  topInsetPx: number,
  viewZone: ViewZoneSpec | null,
  afterRow: number,
): number {
  const zoneExtra = viewZone && afterRow >= 0 && row > afterRow ? viewZone.heightPx : 0;
  return topInsetPx + metrics.paddingTop + row * metrics.lineHeight + zoneExtra;
}

export function computeScrollHeight(
  visualLineCount: number,
  metrics: RenderMetrics,
  topInsetPx: number,
  viewZone: ViewZoneSpec | null,
  scrollBeyondLastLine: boolean,
  cssHeight: number,
): number {
  const zoneH = viewZone ? viewZone.heightPx : 0;
  const contentH = topInsetPx + visualLineCount * metrics.lineHeight + metrics.paddingTop + zoneH;
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
