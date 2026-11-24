import { getActiveMonoEditors, MonoEditor } from '../browser/editor/MonoEditor';
import { EndOfLineSequence } from '../common/core/enums';
import { Uri } from '../common/core/uri';
import { MarkerService } from '../common/decorations/MarkerService';
import type { IMarker, IMarkerData } from '../common/decorations/types';
import { registerDefaultLanguageConfigurations } from '../common/languages/languageConfigurationRegistry';
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

export { getActiveMonoEditors, MonoEditor };

export function createMonoEditor(host: HTMLElement, options?: MonoEditorOptions): IMonoEditor {
  registerBuiltInContributions();
  return new MonoEditor(host, options);
}

export interface IStandaloneTextModel extends IMonoTextModel {
  readonly uri: Uri;
  getEOL(): '\n' | '\r\n';
  setEOL(eol: '\n' | '\r\n' | number): void;
  setLanguage(languageId: string): void;
  onDidChangeContent(listener: (e: MonoContentChangeEvent) => void): MonoDisposable;
  dispose(): void;
}

const standaloneModels = new Map<string, IStandaloneTextModel>();
const modelMarkers = new Map<string, MarkerService>();
const globalMarkerListeners = new Set<(uris: readonly Uri[]) => void>();
let autoModelCounter = 1;

function notifyGlobalMarkers(uri: Uri): void {
  for (const listener of globalMarkerListeners) {
    try { listener([uri]); } catch { /* */ }
  }
}

function isEditorLike(target: unknown): target is IMonoEditor {
  return (
    typeof target === 'object' &&
    target !== null &&
    typeof (target as IMonoEditor).setModelMarkers === 'function'
  );
}

/**
 * Monaco-compatible `editor` namespace facade backed by `@mono/editor`.
 */
export const editor = {
  EndOfLineSequence,

  create(domElement: HTMLElement, options?: MonoEditorOptions): IMonoEditor {
    return createMonoEditor(domElement, options);
  },

  getEditors(): IMonoEditor[] {
    return getActiveMonoEditors();
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
    let altVersion = 1;
    const changeListeners = new Set<(e: MonoContentChangeEvent) => void>();
    const unsubBacking = backing.onDidChange(() => {
      altVersion++;
      if (!changeListeners.size) return;
      let cached: string | undefined;
      const ev: MonoContentChangeEvent = {
        get value(): string {
          return cached ?? (cached = backing.getValue());
        },
      };
      for (const l of changeListeners) {
        try { l(ev); } catch { /* */ }
      }
    });

    const model: IStandaloneTextModel = {
      uri: resolvedUri,
      uriString: key,
      getValue: () => backing.getValue(),
      setValue: (v: string) => { backing.setValue(v); },
      getLineCount: () => backing.getLineCount(),
      getLineContent: (ln: number) => backing.getLineContent(ln),
      getOffsetAt: (pos: IPosition) => backing.getOffsetAt(pos.lineNumber, pos.column),
      getPositionAt: (offset: number) => backing.getPositionAt(offset),
      getVersionId: () => backing.getVersionId(),
      getAlternativeVersionId: () => altVersion,
      getLanguageId: () => backing.getLanguageId(),
      getEOL: () => backing.getEOL(),
      setEOL: (eol: '\n' | '\r\n' | number) => backing.setEOL(eol),
      setLanguage: (languageId: string) => {
        backing.setLanguageId(languageId);
        for (const ed of getActiveMonoEditors()) {
          const m = ed.getModel();
          if (m.uri?.toString() === key || m.uriString === key) {
            ed.setLanguageId(languageId);
          }
        }
      },
      onDidChangeContent: (listener) => {
        changeListeners.add(listener);
        return { dispose: () => changeListeners.delete(listener) };
      },
      dispose: () => {
        unsubBacking();
        changeListeners.clear();
        standaloneModels.delete(key);
        unregisterStandaloneModel(key);
        modelMarkers.delete(key);
      },
    };
    standaloneModels.set(key, model);
    registerBackingTextModel(model, backing, key);
    return model;
  },

  setModelLanguage(model: IMonoTextModel, languageId: string): void {
    const backing = getBackingTextModel(model);
    if (backing) backing.setLanguageId(languageId);
    const key = model.uri?.toString() ?? model.uriString;
    if (key) {
      for (const ed of getActiveMonoEditors()) {
        const m = ed.getModel();
        if (m.uri?.toString() === key || m.uriString === key) {
          ed.setLanguageId(languageId);
        }
      }
    }
  },

  getModels(): IStandaloneTextModel[] {
    return [...standaloneModels.values()];
  },

  getModel(uri: Uri): IStandaloneTextModel | null {
    return standaloneModels.get(uri.toString()) ?? null;
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
      if (m.uri?.toString() === key || m.uriString === key) {
        ed.setModelMarkers(owner, markers);
      }
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
    for (const ed of getActiveMonoEditors()) {
      out.push(...ed.getModelMarkers({ owner: filter?.owner }));
    }
    for (const svc of modelMarkers.values()) {
      out.push(...svc.getModelMarkers({ owner: filter?.owner }));
    }
    return filter?.take != null ? out.slice(0, filter.take) : out;
  },

  onDidChangeMarkers(listener: (resources: readonly Uri[]) => void): MonoDisposable {
    globalMarkerListeners.add(listener);
    return { dispose: () => globalMarkerListeners.delete(listener) };
  },
};
