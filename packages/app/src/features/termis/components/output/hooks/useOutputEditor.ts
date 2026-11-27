// src/features/termis/components/output/hooks/useOutputEditor.ts
// Read-only output log viewer powered by Mono Editor (@mono/editor).

import { useEffect, useRef } from 'react';
import {
  createMonoEditor,
  createRegexTokensProvider,
  editor as monoEditorApi,
  languages as monoLanguages,
  monoThemeService,
  registerBuiltinThemes,
  type IMonoEditor,
} from '@mono/editor';
import { useOutputStore, getOrCreateModel } from '../store/outputStore';

let logLanguageRegistered = false;

const setupLogLanguage = (): void => {
  if (logLanguageRegistered) return;
  logLanguageRegistered = true;

  if (!monoLanguages.getLanguages().some((l) => l.id === 'log')) {
    monoLanguages.register({ id: 'log' });
  }

  monoLanguages.registerTokensProvider(
    createRegexTokensProvider({
      languageId: 'log',
      rules: [
        { pattern: /\[?\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}(\.\d{3}Z?)?\]?/, type: 'comment' },
        { pattern: /\[\d{2}:\d{2}:\d{2}\]/, type: 'comment' },
        { pattern: /\[?(ERROR|ERR|FAIL|FATAL)\]?/i, type: 'keyword' },
        { pattern: /\[?(WARNING|WARN)\]?/i, type: 'type' },
        { pattern: /\[?(INFO|NOTICE|Running|Done)\]?/i, type: 'function' },
        { pattern: /\[?(DEBUG|TRACE)\]?/i, type: 'comment' },
        { pattern: /(https?|ws|file):\/\/[^\s]+/, type: 'string' },
        { pattern: /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/, type: 'string' },
        { pattern: /\b\d+(\.\d+)?\b/, type: 'number' },
        { pattern: /\b(true|false|null|undefined|success|ok)\b/i, type: 'keyword' },
      ],
    }),
  );
};

export function useOutputEditor(containerRef: React.RefObject<HTMLDivElement | null>) {
  const editorRef = useRef<IMonoEditor | null>(null);
  const autoScrollRef = useRef(true);
  const activeChannel = useOutputStore((s) => s.activeChannel);

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;

    registerBuiltinThemes();
    setupLogLanguage();

    const model = getOrCreateModel(activeChannel);
    const editor = createMonoEditor(host, {
      model,
      readOnly: true,
      language: 'log',
      theme: monoThemeService.toPartialEditorTheme(),
      lineNumbers: 'off',
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      folding: false,
      renderLineHighlight: 'none',
      fontSize: 12,
      fontFamily: "'Fira Code', 'Cascadia Code', Consolas, monospace",
      links: true,
      scrollbar: {
        vertical: 'visible',
        horizontal: 'hidden',
      },
    });

    editorRef.current = editor;

    const scrollDisposable = editor.onDidScrollChange((e) => {
      const totalHeight = editor.getScrollHeight();
      const visibleBot = e.scrollTop + editor.getLayoutInfo().height;
      autoScrollRef.current = totalHeight - visibleBot < 50;
    });

    const ro = new ResizeObserver(() => editor.layout());
    ro.observe(host);

    return () => {
      ro.disconnect();
      scrollDisposable.dispose();
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = getOrCreateModel(activeChannel);
    editor.setModel(model);
    if (autoScrollRef.current) {
      editor.revealLine(model.getLineCount());
    }
  }, [activeChannel]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = getOrCreateModel(activeChannel);
    const disposable = model.onDidChangeContent(() => {
      if (!autoScrollRef.current) return;
      setTimeout(() => {
        editor.revealLine(model.getLineCount());
      }, 0);
    });
    return () => disposable.dispose();
  }, [activeChannel]);

  void monoEditorApi;
  return { editorRef, autoScrollRef };
}
