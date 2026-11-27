/**
 * Mono editor lifecycle / view-state / settings bridge.
 */
import { useEffect, useRef } from 'react';
import type { IMonoEditor } from '@mono/editor';
import { monoThemeService, registerBuiltinThemes } from '@mono/editor';
import { useEditorViewStateStore } from '@/features/editor/store/editorViewStateStore';
import { commands } from '@/core/extensionAPI/registry/commandRegistry';
import { buildMonoEditorOptions } from '../mono/monoOptions';

export interface UseMonoEditorBridgeParams {
  editor: IMonoEditor | null;
  tabId: string;
  filePath: string;
  settings: Record<string, unknown>;
  isLoading: boolean;
}

/**
 * - Restore cursor / scroll from view state
 * - Persist cursor / scroll on change
 * - Apply ALL editor.* settings via buildMonoEditorOptions -> updateOptions
 * - Sync workbench theme -> monoThemeService
 * - Register active editor for commands
 * - Dirty version tracking (alternativeVersionId)
 */
export function useMonoEditorBridge({
  editor,
  tabId,
  filePath,
  settings,
  isLoading,
}: UseMonoEditorBridgeParams): void {
  const updateViewState = useEditorViewStateStore((s) => s.updateViewState);
  const savedVersionRef = useRef<number>(0);
  const restoredRef = useRef<string | null>(null);

  // Active editor + focus
  useEffect(() => {
    if (!editor || isLoading) return;
    try {
      commands.setActiveEditor?.(editor as any);
    } catch {
      /* ignore */
    }
    const dFocus = editor.onDidFocusEditorText?.(() => {
      try {
        commands.setActiveEditor?.(editor as any);
        import('@/features/editor/store/activeEditorStore').then(({ useActiveEditorStore }) => {
          useActiveEditorStore.getState().setActiveEditor(editor, tabId);
        });
      } catch {
        /* ignore */
      }
    });
    return () => dFocus?.dispose();
  }, [editor, isLoading, tabId]);

  // Restore view state once per file mount
  useEffect(() => {
    if (!editor || isLoading) return;
    const key = `${tabId}:${filePath}`;
    if (restoredRef.current === key) return;
    restoredRef.current = key;

    const vs =
      useEditorViewStateStore.getState().viewStates[tabId] ??
      useEditorViewStateStore.getState().viewStates[filePath];

    if (vs?.cursorLine != null) {
      editor.setPosition({
        lineNumber: vs.cursorLine,
        column: vs.cursorColumn ?? 1,
      });
      editor.revealPositionInCenter?.({
        lineNumber: vs.cursorLine,
        column: vs.cursorColumn ?? 1,
      });
    }
    if (typeof vs?.scrollPos === 'number') {
      editor.setScrollTop(vs.scrollPos);
    }

    try {
      savedVersionRef.current = editor.getAlternativeVersionId?.() ?? 0;
    } catch {
      savedVersionRef.current = 0;
    }
  }, [editor, tabId, filePath, isLoading]);

  // Persist cursor + scroll
  useEffect(() => {
    if (!editor || isLoading) return;

    const saveCursor = () => {
      const pos = editor.getPosition();
      updateViewState(tabId, {
        cursorLine: pos.lineNumber,
        cursorColumn: pos.column,
        scrollPos: editor.getScrollTop(),
      });
      updateViewState(filePath, {
        cursorLine: pos.lineNumber,
        cursorColumn: pos.column,
        scrollPos: editor.getScrollTop(),
      });
    };

    const d1 = editor.onDidChangeCursorPosition(() => saveCursor());
    const d2 = editor.onDidScrollChange(() => {
      updateViewState(tabId, { scrollPos: editor.getScrollTop() });
      updateViewState(filePath, { scrollPos: editor.getScrollTop() });
    });
    return () => {
      d1.dispose();
      d2.dispose();
    };
  }, [editor, tabId, filePath, isLoading, updateViewState]);

  // Settings -> full MonoEditorOptions via updateOptions
  useEffect(() => {
    if (!editor || isLoading) return;
    const patch = buildMonoEditorOptions(settings);
    editor.updateOptions(patch);
  }, [editor, isLoading, settings]);

  // Workbench theme id -> mono
  useEffect(() => {
    if (!editor || isLoading) return;
    registerBuiltinThemes();
    const themeId =
      (settings['workbench.theme'] as string) ||
      (settings['workbench.colorTheme'] as string) ||
      monoThemeService.getActiveThemeId();
    try {
      if (monoThemeService.getTheme(themeId)) {
        monoThemeService.setTheme(themeId);
      }
      editor.setTheme(themeId);
    } catch {
      /* ignore */
    }
  }, [editor, isLoading, settings['workbench.theme'], settings['workbench.colorTheme']]);

  // Dirty flag from alternative version id
  useEffect(() => {
    if (!editor || isLoading) return;
    const sub = editor.onDidChangeModelContent(() => {
      const alt = editor.getAlternativeVersionId?.() ?? 0;
      const dirty = alt !== savedVersionRef.current;
      updateViewState(tabId, { isDirty: dirty });
    });
    return () => sub.dispose();
  }, [editor, isLoading, tabId, updateViewState]);
}

/** Call after successful save to reset dirty baseline */
export function markMonoEditorSaved(editor: IMonoEditor | null, tabId: string): void {
  if (!editor) return;
  const alt = editor.getAlternativeVersionId?.() ?? 0;
  useEditorViewStateStore.getState().updateViewState(tabId, { isDirty: false });
  void alt;
}
