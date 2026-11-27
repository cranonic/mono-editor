import type { MonoContextMenuOptions } from '../../common/config/editorOptions';
import type { SelectionState } from '../../common/core/SelectionState';
import type { TextModel } from '../../common/model/TextModel';
import { readClipboardText, writeClipboardText } from '../../platform/clipboard/clipboard';
import {
  BUILTIN_CLIPBOARD_COMMANDS,
  type ResolvedMenuEntry,
  type ResolvedMenuGroup,
} from '../../platform/menus';
import {
  applyMenuRootStyle,
  createMenuToolbarButton,
  MORE_ICON_SVG,
  renderVerticalMenuList,
} from './menuDom';
import {
  animateMenuPanel,
  computeMenuPlacement,
  type RectBox,
} from './menuPlacement';
import {
  DEFAULT_MENU_STYLE,
  MENU_ICONS,
  type MonoMenuContext,
  type MonoMenuItem,
  type MonoMenuShowOptions,
  type MonoMenuStyle,
} from './types';

export interface ContextMenuRegistryBridge {
  getInlineEntries(): ResolvedMenuEntry[];
  getOverflowGroups(): ResolvedMenuGroup[];
  getAllVerticalGroups(): ResolvedMenuGroup[];
  getShortcutLabel(commandId: string): string | undefined;
  executeCommand(commandId: string, args?: unknown[]): Promise<unknown>;
}

export interface ContextMenuAnchorGeometry {
  anchorRects: readonly RectBox[];
  getSafeArea: () => RectBox;
  gap?: number;
}

function defaultLegacyItems(): MonoMenuItem[] {
  return [
    {
      id: 'copy',
      icon: MENU_ICONS.copy,
      label: 'Copy',
      order: 10,
      visible: (ctx) => ctx.hasSelection(),
      enabled: (ctx) => ctx.hasSelection(),
      action: (ctx) => ctx.copy(),
    },
    {
      id: 'cut',
      icon: MENU_ICONS.cut,
      label: 'Cut',
      order: 20,
      visible: (ctx) => ctx.hasSelection(),
      enabled: (ctx) => ctx.hasSelection(),
      action: (ctx) => ctx.cut(),
    },
    {
      id: 'paste',
      icon: MENU_ICONS.paste,
      label: 'Paste',
      order: 30,
      action: (ctx) => ctx.paste(),
    },
    {
      id: 'selectAll',
      icon: MENU_ICONS.selectAll,
      label: 'Select all',
      order: 40,
      action: (ctx) => ctx.selectAll(),
    },
  ];
}


/**
 * Dual-mode Monaco-style context menu & touch icon toolbar:
 *  - Horizontal bar (default) with inline clipboard actions + automatic "More (⋮)" overflow button
 *  - "More" swaps in-place to a vertical overflow page with thin Back header & WAAPI left-to-right cascade
 *  - Vertical-only mode with grouped entries, separators, right-aligned shortcuts, opt-in icons
 *  - `enabled: false` immediately hides and blocks all triggers
 *  - Full back-compat for `setItems/addItem/removeItem/setStyle/hide/show`
 */
export class ContextMenuController {
  private host: HTMLElement;
  private model: TextModel;
  private selection: SelectionState;
  private onEdit: () => void;
  private focusEditor: () => void;
  private registryBridge?: ContextMenuRegistryBridge;
  private legacyItems: MonoMenuItem[] = defaultLegacyItems();
  private customLegacyOverride = false;
  private style: typeof DEFAULT_MENU_STYLE = { ...DEFAULT_MENU_STYLE };
  private options: MonoContextMenuOptions = {
    enabled: true,
    type: 'horizontal',
    animation: 'cascade',
    horizontal: { showIcons: true, more: { showIcons: false, showShortcuts: false } },
    vertical: { showIcons: false, showShortcuts: true },
  };
  private el: HTMLDivElement | null = null;
  private open = false;
  private activePage: 'horizontal' | 'moreVertical' | 'vertical' = 'horizontal';
  private lastAnchorGeom: ContextMenuAnchorGeometry | null = null;
  private lastLegacyOpts: MonoMenuShowOptions | undefined;
  private lastLocalX = 0;
  private lastLocalY = 0;
  private vvListener: (() => void) | null = null;

