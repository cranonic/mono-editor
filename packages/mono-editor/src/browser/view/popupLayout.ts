import { placePopupHorizontal, type PopupHorizontalResult } from '../../common/util/popupPlacement';

/**
 * Measures `el` at its natural width (no left-based squeeze) and places it with the
 * shift-left-before-shrink rule. Sets `left` and an explicit `width`, so later changes of
 * `left` can never re-wrap the text. Returns the final size for vertical placement.
 *
 * `el` must already be in the DOM, `position:absolute`, with its own `max-width` set.
 */
export function layoutPopupHorizontally(
  el: HTMLElement,
  anchorX: number,
  hostWidth: number,
  margin = 6,
): PopupHorizontalResult & { height: number } {
  el.style.left = '0px';
  el.style.width = 'max-content';
  const natural = el.getBoundingClientRect().width;
  const res = placePopupHorizontal({ anchorX, naturalWidth: natural, hostWidth, margin });
  el.style.width = `${res.width}px`;
  el.style.left = `${res.left}px`;
  return { ...res, height: el.offsetHeight };
}
