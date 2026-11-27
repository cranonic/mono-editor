/**
 * Registers providers into APP paletteStore (CommandPalette UI reads this).
 * Must be called from a mounted component (e.g. CodeEditor).
 *
 * Expected:
 *   query ""  → help items (Show Commands, Go to Line, …)
 *   query ">" → full command list (editor + app registry)
 */
import { useEffect } from 'react';
import { usePaletteStore, type QuickPickItem } from '@/store/paletteStore';
import { commands } from '@/core/extensionAPI/registry/commandRegistry';
import { keybindingManager } from '@/core/keybindings/keybindingManager';

export type MonoEditorPaletteHost = {
  getCommandsForPalette?: (filter?: string) => Array<{
    id: string;
    label: string;
    description?: string;
    category?: string;
    icon?: string;
    shortcut?: string;
    enabled: boolean;
  }>;
  executeCommand?: (id: string, ...args: unknown[]) => Promise<unknown>;
  getLineCount?: () => number;
  revealLine?: (line: number, column?: number) => void;
  setPosition?: (positionOrLine: number | { lineNumber: number; column: number }, column?: number) => void;
  focus?: () => void;
  revealFind?: () => void;
  revealReplace?: () => void;
};

async function runCommand(id: string, editor?: MonoEditorPaletteHost | null) {
  const mono = (window as any).__monoEditor || editor;
  console.log('[palette] run', id);

  // Mono editor commands
  if (id === 'actions.find' || id === 'editor.action.startFindAction') {
    mono?.revealFind?.();
    return;
  }
  if (id === 'editor.action.startFindReplaceAction') {
    mono?.revealReplace?.();
    return;
  }
  if (
    id === 'editor.action.selectAll' ||
    id === 'editor.action.undo' ||
    id === 'undo' ||
    id === 'editor.action.redo' ||
    id === 'redo'
  ) {
    mono?.executeCommand?.(id);
    return;
  }

  // Direct handlers for known IDE commands
  if (id === 'workbench.action.closeAllEditors') {
    const m = await import('@/store/tabStore');
    m.useTabStore.getState().clearTabs();
    return;
  }
  if (id === 'workbench.action.openSettings') {
    const m = await import('@/store/tabStore');
    m.useTabStore.getState().addTab({
      id: 'mscode://internal/settings.ui',
      type: 'settings',
      title: 'Settings',
      icon: 'settings',
    });
    return;
  }
  if (id === 'workbench.action.closeFolder') {
    const exp = await import('@/features/explorer/store/exploreStore');
    const tab = await import('@/store/tabStore');
    exp.useExplorerStore.getState().setWorkspace(null, null);
    await tab.useTabStore.getState().initTabs(null);
    return;
  }
  if (id === 'workbench.action.files.save' || id === 'workbench.action.files.saveAll') {
    console.warn('[palette] save not wired yet');
    return;
  }

  // Fallback to registry or Mono
  if (commands.hasCommand?.(id)) {
    void commands.executeCommand(id);
    return;
  }
  void mono?.executeCommand?.(id);
  console.warn('[palette] unhandled', id);
}

function editorItems(editor: MonoEditorPaletteHost | null | undefined, filter: string): QuickPickItem[] {
  if (!editor?.getCommandsForPalette) return [];
  try {
    return (editor.getCommandsForPalette(filter) || []).map((c) => ({
      id: c.id,
      label: c.label,
      description: c.category || c.description,
      leftIcon: c.icon || 'terminal',
      shortcut: c.shortcut,
      readonly: c.enabled === false,
      onSelect: () => {
        if (c.enabled === false) return;
        void runCommand(c.id, editor);
      },
    }));
  } catch (e) {
    console.warn('[palette] editor commands failed', e);
    return [];
  }
}

function appItems(filter: string, editor?: MonoEditorPaletteHost | null): QuickPickItem[] {
  const q = (filter || '').toLowerCase().trim();
  const raw = commands.getCommandsForPalette?.() || [];
  return raw
    .filter((c: any) => {
      if (!c?.title) return false;
      if (!q) return true;
      return `${c.title} ${c.category || ''} ${c.id}`.toLowerCase().includes(q);
    })
    .map((c: any) => {
      let shortcut = c.shortcut;
      try {
        shortcut = (keybindingManager as any)?.getShortcutLabel?.(c.id) || c.shortcut;
      } catch {
        /* */
      }
      return {
        id: c.id,
        label: c.title || c.id,
        description: c.category,
        leftIcon: c.icon || 'terminal',
        shortcut,
        onSelect: () => {
          void runCommand(c.id, editor);
        },
      };
    });
}

function merge(editor: MonoEditorPaletteHost | null | undefined, filter: string): QuickPickItem[] {
  const a = editorItems(editor, filter);
  const seen = new Set(a.map((i) => i.id));
  const b = appItems(filter, editor).filter((i) => !seen.has(i.id));
  return [...a, ...b].sort((x, y) => (x.label || '').localeCompare(y.label || ''));
}

