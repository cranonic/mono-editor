// src/features/statusbar/hooks/useStatusBarSync.ts

import { useEffect } from 'react';
import type { IMonoEditor, IMarker } from '@mono/editor';
import * as monaco from '@/core/mono';

import { useStatusBarStore } from '../store/statusBarStore';
import { useTabStore } from '@/store/tabStore';
import { usePaletteStore } from '@/store/paletteStore';
import { useQuickKeyboardStore } from '@/store/quickKeyboardStore';
import { useEditorViewStateStore } from '@/features/editor/store/editorViewStateStore';
import { useNotificationStore } from '@/store/notificationStore';
import { useProblemsStore } from '@/features/termis/components/problems/store/problemsStore';
import { commands } from '@/core/extensionAPI/registry/commandRegistry';
import { useTermisStore } from '@/features/termis/store/termisStore';

import { handleLanguageClick } from '../items/language';
import { handleEncodingClick, getFileEncodingLabel } from '../items/encoding';
import { handleIndentClick } from '../items/indent';
import { handleEOLClick } from '../items/eol';

function openProblemsPanel() {
  try {
    if (typeof (commands as any).executeCommand === 'function' && commands.hasCommand('termis.open.problems')) {
      void (commands as any).executeCommand('termis.open.problems');
      return;
    }
    useTabStore.getState().addTab({
      id: 'terminal-main',
      type: 'termis',
      title: 'Termis',
      icon: 'terminal',
    } as any);
    useTermisStore.getState().setActiveView('problems');
  } catch (e) {
    console.warn('[statusBar] openProblemsPanel failed', e);
  }
}

function formatCursorLabel(editor: IMonoEditor): string {
  const pos = editor.getPosition?.() ?? { lineNumber: 1, column: 1 };
  const model = editor.getModel?.();
  const selections = editor.getSelections?.() ?? [];

  if (selections.length > 1) {
    let totalSelected = 0;
    if (model?.getValueInRange) {
      for (const s of selections) {
        if (s.startLineNumber !== s.endLineNumber || s.startColumn !== s.endColumn) {
          totalSelected += model.getValueInRange(s).length;
        }
      }
    }
    return totalSelected > 0
      ? `${selections.length} selections (${totalSelected} selected)`
      : `${selections.length} cursors`;
  }

  const sel = editor.getSelection?.();
  let selectedCount = 0;
  if (sel && model?.getValueInRange) {
    const nonEmpty =
      sel.startLineNumber !== sel.endLineNumber || sel.startColumn !== sel.endColumn;
    if (nonEmpty) {
      const startLine = Math.min(sel.startLineNumber, sel.endLineNumber);
      const endLine = Math.max(sel.startLineNumber, sel.endLineNumber);
      const startCol =
        sel.startLineNumber < sel.endLineNumber
          ? sel.startColumn
          : sel.startLineNumber > sel.endLineNumber
            ? sel.endColumn
            : Math.min(sel.startColumn, sel.endColumn);
      const endCol =
        sel.startLineNumber < sel.endLineNumber
          ? sel.endColumn
          : sel.startLineNumber > sel.endLineNumber
            ? sel.startColumn
            : Math.max(sel.startColumn, sel.endColumn);
      selectedCount = model.getValueInRange({
        startLineNumber: startLine,
        startColumn: startCol,
        endLineNumber: endLine,
        endColumn: endCol,
      }).length;
    }
  }

  const base = `Ln ${pos.lineNumber}, Col ${pos.column}`;
  return selectedCount > 0 ? `${base} (${selectedCount} selected)` : base;
}

