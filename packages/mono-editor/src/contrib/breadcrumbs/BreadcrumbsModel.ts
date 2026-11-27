import type { MonoBreadcrumbsOptions } from '../../common/config/editorOptions';
import type { IPosition, MonoDisposable } from '../../common/core/types';
import type { DocumentSymbol } from '../../common/languages/providers/types';
import {
  isSymbolKindVisibleInBreadcrumbs,
  resolveBreadcrumbsOptions,
  sortBreadcrumbSymbols,
  type IBreadcrumbItem,
  type IBreadcrumbsModel,
  type IBreadcrumbsPathProvider,
  type IBreadcrumbsSnapshot,
  type ResolvedBreadcrumbsOptions,
} from './breadcrumbsTypes';

export interface BreadcrumbsModelHost {
  getUri(): string;
  getPosition(): IPosition;
  getOutline(): readonly DocumentSymbol[];
  setContext(key: string, value: boolean | string | number): void;
  revealSymbol(item: IBreadcrumbItem): void;
  focusEditor(): void;
}

function defaultUriPathItems(uri: string): IBreadcrumbItem[] {
  const cleaned = uri.replace(/^[a-zA-Z0-9+.-]+:\/\//, '').replace(/^\/+/, '');
  const parts = cleaned.split('/').filter(Boolean);
  if (!parts.length) return [];
  const items: IBreadcrumbItem[] = [];
  let acc = '';
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i]!;
    acc = acc ? `${acc}/${seg}` : seg;
    const isFile = i === parts.length - 1;
    items.push({
      id: `path:${acc}`,
      kind: isFile ? 'file' : 'folder',
      label: seg,
      path: acc,
      uri: isFile ? uri : undefined,
      isDirectory: !isFile,
    });
  }
  return items;
}

function findEnclosingSymbolTrail(
  symbols: readonly DocumentSymbol[],
  pos: IPosition,
  opts: ResolvedBreadcrumbsOptions,
  out: DocumentSymbol[] = [],
): DocumentSymbol[] {
  for (let i = 0; i < symbols.length; i++) {
    const s = symbols[i]!;
    const r = s.range;
    if (pos.lineNumber < r.startLineNumber || pos.lineNumber > r.endLineNumber) continue;
    if (pos.lineNumber === r.startLineNumber && pos.column < r.startColumn) continue;
    if (pos.lineNumber === r.endLineNumber && pos.column > r.endColumn) continue;
    if (isSymbolKindVisibleInBreadcrumbs(s.kind, opts)) {
      out.push(s);
    }
    if (s.children?.length) {
      findEnclosingSymbolTrail(s.children, pos, opts, out);
    }
    return out;
  }
  return out;
}

function filterSymbolTree(
  symbols: readonly DocumentSymbol[],
  opts: ResolvedBreadcrumbsOptions,
): DocumentSymbol[] {
  const out: DocumentSymbol[] = [];
  for (const s of sortBreadcrumbSymbols(symbols, opts.symbolSortOrder)) {
    const children = s.children?.length ? filterSymbolTree(s.children, opts) : [];
    if (isSymbolKindVisibleInBreadcrumbs(s.kind, opts)) {
      out.push(children.length ? { ...s, children } : { ...s, children: undefined });
    } else if (children.length) {
      out.push(...children);
    }
  }
  return out;
}

/**
 * Headless VS Code-compatible Breadcrumbs model.
 * Combines file path segments (via host `IBreadcrumbsPathProvider`) and
 * syntax/LSP symbol trails with full filtering, sorting, focus/picker state,
 * context keys (`breadcrumbsPossible`, `breadcrumbsVisible`, `breadcrumbsActive`),
 * and Copy Breadcrumbs Path formatting.
 */
export class BreadcrumbsModel implements IBreadcrumbsModel {
  private readonly host: BreadcrumbsModelHost;
  private options: ResolvedBreadcrumbsOptions;
  private pathProvider: IBreadcrumbsPathProvider | null = null;
  private rawFileItems: IBreadcrumbItem[] = [];
  private fileItems: IBreadcrumbItem[] = [];
  private symbolItems: IBreadcrumbItem[] = [];
  private items: IBreadcrumbItem[] = [];
  private focusedIndex = -1;
  private pickerOpen = false;
  private pathSeq = 0;
  private listeners = new Set<(snapshot: IBreadcrumbsSnapshot) => void>();

