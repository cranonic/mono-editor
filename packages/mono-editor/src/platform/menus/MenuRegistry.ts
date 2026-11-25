import { MENU_ICONS } from '../../common/config/menuTypes';
import type { MonoContextKeyValue, MonoDisposable } from '../commands/types';
import { evaluateWhenExpression } from '../commands/whenExpr';
import { MonoCommands } from '../keybindings/KeybindingService';

export const MenuId = {
  EditorContext: 'editor/context',
  EditorTouchToolbar: 'editor/touchToolbar',
} as const;
export type MenuId = (typeof MenuId)[keyof typeof MenuId];

export interface MenuEvalContext {
  getContext(key: string): MonoContextKeyValue | undefined;
  match(when?: string | ((ctx: MenuEvalContext) => boolean)): boolean;
}

export interface MonoMenuEntry {
  id: string;
  menu: MenuId | string;
  command: string;
  args?: unknown[];
  title: string;
  icon?: string;
  /** Lexicographically sorted group name (e.g. '1_navigation', '2_modification', '9_cutcopypaste'). */
  group: string;
  /** Numeric sort order within the group (lower first). */
  order?: number;
  /** Visibility predicate: hidden (not shown) when false. */
  when?: string | ((ctx: MenuEvalContext) => boolean);
  /** Enabled predicate: shown disabled/greyed-out when false. */
  enabledWhen?: string | ((ctx: MenuEvalContext) => boolean);
  /** Horizontal touch bar placement: inline icon or overflow "More" vertical page. */
  touchToolbar?: 'inline' | 'overflow';
}

export interface ResolvedMenuEntry {
  entry: MonoMenuEntry;
  enabled: boolean;
}

export interface ResolvedMenuGroup {
  group: string;
  items: ResolvedMenuEntry[];
}

interface StoredMenuEntry {
  entry: MonoMenuEntry;
  seq: number;
}

export function createMenuEvalContext(
  getContext: (key: string) => MonoContextKeyValue | undefined,
): MenuEvalContext {
  const ctx: MenuEvalContext = {
    getContext,
    match(when?: string | ((c: MenuEvalContext) => boolean)): boolean {
      if (when == null || when === '') return true;
      if (typeof when === 'function') {
        try { return Boolean(when(ctx)); } catch { return false; }
      }
      return evaluateWhenExpression(when, getContext);
    },
  };
  return ctx;
}

/**
 * Monaco-style declarative menu registry (`menus.register(entry)`).
 * Entries can be registered in any order and are sorted by `group` (lexicographically)
 * then `order` (numerically), filtered by `when`, and enabled-checked via `enabledWhen`.
 */
export class MenuRegistry {
  private entries = new Map<string, StoredMenuEntry[]>();
  private listeners = new Set<() => void>();
  private seq = 1;

  register(entry: MonoMenuEntry): MonoDisposable {
    const key = String(entry.menu);
    let list = this.entries.get(key);
    if (!list) {
      list = [];
      this.entries.set(key, list);
    }
    const stored: StoredMenuEntry = { entry: { ...entry }, seq: this.seq++ };
    // Replace existing entry with same id in same menu if re-registered
    const existingIdx = list.findIndex((s) => s.entry.id === entry.id);
    if (existingIdx >= 0) list[existingIdx] = stored;
    else list.push(stored);
    this.emit();

    let disposed = false;
    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        const arr = this.entries.get(key);
        if (!arr) return;
        const idx = arr.indexOf(stored);
        if (idx >= 0) {
          arr.splice(idx, 1);
          this.emit();
        }
      },
    };
  }

  getEntries(menuId: MenuId | string, ctx: MenuEvalContext): ResolvedMenuEntry[] {
    const list = this.entries.get(String(menuId)) ?? [];
    const visible: Array<{ stored: StoredMenuEntry; enabled: boolean }> = [];
    for (const stored of list) {
      if (!ctx.match(stored.entry.when)) continue;
      const enabled = ctx.match(stored.entry.enabledWhen);
      visible.push({ stored, enabled });
    }
    visible.sort((a, b) => {
      const g = a.stored.entry.group.localeCompare(b.stored.entry.group);
      if (g !== 0) return g;
      const oa = a.stored.entry.order ?? 100;
      const ob = b.stored.entry.order ?? 100;
      if (oa !== ob) return oa - ob;
      return a.stored.seq - b.stored.seq;
    });
    return visible.map((v) => ({ entry: v.stored.entry, enabled: v.enabled }));
  }

  getGroupedEntries(menuId: MenuId | string, ctx: MenuEvalContext): ResolvedMenuGroup[] {
    const flat = this.getEntries(menuId, ctx);
    const groups: ResolvedMenuGroup[] = [];
    for (const item of flat) {
      const last = groups[groups.length - 1];
      if (!last || last.group !== item.entry.group) {
        groups.push({ group: item.entry.group, items: [item] });
      } else {
        last.items.push(item);
      }
    }
    return groups;
  }

  onDidChange(listener: () => void): MonoDisposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  private emit(): void {
    for (const l of this.listeners) {
      try { l(); } catch { /* */ }
    }
  }
}

