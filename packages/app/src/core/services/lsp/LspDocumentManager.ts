// src/core/services/lsp/LspDocumentManager.ts

import * as monaco from '@/core/mono';
import type { LspState } from './types';
import { sendNotify, isTransportOpen } from './LspTransport';
import { toLspUri, getDocUri, getModelKey } from './utils/uriHelpers';
import { isTsJsFamily } from './providers';

/** Delay before pushing a full-text didChange after the user stops typing. */
const DID_CHANGE_DEBOUNCE_MS = 220;

/**
 * Associates an in-memory Mono/Monaco TextModel instance with a concrete filesystem URI address.
 */
export function registerModelUri(
  state: LspState,
  model: monaco.editor.ITextModel,
  realFileUri: string,
): void {
  const key = getModelKey(model);
  const lspUri = toLspUri(realFileUri);
  state.modelUriMap.set(key, lspUri);
  console.log(`[LSP] Workspace URI association established: ${key} → ${lspUri}`);
}

/**
 * Detach content listener + clear pending debounce for a model key.
 */
function detachContentListener(state: LspState, modelKey: string): void {
  const timer = state.changeDebounceTimers.get(modelKey);
  if (timer != null) {
    clearTimeout(timer);
    state.changeDebounceTimers.delete(modelKey);
  }
  const sub = state.contentListeners.get(modelKey);
  if (sub) {
    try { sub.dispose(); } catch { /* ignore */ }
    state.contentListeners.delete(modelKey);
  }
}

/**
 * Push full document text as textDocument/didChange (Full sync).
 */
export function sendFullDocumentChange(
  state: LspState,
  model: monaco.editor.ITextModel,
): void {
  if (!state.initialized) return;
  if (!isTransportOpen(state)) return;

  const uri = getDocUri(model, state);
  if (!state.openedUris.has(uri)) return;

  sendNotify(state, 'textDocument/didChange', {
    textDocument: { uri, version: model.getVersionId?.() ?? 1 },
    contentChanges: [{ text: model.getValue() }],
  });
}

/**
 * Subscribe to content changes on either a model directly or its owning MonoEditor.
 */
function subscribeModelContentChange(
  model: monaco.editor.ITextModel,
  listener: () => void,
): monaco.IDisposable | null {
  if (typeof (model as any).onDidChangeContent === 'function') {
    return (model as any).onDidChangeContent(listener);
  }

  // Fallback for raw MonoEditor text models: bind via the owning MonoEditor instance
  try {
    const editors = monaco.editor.getEditors();
    const owner = editors.find((ed: any) => ed?.getModel?.() === model);
    if (owner && typeof owner.onDidChangeModelContent === 'function') {
      return owner.onDidChangeModelContent(listener);
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Attach a debounced content-change listener so diagnostics / inlay hints
 * refresh while typing. Safe to call multiple times — reuses existing subscription.
 */
export function attachContentListener(
  state: LspState,
  model: monaco.editor.ITextModel,
): void {
  const key = getModelKey(model);
  if (state.contentListeners.has(key)) return;
  if (!isCompatibleLanguage(state, model.getLanguageId())) return;

  const sub = subscribeModelContentChange(model, () => {
    if (!state.initialized) return;

    const prev = state.changeDebounceTimers.get(key);
    if (prev != null) clearTimeout(prev);

    const handle = setTimeout(() => {
      state.changeDebounceTimers.delete(key);
      sendFullDocumentChange(state, model);
    }, DID_CHANGE_DEBOUNCE_MS);

    state.changeDebounceTimers.set(key, handle);
  });

  if (sub) {
    state.contentListeners.set(key, sub);
  }
}

/**
 * Tears down document context maps upon tab deletion or model disposal.
 * Sends textDocument/didClose and removes the content listener.
 */
export function unregisterModelUri(
  state: LspState,
  model: monaco.editor.ITextModel,
): void {
  const key = getModelKey(model);
  detachContentListener(state, key);

  const uri = state.modelUriMap.get(key);
  if (!uri) return;

  if (state.openedUris.has(uri)) {
    sendNotify(state, 'textDocument/didClose', { textDocument: { uri } });
    console.log(`[LSP] Dispatched explicit didClose signal for: ${uri}`);
  }

  state.openedUris.delete(uri);
  state.modelUriMap.delete(key);
}

/**
 * True when the model language is compatible with the connected server language.
 * TS/JS family members all share one TypeScript language server.
 */
function isCompatibleLanguage(state: LspState, modelLang: string): boolean {
  if (modelLang === state.languageId) return true;
  if (isTsJsFamily(state.languageId) && isTsJsFamily(modelLang)) return true;
  return false;
}

/**
 * Signals language server when switching tabs or opening a fresh file.
 * Also installs the live typing → didChange bridge.
 */
export function notifyDocumentOpen(
  state: LspState,
  model: monaco.editor.ITextModel,
): void {
  if (!state.initialized) return;

  const modelLang = model.getLanguageId();
  if (!isCompatibleLanguage(state, modelLang)) return;

  const uri = getDocUri(model, state);

  // Always keep a live content listener while the doc is open on this server
  attachContentListener(state, model);

  if (state.openedUris.has(uri)) {
    sendFullDocumentChange(state, model);
    console.log(`[LSP] Document stream sync updated via didChange: ${uri}`);
    return;
  }

  sendNotify(state, 'textDocument/didOpen', {
    textDocument: {
      uri,
      languageId: modelLang,
      version: model.getVersionId?.() ?? 1,
      text: model.getValue(),
    },
  });

  state.openedUris.add(uri);
  console.log(`[LSP] Document stream tracking initialized via didOpen: ${uri} (${modelLang})`);
}

/**
 * Collect all unique active models from both `editor.getModels()` and `editor.getEditors()`.
 */
export function collectActiveModels(): monaco.editor.ITextModel[] {
  const byKey = new Map<string, monaco.editor.ITextModel>();
  for (const m of monaco.editor.getModels()) {
    if (m) byKey.set(getModelKey(m), m);
  }
  for (const ed of monaco.editor.getEditors()) {
    const m = ed?.getModel?.();
    if (m) byKey.set(getModelKey(m), m);
  }
  return Array.from(byKey.values());
}

/**
 * After handshake: open every compatible model and attach content listeners.
 */
export function syncOpenEditors(state: LspState): void {
  const models = collectActiveModels();
  console.log(`[LSP] Initializing compilation sync across ${models.length} active models...`);

  for (const model of models) {
    if (!isCompatibleLanguage(state, model.getLanguageId())) continue;
    notifyDocumentOpen(state, model);
  }
}

/**
 * Dispose all content listeners + debounce timers (called from teardown / disconnect).
 */
export function clearAllContentListeners(state: LspState): void {
  for (const timer of state.changeDebounceTimers.values()) {
    clearTimeout(timer);
  }
  state.changeDebounceTimers.clear();

  for (const sub of state.contentListeners.values()) {
    try { sub.dispose(); } catch { /* ignore */ }
  }
  state.contentListeners.clear();
}
