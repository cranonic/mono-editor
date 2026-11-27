// Default engine: Mono Editor (canvas).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  createMonoEditor,
  type IMonoEditor,
  monoThemeService,
  registerBuiltinThemes,
} from '@mono/editor';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { useFileLoader } from './hooks/useFileLoader';
import { useEditorViewStateStore } from '@/features/editor/store/editorViewStateStore';
import { useActiveEditorStore } from '@/features/editor/store/activeEditorStore';
import { useTerminalBoot } from '@/features/termis/components/terminal/hooks/useTerminalBoot';
import { useMonoPaletteProviders } from './hooks/useMonoPaletteProviders';
import { useMonoEditorBridge } from './hooks/useMonoEditorBridge';
import { useLspSync } from './hooks/useLspSync';
import { buildMonoEditorOptions } from './mono/monoOptions';
import { usePaletteStore } from '@/store/paletteStore';
import { useTabStore } from '@/store/tabStore';
import { commands } from '@/core/extensionAPI/registry/commandRegistry';
import { monoKeybindingBridge } from '@/core/keybindings/monoKeybindingBridge';
import { Breadcrumbs } from './components/BreadCrumb/Breadcrumbs';
import './CodeEditor.css';

interface CodeEditorProps {
  tabId: string;
  filePath: string;
  tab?: { showBreadcrumb?: boolean; showStatusBar?: boolean };
}

function guessLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
    py: 'python', java: 'java', kt: 'kotlin', rs: 'rust',
    go: 'go', c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
    html: 'html', htm: 'html', css: 'css', scss: 'scss',
    json: 'json', md: 'markdown', xml: 'xml', sh: 'shellscript',
    yaml: 'yaml', yml: 'yaml',
  };
  return map[ext] || 'plaintext';
}

export const CodeEditor: React.FC<CodeEditorProps> = ({ tabId, filePath, tab }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<IMonoEditor | null>(null);
  const [paletteHost, setPaletteHost] = useState<IMonoEditor | null>(null);
  const settings = useSettingsStore((s) => s.settings);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const updateViewState = useEditorViewStateStore((s) => s.updateViewState);
  const { initialContent, isLoading, handleEditorChange } = useFileLoader({ tabId, filePath });

  useTerminalBoot();
  useMonoPaletteProviders(activeTabId === tabId ? paletteHost : null);
  useMonoEditorBridge({
    editor: paletteHost,
    tabId,
    filePath,
    settings: settings as Record<string, unknown>,
    isLoading,
  });
  useLspSync(paletteHost, tabId);

  const language = useMemo(() => guessLanguage(filePath), [filePath]);

  // Keep active editor store synced when tab becomes active
  useEffect(() => {
    if (activeTabId === tabId && editorRef.current) {
      useActiveEditorStore.getState().setActiveEditor(editorRef.current, tabId);
      commands.setActiveEditor?.(editorRef.current as any);
      (window as any).__monoEditor = editorRef.current;
    }
  }, [activeTabId, tabId, paletteHost]);

  // Create / dispose editor
  useEffect(() => {
    const host = hostRef.current;
    if (!host || isLoading) return;

    registerBuiltinThemes();
    const themePartial = monoThemeService.toPartialEditorTheme();
    const monoOpts = buildMonoEditorOptions(
      useSettingsStore.getState().settings as Record<string, unknown>,
    );

    const editor = createMonoEditor(host, {
      ...monoOpts,
      value: initialContent,
      language,
      theme: themePartial,
    });

    editorRef.current = editor;
    setPaletteHost(editor);
    useActiveEditorStore.getState().registerEditor(tabId, editor);
    if (useTabStore.getState().activeTabId === tabId) {
      useActiveEditorStore.getState().setActiveEditor(editor, tabId);
    }
    monoKeybindingBridge.attach(editor);

    // Expose active Mono editor for console/debugging
    const w = window as any;
    w.__monoEditor = editor;
    if (!w.__monoEditors) w.__monoEditors = new Set();
    w.__monoEditors.add(editor);

    // Ctrl+Shift+P from Mono → open app command palette
    const onShowCommands = () => {
      usePaletteStore.setState({ isOpen: true, isQuickPick: false, query: '>' });
    };
    window.addEventListener('mono:showCommands', onShowCommands);

    const onExecuteCommand = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.id) {
        void commands.executeCommand(detail.id, ...(detail.args || []));
      }
    };
    window.addEventListener('mono:executeCommand', onExecuteCommand);

    // 2.2 External Go-to-Line & Go-to-Symbol delegation to Mono Studio's palette
    const subGotoLine = editor.onDidRequestGoToLine?.((ev) => {
      const lineNum = ev?.lineNumber ?? editor.getPosition()?.lineNumber ?? 1;
      usePaletteStore.setState({
        isOpen: true,
        isQuickPick: false,
        query: `:${lineNum}`,
      });
    });

    const subGotoSymbol = editor.onDidRequestGoToSymbol?.(() => {
      usePaletteStore.setState({
        isOpen: true,
        isQuickPick: false,
        query: '@',
      });
    });

    const sub = editor.onDidChangeModelContent((e) => {
      handleEditorChange(e.value);
    });

    const ro = new ResizeObserver(() => {
      editor.layout();
    });
    ro.observe(host);

    if (useTabStore.getState().activeTabId === tabId) {
      editor.focus();
    }

    return () => {
      ro.disconnect();
      sub.dispose();
      subGotoLine?.dispose();
      subGotoSymbol?.dispose();
      useActiveEditorStore.getState().unregisterEditor(tabId, editor);
      const w = window as any;
      if (w.__monoEditor === editor) w.__monoEditor = null;
      w.__monoEditors?.delete(editor);
      window.removeEventListener('mono:showCommands', onShowCommands);
      window.removeEventListener('mono:executeCommand', onExecuteCommand);
      editor.dispose();
      editorRef.current = null;
      setPaletteHost(null);
    };
    // Mount once per tab/file; content/settings applied via other effects
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, filePath, isLoading]);

  // External content load (disk / cache)
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed || isLoading) return;
    if (ed.getValue() !== initialContent) {
      ed.setValue(initialContent);
    }
  }, [initialContent, isLoading]);

  // Language
  useEffect(() => {
    editorRef.current?.setLanguageId(language);
    updateViewState(filePath, { languageId: language });
    updateViewState(tabId, { languageId: language });
  }, [language, filePath, tabId, updateViewState]);

  return (
    <div
      className="ms-code-editor-container"
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        background: 'var(--ms-editor-background, #1e1e1e)',
      }}
      data-engine="mono-editor"
      data-tab-id={tabId}
    >
      <Breadcrumbs
        editor={paletteHost}
        filePath={filePath}
        showBreadcrumb={tab?.showBreadcrumb !== false}
      />
      {isLoading && (
        <div style={{ padding: 20, color: 'var(--ms-text-faded)', fontStyle: 'italic' }}>
          Loading…
        </div>
      )}
      <div ref={hostRef} style={{ flex: 1, minHeight: 0, width: '100%' }} />
    </div>
  );
};
