import type { CompletionItem } from '../../common/languages/providers/types';
import { haptic } from '../../platform/haptic/haptic';
import { createIcon, ensureCodicons, kindToCodicon } from '../../platform/icons';
import { SuggestDetailsPane } from './widget/suggestDetailsPane';
import {
  BORDER,
  ensureSuggestStyle,
  kindLabel,
  LABEL_OFFSET,
  labelOfItem,
  matchIndexes,
  resolveSuggestPalette,
  type SuggestAnchor,
  type SuggestPalette,
  type SuggestWidgetOptions,
} from './widget/suggestStyle';

export type { SuggestAnchor, SuggestWidgetOptions };

/**
 * VS Code-style suggest widget: content-sized floating list next to the caret.
 */
export class SuggestWidget {
  private host: HTMLElement;
  private el: HTMLDivElement | null = null;
  private listEl: HTMLDivElement | null = null;
  private details: SuggestDetailsPane;
  private rows: HTMLDivElement[] = [];
  private items: CompletionItem[] = [];
  private filter = '';
  private index = 0;
  private hoverIndex = -1;
  private suspended = false;
  private anchor: SuggestAnchor = { x: 0, y: 0 };
  private opts: SuggestWidgetOptions;
  private pal: SuggestPalette;
  private onAccept: (item: CompletionItem) => void;
  private onSelectionChange?: (item: CompletionItem | null) => void;
  private lastTouchAcceptAt = 0;

  constructor(
    host: HTMLElement,
    handlers: {
      onAccept: (item: CompletionItem) => void;
      onDismiss: () => void;
      onSelectionChange?: (item: CompletionItem | null) => void;
    },
    options?: SuggestWidgetOptions,
  ) {
    this.host = host;
    this.details = new SuggestDetailsPane(host);
    this.onAccept = handlers.onAccept;
    this.onSelectionChange = handlers.onSelectionChange;
    this.opts = {
      maxHeight: 150,
      maxWidth: 460,
      minWidth: 250,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 14,
      className: '',
      themeType: 'dark',
      ...options,
    };
    this.pal = resolveSuggestPalette(this.opts);
  }

  setOptions(options: SuggestWidgetOptions): void {
    this.opts = { ...this.opts, ...options };
    this.pal = resolveSuggestPalette(this.opts);
    if (this.el) {
      this.applyChrome();
      this.renderList();
      this.position();
    }
  }

  isVisible(): boolean { return !!this.el; }
  isSuspended(): boolean { return this.suspended; }

  show(items: CompletionItem[], anchor: SuggestAnchor, filter?: string): void {
    this.items = items;
    this.filter = filter || '';
    this.index = Math.max(0, items.findIndex((i) => i.preselect));
    this.hoverIndex = -1;
    this.suspended = false;
    this.anchor = anchor;
    ensureSuggestStyle();
    if (!this.el) this.build();
    this.el!.style.display = 'flex';
    this.renderList();
    this.position();
    this.scrollToSelected();
    this.notifySelectionChange();
  }

  hide(): void {
    if (this.el) {
      this.el.remove();
      this.el = null;
      this.listEl = null;
    }
    this.details.hide();
    this.rows = [];
    this.items = [];
    this.suspended = false;
  }

  setSuspended(suspended: boolean): void {
    if (!this.el || this.suspended === suspended) return;
    this.suspended = suspended;
    this.el.style.display = suspended ? 'none' : 'flex';
    this.details.setSuspended(suspended);
    if (!suspended) this.position();
  }

  getSelectedItem(): CompletionItem | null {
    return this.items[this.index] ?? null;
  }

  showDocumentation(item: CompletionItem | null): void {
    this.details.show(item, this.el, this.suspended, this.opts, this.pal);
  }

  reposition(anchor: SuggestAnchor): void {
    this.anchor = anchor;
    if (this.el && !this.suspended) this.position();
  }

  selectNext(): void {
    if (!this.items.length) return;
    this.setIndex((this.index + 1) % this.items.length);
    haptic('light');
  }

  selectPrev(): void {
    if (!this.items.length) return;
    this.setIndex((this.index - 1 + this.items.length) % this.items.length);
    haptic('light');
  }

  acceptSelected(): boolean {
    const item = this.items[this.index];
    if (!item) return false;
    this.onAccept(item);
    this.hide();
    return true;
  }

