// src/core/services/lsp/LspService.ts
//
// Responsibility: Implement ILspService and orchestrate all LSP sub-modules.
// Supports BOTH:
//   - WebSocketTransport (external terminal LSP servers, e.g. Alpine/Termux typescript-language-server)
//   - WorkerTransport    (in-browser Web Worker LSP servers, e.g. built-in TypeScript LanguageService)

import * as monaco from '@/core/mono';
import type { ILspService } from '../ILspService';
import type { LspOptions } from './types';
import { createInitialState } from './types';
import { toLspUri, getDocUri } from './utils/uriHelpers';
import {
  sendNotify,
  sendRequest,
  processBuffer,
  dispatchMessage,
  createWebSocketTransport,
  createWorkerTransport,
  isTransportOpen,
} from './LspTransport';
import { initializeLsp, handlePublishDiagnostics } from './LspProtocol';
import {
  registerModelUri,
  unregisterModelUri,
  notifyDocumentOpen,
  syncOpenEditors,
  clearAllContentListeners,
} from './LspDocumentManager';
import { registerProviders, teardownProviders } from './LspProviders';

export class LspService implements ILspService {
  private state = createInitialState();

  // §1  Public surface  –  ILspService properties & methods

  get isConnected(): boolean {
    return isTransportOpen(this.state);
  }

  get mode(): 'web-worker' | 'terminal' {
    return this.state.mode;
  }

  get languageId(): string {
    return this.state.languageId;
  }

  get initialized(): boolean {
    return this.state.initialized;
  }
  set initialized(v: boolean) {
    this.state.initialized = v;
  }

  get isInitializing(): boolean {
    return this.state.isInitializing;
  }
  set isInitializing(v: boolean) {
    this.state.isInitializing = v;
  }

  get disposables(): monaco.IDisposable[] {
    return this.state.disposables;
  }
  set disposables(v: monaco.IDisposable[]) {
    this.state.disposables = v;
  }

  waitUntilReady(): Promise<void> {
    if (this.state.initialized) return Promise.resolve();
    if (this.state._initPromise) return this.state._initPromise;
    return Promise.reject(new Error('LspService: not connecting'));
  }

  registerModelUri(model: monaco.editor.ITextModel, realFileUri: string): void {
    registerModelUri(this.state, model, realFileUri);
  }

  unregisterModelUri(model: monaco.editor.ITextModel): void {
    unregisterModelUri(this.state, model);
  }

  notifyDocumentOpen(model: monaco.editor.ITextModel): void {
    notifyDocumentOpen(this.state, model);
  }

  getDocUriForModel(model: monaco.editor.ITextModel): string {
    return getDocUri(model, this.state);
  }

  /**
   * Push multi-file workspace snapshots to the Web Worker virtual FS.
   */
  syncWorkspaceFiles(
    files: Array<{ uri: string; text: string }>,
    removeUris?: string[],
  ): void {
    if (!this.isConnected) return;
    sendNotify(this.state, 'mscode/syncFiles', {
      files: files.map((f) => ({ uri: toLspUri(f.uri), text: f.text })),
      ...(removeUris?.length ? { removeUris: removeUris.map((u) => toLspUri(u)) } : {}),
    });
  }

  _notify(method: string, params: unknown): void {
    sendNotify(this.state, method, params);
  }

  request(method: string, params: unknown): Promise<unknown> {
    return sendRequest(this.state, method, params);
  }

  // §2  Shared state preparation & handshake completion

  private _prepareConnection(
    languageId: string,
    mode: 'web-worker' | 'terminal',
    options: LspOptions,
  ): void {
    this.disconnect();

    const s = this.state;
    s.languageId = languageId;
    s.mode = mode;
    s.rootUri = toLspUri(options.rootUri ?? 'file:///workspace');

    const initOpts: Record<string, unknown> = {
      ...((options.initializationOptions as Record<string, unknown> | undefined) ?? {}),
    };
    if (options.preferences && typeof options.preferences === 'object') {
      initOpts.preferences = {
        ...((initOpts.preferences as Record<string, unknown>) || {}),
        ...(options.preferences as Record<string, unknown>),
      };
    }
    s.initializationOptions = initOpts;
    s.configuration = { ...(options as Record<string, unknown>) };
    s.initialized = false;
    s.isInitializing = true;
    s.openedUris.clear();

    s._initPromise = new Promise<void>((res, rej) => {
      s._initResolve = res;
      s._initReject = rej;
    });

    if (!monaco.languages.getLanguages().some((l) => l.id === languageId)) {
      monaco.languages.register({ id: languageId });
    }
  }

