// src/core/symbols/providers/LspSymbolProvider.ts

import { SymbolSource, SymbolKind } from '../types';
import type { SymbolProvider, DocumentSymbol } from '../types';
import { getActiveLspService } from '@/features/editor/hooks/useLspSync';

const resolveLspUri = (uri: string): string => {
  let safeUri = uri.replace(/([^:/])\/{2,}/g, '$1/');
  if (safeUri.includes('/storage/emulated/0')) {
    safeUri = safeUri.replace('/storage/emulated/0', '/sdcard');
  }
  return safeUri;
};

/**
 * Symbol provider routing document symbol extraction directly through the active LSP service
 * (works identically for built-in Web Worker LSP and external terminal LSP servers).
 */
export const lspSymbolProvider: SymbolProvider = {
  id: 'lsp-native',
  source: SymbolSource.LSP,
  priority: 100,

  provideSymbols: async (_text: string, _languageId: string, model?: any): Promise<DocumentSymbol[] | null> => {
    const lsp = getActiveLspService();
    if (!model || !lsp.isConnected || !lsp.initialized) return null;

    try {
      const uri =
        typeof lsp.getDocUriForModel === 'function'
          ? lsp.getDocUriForModel(model)
          : resolveLspUri(model.uri?.toString?.() ?? '');

      if (!uri) return null;

      const requestFn = (lsp as any).request || (lsp as any)._request;
      if (!requestFn) return null;

      const response: any = await requestFn.call(lsp, 'textDocument/documentSymbol', {
        textDocument: { uri },
      });

      if (!Array.isArray(response) || response.length === 0) return null;

      const toRange = (r: any) => ({
        startLineNumber: (r?.start?.line ?? 0) + 1,
        startColumn: (r?.start?.character ?? 0) + 1,
        endLineNumber: (r?.end?.line ?? 0) + 1,
        endColumn: (r?.end?.character ?? 0) + 1,
      });

      const mapLspSymbol = (sym: any): DocumentSymbol => {
        const rawRange = sym.range ?? sym.location?.range;
        const rawSel = sym.selectionRange ?? rawRange;
        return {
          name: sym.name,
          detail: sym.detail ?? sym.containerName,
          kind: mapLspKindToCustom(sym.kind),
          range: toRange(rawRange),
          selectionRange: toRange(rawSel),
          children: Array.isArray(sym.children) ? sym.children.map(mapLspSymbol) : [],
        };
      };

      return response.map(mapLspSymbol);
    } catch {
      return null;
    }
  },
};

const mapLspKindToCustom = (kind: number): SymbolKind => {
  if (kind >= 1 && kind <= 26) {
    return (kind - 1) as SymbolKind;
  }
  return SymbolKind.File;
};