  constructor(host: BreadcrumbsModelHost, initialOptions?: Partial<MonoBreadcrumbsOptions>) {
    this.host = host;
    this.options = resolveBreadcrumbsOptions(initialOptions);
    this.refresh();
  }

  getOptions(): ResolvedBreadcrumbsOptions {
    return { ...this.options };
  }

  updateOptions(patch: Partial<MonoBreadcrumbsOptions>): void {
    this.options = resolveBreadcrumbsOptions({ ...this.options, ...patch });
    this.rebuild(true);
  }

  setPathProvider(provider: IBreadcrumbsPathProvider | null): void {
    this.pathProvider = provider;
    this.refresh();
  }

  getSnapshot(): IBreadcrumbsSnapshot {
    return {
      enabled: this.options.enabled,
      options: { ...this.options },
      items: this.items,
      fileItems: this.fileItems,
      symbolItems: this.symbolItems,
      focusedIndex: this.focusedIndex,
      pickerOpen: this.pickerOpen,
    };
  }

  getItems(): readonly IBreadcrumbItem[] {
    return this.items;
  }

  getFocusedIndex(): number {
    return this.focusedIndex;
  }

  isPickerOpen(): boolean {
    return this.pickerOpen;
  }

  setFocusedIndex(index: number, openPicker = false): void {
    if (!this.options.enabled || this.items.length === 0) {
      this.focusedIndex = -1;
      this.pickerOpen = false;
    } else if (index < 0) {
      this.focusedIndex = -1;
      this.pickerOpen = false;
    } else {
      this.focusedIndex = Math.max(0, Math.min(this.items.length - 1, index));
      this.pickerOpen = openPicker;
    }
    this.syncContextKeys();
    this.emit();
  }

  setPickerOpen(open: boolean): void {
    if (this.pickerOpen === open) return;
    this.pickerOpen = open && this.focusedIndex >= 0;
    this.syncContextKeys();
    this.emit();
  }

  focus(): void {
    if (!this.options.enabled || this.items.length === 0) return;
    this.setFocusedIndex(this.items.length - 1, false);
  }

  focusAndSelect(): void {
    if (!this.options.enabled || this.items.length === 0) return;
    this.setFocusedIndex(this.items.length - 1, true);
  }

  focusNext(openPicker = false): void {
    if (!this.options.enabled || this.items.length === 0) return;
    const next = this.focusedIndex < 0 ? 0 : Math.min(this.items.length - 1, this.focusedIndex + 1);
    this.setFocusedIndex(next, openPicker);
  }

  focusPrevious(openPicker = false): void {
    if (!this.options.enabled || this.items.length === 0) return;
    const prev = this.focusedIndex < 0 ? this.items.length - 1 : Math.max(0, this.focusedIndex - 1);
    this.setFocusedIndex(prev, openPicker);
  }

  selectFocused(): void {
    if (this.focusedIndex < 0 || this.focusedIndex >= this.items.length) return;
    this.pickerOpen = true;
    this.syncContextKeys();
    this.emit();
  }

  revealFocused(): void {
    if (this.focusedIndex < 0 || this.focusedIndex >= this.items.length) return;
    const item = this.items[this.focusedIndex]!;
    if (item.kind === 'symbol') {
      this.host.revealSymbol(item);
    } else if (this.pathProvider?.openItem) {
      void this.pathProvider.openItem(item);
    }
    this.pickerOpen = false;
    this.focusedIndex = -1;
    this.syncContextKeys();
    this.emit();
    this.host.focusEditor();
  }

  selectEditor(): void {
    this.focusedIndex = -1;
    this.pickerOpen = false;
    this.syncContextKeys();
    this.emit();
    this.host.focusEditor();
  }

  toggle(): void {
    this.options = { ...this.options, enabled: !this.options.enabled };
    if (!this.options.enabled) {
      this.focusedIndex = -1;
      this.pickerOpen = false;
    }
    this.rebuild(true);
  }