  private async _runHandshake(languageId: string, options: LspOptions): Promise<void> {
    const s = this.state;
    try {
      await initializeLsp(s);
      registerProviders(s, options);
      syncOpenEditors(s);

      // Ensure inlayHints are refreshed cleanly after providers register
      try {
        const { refreshInlayHints } = await import('./providers/inlayHints');
        for (const ed of monaco.editor.getEditors()) {
          try {
            if (options.inlayHints !== false) {
              ed.updateOptions({ inlayHints: { enabled: 'on' } } as any);
            }
          } catch { /* ignore */ }
        }
        setTimeout(() => refreshInlayHints(languageId), 180);
        setTimeout(() => refreshInlayHints(languageId), 800);
      } catch (e) {
        console.warn('[LSP] inlay refresh after ready failed:', e);
      }

      s.isInitializing = false;
      s._initResolve?.();
      s._initResolve = s._initReject = null;

      try {
        window.dispatchEvent(
          new CustomEvent('ms-lsp-ready', { detail: { languageId, mode: s.mode } }),
        );
      } catch { /* non-browser test env */ }

      console.log(`[LSP] ✅ ${languageId} server ready (${s.mode})`);
    } catch (e) {
      console.error('[LSP] Handshake failed:', e);
      s.isInitializing = false;
      s._initReject?.(e instanceof Error ? e : new Error(String(e)));
      s._initResolve = s._initReject = null;
    }
  }

  // §3  connectWorker()  –  In-browser Web Worker JSON-RPC 2.0 LSP

  connectWorker(
    languageId: string,
    workerFactory: () => Worker,
    options: LspOptions = {},
  ): void {
    this._prepareConnection(languageId, 'web-worker', options);
    const s = this.state;

    console.log(`[LSP] Connecting Web Worker → lang: ${languageId}  root: ${s.rootUri}`);

    let worker: Worker;
    try {
      worker = workerFactory();
    } catch (err) {
      s.isInitializing = false;
      const e = err instanceof Error ? err : new Error(String(err));
      s._initReject?.(e);
      s._initResolve = s._initReject = null;
      return;
    }

    const transport = createWorkerTransport(worker);
    s.transport = transport;
    s.ws = null;

    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      dispatchMessage(s, msg, this._onNotification.bind(this));
    };

    worker.onerror = (ev: ErrorEvent) => {
      const errMsg = ev?.message || 'TypeScript Web Worker error';
      console.error('[LSP] Worker error:', errMsg);
      if (s.isInitializing) {
        s.isInitializing = false;
        s._initReject?.(new Error(errMsg));
        s._initResolve = s._initReject = null;
      }
    };

    // Start LSP initialize handshake immediately (worker queues messages until module loads)
    void this._runHandshake(languageId, options);
  }

  // §4  connect()  –  WebSocket (terminal) or delegated Worker

  connect(languageId: string, url: string, options: LspOptions = {}): void {
    if (options.workerFactory || url.startsWith('worker://')) {
      if (!options.workerFactory) {
        throw new Error('LspService.connect: workerFactory required for worker:// URL');
      }
      this.connectWorker(languageId, options.workerFactory, options);
      return;
    }

    this._prepareConnection(languageId, 'terminal', options);
    const s = this.state;

    console.log(`[LSP] Connecting → ${url}  lang: ${languageId}  root: ${s.rootUri}`);
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    s.ws = ws;
    s.transport = createWebSocketTransport(ws);

    ws.onopen = async () => {
      console.log('[LSP] WebSocket open — starting handshake…');
      await this._runHandshake(languageId, options);
    };

    ws.onmessage = (event) => {
      const isBin = typeof event.data !== 'string';
      const raw = !isBin
        ? (event.data as string)
        : s.decoder.decode(event.data as ArrayBuffer, { stream: true });

      if (s.isInitializing) {
        console.log(
          `[LSP] onmessage during init: ${isBin ? 'binary' : 'text'} len=${raw.length}`,
        );
      }

      s.buffer += raw;
      processBuffer(s, (msg) =>
        dispatchMessage(s, msg, this._onNotification.bind(this)),
      );
    };

    ws.onerror = (ev) => {
      console.warn('[LSP] WebSocket error', ev);
      if (s.isInitializing) {
        s.isInitializing = false;
        s._initReject?.(new Error('WebSocket error during handshake'));
        s._initResolve = s._initReject = null;
      }
    };

    ws.onclose = (e) => {
      console.log(`[LSP] WebSocket closed (code: ${e.code})`);
      if (s.isInitializing) {
        s.isInitializing = false;
        s._initReject?.(new Error(`WebSocket closed before initialized (code ${e.code})`));
        s._initResolve = s._initReject = null;
      }
      teardownProviders(s);
      clearAllContentListeners(s);
    };
  }

  // §5  disconnect()

  disconnect(): void {
    const s = this.state;

    teardownProviders(s);
    clearAllContentListeners(s);
    s.openedUris.clear();
    s.serverCapabilities = {};

    if (s.isInitializing) {
      s._initReject?.(new Error('LspService disconnected during initialization'));
      s._initResolve = s._initReject = null;
    }
    s.isInitializing = false;
    s.initialized = false;
    s._initPromise = null;

    if (s.transport) {
      try {
        s.transport.close();
      } catch { /* ignore */ }
      s.transport = null;
    }
    if (s.ws) {
      s.ws.onopen = s.ws.onmessage = s.ws.onerror = s.ws.onclose = null;
      if (s.ws.readyState < WebSocket.CLOSING) s.ws.close();
      s.ws = null;
    }

    s.pendingRequests.forEach((p) => p.reject(new Error('disconnected')));
    s.pendingRequests.clear();

    s.buffer = '';
  }

  // §6  Notification handler

  private _onNotification(method: string, params: any): void {
    if (method === 'textDocument/publishDiagnostics') {
      handlePublishDiagnostics(this.state, params);
    }
  }
}