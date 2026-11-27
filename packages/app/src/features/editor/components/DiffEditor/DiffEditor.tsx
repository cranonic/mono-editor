// src/features/editor/components/DiffEditor/DiffEditor.tsx
// Native MonoDiffEditor (@mono/editor) — replaces legacy Monaco DiffEditor & custom menus.

import React, { useEffect, useRef, useState } from 'react';
import {
  editor as monoEditorApi,
  monoThemeService,
  registerBuiltinThemes,
  Uri,
  type IMonoDiffEditor,
  type IStandaloneTextModel,
} from '@mono/editor';

import { useTabStore } from '@/store/tabStore';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { useThemeStore } from '@/core/theme/store/themeStore';
import { useEditorViewStateStore } from '@/features/editor/store/editorViewStateStore';
import { buildMonoEditorOptions } from '../../mono/monoOptions';
import { fs } from '@/core/fileSystem';
import '../../CodeEditor.css';

export interface DiffEditorProps {
  tabId: string;
}

function guessDiffLanguage(filePath: string): string {
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

export const DiffEditor: React.FC<DiffEditorProps> = ({ tabId }) => {
  const tab = useTabStore((s) => s.tabs.find((t) => t.id === tabId));
  const diffData = tab?.diffData;

  const [originalContent, setOriginalContent] = useState('');
  const [modifiedContent, setModifiedContent] = useState('');
  const [language, setLanguage] = useState('plaintext');
  const [isReady, setIsReady] = useState(false);

  const settings = useSettingsStore((s) => s.settings);
  const activeThemeId = useThemeStore((s) => s.activeThemeId);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const diffEditorRef = useRef<IMonoDiffEditor | null>(null);
  const modelsRef = useRef<{ orig: IStandaloneTextModel; mod: IStandaloneTextModel } | null>(null);

  // Load original & modified file content
  useEffect(() => {
    if (!diffData) return;
    const { originalContent: orig, modifiedContent: mod, filePath } = diffData;
    setLanguage(guessDiffLanguage(filePath));
    setOriginalContent((orig || '').replace(/\r\n/g, '\n'));

    const loadModified = async () => {
      if (mod !== null) {
        setModifiedContent(mod.replace(/\r\n/g, '\n'));
        setIsReady(true);
      } else if (filePath) {
        try {
          const raw = await fs.readFile(filePath);
          const rawStr =
            typeof raw === 'string'
              ? raw
              : raw && (raw as any).byteLength
                ? new TextDecoder().decode(raw as any)
                : raw && 'data' in raw
                  ? String((raw as any).data)
                  : String(raw);
          setModifiedContent(rawStr.replace(/\r\n/g, '\n'));
        } catch (err) {
          console.error('[DiffEditor] Failed to read local file:', err);
          setModifiedContent('');
        }
        setIsReady(true);
      }
    };
    void loadModified();
  }, [diffData]);

  // Mount MonoDiffEditor
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !isReady || !diffData) return;

    registerBuiltinThemes();
    const baseOpts = buildMonoEditorOptions(
      useSettingsStore.getState().settings as Record<string, unknown>,
    );

    const diffEditor = monoEditorApi.createDiffEditor(host, {
      ...baseOpts,
      readOnly: Boolean(diffData.readOnly),
      originalEditable: false,
      renderSideBySide: window.innerWidth > 768,
      ignoreTrimWhitespace: true,
      theme: monoThemeService.toPartialEditorTheme(),
    });
    diffEditorRef.current = diffEditor;

    const safeKey = diffData.filePath.replace(/[^a-zA-Z0-9._-]/g, '_');
    const origUri = Uri.parse(`inmemory://git-orig/${tabId}/${safeKey}`);
    const modUri = Uri.parse(`inmemory://git-mod/${tabId}/${safeKey}`);

    const origModel = monoEditorApi.createModel(originalContent, language, origUri);
    const modModel = monoEditorApi.createModel(modifiedContent, language, modUri);
    modelsRef.current = { orig: origModel, mod: modModel };

    diffEditor.setModel({ original: origModel, modified: modModel });

    const modifiedEditor = diffEditor.getModifiedEditor();
    const disposables: Array<{ dispose(): void }> = [];

    if (typeof modifiedEditor.addAction === 'function') {
      disposables.push(
        modifiedEditor.addAction({
          id: 'editor.action.save',
          label: 'Save File',
          keybindings: ['ctrl+s', 'meta+s'],
          run: async () => {
            if (diffData.modifiedContent === null && diffData.filePath) {
              const currentVal = modifiedEditor.getValue();
              await fs.writeFile(diffData.filePath, currentVal);
              useEditorViewStateStore.getState().setTabDirty(diffData.filePath, false);
              import('@/features/git/store/gitStore').then(({ useGitStore }) => {
                useGitStore.getState().refresh();
              });
            }
          },
        }),
      );
    }

    if (diffData.modifiedContent === null && diffData.filePath) {
      disposables.push(
        modifiedEditor.onDidChangeModelContent(() => {
          useEditorViewStateStore.getState().setTabDirty(diffData.filePath, true);
        }),
      );
    }

    const ro = new ResizeObserver(() => diffEditor.layout());
    ro.observe(host);

    return () => {
      ro.disconnect();
      disposables.forEach((d) => d.dispose());
      try {
        diffEditor.dispose();
      } catch {
        /* ignore */
      }
      try {
        origModel.dispose();
        modModel.dispose();
      } catch {
        /* ignore */
      }
      diffEditorRef.current = null;
      modelsRef.current = null;
    };
  }, [isReady, diffData, tabId, language, originalContent, modifiedContent]);

  // Live settings & theme updates
  useEffect(() => {
    const de = diffEditorRef.current;
    if (!de) return;
    const baseOpts = buildMonoEditorOptions(settings as Record<string, unknown>);
    de.updateOptions({
      ...baseOpts,
      readOnly: Boolean(diffData?.readOnly),
      originalEditable: false,
      theme: monoThemeService.toPartialEditorTheme(),
    });
  }, [settings, activeThemeId, diffData?.readOnly]);

  if (!isReady || !diffData) return null;

  return (
    <div
      className="ms-code-editor-container"
      data-engine="mono-diff-editor"
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        background: 'var(--ms-editor-background, #1e1e1e)',
      }}
    >
      <div ref={hostRef} style={{ flex: 1, minHeight: 0, width: '100%' }} />
    </div>
  );
};