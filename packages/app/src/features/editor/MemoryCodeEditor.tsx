// In-memory buffer editor powered by Mono Editor (canvas).
import React, { useEffect, useRef } from 'react';
import {
  createMonoEditor,
  monoThemeService,
  registerBuiltinThemes,
  type IMonoEditor,
  type MonoEditorOptions,
} from '@mono/editor';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { buildMonoEditorOptions } from './mono/monoOptions';

export interface MemoryCodeEditorProps {
  value?: string;
  language?: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onEditorMount?: (editor: IMonoEditor) => void;
  instanceId?: string;
  options?: Partial<MonoEditorOptions>;
  [key: string]: any;
}

export const MemoryCodeEditor: React.FC<MemoryCodeEditorProps> = ({
  value = '',
  language = 'plaintext',
  readOnly = false,
  onChange,
  onEditorMount,
  options,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<IMonoEditor | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const settings = useSettingsStore((s) => s.settings);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    registerBuiltinThemes();
    const baseOpts = buildMonoEditorOptions(
      useSettingsStore.getState().settings as Record<string, unknown>,
    );
    const editor = createMonoEditor(host, {
      ...baseOpts,
      ...options,
      value,
      language,
      readOnly,
      theme: monoThemeService.toPartialEditorTheme(),
    });
    editorRef.current = editor;
    onEditorMount?.(editor);
    const sub = editor.onDidChangeModelContent((e) => {
      onChangeRef.current?.(e.value);
    });
    const ro = new ResizeObserver(() => editor.layout());
    ro.observe(host);
    return () => {
      ro.disconnect();
      sub.dispose();
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    ed.updateOptions({
      ...buildMonoEditorOptions(settings as Record<string, unknown>),
      ...options,
      readOnly,
    });
  }, [settings, options, readOnly]);

  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    if (ed.getValue() !== value) ed.setValue(value);
  }, [value]);

  useEffect(() => {
    editorRef.current?.setLanguageId(language);
  }, [language]);

  return (
    <div
      ref={hostRef}
      className="ms-code-editor-container"
      data-engine="mono-editor"
      style={{ height: '100%', width: '100%', minHeight: 120 }}
    />
  );
};
