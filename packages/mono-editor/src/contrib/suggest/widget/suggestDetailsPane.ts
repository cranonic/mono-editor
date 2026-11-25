import { renderMarkdownToDom } from '../../../browser/render/markdownDom';
import type { CompletionItem } from '../../../common/languages/providers/types';
import type { SuggestDocsMode, SuggestPalette, SuggestWidgetOptions } from './suggestStyle';

export interface BoxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CaretLineBand {
  top: number;
  bottom: number;
}

export interface DocsPlacementResult {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  placement: 'right' | 'left' | 'below' | 'above';
}

const MARGIN = 4;
const GAP = 4;
const MIN_DOC_WIDTH = 140;
const MIN_DOC_HEIGHT = 44;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function verticalBandForSide(
  listRect: BoxRect,
  caretLine: CaretLineBand,
  hostH: number,
): { minTop: number; maxBottom: number } {
  const listBelowCaret = listRect.top >= caretLine.bottom - 1;
  const listAboveCaret = listRect.top + listRect.height <= caretLine.top + 1;
  if (listBelowCaret) {
    return { minTop: Math.max(MARGIN, caretLine.bottom + 2), maxBottom: hostH - MARGIN };
  }
  if (listAboveCaret) {
    return { minTop: MARGIN, maxBottom: Math.min(hostH - MARGIN, caretLine.top - 2) };
  }
  const aboveSpace = Math.max(0, caretLine.top - 2 - MARGIN);
  const belowSpace = Math.max(0, hostH - MARGIN - (caretLine.bottom + 2));
  if (belowSpace >= aboveSpace) {
    return { minTop: Math.max(MARGIN, caretLine.bottom + 2), maxBottom: hostH - MARGIN };
  }
  return { minTop: MARGIN, maxBottom: Math.min(hostH - MARGIN, caretLine.top - 2) };
}

/**
 * Pure non-overlapping placement solver for the completion documentation pane.
 * Evaluates right -> left -> below -> above (or below -> above -> right -> left
 * on narrow/touch hosts or when mode === 'below') and guarantees the returned
 * rectangle never intersects `listRect` or `caretLine`.
 */
export function computeDocsPlacement(
  listRect: BoxRect,
  caretLine: CaretLineBand,
  preferredSize: { width: number; height: number },
  hostSize: { width: number; height: number },
  mode: Exclude<SuggestDocsMode, 'off'> = 'auto',
  isNarrowOrTouch = false,
): DocsPlacementResult | null {
  const hostW = Math.max(0, hostSize.width);
  const hostH = Math.max(0, hostSize.height);
  if (hostW <= 2 * MARGIN || hostH <= 2 * MARGIN) return null;

  const prefW = clamp(preferredSize.width || 260, MIN_DOC_WIDTH, Math.min(340, hostW - 2 * MARGIN));
  const prefH = Math.max(MIN_DOC_HEIGHT, preferredSize.height || 120);

  const preferStacked = mode === 'below' || (mode === 'auto' && (isNarrowOrTouch || hostW <= 480));
  const order: Array<'right' | 'left' | 'below' | 'above'> = preferStacked
    ? ['below', 'above', 'right', 'left']
    : ['right', 'left', 'below', 'above'];

  const sideBand = verticalBandForSide(listRect, caretLine, hostH);
  const sideAvailH = Math.max(0, sideBand.maxBottom - sideBand.minTop);

  const buildCandidate = (side: 'right' | 'left' | 'below' | 'above'): DocsPlacementResult | null => {
    if (side === 'right') {
      const startX = listRect.left + listRect.width + GAP;
      const availW = hostW - MARGIN - startX;
      if (availW < MIN_DOC_WIDTH || sideAvailH < MIN_DOC_HEIGHT) return null;
      const width = Math.min(prefW, availW);
      const height = Math.min(prefH, sideAvailH);
      const top = clamp(listRect.top, sideBand.minTop, Math.max(sideBand.minTop, sideBand.maxBottom - height));
      const maxHeight = Math.max(MIN_DOC_HEIGHT, sideBand.maxBottom - top);
      return { left: Math.round(startX), top: Math.round(top), width: Math.floor(width), maxHeight: Math.floor(maxHeight), placement: 'right' };
    }
    if (side === 'left') {
      const endX = listRect.left - GAP;
      const availW = endX - MARGIN;
      if (availW < MIN_DOC_WIDTH || sideAvailH < MIN_DOC_HEIGHT) return null;
      const width = Math.min(prefW, availW);
      const height = Math.min(prefH, sideAvailH);
      const top = clamp(listRect.top, sideBand.minTop, Math.max(sideBand.minTop, sideBand.maxBottom - height));
      const maxHeight = Math.max(MIN_DOC_HEIGHT, sideBand.maxBottom - top);
      return { left: Math.round(endX - width), top: Math.round(top), width: Math.floor(width), maxHeight: Math.floor(maxHeight), placement: 'left' };
    }
    if (side === 'below') {
      let startY = listRect.top + listRect.height + GAP;
      // If list is above caret line, skip past the caret line so docs never cover it
      if (startY < caretLine.bottom + 2 && listRect.top + listRect.height <= caretLine.top + 1) {
        startY = caretLine.bottom + GAP;
      }
      const availH = hostH - MARGIN - startY;
      const availW = hostW - 2 * MARGIN;
      if (availH < MIN_DOC_HEIGHT || availW < Math.min(MIN_DOC_WIDTH, availW)) return null;
      if (availW < 100) return null;
      const width = Math.min(availW, Math.max(listRect.width, prefW));
      const left = clamp(listRect.left, MARGIN, Math.max(MARGIN, hostW - MARGIN - width));
      return { left: Math.round(left), top: Math.round(startY), width: Math.floor(width), maxHeight: Math.floor(availH), placement: 'below' };
    }
    // above
    let endY = listRect.top - GAP;
    // If list is below caret line, end above the caret line so docs never cover it
    if (endY > caretLine.top - 2 && listRect.top >= caretLine.bottom - 1) {
      endY = caretLine.top - GAP;
    }
    const availH = endY - MARGIN;
    const availW = hostW - 2 * MARGIN;
    if (availH < MIN_DOC_HEIGHT || availW < 100) return null;
    const width = Math.min(availW, Math.max(listRect.width, prefW));
    const usedH = Math.min(prefH, availH);
    const left = clamp(listRect.left, MARGIN, Math.max(MARGIN, hostW - MARGIN - width));
    const top = Math.max(MARGIN, endY - usedH);
    return { left: Math.round(left), top: Math.round(top), width: Math.floor(width), maxHeight: Math.floor(availH), placement: 'above' };
  };

  const candidates: DocsPlacementResult[] = [];
  for (const side of order) {
    const c = buildCandidate(side);
    if (c) candidates.push(c);
  }
  if (!candidates.length) return null;

  // First pass: pick first candidate that fits comfortably at preferred width (or >= 200px) and reasonable height
  const minComfortW = Math.min(prefW, 200);
  const minComfortH = Math.min(prefH, 68);
  for (const c of candidates) {
    if (c.width >= minComfortW && c.maxHeight >= minComfortH) return c;
  }

  // Second pass: pick the candidate with the largest usable area (graceful shrink + scroll)
  let best = candidates[0]!;
  let bestArea = best.width * Math.min(prefH, best.maxHeight);
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i]!;
    const area = c.width * Math.min(prefH, c.maxHeight);
    if (area > bestArea) {
      best = c;
      bestArea = area;
    }
  }
  return best;
}

