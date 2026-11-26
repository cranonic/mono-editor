/**
 * Horizontal popup placement shared by hover and signature-help widgets (pure, no DOM).
 *
 * Priority (VS Code behaviour):
 *  1. keep the natural (unconstrained) width;
 *  2. if it overflows the right edge, shift left (down to `margin`);
 *  3. only when the popup cannot fit even at `margin`, shrink its width to the room available.
 */
export interface PopupHorizontalInput {
  /** Preferred left edge (usually the anchor x). */
  anchorX: number;
  /** Width the popup wants when nothing constrains it (already capped by its own max-width). */
  naturalWidth: number;
  hostWidth: number;
  /** Gap kept to both host edges. Default 6. */
  margin?: number;
}

export interface PopupHorizontalResult {
  left: number;
  width: number;
  /** True only when the width had to be reduced below the natural width. */
  shrunk: boolean;
}

export function placePopupHorizontal(input: PopupHorizontalInput): PopupHorizontalResult {
  const margin = input.margin ?? 6;
  const hostW = Math.max(0, input.hostWidth);
  const avail = Math.max(1, hostW - margin * 2);
  const natural = Math.max(1, Math.ceil(input.naturalWidth));
  const shrunk = natural > avail;
  const width = shrunk ? avail : natural;
  const maxLeft = Math.max(margin, hostW - margin - width);
  const left = Math.min(Math.max(margin, input.anchorX), maxLeft);
  return { left: Math.round(left), width, shrunk };
}

/** Popups never take more than this share of the host width (phones: no full-width popups). */
export const POPUP_MAX_WIDTH_RATIO = 0.7;

/**
 * Effective max width: first the percentage cap (70% of the host), then the configured px width,
 * whichever is smaller. A host of 0/unknown falls back to 600.
 */
export function capPopupMaxWidth(configuredMaxWidth: number, hostWidth: number, ratio = POPUP_MAX_WIDTH_RATIO): number {
  const host = hostWidth > 0 ? hostWidth : 600;
  return Math.max(1, Math.floor(Number(Math.min(configuredMaxWidth, host * ratio).toFixed(3))));
}
