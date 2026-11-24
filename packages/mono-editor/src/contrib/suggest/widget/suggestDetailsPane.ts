import { renderMarkdownToDom } from '../../../browser/render/markdownDom';
import type { CompletionItem } from '../../../common/languages/providers/types';
import type { SuggestPalette, SuggestWidgetOptions } from './suggestStyle';

/**
 * Side documentation pane for the SuggestWidget.
 */
export class SuggestDetailsPane {
  private host: HTMLElement;
  private docEl: HTMLDivElement | null = null;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  show(
    item: CompletionItem | null,
    listEl: HTMLElement | null,
    suspended: boolean,
    opts: SuggestWidgetOptions,
    pal: SuggestPalette,
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
    if (!docText) {
      this.hide();
      return;
    }
    if (!this.docEl) {
      const d = document.createElement('div');
      d.className = 'mono-suggest-docs';
      Object.assign(d.style, {
        position: 'absolute',
        zIndex: '45',
        boxSizing: 'border-box',
        borderRadius: '3px',
        padding: '8px 10px',
        maxWidth: '300px',
        maxHeight: '200px',
        overflowY: 'auto',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '12px',
        lineHeight: '1.45',
        pointerEvents: 'auto',
      } as CSSStyleDeclaration);
      d.addEventListener('pointerdown', (e) => e.stopPropagation());
      d.addEventListener('mousedown', (e) => e.preventDefault());
      d.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
      this.host.appendChild(d);
      this.docEl = d;
    }
    const d = this.docEl;
    d.style.background = pal.background;
    d.style.border = pal.border;
    d.style.color = pal.foreground;
    d.style.boxShadow = `0 0 8px 2px ${pal.shadow}`;
    d.style.display = 'block';
    d.textContent = '';

    if (detailText) {
      const hdr = document.createElement('div');
      hdr.textContent = detailText;
      hdr.style.fontFamily = opts.fontFamily ?? 'monospace';
      hdr.style.fontSize = '11px';
      hdr.style.opacity = '0.85';
      hdr.style.paddingBottom = '5px';
      hdr.style.marginBottom = '5px';
      hdr.style.borderBottom = pal.border;
      d.appendChild(hdr);
    }

    const isDark = opts.themeType !== 'light';
    renderMarkdownToDom(d, docText, {
      isDark,
      background: pal.background,
      foreground: pal.foreground,
      mutedForeground: pal.foreground,
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
      codeBackground: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
      shadow: `0 0 8px 2px ${pal.shadow}`,
    });
    this.position(listEl, suspended);
  }

  setSuspended(suspended: boolean): void {
    if (this.docEl) this.docEl.style.display = suspended ? 'none' : 'block';
  }

  position(listEl: HTMLElement | null, suspended: boolean): void {
    if (!listEl || !this.docEl || suspended) return;
    const hostW = this.host.clientWidth || 600;
    const hostH = this.host.clientHeight || 400;
    const listLeft = parseFloat(listEl.style.left) || 0;
    const listTop = parseFloat(listEl.style.top) || 0;
    const listW = listEl.offsetWidth;
    const docW = Math.min(300, Math.max(160, this.docEl.offsetWidth || 240));
    const docH = this.docEl.offsetHeight || 80;

    let left = listLeft + listW + 4;
    if (left + docW > hostW - 6) {
      const onLeft = listLeft - docW - 4;
      left = onLeft >= 6 ? onLeft : Math.max(6, hostW - docW - 6);
    }
    let top = listTop;
    if (top + docH > hostH - 6) top = Math.max(6, hostH - docH - 6);
    this.docEl.style.left = `${Math.round(left)}px`;
    this.docEl.style.top = `${Math.round(top)}px`;
  }

  hide(): void {
    if (this.docEl) {
      this.docEl.remove();
      this.docEl = null;
    }
  }
}