  dispose(): void { this.hide(); }

  private notifySelectionChange(): void {
    const item = this.items[this.index] ?? null;
    this.showDocumentation(item);
    this.onSelectionChange?.(item);
  }

  private rowHeight(): number {
    return this.opts.rowHeight ?? Math.max(22, Math.round((this.opts.fontSize ?? 14) * 1.5));
  }

  private build(): void {
    const el = document.createElement('div');
    el.className = `mono-suggest-widget ${this.opts.className ?? ''}`.trim();
    el.setAttribute('role', 'listbox');
    Object.assign(el.style, {
      position: 'absolute',
      zIndex: '45',
      display: 'flex',
      flexDirection: 'column',
      boxSizing: 'border-box',
      borderRadius: '3px',
      overflow: 'hidden',
      pointerEvents: 'auto',
      touchAction: 'manipulation',
      width: 'max-content',
      left: '0px',
      top: '0px',
    } as CSSStyleDeclaration);

    const list = document.createElement('div');
    list.className = 'mono-suggest-list';
    Object.assign(list.style, {
      overflowY: 'auto',
      overflowX: 'hidden',
      outline: 'none',
      overscrollBehavior: 'contain',
    });
    this.listEl = list;
    el.appendChild(list);
    list.addEventListener('pointerdown', (e) => e.stopPropagation());
    list.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    this.host.appendChild(el);
    this.el = el;
    this.applyChrome(el);
  }

  private applyChrome(el: HTMLElement = this.el!): void {
    const p = this.pal;
    el.style.background = p.background;
    el.style.border = p.border;
    el.style.color = p.foreground;
    el.style.fontFamily = this.opts.fontFamily!;
    el.style.fontSize = `${this.opts.fontSize}px`;
    el.style.minWidth = `${this.opts.minWidth}px`;
    el.style.boxShadow = `0 0 8px 2px ${p.shadow}`;
  }

  private position(): void {
    if (!this.el || !this.listEl) return;
    const hostW = this.host.clientWidth;
    const hostH = this.host.clientHeight;
    const { x, y } = this.anchor;
    const lineTop = this.anchor.top ?? y - this.rowHeight();
    const rowH = this.rowHeight();
    const gap = 2;

    this.el.style.maxWidth = `${Math.max(120, Math.min(this.opts.maxWidth!, hostW - 8))}px`;

    const wanted = Math.min(this.opts.maxHeight!, this.items.length * rowH);
    const below = hostH - y - gap - 4;
    const above = lineTop - gap - 4;
    const placeBelow = below >= wanted + 2 * BORDER || below >= above;
    const avail = Math.max(rowH * 3, placeBelow ? below : above);
    this.listEl.style.maxHeight = `${Math.max(rowH, Math.min(this.opts.maxHeight!, avail - 2 * BORDER))}px`;

    const h = this.el.offsetHeight;
    const w = this.el.offsetWidth;
    const top = placeBelow ? y + gap : Math.max(4, lineTop - gap - h);
    let left = x - LABEL_OFFSET - BORDER;
    left = Math.min(left, hostW - w - 4);
    left = Math.max(4, left);

    this.el.style.left = `${Math.round(left)}px`;
    this.el.style.top = `${Math.round(top)}px`;
    this.details.position(this.el, this.suspended);
  }

  private setIndex(i: number): void {
    if (i === this.index) return;
    const prev = this.index;
    this.index = i;
    this.paintRow(prev);
    this.paintRow(i);
    this.scrollToSelected();
    this.notifySelectionChange();
  }

  private scrollToSelected(): void {
    const list = this.listEl;
    const row = this.rows[this.index];
    if (!list || !row) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }

  private paintRow(i: number): void {
    const row = this.rows[i];
    if (!row) return;
    const p = this.pal;
    const selected = i === this.index;
    row.setAttribute('aria-selected', selected ? 'true' : 'false');
    row.style.background = selected ? p.selectedBackground : i === this.hoverIndex ? p.hoverBackground : 'transparent';
    row.style.color = selected ? p.selectedForeground : p.foreground;
    const hl = selected ? p.focusHighlight : p.highlight;
    row.querySelectorAll<HTMLElement>('.mono-sg-hl').forEach((h) => (h.style.color = hl));
  }