  constructor(
    host: HTMLElement,
    model: TextModel,
    selection: SelectionState,
    onEdit: () => void,
    focusEditor: () => void,
    registryBridge?: ContextMenuRegistryBridge,
  ) {
    this.host = host;
    this.model = model;
    this.selection = selection;
    this.onEdit = onEdit;
    this.focusEditor = focusEditor;
    this.registryBridge = registryBridge;
  }

  setModel(model: TextModel): void {
    this.model = model;
    this.hide();
  }

  setEnabled(enabled: boolean): void {
    this.options = { ...this.options, enabled };
    if (!enabled) this.hide();
  }

  isEnabled(): boolean {
    return this.options.enabled !== false;
  }

  setMenuOptions(patch: Partial<MonoContextMenuOptions>): void {
    this.options = {
      ...this.options,
      ...patch,
      horizontal: {
        ...this.options.horizontal,
        ...patch.horizontal,
        more: { ...this.options.horizontal?.more, ...patch.horizontal?.more },
      },
      vertical: { ...this.options.vertical, ...patch.vertical },
    };
    if (this.options.enabled === false) {
      this.hide();
    } else if (this.open) {
      this.activePage = this.options.type === 'vertical' ? 'vertical' : 'horizontal';
      this.renderCurrentPage(false);
    }
  }

  setItems(items: MonoMenuItem[]): void {
    this.customLegacyOverride = true;
    this.legacyItems = items.map((i) => ({ ...i }));
    if (this.open) this.renderCurrentPage(false);
  }

  getItems(): MonoMenuItem[] {
    return this.legacyItems.map((i) => ({ ...i }));
  }

  addItem(item: MonoMenuItem): void {
    this.customLegacyOverride = true;
    const idx = this.legacyItems.findIndex((x) => x.id === item.id);
    if (idx >= 0) this.legacyItems[idx] = { ...item };
    else this.legacyItems.push({ ...item });
    if (this.open) this.renderCurrentPage(false);
  }

  removeItem(id: string): void {
    this.customLegacyOverride = true;
    this.legacyItems = this.legacyItems.filter((x) => x.id !== id);
    if (this.open) this.renderCurrentPage(false);
  }

  setStyle(style: MonoMenuStyle): void {
    this.style = { ...this.style, ...style };
    if (this.open) this.renderCurrentPage(false);
  }

  isOpen(): boolean { return this.open; }
  getType(): 'horizontal' | 'vertical' { return this.options.type === 'vertical' ? 'vertical' : 'horizontal'; }
  getActivePage(): 'horizontal' | 'moreVertical' | 'vertical' { return this.activePage; }

  hide(): void {
    this.detachVisualViewport();
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
    this.open = false;
  }

  showAnchored(geom: ContextMenuAnchorGeometry, forcedType?: 'horizontal' | 'vertical'): void {
    if (!this.isEnabled()) return;
    this.hide();
    this.lastAnchorGeom = geom;
    this.lastLegacyOpts = undefined;
    const effectiveType = forcedType ?? this.options.type ?? 'horizontal';
    this.activePage = effectiveType === 'vertical' ? 'vertical' : 'horizontal';
    this.open = true;
    this.mountRoot();
    this.renderCurrentPage(true);
    this.attachVisualViewport();
  }

  showAt(localX: number, localY: number, opts?: MonoMenuShowOptions): void {
    if (!this.isEnabled()) return;
    this.hide();
    this.lastAnchorGeom = null;
    this.lastLegacyOpts = opts;
    this.lastLocalX = localX;
    this.lastLocalY = localY;
    this.activePage = this.options.type === 'vertical' ? 'vertical' : 'horizontal';
    this.open = true;
    this.mountRoot();
    this.renderCurrentPage(true);
    this.attachVisualViewport();
  }