export const menus = new MenuRegistry();

let builtinsRegistered = false;

export const BUILTIN_CLIPBOARD_COMMANDS = {
  Cut: 'editor.action.clipboardCutAction',
  Copy: 'editor.action.clipboardCopyAction',
  Paste: 'editor.action.clipboardPasteAction',
  SelectAll: 'editor.action.selectAll',
} as const;

export function registerDefaultEditorMenuEntries(): void {
  if (builtinsRegistered) return;
  builtinsRegistered = true;

  const entries: MonoMenuEntry[] = [
    // Navigation
    {
      id: 'mono.ctx.gotoDefinition',
      menu: MenuId.EditorContext,
      command: MonoCommands.RevealDefinition,
      title: 'Go to Definition',
      group: '1_navigation',
      order: 10,
      when: 'editorHasDefinitionProvider',
      touchToolbar: 'overflow',
    },
    {
      id: 'mono.ctx.gotoTypeDefinition',
      menu: MenuId.EditorContext,
      command: MonoCommands.GoToTypeDefinition,
      title: 'Go to Type Definition',
      group: '1_navigation',
      order: 20,
      when: 'editorHasTypeDefinitionProvider',
      touchToolbar: 'overflow',
    },
    {
      id: 'mono.ctx.gotoImplementation',
      menu: MenuId.EditorContext,
      command: MonoCommands.GoToImplementation,
      title: 'Go to Implementation',
      group: '1_navigation',
      order: 30,
      when: 'editorHasImplementationProvider',
      touchToolbar: 'overflow',
    },
    {
      id: 'mono.ctx.peekDefinition',
      menu: MenuId.EditorContext,
      command: MonoCommands.PeekDefinition,
      title: 'Peek Definition',
      group: '1_navigation',
      order: 40,
      when: 'editorHasDefinitionProvider',
      touchToolbar: 'overflow',
    },
    {
      id: 'mono.ctx.peekReferences',
      menu: MenuId.EditorContext,
      command: MonoCommands.ReferenceSearch,
      title: 'Peek References',
      group: '1_navigation',
      order: 50,
      when: 'editorHasReferenceProvider',
      touchToolbar: 'overflow',
    },

    // Modification
    {
      id: 'mono.ctx.rename',
      menu: MenuId.EditorContext,
      command: MonoCommands.Rename,
      title: 'Rename Symbol',
      group: '2_modification',
      order: 10,
      when: 'editorHasRenameProvider && !editorReadonly',
      touchToolbar: 'overflow',
    },
    {
      id: 'mono.ctx.quickFix',
      menu: MenuId.EditorContext,
      command: MonoCommands.QuickFix,
      title: 'Quick Fix...',
      group: '2_modification',
      order: 20,
      when: 'editorHasCodeActionsProvider && !editorReadonly',
      touchToolbar: 'overflow',
    },
    {
      id: 'mono.ctx.formatSelection',
      menu: MenuId.EditorContext,
      command: MonoCommands.FormatSelection,
      title: 'Format Selection',
      group: '2_modification',
      order: 30,
      when: 'editorHasSelection && editorHasDocumentFormattingProvider && !editorReadonly',
      touchToolbar: 'overflow',
    },
    {
      id: 'mono.ctx.formatDocument',
      menu: MenuId.EditorContext,
      command: MonoCommands.FormatDocument,
      title: 'Format Document',
      group: '2_modification',
      order: 40,
      when: 'editorHasDocumentFormattingProvider && !editorReadonly',
      touchToolbar: 'overflow',
    },

    // Selection & Hints
    {
      id: 'mono.ctx.parameterHints',
      menu: MenuId.EditorContext,
      command: MonoCommands.TriggerParameterHints,
      title: 'Parameter Hints',
      group: '3_hints',
      order: 10,
      when: 'editorHasSignatureHelpProvider',
      touchToolbar: 'overflow',
    },
    {
      id: 'mono.ctx.expandSelection',
      menu: MenuId.EditorContext,
      command: MonoCommands.SmartSelectExpand,
      title: 'Expand Selection',
      group: '4_selection',
      order: 10,
      touchToolbar: 'overflow',
    },
    {
      id: 'mono.ctx.shrinkSelection',
      menu: MenuId.EditorContext,
      command: MonoCommands.SmartSelectShrink,
      title: 'Shrink Selection',
      group: '4_selection',
      order: 20,
      when: 'editorHasSelection',
      touchToolbar: 'overflow',
    },

    // Folding
    {
      id: 'mono.ctx.foldAll',
      menu: MenuId.EditorContext,
      command: MonoCommands.FoldAll,
      title: 'Fold All',
      group: '5_folding',
      order: 10,
      touchToolbar: 'overflow',
    },
    {
      id: 'mono.ctx.unfoldAll',
      menu: MenuId.EditorContext,
      command: MonoCommands.UnfoldAll,
      title: 'Unfold All',
      group: '5_folding',
      order: 20,
      touchToolbar: 'overflow',
    },

    // Clipboard (9_cutcopypaste — inline on horizontal touch bar)
    {
      id: 'mono.ctx.copy',
      menu: MenuId.EditorContext,
      command: BUILTIN_CLIPBOARD_COMMANDS.Copy,
      title: 'Copy',
      icon: MENU_ICONS.copy,
      group: '9_cutcopypaste',
      order: 10,
      when: 'editorHasSelection',
      touchToolbar: 'inline',
    },
    {
      id: 'mono.ctx.cut',
      menu: MenuId.EditorContext,
      command: BUILTIN_CLIPBOARD_COMMANDS.Cut,
      title: 'Cut',
      icon: MENU_ICONS.cut,
      group: '9_cutcopypaste',
      order: 20,
      when: 'editorHasSelection && !editorReadonly',
      touchToolbar: 'inline',
    },
    {
      id: 'mono.ctx.paste',
      menu: MenuId.EditorContext,
      command: BUILTIN_CLIPBOARD_COMMANDS.Paste,
      title: 'Paste',
      icon: MENU_ICONS.paste,
      group: '9_cutcopypaste',
      order: 30,
      when: '!editorReadonly',
      touchToolbar: 'inline',
    },
    {
      id: 'mono.ctx.selectAll',
      menu: MenuId.EditorContext,
      command: BUILTIN_CLIPBOARD_COMMANDS.SelectAll,
      title: 'Select All',
      icon: MENU_ICONS.selectAll,
      group: '9_cutcopypaste',
      order: 40,
      touchToolbar: 'inline',
    },

    // Command Palette
    {
      id: 'mono.ctx.commandPalette',
      menu: MenuId.EditorContext,
      command: MonoCommands.CommandPalette,
      title: 'Command Palette...',
      group: 'z_commands',
      order: 10,
      touchToolbar: 'overflow',
    },
  ];

  for (const e of entries) menus.register(e);
}