  private renderList(): void {
    const list = this.listEl;
    if (!list) return;
    ensureCodicons();
    list.textContent = '';
    this.rows = [];
    const p = this.pal;
    const rowH = this.rowHeight();

    this.items.forEach((item, i) => {
      const row = document.createElement('div');
      row.setAttribute('role', 'option');
      Object.assign(row.style, {
        display: 'flex',
        alignItems: 'center',
        boxSizing: 'border-box',
        height: `${rowH}px`,
        lineHeight: `${rowH}px`,
        padding: '0 8px 0 4px',
        cursor: 'pointer',
        whiteSpace: 'pre',
        userSelect: 'none',
      } as CSSStyleDeclaration);
      (row.style as unknown as { webkitUserSelect: string }).webkitUserSelect = 'none';

      const icon = createIcon(kindToCodicon(item.kind), 16);
      Object.assign(icon.style, {
        width: '16px',
        height: '16px',
        flexShrink: '0',
        margin: '0 4px 0 2px',
        color: p.icon(item.kind),
      });

      const lab = document.createElement('span');
      Object.assign(lab.style, { flex: '1 1 auto', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis' });
      const text = labelOfItem(item);
      const hits = matchIndexes(text, this.filter);
      if (!hits) {
        lab.textContent = text;
      } else {
        let run = '';
        let runHit = false;
        const flush = () => {
          if (!run) return;
          if (runHit) {
            const s = document.createElement('span');
            s.textContent = run;
            s.className = 'mono-sg-hl';
            s.style.fontWeight = 'bold';
            lab.appendChild(s);
          } else {
            lab.appendChild(document.createTextNode(run));
          }
          run = '';
        };
        for (let k = 0; k < text.length; k++) {
          const h = hits.has(k);
          if (h !== runHit) {
            flush();
            runHit = h;
          }
          run += text[k];
        }
        flush();
      }

      row.appendChild(icon);
      row.appendChild(lab);

      const right = item.detail || kindLabel(item.kind);
      if (right) {
        const d = document.createElement('span');
        d.textContent = right;
        Object.assign(d.style, {
          flex: '0 1 auto',
          maxWidth: '60%',
          marginLeft: '16px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          textAlign: 'right',
          fontSize: '85%',
        });
        if (this.opts.detailForeground) d.style.color = this.opts.detailForeground;
        row.appendChild(d);
      }

      this.bindRowEvents(row, i);
      list.appendChild(row);
      this.rows.push(row);
      this.paintRow(i);
    });
  }

  private bindRowEvents(row: HTMLDivElement, i: number): void {
    let startX = 0;
    let startY = 0;
    let moved = false;
    let touchStartX = 0;
    let touchStartY = 0;
    let touchMoved = false;

    row.addEventListener('touchstart', (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) { touchStartX = t.clientX; touchStartY = t.clientY; }
      touchMoved = false;
      e.stopPropagation();
    }, { passive: true });
    row.addEventListener('touchmove', (e: TouchEvent) => {
      const t = e.touches[0];
      if (t && Math.hypot(t.clientX - touchStartX, t.clientY - touchStartY) > 6) touchMoved = true;
    }, { passive: true });
    row.addEventListener('touchend', (e: TouchEvent) => {
      if (touchMoved) return;
      e.preventDefault();
      e.stopPropagation();
      this.lastTouchAcceptAt = Date.now();
      this.index = i;
      haptic('light');
      this.acceptSelected();
    }, { passive: false });
    row.addEventListener('pointerdown', (e) => {
      startX = e.clientX; startY = e.clientY; moved = false;
      if (e.pointerType === 'mouse') e.preventDefault();
      e.stopPropagation();
    });
    row.addEventListener('pointermove', (e) => {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 6) moved = true;
    });
    row.addEventListener('pointerup', (e) => {
      if (Date.now() - this.lastTouchAcceptAt < 350 || moved) return;
      e.preventDefault();
      e.stopPropagation();
      this.index = i;
      haptic('light');
      this.acceptSelected();
    });
    row.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
    row.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse') return;
      const prev = this.hoverIndex;
      this.hoverIndex = i;
      this.paintRow(prev);
      this.paintRow(i);
    });
    row.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (this.hoverIndex === i) { this.hoverIndex = -1; this.paintRow(i); }
    });
  }
}
