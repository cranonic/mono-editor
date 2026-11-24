/**
 * Pure scroll maths for revealing a line (no DOM, no view state) — kept out of ViewController so it stays small
 * and unit-testable.
 */

/**
 * Scroll position used to decide which sticky headers apply. Device-pixel rounding of the render position may
 * round UP by a fraction of a pixel (28px → 28.19px at DPR 2.625); on a row boundary that makes the sticky probe
 * land one row lower and pins the very line the caller just scrolled into place. Flooring to the device pixel
 * guarantees the probe is never below the true scroll position.
 */
export function quantizeStickyScrollTop(scrollTop: number, dpr: number): number {
  return Math.floor(scrollTop * dpr + 1e-6) / dpr;
}

export interface CenterRevealArgs {
  scrollTop: number;
  /** Row top in scroll space (already includes the top inset and padding). */
  rowTop: number;
  lineHeight: number;
  cssHeight: number;
  topInsetPx: number;
  maxScrollTop: number;
  /** Height of the sticky stack that would be shown at a given scroll position. */
  stickyHeightAt: (scrollTop: number) => number;
}

/**
 * Find next / previous: the new scrollTop that brings the row into the comfortably visible window, or the
 * current one when it is already there.
 *
 * Window = below the Find widget inset AND the sticky stack at the target scroll, and one row above the bottom
 * edge (that row is where the bottom active-line bar sits and would hide the match). Outside → centred.
 */
export function computeCenterReveal(a: CenterRevealArgs): number {
  const bottomLimit = a.cssHeight - a.lineHeight;
  const clearTop = (scroll: number) => Math.max(a.topInsetPx, a.stickyHeightAt(scroll));

  let scroll = a.scrollTop;
  const y = a.rowTop - scroll;
  if (y >= clearTop(scroll) && y + a.lineHeight <= bottomLimit) return scroll;

  for (let i = 0; i < 3; i++) {
    const top = clearTop(scroll);
    const room = Math.max(0, bottomLimit - top - a.lineHeight);
    scroll = Math.max(0, Math.min(a.maxScrollTop, a.rowTop - top - room / 2));
    // The stack depends on where we land; stop once the clearance used equals the clearance at the target.
    if (clearTop(scroll) === top) break;
  }
  return scroll;
}
