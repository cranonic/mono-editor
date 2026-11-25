export interface RectBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface MenuSize {
  width: number;
  height: number;
}

export interface MenuPlacementResult {
  left: number;
  top: number;
  maxHeight: number | null;
  placement: 'above' | 'below' | 'right' | 'left';
}

export interface CascadeTiming {
  staggerMs: number;
  rowDurationMs: number;
  totalDurationMs: number;
}

function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.max(lo, Math.min(hi, v));
}

function rectsIntersect(a: RectBox, b: RectBox): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * Pure placement solver for horizontal and vertical context menus.
 * Guarantees the placed rectangle stays inside `safeArea` and never overlaps `anchorRects`,
 * clamping to `maxHeight` with vertical scroll when the menu is taller than available room.
 */
export function computeMenuPlacement(
  anchorRects: readonly RectBox[],
  menuSize: MenuSize,
  safeArea: RectBox,
  gap = 8,
  explicitMaxHeight?: number,
): MenuPlacementResult {
  const safeW = Math.max(40, safeArea.right - safeArea.left);
  const safeH = Math.max(40, safeArea.bottom - safeArea.top);
  const w = Math.min(Math.max(1, menuSize.width), safeW);
  const rawH = Math.max(1, menuSize.height);
  const cappedH = explicitMaxHeight != null ? Math.min(rawH, explicitMaxHeight) : rawH;

  // Union bounding box of all anchor rects (caret lines + teardrops)
  let union: RectBox;
  if (anchorRects.length === 0) {
    const cx = (safeArea.left + safeArea.right) / 2;
    const cy = (safeArea.top + safeArea.bottom) / 2;
    union = { left: cx, right: cx, top: cy, bottom: cy };
  } else {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const r of anchorRects) {
      if (r.left < left) left = r.left;
      if (r.top < top) top = r.top;
      if (r.right > right) right = r.right;
      if (r.bottom > bottom) bottom = r.bottom;
    }
    union = { left, top, right, bottom };
  }

  const anchorCx = (union.left + union.right) / 2;
  const centeredLeft = clamp(anchorCx - w / 2, safeArea.left, safeArea.right - w);

  const overlapsAnyAnchor = (box: RectBox): boolean =>
    anchorRects.some((r) => rectsIntersect(box, r));

  // 1) Above anchor union
  const aboveRoom = Math.max(0, union.top - gap - safeArea.top);
  if (cappedH <= aboveRoom) {
    const top = union.top - gap - cappedH;
    const box: RectBox = { left: centeredLeft, top, right: centeredLeft + w, bottom: top + cappedH };
    if (!overlapsAnyAnchor(box)) {
      return {
        left: Math.round(centeredLeft),
        top: Math.round(top),
        maxHeight: explicitMaxHeight != null && rawH > explicitMaxHeight ? Math.floor(explicitMaxHeight) : null,
        placement: 'above',
      };
    }
  }

  // 2) Below anchor union (starts after teardrop bottom)
  const belowRoom = Math.max(0, safeArea.bottom - (union.bottom + gap));
  if (cappedH <= belowRoom) {
    const top = union.bottom + gap;
    const box: RectBox = { left: centeredLeft, top, right: centeredLeft + w, bottom: top + cappedH };
    if (!overlapsAnyAnchor(box)) {
      return {
        left: Math.round(centeredLeft),
        top: Math.round(top),
        maxHeight: explicitMaxHeight != null && rawH > explicitMaxHeight ? Math.floor(explicitMaxHeight) : null,
        placement: 'below',
      };
    }
  }

  // 3) Beside anchor (right then left) if full height fits in safeArea
  const clampedMidTop = clamp(union.top, safeArea.top, safeArea.bottom - Math.min(cappedH, safeH));
  const rightRoom = safeArea.right - (union.right + gap);
  if (w <= rightRoom && cappedH <= safeH) {
    const left = union.right + gap;
    const box: RectBox = { left, top: clampedMidTop, right: left + w, bottom: clampedMidTop + cappedH };
    if (!overlapsAnyAnchor(box)) {
      return {
        left: Math.round(left),
        top: Math.round(clampedMidTop),
        maxHeight: explicitMaxHeight != null && rawH > explicitMaxHeight ? Math.floor(explicitMaxHeight) : null,
        placement: 'right',
      };
    }
  }
  const leftRoom = union.left - gap - safeArea.left;
  if (w <= leftRoom && cappedH <= safeH) {
    const left = union.left - gap - w;
    const box: RectBox = { left, top: clampedMidTop, right: left + w, bottom: clampedMidTop + cappedH };
    if (!overlapsAnyAnchor(box)) {
      return {
        left: Math.round(left),
        top: Math.round(clampedMidTop),
        maxHeight: explicitMaxHeight != null && rawH > explicitMaxHeight ? Math.floor(explicitMaxHeight) : null,
        placement: 'left',
      };
    }
  }

  // 4) Tall menu fallback: choose side (above vs below) with MORE room, clamp maxHeight & scroll
  if (belowRoom >= aboveRoom && belowRoom >= 36) {
    const maxH = Math.floor(explicitMaxHeight != null ? Math.min(belowRoom, explicitMaxHeight) : belowRoom);
    return {
      left: Math.round(centeredLeft),
      top: Math.round(union.bottom + gap),
      maxHeight: Math.max(36, maxH),
      placement: 'below',
    };
  }
  if (aboveRoom >= 36) {
    const maxH = Math.floor(explicitMaxHeight != null ? Math.min(aboveRoom, explicitMaxHeight) : aboveRoom);
    const usedH = Math.min(rawH, maxH);
    return {
      left: Math.round(centeredLeft),
      top: Math.round(Math.max(safeArea.top, union.top - gap - usedH)),
      maxHeight: Math.max(36, maxH),
      placement: 'above',
    };
  }

  // Extreme constrained viewport: beside or inside safeArea with maxHeight = safeH
  const fallbackMaxH = Math.floor(explicitMaxHeight != null ? Math.min(safeH, explicitMaxHeight) : safeH);
  return {
    left: Math.round(centeredLeft),
    top: Math.round(safeArea.top),
    maxHeight: Math.max(36, fallbackMaxH),
    placement: belowRoom >= aboveRoom ? 'below' : 'above',
  };
}