function collectMarkers(editor: IMonoEditor): IMarker[] {
  const seen = new Set<string>();
  const out: IMarker[] = [];
  const pushAll = (list: readonly IMarker[] | undefined) => {
    if (!list) return;
    for (const m of list) {
      const key = `${m.owner}:${m.startLineNumber}:${m.startColumn}:${m.endLineNumber}:${m.endColumn}:${m.severity}:${m.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(m);
      }
    }
  };
  try {
    pushAll(editor.getModelMarkers?.());
  } catch { /* ignore */ }
  try {
    pushAll(monaco.editor.getModelMarkers({}) as IMarker[]);
  } catch { /* ignore */ }
  return out;
}

export function useStatusBarSync(editor: IMonoEditor | null, activeTabId?: string | null) {
  const { registerItem, updateItem } = useStatusBarStore.getState();

  useEffect(() => {
    registerItem({
      id: 'notif-bell',
      alignment: 'right',
      priority: 1000,
      icon: 'bell',
      onClick: () => useNotificationStore.getState().toggleCenter(),
      style: { background: 'var(--ms-accent)', padding: '0 10px', color: '#ffffff' },
    });

    registerItem({
      id: 'quick-keyboard',
      alignment: 'right',
      priority: 45,
      icon: 'keyboard',
      tooltip: 'Toggle Action Bar',
      onClick: () => useQuickKeyboardStore.getState().toggleVisibility(),
    });

    const editorCondition = "activeTabType == 'code'";

    registerItem({
      id: 'problems-error',
      alignment: 'left',
      priority: 10000,
      icon: 'error',
      label: '0',
      color: '#a44e3c',
      tooltip: 'Show Problems',
      onClick: openProblemsPanel,
      when: editorCondition,
    });
    registerItem({
      id: 'problems-warn',
      alignment: 'left',
      priority: 9990,
      icon: 'warning',
      label: '0',
      color: '#6c5e1f',
      tooltip: 'Show Problems',
      onClick: openProblemsPanel,
      when: editorCondition,
    });
    registerItem({
      id: 'cursor-pos',
      alignment: 'right',
      priority: 100,
      label: 'Ln 1, Col 1',
      tooltip: 'Go to Line/Column',
      when: editorCondition,
    });
    registerItem({
      id: 'indent',
      alignment: 'right',
      priority: 80,
      label: 'Spaces: 4',
      tooltip: 'Select Indentation',
      when: editorCondition,
    });
    registerItem({
      id: 'encoding',
      alignment: 'right',
      priority: 70,
      label: 'UTF-8',
      tooltip: 'Select Encoding',
      when: editorCondition,
    });
    registerItem({
      id: 'eol',
      alignment: 'right',
      priority: 60,
      label: 'LF',
      tooltip: 'Select End of Line Sequence',
      when: editorCondition,
    });
    registerItem({
      id: 'lang-mode',
      alignment: 'right',
      priority: 50,
      label: 'plaintext',
      tooltip: 'Select Language Mode',
      when: editorCondition,
    });
  }, [registerItem]);

  useEffect(() => {
    if (!editor) return;

    const syncData = () => {
      const model = editor.getModel?.();
      const tabId = activeTabId || useTabStore.getState().activeTabId || '';
      if (!model) return;

      const pos = editor.getPosition?.() ?? { lineNumber: 1, column: 1 };
      const opts = model.getOptions?.() ?? { tabSize: 4, insertSpaces: true };
      const langId = editor.getLanguageId?.() || model.getLanguageId?.() || 'plaintext';
      const eol = model.getEOL?.() === '\r\n' ? 'CRLF' : 'LF';

      updateItem('cursor-pos', {
        label: formatCursorLabel(editor),
        onClick: () => {
          const curPos = editor.getPosition?.();
          usePaletteStore.setState({
            isOpen: true,
            isQuickPick: false,
            query: `:${curPos?.lineNumber ?? 1}`,
          });
        },
      });

      updateItem('lang-mode', {
        label: langId,
        onClick: () => handleLanguageClick(editor as any),
      });
      updateItem('eol', {
        label: eol,
        onClick: () => handleEOLClick(editor as any),
      });
      updateItem('indent', {
        label: `${opts.insertSpaces ? 'Spaces' : 'Tab Size'}: ${opts.tabSize}`,
        onClick: () => handleIndentClick(editor as any),
      });
      updateItem('encoding', {
        label: getFileEncodingLabel(tabId),
        onClick: () => handleEncodingClick(editor as any),
      });

      if (tabId) {
        useEditorViewStateStore.getState().updateViewState(tabId, {
          cursorLine: pos.lineNumber,
          cursorColumn: pos.column,
          languageId: langId,
          tabSize: opts.tabSize,
          insertSpaces: opts.insertSpaces,
        });
      }
    };

    const syncMarkers = () => {
      const markers = collectMarkers(editor);
      useProblemsStore.getState().setMarkers(markers as any);
      const errCount = markers.filter((m) => m.severity === monaco.MarkerSeverity.Error).length;
      const warnCount = markers.filter((m) => m.severity === monaco.MarkerSeverity.Warning).length;
      updateItem('problems-error', { label: errCount.toString(), onClick: openProblemsPanel });
      updateItem('problems-warn', { label: warnCount.toString(), onClick: openProblemsPanel });
    };

    const listeners = [
      editor.onDidChangeCursorPosition?.(syncData),
      editor.onDidChangeCursorSelection?.(syncData),
      editor.onDidChangeModelLanguage?.(syncData),
      editor.onDidChangeModel?.(syncData),
      editor.onDidChangeModelOptions?.(syncData),
      editor.onDidChangeConfiguration?.(syncData),
      editor.onDidFocusEditorText?.(syncData),
      editor.onDidChangeMarkers?.(syncMarkers),
      monaco.editor.onDidChangeMarkers?.(syncMarkers),
    ].filter(Boolean);

    syncData();
    syncMarkers();

    return () => {
      for (const l of listeners) {
        try {
          l?.dispose();
        } catch { /* ignore */ }
      }
    };
  }, [editor, activeTabId, updateItem]);
}
