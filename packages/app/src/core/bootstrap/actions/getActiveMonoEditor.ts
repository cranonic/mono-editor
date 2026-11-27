// src/core/bootstrap/actions/getActiveMonoEditor.ts
import { getActiveMonoEditors, type IMonoEditor } from '@mono/editor';
import { commands } from '@/core/extensionAPI/registry/commandRegistry';
import { useTabStore } from '@/store/tabStore';

/**
 * Resolves the active Mono Editor instance that the user is currently working in.
 *
 * Priority:
 *   1. commands.getActiveEditor() — set on mount / focus by useMonoEditorBridge
 *   2. Editor with text focus
 *   3. Editor whose model URI matches the active tab's filePath
 *   4. First active Mono editor (last resort)
 */
export function getActiveMonoEditor(): IMonoEditor | null {
  try {
    const tracked = commands.getActiveEditor?.();
    if (tracked) return tracked as unknown as IMonoEditor;
  } catch {
    /* registry may not expose it yet */
  }

  const all = getActiveMonoEditors();
  if (!all.length) return null;

  const focused = all.find((e) => e.hasTextFocus?.());
  if (focused) return focused;

  const { activeTabId, tabs } = useTabStore.getState();
  const tab = tabs.find((t) => t.id === activeTabId);
  const filePath = tab?.filePath || activeTabId;
  if (filePath) {
    const match = all.find((e) => {
      const uri = e.getModel()?.uri;
      if (!uri) return false;
      const s = uri.toString();
      const path = (uri as any).path || (uri as any).fsPath || '';
      return (
        s.includes(filePath) ||
        path === filePath ||
        path.endsWith(filePath) ||
        s.endsWith(filePath)
      );
    });
    if (match) return match;
  }

  return all[0] ?? null;
}

/** Focus the active Mono editor and run an editor action by id. */
export function triggerOnActiveEditor(actionId: string): void {
  const editor = getActiveMonoEditor();
  if (!editor) {
    console.warn(`[actions] No active Mono editor for: ${actionId}`);
    return;
  }
  editor.focus();
  editor.trigger('keyboard', actionId, null);
}
