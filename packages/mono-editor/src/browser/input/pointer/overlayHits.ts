import type { ColorHit, InlayHintHit, LinkHit } from '../../render/CanvasRenderer';
import type { ViewController } from '../../view/ViewController';

export interface InlayHintClickMeta {
  clickCount: 1 | 2;
  source: 'touch' | 'mouse';
  localX: number;
  localY: number;
}

export interface OverlayHitHandlers {
  onFoldToggle?: (lineNumber: number) => void;
  onColorSwatchClick?: (hit: ColorHit) => void;
  onLinkClick?: (hit: LinkHit, e: PointerEvent) => void;
  onInlayHintClick?: (hit: InlayHintHit, meta?: InlayHintClickMeta) => void;
}

export function hitTestStickyColorSwatch(
  view: ViewController,
  localX: number,
  localY: number,
): ColorHit | null {
  for (const ch of view.getStickyColorHits()) {
    if (localX >= ch.x - 3 && localX <= ch.x + ch.w + 3 && localY >= ch.y - 3 && localY <= ch.y + ch.h + 3) {
      return ch;
    }
  }
  return null;
}

export function hitTestColorSwatch(
  view: ViewController,
  localX: number,
  localY: number,
): ColorHit | null {
  for (const ch of view.getColorHits()) {
    if (localX >= ch.x - 3 && localX <= ch.x + ch.w + 3 && localY >= ch.y - 3 && localY <= ch.y + ch.h + 3) {
      return ch;
    }
  }
  return null;
}

export function hitTestFoldChevron(
  view: ViewController,
  localX: number,
  localY: number,
): number | null {
  for (const fh of view.getFoldHits()) {
    if (localX >= fh.x - 4 && localX <= fh.x + fh.w + 4 && localY >= fh.y && localY <= fh.y + fh.h) {
      return fh.lineNumber;
    }
  }
  return null;
}

export function hitTestLink(
  view: ViewController,
  localX: number,
  localY: number,
): LinkHit | null {
  for (const lh of view.getLinkHits()) {
    if (localX >= lh.x && localX <= lh.x + lh.w && localY >= lh.y && localY <= lh.y + lh.h) {
      return lh;
    }
  }
  return null;
}

/**
 * Handles `pointerdown` overlay hits. For touch/pen, color swatches, sticky swatches,
 * and fold chevrons are intentionally deferred to `pointerup` so touch-scrolling never
 * accidentally triggers them.
 */
export function handlePointerDownOverlay(
  view: ViewController,
  localX: number,
  localY: number,
  e: PointerEvent,
  hasTeardropHit: boolean,
  handlers: OverlayHitHandlers & {
    onStickyTap: () => void;
    onBottomStickyTap: () => void;
  },
): boolean {
  const isTouchOrPen = e.pointerType === 'touch' || e.pointerType === 'pen';

  if (handlers.onColorSwatchClick) {
    const stickySwatch = hitTestStickyColorSwatch(view, localX, localY);
    if (stickySwatch) {
      if (isTouchOrPen) return false;
      e.preventDefault();
      e.stopPropagation();
      handlers.onColorSwatchClick(stickySwatch);
      return true;
    }
  }

  const stickyHit = view.hitTestSticky(localX, localY);
  if (stickyHit) {
    e.preventDefault();
    view.revealStickyLine(stickyHit.lineNumber, stickyHit.index, localX);
    handlers.onStickyTap();
    return true;
  }

  const bottomHit = hasTeardropHit ? null : view.hitTestBottomSticky(localX, localY);
  if (bottomHit) {
    e.preventDefault();
    handlers.onBottomStickyTap();
    view.revealBottomStickyLine(bottomHit.lineNumber, localX);
    handlers.onStickyTap();
    return true;
  }

  if (!isTouchOrPen && handlers.onFoldToggle) {
    const foldLine = hitTestFoldChevron(view, localX, localY);
    if (foldLine !== null) {
      e.preventDefault();
      handlers.onFoldToggle(foldLine);
      return true;
    }
  }

  if (!isTouchOrPen && handlers.onColorSwatchClick) {
    const swatch = hitTestColorSwatch(view, localX, localY);
    if (swatch) {
      e.preventDefault();
      e.stopPropagation();
      handlers.onColorSwatchClick(swatch);
      return true;
    }
  }

  if (handlers.onLinkClick && (e.ctrlKey || e.metaKey)) {
    const link = hitTestLink(view, localX, localY);
    if (link) {
      e.preventDefault();
      e.stopPropagation();
      handlers.onLinkClick(link, e);
      return true;
    }
  }
  return false;
}

/**
 * Handles deferred touch/pen tap overlays on `pointerup` once we know the gesture
 * was a genuine tap (not a scroll and not a long-press).
 */
export function handleDeferredTapOverlay(
  view: ViewController,
  localX: number,
  localY: number,
  e: PointerEvent,
  handlers: OverlayHitHandlers,
): boolean {
  if (handlers.onColorSwatchClick) {
    const stickySwatch = hitTestStickyColorSwatch(view, localX, localY);
    if (stickySwatch) {
      e.preventDefault();
      e.stopPropagation();
      handlers.onColorSwatchClick(stickySwatch);
      return true;
    }
  }
  if (handlers.onFoldToggle) {
    const foldLine = hitTestFoldChevron(view, localX, localY);
    if (foldLine !== null) {
      e.preventDefault();
      handlers.onFoldToggle(foldLine);
      return true;
    }
  }
  if (handlers.onColorSwatchClick) {
    const swatch = hitTestColorSwatch(view, localX, localY);
    if (swatch) {
      e.preventDefault();
      e.stopPropagation();
      handlers.onColorSwatchClick(swatch);
      return true;
    }
  }
  return false;
}

export function handleInlayHintTap(
  view: ViewController,
  localX: number,
  localY: number,
  e: PointerEvent,
  isDouble: boolean,
  onInlayHintClick?: (hit: InlayHintHit, meta?: InlayHintClickMeta) => void,
): boolean {
  if (!onInlayHintClick) return false;
  const hits = view.getInlayHits();
  for (let i = hits.length - 1; i >= 0; i--) {
    const ih = hits[i]!;
    if (localX >= ih.x && localX <= ih.x + ih.w && localY >= ih.y && localY <= ih.y + ih.h) {
      const clickCount: 1 | 2 = isDouble ? 2 : 1;
      const source: 'touch' | 'mouse' = e.pointerType === 'touch' ? 'touch' : 'mouse';
      onInlayHintClick(ih, { clickCount, source, localX, localY });
      return true;
    }
  }
  return false;
}
