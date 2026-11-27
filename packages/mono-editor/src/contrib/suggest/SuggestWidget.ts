import type { WidgetBoxRect } from '../../browser/editor/editorTypes';
import type { CompletionItem } from '../../common/languages/providers/types';
import { haptic } from '../../platform/haptic/haptic';
import { ensureCodicons } from '../../platform/icons';
import { SuggestDetailsPane, type CaretLineBand } from './widget/suggestDetailsPane';
import { buildSuggestRow, hasItemDocumentation, paintSuggestRow } from './widget/suggestRowDom';
import {
  BORDER,
  ensureSuggestStyle,
  resolveSuggestPalette,
  type SuggestAnchor,
  type SuggestDocsMode,
  type SuggestPalette,
  type SuggestWidgetOptions,
} from './widget/suggestStyle';

export type { SuggestAnchor, SuggestDocsMode, SuggestWidgetOptions };

/**
 * VS Code-style suggest widget: content-sized floating list next to the caret.
 */
export class SuggestWidget {
  private host: HTMLElement;
  private el: HTMLDivElement | null = null;
  private listEl: HTMLDivElement | null = null;
  private statusBarEl: HTMLDivElement | null = null;
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
  private onBoundsChange?: (rect: WidgetBoxRect | null) => void;
  private lastTouchAcceptAt = 0;
  /** Session-scoped docs visibility toggle (reset on hide). */
  private docsExpanded = false;
  private docsToggledManually = false;

  constructor(
    host: HTMLElement,
    handlers: {
      onAccept: (item: CompletionItem) => void;
      onDismiss: () => void;
      onSelectionChange?: (item: CompletionItem | null) => void;
      onBoundsChange?: (rect: WidgetBoxRect | null) => void;
    },
    options?: SuggestWidgetOptions,
  ) {
    this.host = host;
    this.details = new SuggestDetailsPane(host);
    this.onAccept = handlers.onAccept;
    this.onSelectionChange = handlers.onSelectionChange;
    this.onBoundsChange = handlers.onBoundsChange;
    this.opts = {
      maxHeight: 220,
      maxWidth: 440,
      minWidth: 240,
      fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      docsMode: 'off',
      showIcons: true,
      showStatusBar: false,
      className: '',
      themeType: 'dark',
      ...options,
    };
    this.pal = resolveSuggestPalette(this.opts);
  }

  setOptions(options: SuggestWidgetOptions): void {
    const prevDocsMode = this.opts.docsMode;
    this.opts = { ...this.opts, ...options };
    this.pal = resolveSuggestPalette(this.opts);
    if (options.docsMode !== undefined && options.docsMode !== prevDocsMode && !this.docsToggledManually) {
      this.docsExpanded = options.docsMode !== 'off';
    }
    if (this.el) {
      this.applyChrome();
      this.renderList();
      this.updateStatusBar();
      this.position();
      this.showDocumentation(this.getSelectedItem());
    }
  }

  isVisible(): boolean { return !!this.el; }
  isSuspended(): boolean { return this.suspended; }
  isDocsOpen(): boolean { return this.details.isVisible(); }

  toggleDocs(): boolean {
    if (!this.el) return false;
    this.docsToggledManually = true;
    this.docsExpanded = !this.docsExpanded;
    this.paintRow(this.index);
    this.showDocumentation(this.getSelectedItem());
    return this.docsExpanded;
  }

  show(items: CompletionItem[], anchor: SuggestAnchor, filter?: string, initialIndex?: number): void {
    const wasVisible = !!this.el;
    this.items = items;
    this.filter = filter || '';
    if (initialIndex !== undefined && initialIndex >= 0 && initialIndex < items.length) {
      this.index = initialIndex;
    } else {
      this.index = Math.max(0, items.findIndex((i) => i.preselect));
    }
    this.hoverIndex = -1;
    this.suspended = false;
    this.anchor = anchor;
    if (!wasVisible) {
      this.docsToggledManually = false;
      this.docsExpanded = (this.opts.docsMode ?? 'off') !== 'off';
    }
    ensureSuggestStyle();
    if (!this.el) this.build();
    this.el!.style.display = 'flex';
    this.renderList();
    this.updateStatusBar();
    this.position();
    this.scrollToSelected();
    this.notifySelectionChange();
  }

  hide(): void {
    const wasVisible = !!this.el;
    if (this.el) {
      this.el.remove();
      this.el = null;
      this.listEl = null;
      this.statusBarEl = null;
    }
    this.details.hide();
    this.rows = [];
    this.items = [];
    this.suspended = false;
    this.docsExpanded = false;
    this.docsToggledManually = false;
    if (wasVisible) this.onBoundsChange?.(null);
  }

  setSuspended(suspended: boolean): void {
    if (!this.el || this.suspended === suspended) return;
    this.suspended = suspended;
    this.el.style.display = suspended ? 'none' : 'flex';
    this.details.setSuspended(suspended);
    if (!suspended) this.position();
    else this.onBoundsChange?.(null);
  }

  getSelectedItem(): CompletionItem | null {
    return this.items[this.index] ?? null;
  }