/**
 * Side/stacked documentation pane for the SuggestWidget.
 */
export class SuggestDetailsPane {
  private host: HTMLElement;
  private docEl: HTMLDivElement | null = null;
  private lastCaretLine: CaretLineBand | null = null;
  private lastMode: Exclude<SuggestDocsMode, 'off'> = 'auto';

  constructor(host: HTMLElement) {
    this.host = host;
  }

  isVisible(): boolean {
    return Boolean(this.docEl && this.docEl.style.display !== 'none');
  }

  show(
    item: CompletionItem | null,
    listEl: HTMLElement | null,
    suspended: boolean,
    opts: SuggestWidgetOptions,
    pal: SuggestPalette,
    caretLine?: CaretLineBand,
    mode: Exclude<SuggestDocsMode, 'off'> = 'auto',
  ): void {
    if (!listEl || suspended || !item) {
      this.hide();
      return;
    }
    const rawDoc = item.documentation;
    const docText =
      typeof rawDoc === 'string'
        ? rawDoc
        : rawDoc && typeof rawDoc === 'object'
          ? rawDoc.value
          : '';
    const detailText = item.detail || '';
    if (!docText && !detailText) {
      this.hide();
      return;
    }
    this.lastCaretLine = caretLine ?? null;
    this.lastMode = mode;

    if (!this.docEl) {
      const d = document.createElement('div');
      d.className = 'mono-suggest-docs';
      Object.assign(d.style, {
        position: 'absolute',
        zIndex: '45',
        boxSizing: 'border-box',
        borderRadius: '3px',
        padding: '6px 8px',
        overflowY: 'auto',
        overflowX: 'hidden',
        overscrollBehavior: 'contain',
        overflowWrap: 'break-word',
        wordBreak: 'break-word',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: '13px',
        lineHeight: '1.45',
        pointerEvents: 'auto',
      } as CSSStyleDeclaration);
      d.addEventListener('pointerdown', (e) => e.stopPropagation());
      d.addEventListener('mousedown', (e) => e.preventDefault());
      d.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
      this.host.appendChild(d);
      this.docEl = d;
    }
    const editorFontSize = Math.max(10, Math.round(opts.fontSize ?? 14));
    const paneFontSize = Math.max(10, Math.round(editorFontSize * 0.93));
    const headerFontSize = Math.max(10, Math.round(editorFontSize * 0.92));

    const d = this.docEl;
    d.style.background = pal.background;
    d.style.border = pal.border;
    d.style.color = pal.foreground;
    d.style.fontSize = `${paneFontSize}px`;
    d.style.boxShadow = `0 2px 8px ${pal.shadow}`;
    d.style.display = 'block';
    d.style.width = 'auto';
    d.style.maxWidth = `${Math.round(320 * Math.max(1, editorFontSize / 14))}px`;
    d.style.maxHeight = 'none';
    d.textContent = '';

    if (detailText) {
      const hdr = document.createElement('div');
      hdr.textContent = detailText;
      hdr.style.fontFamily =
        opts.fontFamily ?? '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
      hdr.style.fontSize = `${headerFontSize}px`;
      hdr.style.lineHeight = '1.45';
      hdr.style.opacity = '0.92';
      hdr.style.overflowWrap = 'break-word';
      if (docText) {
        hdr.style.paddingBottom = '6px';
        hdr.style.marginBottom = '6px';
        hdr.style.borderBottom = pal.border;
      }
      d.appendChild(hdr);
    }

    if (docText) {
      const isDark = opts.themeType !== 'light';
      renderMarkdownToDom(d, docText, {
        isDark,
        background: pal.background,
        foreground: pal.foreground,
        mutedForeground: pal.detailForeground,
        border: isDark ? '#454545' : '#c8c8c8',
        inputBackground: pal.background,
        inputForeground: pal.foreground,
        inputBorder: isDark ? '#454545' : '#c8c8c8',
        focusBorder: pal.highlight,
        activeOptionBg: pal.selectedBackground,
        activeOptionFg: pal.selectedForeground,
        activeOptionBorder: pal.highlight,
        hoverBackground: pal.hoverBackground,
        selectionBackground: pal.selectedBackground,
        selectionForeground: pal.selectedForeground,
        codeBackground: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
        shadow: `0 2px 8px ${pal.shadow}`,
      }, undefined, { codeFontFamily: opts.fontFamily });
    }
    this.position(listEl, suspended, caretLine ?? this.lastCaretLine ?? undefined, mode);
  }

