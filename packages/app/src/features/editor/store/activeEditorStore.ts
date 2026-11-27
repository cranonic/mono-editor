// src/features/editor/store/activeEditorStore.ts
import { create } from 'zustand';
import type { IMonoEditor } from '@mono/editor';

interface ActiveEditorState {
  activeEditor: IMonoEditor | null;
  activeTabId: string | null;
  editorsByTab: Record<string, IMonoEditor>;
  registerEditor: (tabId: string, editor: IMonoEditor) => void;
  unregisterEditor: (tabId: string, editor?: IMonoEditor) => void;
  setActiveEditor: (editor: IMonoEditor | null, tabId?: string | null) => void;
  getEditorForTab: (tabId: string | null | undefined) => IMonoEditor | null;
}

export const useActiveEditorStore = create<ActiveEditorState>((set, get) => ({
  activeEditor: null,
  activeTabId: null,
  editorsByTab: {},

  registerEditor: (tabId, editor) =>
    set((s) => ({
      editorsByTab: { ...s.editorsByTab, [tabId]: editor },
      activeEditor: s.activeTabId === tabId || !s.activeEditor ? editor : s.activeEditor,
      activeTabId: s.activeTabId ?? tabId,
    })),

  unregisterEditor: (tabId, editor) =>
    set((s) => {
      const next = { ...s.editorsByTab };
      if (!editor || next[tabId] === editor) {
        delete next[tabId];
      }
      const nextActive =
        s.activeEditor === editor || s.activeTabId === tabId
          ? (Object.values(next)[0] ?? null)
          : s.activeEditor;
      return {
        editorsByTab: next,
        activeEditor: nextActive,
        activeTabId: nextActive ? s.activeTabId : null,
      };
    }),

  setActiveEditor: (editor, tabId) =>
    set((s) => ({
      activeEditor: editor,
      activeTabId: tabId !== undefined ? tabId : s.activeTabId,
    })),

  getEditorForTab: (tabId) => {
    if (!tabId) return get().activeEditor;
    return get().editorsByTab[tabId] ?? null;
  },
}));