  showDocumentation(item: CompletionItem | null): void {
    if (!this.docsExpanded) {
      this.details.hide();
      return;
    }
    const configured = this.opts.docsMode ?? 'off';
    const placementMode: Exclude<SuggestDocsMode, 'off'> = configured === 'off' ? 'auto' : configured;
    this.details.show(item, this.el, this.suspended, this.opts, this.pal, this.caretLineBand(), placementMode);
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

  private caretLineBand(): CaretLineBand {
    const lineTop = this.anchor.top ?? Math.max(0, this.anchor.y - this.rowHeight());
    return { top: lineTop, bottom: this.anchor.y };
  }

  private notifySelectionChange(): void {
    const item = this.items[this.index] ?? null;
    this.showDocumentation(item);
    this.onSelectionChange?.(item);
  }

  private iconSize(): number {
    return Math.max(12, Math.round((this.opts.fontSize ?? 14) * 1.1));
  }

  private labelOffset(): number {
    if (this.opts.showIcons === false) return 4;
    return 4 + 2 + this.iconSize() + 4;
  }

  private rowHeight(): number {
    return this.opts.rowHeight ?? Math.max(20, Math.round((this.opts.fontSize ?? 14) * 1.55));
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

    const statusBar = document.createElement('div');
    statusBar.className = 'mono-suggest-status-bar';
    Object.assign(statusBar.style, {
      display: 'none',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '10px',
      padding: '2px 6px',
      fontSize: '11px',
      lineHeight: '18px',
      userSelect: 'none',
      whiteSpace: 'nowrap',
      flexShrink: '0',
    } as CSSStyleDeclaration);
    this.statusBarEl = statusBar;
    el.appendChild(statusBar);

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
    el.style.boxShadow = `0 2px 8px ${p.shadow}`;
    if (this.statusBarEl) {
      this.statusBarEl.style.borderTop = p.border;
      this.statusBarEl.style.color = p.detailForeground;
      this.statusBarEl.style.background = p.background;
    }
  }

  private updateStatusBar(): void {
    const bar = this.statusBarEl;
    if (!bar) return;
    if (!this.opts.showStatusBar || this.items.length === 0) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';
    const item = this.items[this.index];
    const hint = hasItemDocumentation(item)
      ? 'Enter/Tab accept · Ctrl+Space docs'
      : 'Enter/Tab accept';
    bar.textContent = '';
    const leftSpan = document.createElement('span');
    leftSpan.textContent = hint;
    const rightSpan = document.createElement('span');
    rightSpan.textContent = `${this.index + 1} / ${this.items.length}`;
    rightSpan.style.opacity = '0.85';
    bar.appendChild(leftSpan);
    bar.appendChild(rightSpan);
  }

  private position(): void {
    if (!this.el || !this.listEl) return;
    const hostW = this.host.clientWidth;
    const hostH = this.host.clientHeight;
    const { x, y } = this.anchor;
    const lineTop = this.anchor.top ?? y - this.rowHeight();
    const rowH = this.rowHeight();
    const gap = 2;
    const statusH = this.opts.showStatusBar && this.items.length > 0 ? 22 : 0;

    this.el.style.maxWidth = `${Math.max(120, Math.min(this.opts.maxWidth!, hostW - 8))}px`;

    const wanted = Math.min(this.opts.maxHeight!, this.items.length * rowH) + statusH;
    const below = hostH - y - gap - 4;
    const above = lineTop - gap - 4;
    const placeBelow = below >= wanted + 2 * BORDER || below >= above;
    const avail = Math.max(rowH * 3 + statusH, placeBelow ? below : above);
    this.listEl.style.maxHeight = `${Math.max(rowH, Math.min(this.opts.maxHeight!, avail - 2 * BORDER - statusH))}px`;

    const h = this.el.offsetHeight;
    const w = this.el.offsetWidth;
    const top = placeBelow ? y + gap : Math.max(4, lineTop - gap - h);
    let left = x - this.labelOffset() - BORDER;
    left = Math.min(left, hostW - w - 4);
    left = Math.max(4, left);

    const roundedLeft = Math.round(left);
    const roundedTop = Math.round(top);
    this.el.style.left = `${roundedLeft}px`;
    this.el.style.top = `${roundedTop}px`;
    this.onBoundsChange?.({ left: roundedLeft, top: roundedTop, width: w, height: h });

    if (this.docsExpanded) {
      const configured = this.opts.docsMode ?? 'off';
      const placementMode: Exclude<SuggestDocsMode, 'off'> = configured === 'off' ? 'auto' : configured;
      this.details.position(this.el, this.suspended, this.caretLineBand(), placementMode);
    }
  }

  private setIndex(i: number): void {
    if (i === this.index) return;
    const prev = this.index;
    this.index = i;
    this.paintRow(prev);
    this.paintRow(i);
    this.updateStatusBar();
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
    paintSuggestRow(this.rows[i], i === this.index, i === this.hoverIndex, this.docsExpanded, this.pal);
  }

  private renderList(): void {
    const list = this.listEl;
    if (!list) return;
    ensureCodicons();
    list.textContent = '';
    this.rows = [];
    const rowH = this.rowHeight();
    const iconPx = this.iconSize();

    this.items.forEach((item, i) => {
      const row = buildSuggestRow({
        item,
        index: i,
        rowHeight: rowH,
        iconPx,
        filter: this.filter,
        opts: this.opts,
        pal: this.pal,
        onToggleDocs: () => this.toggleDocs(),
        onTouchAccept: (idx) => {
          this.lastTouchAcceptAt = Date.now();
          this.index = idx;
          this.acceptSelected();
        },
        onPointerAccept: (idx) => {
          const now = Date.now();
          if (now - this.lastTouchAcceptAt < 350) return;
          this.lastTouchAcceptAt = now;
          this.index = idx;
          haptic('light');
          this.acceptSelected();
        },
        onHoverEnter: (idx) => {
          const prev = this.hoverIndex;
          this.hoverIndex = idx;
          this.paintRow(prev);
          this.paintRow(idx);
        },
        onHoverLeave: (idx) => {
          if (this.hoverIndex === idx) {
            this.hoverIndex = -1;
            this.paintRow(idx);
          }
        },
      });
      list.appendChild(row);
      this.rows.push(row);
      this.paintRow(i);
    });
  }
}