  setSuspended(suspended: boolean): void {
    if (this.docEl) this.docEl.style.display = suspended ? 'none' : 'block';
  }

  position(
    listEl: HTMLElement | null,
    suspended: boolean,
    caretLine?: CaretLineBand,
    mode?: Exclude<SuggestDocsMode, 'off'>,
  ): void {
    if (!listEl || !this.docEl || suspended) return;
    if (caretLine) this.lastCaretLine = caretLine;
    if (mode) this.lastMode = mode;

    const hostW = this.host.clientWidth || 600;
    const hostH = this.host.clientHeight || 400;
    const listRect: BoxRect = {
      left: parseFloat(listEl.style.left) || 0,
      top: parseFloat(listEl.style.top) || 0,
      width: listEl.offsetWidth || 240,
      height: listEl.offsetHeight || 120,
    };
    const caretBand: CaretLineBand = this.lastCaretLine ?? {
      top: Math.max(0, listRect.top - 22),
      bottom: listRect.top,
    };
    const isCoarse =
      typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);

    const prefW = Math.min(300, Math.max(160, this.docEl.scrollWidth || this.docEl.offsetWidth || 240));
    const prefH = Math.max(48, this.docEl.scrollHeight || this.docEl.offsetHeight || 96);

    const placement = computeDocsPlacement(
      listRect,
      caretBand,
      { width: prefW, height: prefH },
      { width: hostW, height: hostH },
      this.lastMode,
      isCoarse,
    );

    if (!placement) {
      this.docEl.style.display = 'none';
      return;
    }

    this.docEl.style.display = 'block';
    this.docEl.style.width = `${placement.width}px`;
    this.docEl.style.maxWidth = `${placement.width}px`;
    this.docEl.style.maxHeight = `${placement.maxHeight}px`;
    this.docEl.style.left = `${placement.left}px`;

    // Re-adjust top when placed above and actual wrapped height is known
    if (placement.placement === 'above') {
      const actualH = Math.min(this.docEl.offsetHeight || placement.maxHeight, placement.maxHeight);
      let endY = listRect.top - GAP;
      if (endY > caretBand.top - 2 && listRect.top >= caretBand.bottom - 1) {
        endY = caretBand.top - GAP;
      }
      this.docEl.style.top = `${Math.round(Math.max(MARGIN, endY - actualH))}px`;
    } else {
      this.docEl.style.top = `${placement.top}px`;
    }
  }

  hide(): void {
    if (this.docEl) {
      this.docEl.remove();
      this.docEl = null;
    }
  }
}
