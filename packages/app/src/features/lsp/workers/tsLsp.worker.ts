// packages/app/src/features/lsp/workers/tsLsp.worker.ts
// Browser Web Worker entrypoint hosting TsLspEngine with bundled TypeScript stdlib .d.ts files.

import * as ts from 'typescript';
import tsLibs from 'virtual:ts-lsp-libs';
import { TsLspEngine, type JsonRpcMessage } from './tsLspEngine';

const engine = new TsLspEngine({
  ts,
  libs: tsLibs,
  send: (msg: JsonRpcMessage) => {
    (self as unknown as Worker).postMessage(msg);
  },
});

self.addEventListener('message', (event: MessageEvent<JsonRpcMessage>) => {
  if (!event.data) return;
  engine.handleMessage(event.data);
});

// Signal worker ready so WorkerTransport can kick off LSP initialize immediately
(self as unknown as Worker).postMessage({ __workerReady: true });
