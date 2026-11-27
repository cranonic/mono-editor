import {
  capPopupMaxWidth,
  placePopupHorizontal,
  POPUP_MAX_WIDTH_RATIO,
} from './popupPlacement';

export interface SuggestDocsBoxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SuggestDocsCaretBand {
  top: number;
  bottom: number;
}

export interface PlaceSuggestDocsInput {
  listRect: SuggestDocsBoxRect;
  caretLine: SuggestDocsCaretBand;
  naturalSize: { width: number; height: number };
  hostSize: { width: number; height: number };
  mode?: 'auto' | 'side' | 'below';
  margin?: number;
  gap?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
}

export interface SuggestDocsPlacementResult {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  placement: 'right' | 'above' | 'below' | 'left';
}

const DEFAULT_MARGIN = 4;
const DEFAULT_GAP = 4;
const DEFAULT_MIN_WIDTH = 140;
const DEFAULT_MIN_HEIGHT = 44;
const DEFAULT_MAX_WIDTH = 340;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function verticalBandForRight(
  listRect: SuggestDocsBoxRect,
  caretLine: SuggestDocsCaretBand,
  hostH: number,
  margin: number,
): { minTop: number; maxBottom: number } {
  const listBelowCaret = listRect.top >= caretLine.bottom - 1;
  const listAboveCaret = listRect.top + listRect.height <= caretLine.top + 1;
  if (listBelowCaret) {
    return { minTop: Math.max(margin, caretLine.bottom + 2), maxBottom: hostH - margin };
  }
  if (listAboveCaret) {
    return { minTop: margin, maxBottom: Math.min(hostH - margin, caretLine.top - 2) };
  }
  const aboveSpace = Math.max(0, caretLine.top - 2 - margin);
  const belowSpace = Math.max(0, hostH - margin - (caretLine.bottom + 2));
  if (belowSpace >= aboveSpace) {
    return { minTop: Math.max(margin, caretLine.bottom + 2), maxBottom: hostH - margin };
  }
  return { minTop: margin, maxBottom: Math.min(hostH - margin, caretLine.top - 2) };
}

/**
 * Pure non-overlapping placement solver for the completion documentation popup.
 *
 * Priority order (default `'auto'` / `'side'`):
 *  1. right of the completion list (if there is room);
 *  2. above the cursor line (if there is room);
 *  3. below the completion list.
 *
 * Guarantees the returned box never overlaps the completion list or caret line,
 * respects `POPUP_MAX_WIDTH_RATIO` (0.7 of host width), and shifts left before
 * shrinking when placing above/below.
 */
export function placeSuggestDocs(input: PlaceSuggestDocsInput): SuggestDocsPlacementResult | null {
  const margin = input.margin ?? DEFAULT_MARGIN;
  const gap = input.gap ?? DEFAULT_GAP;
  const minW = input.minWidth ?? DEFAULT_MIN_WIDTH;
  const minH = input.minHeight ?? DEFAULT_MIN_HEIGHT;
  const hostW = Math.max(0, input.hostSize.width);
  const hostH = Math.max(0, input.hostSize.height);
  if (hostW <= 2 * margin || hostH <= 2 * margin) return null;

  const { listRect, caretLine } = input;
  const maxAllowedW = Math.min(
    hostW - 2 * margin,
    capPopupMaxWidth(input.maxWidth ?? DEFAULT_MAX_WIDTH, hostW, POPUP_MAX_WIDTH_RATIO),
  );
  if (maxAllowedW < 60) return null;

  const naturalW = Math.max(1, Math.ceil(input.naturalSize.width || 240));
  const desiredW = Math.min(maxAllowedW, Math.max(Math.min(minW, maxAllowedW), naturalW));
  const prefH = Math.max(minH, Math.ceil(input.naturalSize.height || 120));

  const tryRight = (): SuggestDocsPlacementResult | null => {
    const startX = listRect.left + listRect.width + gap;
    const availW = hostW - margin - startX;
    const reqW = Math.min(minW, desiredW);
    const band = verticalBandForRight(listRect, caretLine, hostH, margin);
    const availH = Math.max(0, band.maxBottom - band.minTop);
    if (availW < reqW || availH < minH) return null;
    const width = Math.floor(Math.min(desiredW, availW));
    const height = Math.min(prefH, availH);
    const top = clamp(listRect.top, band.minTop, Math.max(band.minTop, band.maxBottom - height));
    const maxHeight = Math.floor(Math.max(minH, band.maxBottom - top));
    return {
      left: Math.round(startX),
      top: Math.round(top),
      width,
      maxHeight,
      placement: 'right',
    };
  };

  const tryAbove = (allowTiny = false): SuggestDocsPlacementResult | null => {
    const listAboveCaret = listRect.top + listRect.height <= caretLine.top + 1;
    const endY = (listAboveCaret ? Math.min(listRect.top, caretLine.top) : caretLine.top) - gap;
    const availH = endY - margin;
    const minNeeded = allowTiny ? 16 : minH;
    if (availH < minNeeded) return null;
    const h = placePopupHorizontal({
      anchorX: listRect.left,
      naturalWidth: desiredW,
      hostWidth: hostW,
      margin,
    });
    const width = Math.min(h.width, maxAllowedW);
    const left = Math.min(Math.max(margin, h.left), Math.max(margin, hostW - margin - width));
    const usedH = Math.min(prefH, availH);
    const top = Math.max(margin, endY - usedH);
    const maxHeight = Math.floor(Math.max(1, endY - top));
    return {
      left: Math.round(left),
      top: Math.round(top),
      width: Math.floor(width),
      maxHeight,
      placement: 'above',
    };
  };

  const tryBelow = (allowTiny = false): SuggestDocsPlacementResult | null => {
    const startY = Math.max(listRect.top + listRect.height, caretLine.bottom) + gap;
    const availH = hostH - margin - startY;
    const minNeeded = allowTiny ? 16 : minH;
    if (availH < minNeeded) return null;
    const h = placePopupHorizontal({
      anchorX: listRect.left,
      naturalWidth: desiredW,
      hostWidth: hostW,
      margin,
    });
    const width = Math.min(h.width, maxAllowedW);
    const left = Math.min(Math.max(margin, h.left), Math.max(margin, hostW - margin - width));
    return {
      left: Math.round(left),
      top: Math.round(startY),
      width: Math.floor(width),
      maxHeight: Math.floor(availH),
      placement: 'below',
    };
  };

  const order: Array<'right' | 'above' | 'below'> =
    input.mode === 'below' ? ['below', 'above', 'right'] : ['right', 'above', 'below'];

  for (const side of order) {
    const res = side === 'right' ? tryRight() : side === 'above' ? tryAbove(false) : tryBelow(false);
    if (res) return res;
  }

  // Last-resort fallback on ultra-short viewports: pick whichever of above/below has more vertical room
  const aboveTiny = tryAbove(true);
  const belowTiny = tryBelow(true);
  if (aboveTiny && belowTiny) {
    return aboveTiny.maxHeight >= belowTiny.maxHeight ? aboveTiny : belowTiny;
  }
  return aboveTiny ?? belowTiny ?? null;
}
