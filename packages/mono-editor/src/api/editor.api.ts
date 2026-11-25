import {
  createMonoDiffNavigator,
  MonoDiffEditor,
  onDidCreateMonoDiffEditor,
  type DiffUpdateEvent,
  type IDiffEditorModel,
  type IDiffEditorModelChangedEvent,
  type IDiffEditorViewState,
  type IDiffNavigator,
  type IDiffNavigatorOptions,
  type IHideUnchangedRegionsOptions,
  type IMonoDiffEditor,
  type MonoDiffEditorOptions,
} from '../browser/diff/MonoDiffEditor';
import { getActiveMonoEditors, MonoEditor } from '../browser/editor/MonoEditor';
import {
  onDidCreateMonoEditor,
  registerMonoEditorOpener,
  type ICodeEditorOpener,
} from '../browser/editor/editorViewFacade';
import {
  ContentWidgetPositionPreference,
  EndOfLineSequence,
  MouseTargetType,
  OverlayWidgetPositionPreference,
  ScrollType,
  TrackedRangeStickiness,
} from '../common/core/enums';
import type {
  ICursorStateComputer,
  IIdentifiedSingleEditOperation,
  IModelDecorationsChangedEvent,
  IModelLanguageChangedEvent,
  IModelOptionsChangedEvent,
  IRange,
  ISelection,
} from '../common/core/types';
import { Uri } from '../common/core/uri';
import { DecorationsCollection } from '../common/decorations/DecorationsCollection';
import { MarkerService } from '../common/decorations/MarkerService';
import type { IMarker, IMarkerData, IModelDecoration, IModelDeltaDecoration } from '../common/decorations/types';
import { registerDefaultLanguages } from '../common/languages/defaults/registerDefaults';
import { registerDefaultLanguageConfigurations } from '../common/languages/languageConfigurationRegistry';
import { TokenizationSupport } from '../common/languages/tokenization/TokenizationSupport';
import type { MonoToken } from '../common/languages/tokenization/tokenTypes';
import { DEFAULT_TOKEN_COLORS } from '../common/languages/tokenization/tokenTypes';
import { TextModel } from '../common/model/TextModel';
import {
  getBackingTextModel,
  registerBackingTextModel,
  unregisterStandaloneModel,
} from '../common/model/modelRegistry';
import { registerBuiltInContributions } from '../contrib';
import { monoThemeService, registerBuiltinThemes, type MonoStandaloneThemeData } from '../platform/theme';
import type {
  IMonoEditor,
  IMonoTextModel,
  IPosition,
  MonoContentChangeEvent,
  MonoDisposable,
  MonoEditorOptions,
} from './types';

// Ensure all built-in contributions are registered before any MonoEditor is instantiated.
registerBuiltInContributions();

export { createMonoDiffNavigator, getActiveMonoEditors, MonoDiffEditor, MonoEditor, onDidCreateMonoDiffEditor };
export type {
  DiffUpdateEvent,
  ICodeEditorOpener,
  IDiffEditorModel,
  IDiffEditorModelChangedEvent,
  IDiffEditorViewState,
  IDiffNavigator,
  IDiffNavigatorOptions,
  IHideUnchangedRegionsOptions,
  IMonoDiffEditor,
  MonoDiffEditorOptions,
};

export function createMonoEditor(host: HTMLElement, options?: MonoEditorOptions): IMonoEditor {
  registerBuiltInContributions();
  return new MonoEditor(host, options);
}

export interface IStandaloneTextModel extends IMonoTextModel {
  readonly uri: Uri;
  getEOL(): '\n' | '\r\n';
  setEOL(eol: '\n' | '\r\n' | number): void;
  setLanguage(languageId: string): void;
  deltaDecorations(oldDecorations: string[], newDecorations: IModelDeltaDecoration[]): string[];
  getDecorationsInRange(range: IRange): IModelDecoration[];
  getAllDecorations(): IModelDecoration[];
  onDidChangeContent(listener: (e: MonoContentChangeEvent) => void): MonoDisposable;
  onDidChangeLanguage(listener: (e: IModelLanguageChangedEvent) => void): MonoDisposable;
  onDidChangeOptions(listener: (e: IModelOptionsChangedEvent) => void): MonoDisposable;
  onDidChangeDecorations(listener: (e: IModelDecorationsChangedEvent) => void): MonoDisposable;
  onWillDispose(listener: () => void): MonoDisposable;
  dispose(): void;
}

