import {
  ContributionIds,
  type IContextMenuContribution,
  type IEditorContributionHost,
} from '../../browser/editor/editorTypes';
import type { InputChangeEvent } from '../../browser/input/InputController';
import type { PointerInteractKind } from '../../browser/input/pointer/PointerController';
import { TEARDROP, type ColorHit } from '../../browser/render/CanvasRenderer';
import type { MonoEditorOptions } from '../../common/config/editorOptions';
import type { MonoMenuItem, MonoMenuStyle } from '../../common/config/menuTypes';
import { languageFeatures } from '../../common/languages/languageFeaturesService';
import type { TextModel } from '../../common/model/TextModel';
import {
  BUILTIN_CLIPBOARD_COMMANDS,
  createMenuEvalContext,
  MenuId,
  menus,
  registerDefaultEditorMenuEntries,
} from '../../platform/menus';
import type { ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';
import { ContextMenuController } from './ContextMenuController';
import { computeMenuSafeArea, type RectBox } from './menuPlacement';

export class ContextMenuContribution implements IContextMenuContribution {
  readonly id = ContributionIds.ContextMenu;
  private readonly host: IEditorContributionHost;
  private readonly menu: ContextMenuController;
  private menuRestore = false;
  private lastSelectMenuAt = 0;

  constructor(host: IEditorContributionHost) {
    this.host = host;
    registerDefaultEditorMenuEntries();

    const evalCtx = createMenuEvalContext((key) => host.getContext(key));

    this.menu = new ContextMenuController(
      host.root,
      host.getModel(),
      host.selection,
      () => {
        host.view.ensureCaretVisible();
        host.syncTextarea();
        host.view.paint();
        host.emitContent();
      },
      () => host.focus(),
      {
        getInlineEntries: () => {
          this.syncLiveContextKeys();
          return menus
            .getEntries(MenuId.EditorContext, evalCtx)
            .filter((r) => r.entry.touchToolbar === 'inline');
        },
        getOverflowGroups: () => {
          this.syncLiveContextKeys();
          const all = menus.getGroupedEntries(MenuId.EditorContext, evalCtx);
          const out = [];
          for (const g of all) {
            const items = g.items.filter((r) => r.entry.touchToolbar !== 'inline');
            if (items.length > 0) out.push({ group: g.group, items });
          }
          return out;
        },
        getAllVerticalGroups: () => {
          this.syncLiveContextKeys();
          return menus.getGroupedEntries(MenuId.EditorContext, evalCtx);
        },
        getShortcutLabel: (cmd) => host.keybindings.getShortcutLabel(cmd),
        executeCommand: (cmd, args) => host.executeCommand(cmd, ...(args ?? [])),
      },
    );

    if (host.initialOptions.contextMenu) {
      this.menu.setMenuOptions(host.initialOptions.contextMenu);
    }

    // Register standard clipboard commands so registry entries execute cleanly
    host.commands.registerCommand(BUILTIN_CLIPBOARD_COMMANDS.Copy, () => this.menu.copy(), {
      title: 'Copy',
      category: 'Edit',
    });
    host.commands.registerCommand(BUILTIN_CLIPBOARD_COMMANDS.Cut, () => this.menu.cut(), {
      title: 'Cut',
      category: 'Edit',
    });
    host.commands.registerCommand(BUILTIN_CLIPBOARD_COMMANDS.Paste, () => this.menu.paste(), {
      title: 'Paste',
      category: 'Edit',
    });
    host.commands.registerCommand(BUILTIN_CLIPBOARD_COMMANDS.SelectAll, () => this.menu.selectAll(), {
      title: 'Select All',
      category: 'Selection',
    });

    host.root.addEventListener('contextmenu', this.onContextMenuDom);
  }

  setEnabled(enabled: boolean): void { this.menu.setEnabled(enabled); }
  setItems(items: MonoMenuItem[]): void { this.menu.setItems(items); }
  addItem(item: MonoMenuItem): void { this.menu.addItem(item); }
  removeItem(id: string): void { this.menu.removeItem(id); }
  setStyle(style: MonoMenuStyle): void { this.menu.setStyle(style); }
  hide(): void { this.menu.hide(); }
  show(): void { this.showEditorMenu(); }

  onKeyDown(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' && this.menu.isOpen()) {
      this.menu.hide();
      return true;
    }
    return false;
  }

  onInputChange(_ev: InputChangeEvent): void {
    this.menuRestore = false;
    this.menu.hide();
  }

  onPointerInteract(kind: PointerInteractKind): void {
    if (kind === 'scroll') {
      if (this.menu.isOpen()) this.menuRestore = true;
      this.menu.hide();
      return;
    }
    if (kind === 'tap' || kind === 'handle') {
      this.menuRestore = false;
      this.menu.hide();
      return;
    }
    if (kind === 'handleTap') {
      if (this.menu.isEnabled()) {
        this.lastSelectMenuAt = Date.now();
        requestAnimationFrame(() => this.showEditorMenu());
      }
      return;
    }
    if (kind === 'select') {
      if (!this.host.selection.isEmpty && this.menu.isEnabled()) {
        this.lastSelectMenuAt = Date.now();
        requestAnimationFrame(() => this.showEditorMenu());
      } else {
        this.menuRestore = false;
        this.menu.hide();
      }
    }
  }

  onScrollEnd(): void {
    if (!this.menuRestore || this.host.isDisposed() || !this.menu.isEnabled()) return;
    this.menuRestore = false;
    requestAnimationFrame(() => {
      if (!this.host.isDisposed() && this.menu.isEnabled()) this.showEditorMenu();
    });
  }

  onOutsidePointerDown(): void { this.menu.hide(); }
  onColorSwatchClick(_hit: ColorHit): void { this.menu.hide(); }

  onModelChange(model: TextModel): void {
    this.menuRestore = false;
    this.menu.setModel(model);
  }

  onThemeChange(wt: ResolvedWidgetTheme): void {
    this.menu.setStyle({
      background: wt.background,
      border: `1px solid ${wt.border}`,
      iconColor: wt.foreground,
      shadow: wt.shadow,
    });
  }

  onOptionsChange(patch: Partial<MonoEditorOptions>): void {
    if (patch.contextMenu) {
      this.menu.setMenuOptions(patch.contextMenu);
    }
  }

  dispose(): void {
    this.host.root.removeEventListener('contextmenu', this.onContextMenuDom);
    this.menu.dispose();
  }

  private onContextMenuDom = (e: MouseEvent): void => {
    if (this.host.isDisposed() || !this.menu.isEnabled()) return;
    e.preventDefault();
    // On mobile/touch browsers, long-press fires a native `contextmenu` event right after
    // PointerController's long-press selects the word and opens the configured menu.
    // Never hijack that selection menu with a vertical menu!
    const pointerType = (e as unknown as { pointerType?: string }).pointerType;
    if (pointerType === 'touch' || Date.now() - this.lastSelectMenuAt < 750) {
      if (!this.menu.isOpen()) this.showEditorMenu();
      return;
    }
    const rect = this.host.root.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    const lh = this.host.getMetrics().lineHeight;
    const anchorRect: RectBox = {
      left: localX - 4,
      right: localX + 4,
      top: localY - 4,
      bottom: localY + 4,
    };
    this.menu.showAnchored({
      anchorRects: [anchorRect],
      gap: 6,
      getSafeArea: () => this.computeSafeArea(lh),
    });
  };

  private syncLiveContextKeys(): void {
    const pos = this.host.getPosition();
    const lang = this.host.getLanguageIdAtPosition(pos.lineNumber, pos.column);
    this.host.setContext('editorHasSelection', !this.host.selection.isEmpty);
    this.host.setContext('editorHasMultipleSelections', this.host.selection.hasMultipleCursors);
    this.host.setContext('editorReadonly', this.host.isReadOnly());
    this.host.setContext('editorLangId', lang);
    this.host.setContext('editorHasDefinitionProvider', languageFeatures.getDefinitionProviders(lang).length > 0);
    this.host.setContext('editorHasTypeDefinitionProvider', languageFeatures.getTypeDefinitionProviders(lang).length > 0);
    this.host.setContext('editorHasImplementationProvider', languageFeatures.getImplementationProviders(lang).length > 0);
    this.host.setContext('editorHasReferenceProvider', languageFeatures.getReferenceProviders(lang).length > 0);
    this.host.setContext('editorHasRenameProvider', languageFeatures.getRenameProviders(lang).length > 0);
    this.host.setContext('editorHasCodeActionsProvider', languageFeatures.getCodeActionProviders(lang).length > 0);
    this.host.setContext(
      'editorHasDocumentFormattingProvider',
      languageFeatures.getDocumentFormattingProviders(lang).length > 0,
    );
    this.host.setContext(
      'editorHasDocumentSymbolProvider',
      languageFeatures.getDocumentSymbolProviders(lang).length > 0,
    );
    this.host.setContext(
      'editorHasSignatureHelpProvider',
      languageFeatures.getSignatureHelpProviders(lang).length > 0,
    );
  }

  private computeSafeArea(lh: number): RectBox {
    const rect = this.host.root.getBoundingClientRect();
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    return computeMenuSafeArea(
      { left: rect.left, top: rect.top, width: rect.width || this.host.root.clientWidth || 600, height: rect.height || this.host.root.clientHeight || 400 },
      this.host.view.lastStickyHeight,
      this.host.view.lastBottomSticky ? lh : 0,
      8,
      vv ? { offsetTop: vv.offsetTop, offsetLeft: vv.offsetLeft, width: vv.width, height: vv.height } : null,
    );
  }

  private showEditorMenu(): void {
    if (this.host.isDisposed() || !this.menu.isEnabled()) return;
    this.menuRestore = false;
    const m = this.host.getMetrics();
    const lh = m.lineHeight;
    const a = this.host.selection.anchor;
    const b = this.host.selection.active;
    const aBefore = a.lineNumber < b.lineNumber || (a.lineNumber === b.lineNumber && a.column <= b.column);
    const s = aBefore ? a : b;
    const e = aBefore ? b : a;

    const sp = this.host.view.screenPosOf(s.lineNumber, s.column);
    const ep = this.host.view.screenPosOf(e.lineNumber, e.column);
    const drop = TEARDROP.h;
    const handlesShown = this.host.getHandlesShown();

    const anchorRects: RectBox[] = [
      {
        left: Math.min(sp.x, ep.x) - 4,
        right: Math.max(sp.x, ep.x) + 4,
        top: Math.min(sp.y, ep.y),
        bottom: Math.max(sp.y, ep.y) + lh,
      },
    ];
    if (handlesShown) {
      const pts = this.host.selection.isEmpty ? [sp] : [sp, ep];
      for (const p of pts) {
        const tip = p.y + lh - 1;
        anchorRects.push({ left: p.x - 22, right: p.x + 22, top: tip, bottom: tip + drop + 8 });
      }
    }

    this.menu.showAnchored({
      anchorRects,
      gap: 8,
      getSafeArea: () => this.computeSafeArea(lh),
    });
  }
}