/**
 * Computes safe area inside `hostRect` intersected with `window.visualViewport`
 * (keeping menus above soft keyboards) minus sticky header and bottom sticky bar.
 */
export function computeMenuSafeArea(
  hostRect: { left: number; top: number; width: number; height: number },
  topStickyPx: number,
  bottomStickyPx: number,
  pad = 8,
  vv?: { offsetTop: number; offsetLeft: number; width: number; height: number } | null,
): RectBox {
  let top = Math.max(pad, topStickyPx + 4);
  let bottom = hostRect.height - bottomStickyPx - pad;
  let left = pad;
  let right = hostRect.width - pad;

  if (vv && vv.height > 0 && vv.width > 0) {
    const vvTopLocal = vv.offsetTop - hostRect.top;
    const vvBottomLocal = vv.offsetTop + vv.height - hostRect.top;
    const vvLeftLocal = vv.offsetLeft - hostRect.left;
    const vvRightLocal = vv.offsetLeft + vv.width - hostRect.left;
    top = Math.max(top, vvTopLocal + pad);
    bottom = Math.min(bottom, vvBottomLocal - bottomStickyPx - pad);
    left = Math.max(left, vvLeftLocal + pad);
    right = Math.min(right, vvRightLocal - pad);
  }

  if (bottom < top + 40) bottom = Math.max(top + 40, hostRect.height - pad);
  if (right < left + 40) right = Math.max(left + 40, hostRect.width - pad);
  return { left, top, right, bottom };
}

/**
 * Computes cascade stagger & duration guaranteeing total animation time <= 500ms for any N >= 1.
 */
export function computeCascadeTiming(rowCount: number): CascadeTiming {
  const n = Math.max(0, Math.floor(rowCount));
  if (n === 0) return { staggerMs: 0, rowDurationMs: 0, totalDurationMs: 0 };
  const staggerMs = n > 1 ? Math.min(60, Math.floor(360 / n)) : 0;
  const budgetForLastRow = 500 - staggerMs * (n - 1);
  const rowDurationMs = Math.min(180, Math.max(80, budgetForLastRow));
  const totalDurationMs = staggerMs * (n - 1) + rowDurationMs;
  return { staggerMs, rowDurationMs, totalDurationMs };
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

/**
 * Compositor-only WAAPI animations (transform + opacity only, never blocks pointer events).
 */
export function animateMenuPanel(
  panel: HTMLElement,
  rows: HTMLElement[],
  mode: 'cascade' | 'smooth' | 'none',
  headerEl?: HTMLElement | null,
): void {
  if (prefersReducedMotion() || typeof panel.animate !== 'function') return;

  if (mode === 'none') {
    panel.style.willChange = 'opacity';
    const anim = panel.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 100,
      easing: 'ease-out',
    });
    anim.onfinish = () => { panel.style.willChange = ''; };
    return;
  }

  if (mode === 'smooth') {
    panel.style.willChange = 'transform, opacity';
    const anim = panel.animate(
      [
        { opacity: 0, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: 140, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
    );
    anim.onfinish = () => { panel.style.willChange = ''; };
    return;
  }

  // Cascade mode: header fades in first, rows slide left -> right with total <= 500ms
  if (headerEl && typeof headerEl.animate === 'function') {
    headerEl.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 110,
      easing: 'ease-out',
    });
  }
  const { staggerMs, rowDurationMs } = computeCascadeTiming(rows.length);
  rows.forEach((row, idx) => {
    if (typeof row.animate !== 'function') return;
    row.style.willChange = 'transform, opacity';
    const anim = row.animate(
      [
        { opacity: 0, transform: 'translateX(-18px)' },
        { opacity: 1, transform: 'translateX(0)' },
      ],
      {
        duration: rowDurationMs,
        delay: idx * staggerMs,
        easing: 'cubic-bezier(0.2, 0, 0, 1)',
        fill: 'backwards',
      },
    );
    anim.onfinish = () => { row.style.willChange = ''; };
  });
}