const standaloneModels = new Map<string, IStandaloneTextModel>();
const modelMarkers = new Map<string, MarkerService>();
const globalMarkerListeners = new Set<(uris: readonly Uri[]) => void>();
const createModelListeners = new Set<(model: IStandaloneTextModel) => void>();
const willDisposeModelListeners = new Set<(model: IStandaloneTextModel) => void>();
const changeModelLanguageListeners = new Set<(e: { model: IMonoTextModel; oldLanguage: string }) => void>();
let autoModelCounter = 1;

function notifyGlobalMarkers(uri: Uri): void {
  for (const listener of globalMarkerListeners) {
    try { listener([uri]); } catch { /* */ }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isEditorLike(target: unknown): target is IMonoEditor {
  return typeof target === 'object' && target !== null && typeof (target as IMonoEditor).setModelMarkers === 'function';
}

/**
 * Monaco-compatible `editor` namespace facade backed by `@mono/editor`.
 */
export const editor = {
  EndOfLineSequence,
  TrackedRangeStickiness,
  ScrollType,
  MouseTargetType,
  ContentWidgetPositionPreference,
  OverlayWidgetPositionPreference,

  create(domElement: HTMLElement, options?: MonoEditorOptions): IMonoEditor {
    return createMonoEditor(domElement, options);
  },

  createDiffEditor(domElement: HTMLElement, options?: MonoDiffEditorOptions): IMonoDiffEditor {
    return new MonoDiffEditor(domElement, options);
  },

  createDiffNavigator(diffEditor: IMonoDiffEditor, opts?: IDiffNavigatorOptions): IDiffNavigator {
    return createMonoDiffNavigator(diffEditor, opts);
  },

  getEditors(): IMonoEditor[] {
    return getActiveMonoEditors();
  },

  onDidCreateEditor(listener: (editor: IMonoEditor) => void): MonoDisposable {
    return onDidCreateMonoEditor(listener);
  },

  onDidCreateDiffEditor(listener: (diffEditor: IMonoDiffEditor) => void): MonoDisposable {
    return onDidCreateMonoDiffEditor(listener);
  },

  registerEditorOpener(opener: ICodeEditorOpener): MonoDisposable {
    return registerMonoEditorOpener(opener);
  },

  defineTheme(themeName: string, themeData: MonoStandaloneThemeData): void {
    registerBuiltinThemes();
    monoThemeService.defineTheme(themeName, themeData);
  },

  setTheme(themeName: string): void {
    registerBuiltinThemes();
    monoThemeService.setTheme(themeName);
  },

  createModel(value: string, language?: string, uri?: Uri): IStandaloneTextModel {
    registerDefaultLanguageConfigurations();
    const resolvedUri = uri ?? Uri.parse(`inmemory://model/${autoModelCounter++}`);
    const key = resolvedUri.toString();
    const backing = new TextModel(value, language ?? 'plaintext');
    const decs = new DecorationsCollection();
    let altVersion = 1;
    let disposed = false;

    const changeListeners = new Set<(e: MonoContentChangeEvent) => void>();
    const langListeners = new Set<(e: IModelLanguageChangedEvent) => void>();
    const optListeners = new Set<(e: IModelOptionsChangedEvent) => void>();
    const decListeners = new Set<(e: IModelDecorationsChangedEvent) => void>();
    const willDisposeListeners = new Set<() => void>();

    const unsubBacking = backing.onDidChange((_v, change) => {
      altVersion++;
      if (!changeListeners.size) return;
      let cached: string | undefined;
      const ev: MonoContentChangeEvent = {
        changes: change?.changes ?? [],
        eol: backing.getEOL(),
        versionId: backing.getVersionId(),
        isUndoing: Boolean(change?.isUndoing),
        isRedoing: Boolean(change?.isRedoing),
        isFlush: Boolean(change?.isFlush),
        get value(): string { return cached ?? (cached = backing.getValue()); },
      };
      for (const l of changeListeners) {
        try { l(ev); } catch { /* */ }
      }
    });
    const unsubLang = backing.onDidChangeLanguage((ev) => {
      for (const l of langListeners) { try { l(ev); } catch { /* */ } }
    });
    const unsubOpts = backing.onDidChangeOptions((ev) => {
      for (const l of optListeners) { try { l(ev); } catch { /* */ } }
    });
    const unsubDecs = decs.onDidChange(() => {
      for (const l of decListeners) { try { l({}); } catch { /* */ } }
    });

    const model: IStandaloneTextModel = {
      uri: resolvedUri,
      uriString: key,
      getValue: () => backing.getValue(),
      setValue: (v: string) => { backing.setValue(v); },
      getValueInRange: (r: IRange) => backing.getValueInRange(r),
      getLineCount: () => backing.getLineCount(),
      getLineContent: (ln: number) => backing.getLineContent(ln),
      getLineLength: (ln: number) => backing.getLineLength(ln),
      getLineMinColumn: (ln: number) => backing.getLineMinColumn(ln),
      getLineMaxColumn: (ln: number) => backing.getLineMaxColumn(ln),
      getLineFirstNonWhitespaceColumn: (ln: number) => backing.getLineFirstNonWhitespaceColumn(ln),
      getLineLastNonWhitespaceColumn: (ln: number) => backing.getLineLastNonWhitespaceColumn(ln),
      getLinesContent: () => backing.getLinesContent(),
      getFullModelRange: () => backing.getFullModelRange(),
      getOffsetAt: (pos: IPosition) => backing.getOffsetAt(pos.lineNumber, pos.column),
      getPositionAt: (offset: number) => backing.getPositionAt(offset),
      validatePosition: (pos: IPosition) => backing.validatePosition(pos),
      validateRange: (range: IRange) => backing.validateRange(range),
      modifyPosition: (pos: IPosition, offset: number) => backing.modifyPosition(pos, offset),
      getWordAtPosition: (pos: IPosition) => backing.getWordAtPosition(pos),
      getWordUntilPosition: (pos: IPosition) => backing.getWordUntilPosition(pos),
      findMatches: (s, r, re, mc, ws, cm, lim) => backing.findMatches(s, r, re, mc, ws, cm, lim),
      findNextMatch: (s, st, re, mc, ws, cm) => backing.findNextMatch(s, st, re, mc, ws, cm),
      findPreviousMatch: (s, st, re, mc, ws, cm) => backing.findPreviousMatch(s, st, re, mc, ws, cm),
      getVersionId: () => backing.getVersionId(),
      getAlternativeVersionId: () => altVersion,
      getLanguageId: () => backing.getLanguageId(),
      getEOL: () => backing.getEOL(),
      setEOL: (eol: '\n' | '\r\n' | number) => backing.setEOL(eol),
      getOptions: () => backing.getOptions(),
      updateOptions: (opts) => backing.updateOptions(opts),
      detectIndentation: (sp, ts) => backing.detectIndentation(sp, ts),
      pushStackElement: () => backing.pushStackElement(),
      applyEdits: (ops: readonly IIdentifiedSingleEditOperation[]) => { backing.applyEdits(ops); },
      pushEditOperations: (before: ISelection[] | null, ops: readonly IIdentifiedSingleEditOperation[], computer?: ICursorStateComputer) => {
        const inv = backing.applyEdits(ops);
        return computer ? computer(inv) : before;
      },
      deltaDecorations: (oldIds, newDecs) => decs.deltaDecorations(oldIds, newDecs),
      getDecorationsInRange: (range) => decs.getInRange(range),
      getAllDecorations: () => decs.getAll(),
      isDisposed: () => disposed,
      isAttachedToEditor: () =>
        getActiveMonoEditors().some((ed) => {
          const m = ed.getModel();
          return m.uri?.toString() === key || m.uriString === key;
        }),
      setLanguage: (languageId: string) => {
        const oldLanguage = backing.getLanguageId();
        backing.setLanguageId(languageId);
        for (const ed of getActiveMonoEditors()) {
          const m = ed.getModel();
          if (m.uri?.toString() === key || m.uriString === key) ed.setLanguageId(languageId);
        }
        if (oldLanguage !== languageId) {
          for (const l of changeModelLanguageListeners) { try { l({ model, oldLanguage }); } catch { /* */ } }
        }
      },
      onDidChangeContent: (listener) => {
        changeListeners.add(listener);
        return { dispose: () => changeListeners.delete(listener) };
      },
      onDidChangeLanguage: (listener) => {
        langListeners.add(listener);
        return { dispose: () => langListeners.delete(listener) };
      },
      onDidChangeOptions: (listener) => {
        optListeners.add(listener);
        return { dispose: () => optListeners.delete(listener) };
      },
      onDidChangeDecorations: (listener) => {
        decListeners.add(listener);
        return { dispose: () => decListeners.delete(listener) };
      },
      onWillDispose: (listener) => {
        willDisposeListeners.add(listener);
        return { dispose: () => willDisposeListeners.delete(listener) };
      },
      dispose: () => {
        if (disposed) return;
        for (const l of willDisposeListeners) { try { l(); } catch { /* */ } }
        for (const l of willDisposeModelListeners) { try { l(model); } catch { /* */ } }
        disposed = true;
        unsubBacking(); unsubLang(); unsubOpts(); unsubDecs.dispose();
        changeListeners.clear(); langListeners.clear(); optListeners.clear();
        decListeners.clear(); willDisposeListeners.clear();
        standaloneModels.delete(key);
        unregisterStandaloneModel(key);
        modelMarkers.delete(key);
      },
    };
    standaloneModels.set(key, model);
    registerBackingTextModel(model, backing, key);
    for (const l of createModelListeners) { try { l(model); } catch { /* */ } }
    return model;
  },

  onDidCreateModel(listener: (model: IStandaloneTextModel) => void): MonoDisposable {
    createModelListeners.add(listener);
    return { dispose: () => createModelListeners.delete(listener) };
  },

  onWillDisposeModel(listener: (model: IStandaloneTextModel) => void): MonoDisposable {
    willDisposeModelListeners.add(listener);
    return { dispose: () => willDisposeModelListeners.delete(listener) };
  },

  onDidChangeModelLanguage(listener: (e: { model: IMonoTextModel; oldLanguage: string }) => void): MonoDisposable {
    changeModelLanguageListeners.add(listener);
    return { dispose: () => changeModelLanguageListeners.delete(listener) };
  },

  setModelLanguage(model: IMonoTextModel, languageId: string): void {
    const oldLanguage = model.getLanguageId();
    const backing = getBackingTextModel(model);
    if (backing) backing.setLanguageId(languageId);
    const key = model.uri?.toString() ?? model.uriString;
    if (key) {
      for (const ed of getActiveMonoEditors()) {
        const m = ed.getModel();
        if (m.uri?.toString() === key || m.uriString === key) ed.setLanguageId(languageId);
      }
    }
    if (oldLanguage !== languageId) {
      for (const l of changeModelLanguageListeners) { try { l({ model, oldLanguage }); } catch { /* */ } }
    }
  },

  getModels(): IStandaloneTextModel[] {
    return [...standaloneModels.values()];
  },

  getModel(uri: Uri): IStandaloneTextModel | null {
    return standaloneModels.get(uri.toString()) ?? null;
  },

  tokenize(text: string, languageId: string): MonoToken[][] {
    registerDefaultLanguages();
    const m = new TextModel(text, languageId);
    const support = new TokenizationSupport();
    const out: MonoToken[][] = [];
    for (let ln = 1; ln <= m.getLineCount(); ln++) {
      out.push(support.getLineTokens(m, ln));
    }
    return out;
  },

  async colorize(text: string, languageId: string): Promise<string> {
    registerBuiltinThemes();
    const lines = text.split(/\r\n|\n/);
    const tokenLines = editor.tokenize(text, languageId);
    const partial = monoThemeService.toPartialEditorTheme();
    const colors = { ...DEFAULT_TOKEN_COLORS, ...partial.tokenColors };
    return lines
      .map((line, i) => {
        const tokens = tokenLines[i] ?? [];
        if (!tokens.length) return escapeHtml(line);
        let html = '';
        let pos = 0;
        for (const tok of tokens) {
          const s = Math.max(pos, tok.startColumn - 1);
          const e = Math.min(line.length, tok.endColumn - 1);
          if (s > pos) html += escapeHtml(line.slice(pos, s));
          if (e > s) {
            const c = colors[tok.type as keyof typeof colors];
            const chunk = escapeHtml(line.slice(s, e));
            html += c ? `<span style="color:${c}">${chunk}</span>` : chunk;
          }
          pos = Math.max(pos, e);
        }
        if (pos < line.length) html += escapeHtml(line.slice(pos));
        return html;
      })
      .join('<br/>');
  },

  async colorizeElement(domNode: HTMLElement, options?: { mimeType?: string; tabSize?: number }): Promise<void> {
    registerBuiltinThemes();
    const text = domNode.textContent ?? '';
    const langId = options?.mimeType ?? domNode.getAttribute('data-lang') ?? 'plaintext';
    const lines = text.split(/\r\n|\n/);
    const tokenLines = editor.tokenize(text, langId);
    const partial = monoThemeService.toPartialEditorTheme();
    const colors = { ...DEFAULT_TOKEN_COLORS, ...partial.tokenColors };
    const frag = document.createDocumentFragment();
    lines.forEach((line, i) => {
      const tokens = tokenLines[i] ?? [];
      let pos = 0;
      for (const tok of tokens) {
        const s = Math.max(pos, tok.startColumn - 1);
        const e = Math.min(line.length, tok.endColumn - 1);
        if (s > pos) frag.appendChild(document.createTextNode(line.slice(pos, s)));
        if (e > s) {
          const span = document.createElement('span');
          const c = colors[tok.type as keyof typeof colors];
          if (c) span.style.color = c;
          span.textContent = line.slice(s, e);
          frag.appendChild(span);
        }
        pos = Math.max(pos, e);
      }
      if (pos < line.length) frag.appendChild(document.createTextNode(line.slice(pos)));
      if (i < lines.length - 1) frag.appendChild(document.createElement('br'));
    });
    domNode.replaceChildren(frag);
  },

  setModelMarkers(
    modelOrEditor: IMonoTextModel | IMonoEditor,
    owner: string,
    markers: IMarkerData[],
  ): void {
    if (isEditorLike(modelOrEditor)) {
      modelOrEditor.setModelMarkers(owner, markers);
      notifyGlobalMarkers(Uri.parse('inmemory://editor/active'));
      return;
    }
    const key = modelOrEditor.uri?.toString() ?? modelOrEditor.uriString ?? 'inmemory://model/default';
    let svc = modelMarkers.get(key);
    if (!svc) {
      svc = new MarkerService();
      modelMarkers.set(key, svc);
    }
    svc.setModelMarkers(owner, markers);

    for (const ed of getActiveMonoEditors()) {
      const m = ed.getModel();
      if (m.uri?.toString() === key || m.uriString === key) ed.setModelMarkers(owner, markers);
    }
    notifyGlobalMarkers(Uri.parse(key));
  },

  getModelMarkers(filter?: { owner?: string; resource?: Uri; take?: number }): IMarker[] {
    const out: IMarker[] = [];
    if (filter?.resource) {
      const svc = modelMarkers.get(filter.resource.toString());
      if (svc) out.push(...svc.getModelMarkers({ owner: filter.owner, take: filter.take }));
      return out;
    }
    for (const ed of getActiveMonoEditors()) out.push(...ed.getModelMarkers({ owner: filter?.owner }));
    for (const svc of modelMarkers.values()) out.push(...svc.getModelMarkers({ owner: filter?.owner }));
    return filter?.take != null ? out.slice(0, filter.take) : out;
  },

  onDidChangeMarkers(listener: (resources: readonly Uri[]) => void): MonoDisposable {
    globalMarkerListeners.add(listener);
    return { dispose: () => globalMarkerListeners.delete(listener) };
  },
};