  async getSiblings(item: IBreadcrumbItem): Promise<readonly IBreadcrumbItem[]> {
    if (item.kind === 'file' || item.kind === 'folder') {
      if (this.pathProvider) {
        try {
          const res = await Promise.resolve(this.pathProvider.getSiblings(item));
          return res ?? [];
        } catch {
          return [];
        }
      }
      return [item];
    }

    // For symbol items: find parent symbol's children (or root outline)
    const outline = this.host.getOutline();
    const trail = findEnclosingSymbolTrail(outline, this.host.getPosition(), this.options);
    const idx = trail.findIndex(
      (s) => s.name === item.label && s.range.startLineNumber === item.range?.startLineNumber,
    );
    const siblingsRaw = idx > 0 ? (trail[idx - 1]?.children ?? []) : outline;
    const filtered = siblingsRaw.filter((s) => isSymbolKindVisibleInBreadcrumbs(s.kind, this.options));
    return sortBreadcrumbSymbols(filtered, this.options.symbolSortOrder).map((s, i) => ({
      id: `sym:${s.name}:${s.range.startLineNumber}:${i}`,
      kind: 'symbol',
      label: s.name,
      detail: s.detail,
      symbolKind: s.kind,
      range: s.range,
      selectionRange: s.selectionRange,
      symbol: s,
      children: s.children,
    }));
  }

  getOutlineForPicker(): readonly DocumentSymbol[] {
    return filterSymbolTree(this.host.getOutline(), this.options);
  }

  getCopyPath(): string {
    const filePart = this.rawFileItems.map((i) => i.label).join('/');
    const symPart = this.symbolItems.map((i) => i.label).join(this.options.symbolPathSeparator);
    if (filePart && symPart) return `${filePart}${this.options.symbolPathSeparator}${symPart}`;
    return symPart || filePart || this.host.getUri();
  }

  refresh(): void {
    const uri = this.host.getUri();
    if (this.pathProvider) {
      const seq = ++this.pathSeq;
      const result = this.pathProvider.getPath(uri);
      if (result && typeof (result as Promise<readonly IBreadcrumbItem[]>).then === 'function') {
        this.rebuild(false);
        void (result as Promise<readonly IBreadcrumbItem[]>).then((items) => {
          if (seq !== this.pathSeq) return;
          this.rawFileItems = [...(items ?? [])];
          this.rebuild(true);
        });
        return;
      }
      this.rawFileItems = [...((result as readonly IBreadcrumbItem[]) ?? [])];
    } else {
      this.rawFileItems = defaultUriPathItems(uri);
    }
    this.rebuild(true);
  }

  refreshSymbols(): void {
    this.rebuild(true);
  }

  onDidChange(listener: (snapshot: IBreadcrumbsSnapshot) => void): MonoDisposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  dispose(): void {
    this.listeners.clear();
  }

  private rebuild(emitNow: boolean): void {
    const opts = this.options;

    if (opts.filePath === 'off') {
      this.fileItems = [];
    } else if (opts.filePath === 'last') {
      this.fileItems = this.rawFileItems.length ? [this.rawFileItems[this.rawFileItems.length - 1]!] : [];
    } else {
      this.fileItems = [...this.rawFileItems];
    }

    if (opts.symbolPath === 'off') {
      this.symbolItems = [];
    } else {
      const trail = findEnclosingSymbolTrail(this.host.getOutline(), this.host.getPosition(), opts);
      const mapped: IBreadcrumbItem[] = trail.map((s, idx) => ({
        id: `sym:${s.name}:${s.range.startLineNumber}:${idx}`,
        kind: 'symbol',
        label: s.name,
        detail: s.detail,
        symbolKind: s.kind,
        range: s.range,
        selectionRange: s.selectionRange,
        symbol: s,
        children: s.children,
      }));
      this.symbolItems = opts.symbolPath === 'last' && mapped.length ? [mapped[mapped.length - 1]!] : mapped;
    }

    this.items = [...this.fileItems, ...this.symbolItems];
    if (this.focusedIndex >= this.items.length) {
      this.focusedIndex = this.items.length - 1;
    }
    if (this.items.length === 0) {
      this.focusedIndex = -1;
      this.pickerOpen = false;
    }
    this.syncContextKeys();
    if (emitNow) this.emit();
  }

  private syncContextKeys(): void {
    const possible = this.items.length > 0;
    const visible = this.options.enabled && possible;
    const active = visible && this.focusedIndex >= 0;
    this.host.setContext('breadcrumbsPossible', possible);
    this.host.setContext('breadcrumbsVisible', visible);
    this.host.setContext('breadcrumbsActive', active);
  }

  private emit(): void {
    if (!this.listeners.size) return;
    const snap = this.getSnapshot();
    for (const l of this.listeners) {
      try { l(snap); } catch { /* ignore */ }
    }
  }
}
