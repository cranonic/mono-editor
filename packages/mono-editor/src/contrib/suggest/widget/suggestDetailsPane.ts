import { renderMarkdownToDom } from '../../../browser/render/markdownDom';
import {
  capPopupMaxWidth,
  POPUP_MAX_WIDTH_RATIO,
} from '../../../common/util/popupPlacement';
import {
  placeSuggestDocs,
  type SuggestDocsBoxRect,
  type SuggestDocsCaretBand,
  type SuggestDocsPlacementResult,
} from '../../../common/util/suggestDocsPlacement';
import { CompletionItemKind, type CompletionItem } from '../../../common/languages/providers/types';
import type { SuggestDocsMode, SuggestPalette, SuggestWidgetOptions } from './suggestStyle';

export type BoxRect = SuggestDocsBoxRect;
export type CaretLineBand = SuggestDocsCaretBand;
export type DocsPlacementResult = SuggestDocsPlacementResult;

const MARGIN = 4;
const GAP = 4;

/**
 * Pure non-overlapping placement solver for the completion documentation pane.
 * Delegates to `placeSuggestDocs` (priority: right of list -> above cursor line -> below list),
 * guaranteeing zero overlap with the completion list or caret line and respecting
 * `POPUP_MAX_WIDTH_RATIO` (0.7) and shift-left-before-shrink horizontal placement.
 */
export function computeDocsPlacement(
  listRect: BoxRect,
  caretLine: CaretLineBand,
  preferredSize: { width: number; height: number },
  hostSize: { width: number; height: number },
  mode: Exclude<SuggestDocsMode, 'off'> = 'auto',
  _isNarrowOrTouch = false,
): DocsPlacementResult | null {
  return placeSuggestDocs({
    listRect,
    caretLine,
    naturalSize: preferredSize,
    hostSize,
    mode,
    margin: MARGIN,
    gap: GAP,
  });
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
    if (
      !listEl ||
      suspended ||
      !item ||
      item.kind === CompletionItemKind.Keyword ||
      item.kind === CompletionItemKind.Text
    ) {
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
        wordBreak: 'normal',
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
    const hostW = this.host.clientWidth || 600;
    const configuredMaxW = Math.round(340 * Math.max(1, editorFontSize / 14));
    const cappedMaxW = capPopupMaxWidth(configuredMaxW, hostW, POPUP_MAX_WIDTH_RATIO);

    const d = this.docEl;
    d.style.background = pal.background;
    d.style.border = pal.border;
    d.style.color = pal.foreground;
    d.style.fontSize = `${paneFontSize}px`;
    d.style.boxShadow = `0 2px 8px ${pal.shadow}`;
    d.style.display = 'block';
    d.style.left = '0px';
    d.style.width = 'max-content';
    d.style.maxWidth = `${cappedMaxW}px`;
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
        editorBackground: pal.background,
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
        codeBackground: 'transparent',
        shadow: `0 2px 8px ${pal.shadow}`,
      }, undefined, { flatCodeBlocks: true, codeFontFamily: opts.fontFamily });
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

    const cappedMaxW = capPopupMaxWidth(340, hostW, POPUP_MAX_WIDTH_RATIO);
    this.docEl.style.left = '0px';
    this.docEl.style.width = 'max-content';
    this.docEl.style.maxWidth = `${cappedMaxW}px`;
    const naturalW =
      this.docEl.getBoundingClientRect().width || this.docEl.scrollWidth || this.docEl.offsetWidth || 240;
    const naturalH = Math.max(48, this.docEl.scrollHeight || this.docEl.offsetHeight || 96);

    const placement = placeSuggestDocs({
      listRect,
      caretLine: caretBand,
      naturalSize: { width: naturalW, height: naturalH },
      hostSize: { width: hostW, height: hostH },
      mode: this.lastMode,
      margin: MARGIN,
      gap: GAP,
      maxWidth: cappedMaxW,
    });

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
      const listAboveCaret = listRect.top + listRect.height <= caretBand.top + 1;
      const endY = (listAboveCaret ? Math.min(listRect.top, caretBand.top) : caretBand.top) - GAP;
      const availH = Math.max(16, endY - MARGIN);
      this.docEl.style.maxHeight = `${Math.floor(availH)}px`;
      const actualH = Math.min(this.docEl.offsetHeight || availH, availH);
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