export function useMonoPaletteProviders(editor: MonoEditorPaletteHost | null | undefined) {
  useEffect(() => {
    const { registerProvider, unregisterProvider } = usePaletteStore.getState();

    registerProvider({
      prefix: '',
      name: 'Help & Menu',
      provideItems: (search) => {
        if ((search || '').length > 0) return [];
        const setQuery = usePaletteStore.getState().setQuery;
        return [
          {
            id: 'help-cmd',
            label: 'Show And Run Commands',
            inlineDetail: '>',
            shortcut: 'F1',
            leftIcon: 'terminal',
            keepOpen: true,
            onSelect: () => setQuery('>'),
          },
          {
            id: 'help-line',
            label: 'Go to Line/Column...',
            inlineDetail: ':',
            leftIcon: 'arrow-right',
            keepOpen: true,
            onSelect: () => setQuery(':'),
          },
        ];
      },
    });

    registerProvider({
      prefix: '>',
      name: 'Show and Run Commands',
      provideItems: (search) => {
        const items = merge(editor, search || '');
        if (items.length === 0) {
          return [
            {
              id: 'empty-cmds',
              label: 'No commands registered',
              description: 'Add title via commands.registerCommand(..., { title }) or editor.addAction',
              readonly: true,
            },
          ];
        }
        return items;
      },
    });

    registerProvider({
      prefix: ':',
      name: 'Go to Line/Column',
      provideItems: (search) => {
        const activeEd = (editor ?? (window as any).__monoEditor) as any;
        const total = activeEd?.getLineCount?.() ?? 1;
        const trimmed = (search || '').trim();
        if (!trimmed) {
          const cur = activeEd?.getPosition?.();
          const curHint = cur ? `Current: Ln ${cur.lineNumber}, Col ${cur.column} · ` : '';
          return [{ id: 'hint', label: `${curHint}Type a line number (1–${total})`, readonly: true }];
        }
        const parts = trimmed.split(/[:,]/);
        let line = parseInt(parts[0] || '', 10);
        let col = parts.length > 1 && parts[1] !== '' ? parseInt(parts[1]!, 10) : 1;
        if (Number.isNaN(line)) {
          return [{ id: 'err', label: 'Invalid line number', readonly: true }];
        }
        line = Math.max(1, Math.min(total, line));
        const maxCol = (activeEd?.getModel?.()?.getLineLength?.(line) ?? 0) + 1;
        col = Number.isNaN(col) ? 1 : Math.max(1, Math.min(maxCol, col));
        return [
          {
            id: 'goto',
            label: `Go to line ${line}${parts.length > 1 ? `, column ${col}` : ''}`,
            leftIcon: 'arrow-right',
            onSelect: () => {
              if (!activeEd) return;
              activeEd.setPosition?.({ lineNumber: line, column: col });
              if (typeof activeEd.revealLineInCenter === 'function') {
                activeEd.revealLineInCenter(line);
              } else {
                activeEd.revealLine?.(line, col);
              }
              activeEd.focus?.();
            },
          },
        ];
      },
    });

    registerProvider({
      prefix: '@',
      name: 'Go to Symbol in Editor',
      provideItems: (search) => {
        const activeEd = (editor ?? (window as any).__monoEditor) as any;
        const outline = activeEd?.getStructure?.()?.getOutline?.() ?? [];
        const flat: Array<{ sym: any; depth: number }> = [];
        const walk = (list: any[], depth: number) => {
          for (const s of list) {
            flat.push({ sym: s, depth });
            if (Array.isArray(s.children) && s.children.length > 0) {
              walk(s.children, depth + 1);
            }
          }
        };
        walk(outline, 0);

        const q = (search || '').trim().toLowerCase();
        const matched = q
          ? flat.filter(({ sym }) => String(sym.name || '').toLowerCase().includes(q))
          : flat;

        if (matched.length === 0) {
          return [{ id: 'no-symbols', label: 'No symbols found in editor', readonly: true }];
        }
        return matched.map(({ sym, depth }, idx) => ({
          id: `sym-${idx}-${sym.name}-${sym.range?.startLineNumber ?? 1}`,
          label: `${depth > 0 ? '  '.repeat(depth) : ''}${sym.name}`,
          description: sym.detail || `Ln ${sym.range?.startLineNumber ?? 1}`,
          leftIcon: 'symbol-misc',
          onSelect: () => {
            if (!activeEd) return;
            const target = sym.selectionRange ?? sym.range;
            const ln = target?.startLineNumber ?? 1;
            const col = target?.startColumn ?? 1;
            activeEd.setPosition?.({ lineNumber: ln, column: col });
            if (typeof activeEd.revealLineInCenter === 'function') {
              activeEd.revealLineInCenter(ln);
            } else {
              activeEd.revealLine?.(ln, col);
            }
            activeEd.focus?.();
          },
        }));
      },
    });

    if (typeof console !== 'undefined') {
      console.debug('[palette] providers registered for >, :, @, help; editor=', !!editor);
    }

    return () => {
      unregisterProvider('');
      unregisterProvider('>');
      unregisterProvider(':');
      unregisterProvider('@');
    };
  }, [editor]);
}