  async copy(): Promise<void> {
    const text = this.getSelectionText();
    if (!text) return;
    await writeClipboardText(text);
  }

  async cut(): Promise<void> {
    await this.copy();
    if (this.selection.isEmpty) return;
    const a = this.selection.anchor;
    const b = this.selection.active;
    const start = Math.min(
      this.model.getOffsetAt(a.lineNumber, a.column),
      this.model.getOffsetAt(b.lineNumber, b.column),
    );
    const end = Math.max(
      this.model.getOffsetAt(a.lineNumber, a.column),
      this.model.getOffsetAt(b.lineNumber, b.column),
    );
    this.model.delete(start, end);
    const pos = this.model.getPositionAt(start);
    this.selection.setCaret(pos.lineNumber, pos.column);
    this.onEdit();
  }

  async paste(): Promise<void> {
    const text = await readClipboardText();
    if (!text) return;
    if (!this.selection.isEmpty) {
      const a = this.selection.anchor;
      const b = this.selection.active;
      const start = Math.min(
        this.model.getOffsetAt(a.lineNumber, a.column),
        this.model.getOffsetAt(b.lineNumber, b.column),
      );
      const end = Math.max(
        this.model.getOffsetAt(a.lineNumber, a.column),
        this.model.getOffsetAt(b.lineNumber, b.column),
      );
      this.model.replaceRange(start, end, text);
      const pos = this.model.getPositionAt(start + this.model.normalizeEol(text).length);
      this.selection.setCaret(pos.lineNumber, pos.column);
    } else {
      const off = this.model.getOffsetAt(this.selection.active.lineNumber, this.selection.active.column);
      this.model.insert(off, text);
      const pos = this.model.getPositionAt(off + this.model.normalizeEol(text).length);
      this.selection.setCaret(pos.lineNumber, pos.column);
    }
    this.onEdit();
  }

  selectAll(): void {
    const last = this.model.getLineCount();
    const lastCol = this.model.getLineContent(last).length + 1;
    this.selection.anchor = { lineNumber: 1, column: 1 };
    this.selection.active = { lineNumber: last, column: lastCol };
    this.onEdit();
  }

  dispose(): void {
    this.hide();
  }

  private mountRoot(): void {
    const el = document.createElement('div');
    el.className = `mono-ctx-menu ${this.style.className || ''}`.trim();
    el.setAttribute('role', 'menu');
    el.addEventListener('pointerdown', (e) => {
      // Only preventDefault on horizontal bar or mouse; allow touch vertical scroll inside vertical menus
      if (this.activePage === 'horizontal' || e.pointerType === 'mouse') {
        e.preventDefault();
      }
      e.stopPropagation();
    });
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    this.host.appendChild(el);
    this.el = el;
  }

  private renderCurrentPage(animate: boolean): void {
    if (!this.el) return;
    this.el.replaceChildren();
    this.el.style.maxHeight = '';
    this.el.style.overflowY = 'hidden';

    let animatedRows: HTMLElement[] = [];
    let headerEl: HTMLElement | null = null;

    if (this.activePage === 'horizontal') {
      applyMenuRootStyle(this.el, this.style, false);
      this.renderHorizontalBar();
    } else {
      applyMenuRootStyle(this.el, this.style, true);
      const isMorePage = this.activePage === 'moreVertical';
      const groups = isMorePage
        ? (this.registryBridge?.getOverflowGroups() ?? [])
        : (this.registryBridge?.getAllVerticalGroups() ?? []);
      const showIcons = isMorePage
        ? Boolean(this.options.horizontal?.more?.showIcons)
        : Boolean(this.options.vertical?.showIcons);
      const showShortcuts = isMorePage
        ? Boolean(this.options.horizontal?.more?.showShortcuts)
        : this.options.vertical?.showShortcuts !== false;
      const res = renderVerticalMenuList({
        container: this.el,
        groups,
        withBackHeader: isMorePage,
        showIcons,
        showShortcuts,
        style: this.style,
        getShortcutLabel: (cmd) => this.registryBridge?.getShortcutLabel(cmd),
        onBack: () => {
          this.activePage = 'horizontal';
          this.renderCurrentPage(true);
        },
        onInvoke: async (cmd, args) => {
          this.hide();
          try {
            await this.registryBridge?.executeCommand(cmd, args);
          } finally {
            this.focusEditor();
          }
        },
      });
      animatedRows = res.rows;
      headerEl = res.header;
    }

    if (!this.el.childElementCount) {
      this.hide();
      return;
    }

    this.placePanel();

    if (animate && this.el) {
      const cfgAnim = this.options.animation;
      const animMode: 'cascade' | 'smooth' | 'none' =
        this.activePage === 'moreVertical'
          ? (cfgAnim ?? 'cascade')
          : this.activePage === 'vertical'
            ? (cfgAnim === 'none' ? 'none' : 'smooth')
            : (cfgAnim === 'none' ? 'none' : 'smooth');
      animateMenuPanel(this.el, animatedRows, animMode, headerEl);
    }
  }

