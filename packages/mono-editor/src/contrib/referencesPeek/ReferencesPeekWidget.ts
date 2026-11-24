import type { Location } from '../../common/languages/providers/types';
import { createIcon, ensureCodicons } from '../../platform/icons';
import type { ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';

export interface ReferenceDisplayItem {
  location: Location;
  preview: string;
  uriLabel: string;
}

/**
 * Floating References Peek list (`Shift+F12`).
 */
export class ReferencesPeekWidget {
  private host: HTMLElement;
  private el: HTMLDivElement | null = null;
  private theme: ResolvedWidgetTheme | null = null;
  private lastItems: ReferenceDisplayItem[] = [];
  private lastAnchor: { x: number; y: number } | null = null;
  private lastSelect: ((loc: Location) => void) | null = null;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  applyTheme(theme: ResolvedWidgetTheme): void {
    this.theme = theme;
    if (this.el && this.lastAnchor && this.lastSelect) {
      this.show(this.lastItems, this.lastAnchor, this.lastSelect);
    }
  }

  isVisible(): boolean {
    return !!this.el;
  }

  show(
    items: ReferenceDisplayItem[],
    anchor: { x: number; y: number },
    onSelect: (loc: Location) => void,
  ): void {
    this.hide();
    ensureCodicons();
    this.lastItems = items;
    this.lastAnchor = anchor;
    this.lastSelect = onSelect;

    const bg = this.theme?.background ?? '#252526';
    const border = this.theme?.border ?? '#454545';
    const fg = this.theme?.foreground ?? '#cccccc';
    const muted = this.theme?.mutedForeground ?? '#9d9d9d';
    const hover = this.theme?.hoverBackground ?? 'rgba(255,255,255,0.08)';
    const accent = this.theme?.focusBorder ?? '#3794ff';
    const shadow = this.theme?.shadow ?? '0 6px 20px rgba(0,0,0,0.45)';

    const el = document.createElement('div');
    el.className = 'mono-references-peek';
    Object.assign(el.style, {
      position: 'absolute',
      zIndex: '47',
      width: `${Math.min(440, Math.max(240, (this.host.clientWidth || 600) - 24))}px`,
      maxHeight: '240px',
      display: 'flex',
      flexDirection: 'column',
      background: bg,
      border: `1px solid ${border}`,
      borderTop: `2px solid ${accent}`,
      borderRadius: '4px',
      boxShadow: shadow,
      color: fg,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '12px',
      overflow: 'hidden',
      pointerEvents: 'auto',
    } as CSSStyleDeclaration);

    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '5px 8px',
      borderBottom: `1px solid ${border}`,
      fontSize: '11px',
      fontWeight: '600',
    });
    const titleWrap = document.createElement('span');
    Object.assign(titleWrap.style, { display: 'inline-flex', alignItems: 'center', gap: '5px' });
    titleWrap.appendChild(createIcon('references', 13));
    const title = document.createElement('span');
    title.textContent = `${items.length} reference${items.length === 1 ? '' : 's'}`;
    titleWrap.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.title = 'Close References (Escape)';
    Object.assign(closeBtn.style, {
      border: 'none',
      background: 'transparent',
      color: fg,
      cursor: 'pointer',
      padding: '2px',
      display: 'inline-flex',
      alignItems: 'center',
    });
    closeBtn.appendChild(createIcon('close', 13));
    closeBtn.addEventListener('mousedown', (e) => e.preventDefault());
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide();
    });
    header.appendChild(titleWrap);
    header.appendChild(closeBtn);
    el.appendChild(header);

    const list = document.createElement('div');
    Object.assign(list.style, { overflowY: 'auto', flex: '1' });

    if (!items.length) {
      const empty = document.createElement('div');
      empty.textContent = 'No references found';
      empty.style.padding = '10px 10px';
      empty.style.color = muted;
      list.appendChild(empty);
    } else {
      for (const item of items) {
        const row = document.createElement('div');
        Object.assign(row.style, {
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '5px 8px',
          cursor: 'pointer',
          borderBottom: `1px solid ${border}`,
        });
        const locSpan = document.createElement('span');
        locSpan.textContent = `${item.uriLabel}:${item.location.range.startLineNumber}`;
        locSpan.style.color = accent;
        locSpan.style.fontSize = '11px';
        locSpan.style.flexShrink = '0';

        const code = document.createElement('span');
        code.textContent = item.preview.trim();
        Object.assign(code.style, {
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: '11px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: '1',
        });

        row.addEventListener('pointerenter', () => { row.style.background = hover; });
        row.addEventListener('pointerleave', () => { row.style.background = 'transparent'; });
        row.addEventListener('mousedown', (e) => e.preventDefault());
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          this.hide();
          onSelect(item.location);
        });
        row.appendChild(locSpan);
        row.appendChild(code);
        list.appendChild(row);
      }
    }

    el.appendChild(list);
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    this.host.appendChild(el);
    this.el = el;

    const hostW = this.host.clientWidth || 600;
    const hostH = this.host.clientHeight || 400;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = Math.max(8, anchor.x);
    let top = Math.max(8, anchor.y + 4);
    if (left + w > hostW - 8) left = Math.max(8, hostW - w - 8);
    if (top + h > hostH - 8) top = Math.max(8, anchor.y - h - 22);
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }

  hide(): void {
    this.el?.remove();
    this.el = null;
    this.lastItems = [];
    this.lastAnchor = null;
    this.lastSelect = null;
  }

  dispose(): void {
    this.hide();
  }
}
