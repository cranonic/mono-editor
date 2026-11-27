// Auto-split from LspProviders.ts
import * as monaco from '@/core/mono';
import type { LspState } from '../types';
import { sendRequest } from '../LspTransport';
import { getDocUri } from '../utils/uriHelpers';

const SEMANTIC_LEGEND = {
  tokenTypes: [
    'namespace', 'type', 'class', 'enum', 'interface', 'struct', 'typeParameter',
    'parameter', 'variable', 'property', 'enumMember', 'event', 'function',
    'method', 'macro', 'keyword', 'modifier', 'comment', 'string', 'number',
    'regexp', 'operator', 'decorator',
  ],
  tokenModifiers: [
    'declaration', 'definition', 'readonly', 'static', 'deprecated',
    'abstract', 'async', 'modification', 'documentation', 'defaultLibrary',
  ],
};

export function registerSemanticTokens(state: LspState): void {
  const serverLegend = (state.serverCapabilities?.semanticTokensProvider as any)?.legend;
  const legend =
    serverLegend &&
    Array.isArray(serverLegend.tokenTypes) &&
    Array.isArray(serverLegend.tokenModifiers)
      ? {
          tokenTypes: serverLegend.tokenTypes,
          tokenModifiers: serverLegend.tokenModifiers,
        }
      : SEMANTIC_LEGEND;

  const provider: any = {
    getLegend: () => legend,
    provideDocumentSemanticTokens: async (model: monaco.editor.ITextModel) => {
      if (!state.initialized) return null;
      try {
        const result: any = await sendRequest(state, 'textDocument/semanticTokens/full', {
          textDocument: { uri: getDocUri(model, state) },
        });
        if (!result?.data) return null;
        // Monaco expects a Uint32Array of the same delta-encoded LSP data
        return {
          data: Uint32Array.from(result.data),
          resultId: result.resultId,
        };
      } catch {
        return null;
      }
    },
    releaseDocumentSemanticTokens: () => {},
  };

  try {
    state.disposables.push(
      monaco.languages.registerDocumentSemanticTokensProvider(state.languageId, provider)
    );
  } catch (e) {
    console.warn('[LSP] semantic tokens not available in this monaco build:', e);
  }
}