  private renderHorizontalBar(): void {
    if (!this.el) return;
    const size = this.style.iconSize;
    const showIcons = this.options.horizontal?.showIcons !== false;

    if (this.customLegacyOverride || !this.registryBridge) {
      const ctx = this.legacyCtx();
      const sorted = [...this.legacyItems].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
      for (const item of sorted) {
        const visible = typeof item.visible === 'function' ? item.visible(ctx) : item.visible !== false;
        if (!visible) continue;
        const enabled = typeof item.enabled === 'function' ? item.enabled(ctx) : item.enabled !== false;
        const btn = createMenuToolbarButton({
          label: item.label || String(item.id),
          iconSvg: showIcons ? item.icon : undefined,
          size,
          enabled,
          id: String(item.id),
          style: this.style,
        });
        btn.addEventListener('click', async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (!enabled) return;
          try {
            if (item.action) await item.action(ctx);
            else if (item.id === 'copy') await ctx.copy();
            else if (item.id === 'cut') await ctx.cut();
            else if (item.id === 'paste') await ctx.paste();
            else if (item.id === 'selectAll') ctx.selectAll();
          } finally {
            if (item.id === 'cut' || item.id === 'paste') this.hide();
            else this.renderCurrentPage(false);
            this.focusEditor();
          }
        });
        this.el.appendChild(btn);
      }
    } else {
      const inlineEntries = this.registryBridge.getInlineEntries();
      for (const { entry, enabled } of inlineEntries) {
        const btn = createMenuToolbarButton({
          label: entry.title,
          iconSvg: showIcons ? entry.icon : undefined,
          size,
          enabled,
          id: entry.id,
          style: this.style,
        });
        btn.addEventListener('click', async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (!enabled) return;
          try {
            await this.registryBridge!.executeCommand(entry.command, entry.args);
          } finally {
            if (entry.command === BUILTIN_CLIPBOARD_COMMANDS.Cut || entry.command === BUILTIN_CLIPBOARD_COMMANDS.Paste) {
              this.hide();
            } else {
              this.renderCurrentPage(false);
            }
            this.focusEditor();
          }
        });
        this.el.appendChild(btn);
      }
    }

    // Append "More (⋮)" button whenever overflow contextual entries exist
    const overflow = this.registryBridge?.getOverflowGroups() ?? [];
    if (overflow.length > 0) {
      const moreBtn = createMenuToolbarButton({
        label: 'More actions',
        iconSvg: MORE_ICON_SVG,
        size,
        enabled: true,
        id: 'mono.ctx.more',
        style: this.style,
      });
      moreBtn.dataset.monoMore = 'true';
      moreBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.activePage = 'moreVertical';
        this.renderCurrentPage(true);
      });
      this.el.appendChild(moreBtn);
    }
  }


  private placePanel(): void {
    if (!this.el) return;
    const rect = this.host.getBoundingClientRect();
    const menuRect = this.el.getBoundingClientRect();
    const w = menuRect.width || this.el.offsetWidth || 180;
    const h = menuRect.height || this.el.offsetHeight || 40;
    const isVertical = this.activePage !== 'horizontal';
    const effectiveMaxH = this.options.maxHeight ?? (isVertical ? 220 : undefined);
    const headerH = this.activePage === 'moreVertical' ? 30 : 0;

    if (this.lastAnchorGeom) {
      const safe = this.lastAnchorGeom.getSafeArea();
      const res = computeMenuPlacement(
        this.lastAnchorGeom.anchorRects,
        { width: w, height: h },
        safe,
        this.lastAnchorGeom.gap ?? 8,
        effectiveMaxH,
      );
      this.el.style.left = `${res.left}px`;
      this.el.style.top = `${res.top}px`;
      const cap = res.maxHeight ?? effectiveMaxH;
      if (cap != null) {
        this.el.style.maxHeight = `${cap}px`;
        const listEl = this.el.querySelector?.<HTMLElement>('.mono-ctx-vertical-list') ?? null;
        if (listEl) listEl.style.maxHeight = `${Math.max(40, cap - headerH - 2)}px`;
        else this.el.style.overflowY = 'auto';
      }
      return;
    }

    if (this.lastLegacyOpts?.placement) {
      const p = this.lastLegacyOpts.placement(
        { width: w, height: h },
        { width: rect.width, height: rect.height },
      );
      this.el.style.left = `${p.left}px`;
      this.el.style.top = `${p.top}px`;
      return;
    }

    const gap = this.lastLegacyOpts?.gap ?? 8;
    const anchor: RectBox = {
      left: this.lastLocalX - 4,
      right: this.lastLocalX + 4,
      top: this.lastLocalY,
      bottom: this.lastLegacyOpts?.avoidBelowY ?? this.lastLocalY + 24,
    };
    const res = computeMenuPlacement(
      [anchor],
      { width: w, height: h },
      { left: 8, top: 8, right: Math.max(80, rect.width - 8), bottom: Math.max(80, rect.height - 8) },
      gap,
      effectiveMaxH,
    );
    this.el.style.left = `${res.left}px`;
    this.el.style.top = `${res.top}px`;
    const cap = res.maxHeight ?? effectiveMaxH;
    if (cap != null) {
      this.el.style.maxHeight = `${cap}px`;
      const listEl = this.el.querySelector?.<HTMLElement>('.mono-ctx-vertical-list') ?? null;
      if (listEl) listEl.style.maxHeight = `${Math.max(40, cap - headerH - 2)}px`;
      else this.el.style.overflowY = 'auto';
    }
  }

  private attachVisualViewport(): void {
    this.detachVisualViewport();
    if (typeof window === 'undefined' || !window.visualViewport) return;
    this.vvListener = () => {
      if (this.open && this.el) this.placePanel();
    };
    window.visualViewport.addEventListener('resize', this.vvListener);
    window.visualViewport.addEventListener('scroll', this.vvListener);
  }

  private detachVisualViewport(): void {
    if (!this.vvListener || typeof window === 'undefined' || !window.visualViewport) return;
    window.visualViewport.removeEventListener('resize', this.vvListener);
    window.visualViewport.removeEventListener('scroll', this.vvListener);
    this.vvListener = null;
  }


  private legacyCtx(): MonoMenuContext {
    return {
      getValue: () => this.model.getValue(),
      getSelectionText: () => this.getSelectionText(),
      hasSelection: () => !this.selection.isEmpty,
      copy: () => this.copy(),
      cut: () => this.cut(),
      paste: () => this.paste(),
      selectAll: () => this.selectAll(),
      focus: () => this.focusEditor(),
    };
  }

  private getSelectionText(): string {
    if (this.selection.isEmpty) return '';
    const a = this.selection.anchor;
    const b = this.selection.active;
    const start = Math.min(
      this.model.getOffsetAt(a.lineNumber, a.column),
      this.model.getOffsetAt(b.lineNumber, b.column),
    );
    const end = Math.max(
      this.model.getOffsetAt(a.lineNumber, a.column),
      this.model.getOffsetAt(b.lineNumber, b.column),
    );
    return this.model.getValue().slice(start, end);
  }
}
