// Auto-split from LspProviders.ts
import * as monaco from '@/core/mono';
import type { LspState } from '../types';
import { sendRequest } from '../LspTransport';
import { getDocUri } from '../utils/uriHelpers';
export function registerFoldingRange(state: LspState): void {
  state.disposables.push(
    monaco.languages.registerFoldingRangeProvider(state.languageId, {
      provideFoldingRanges: async (model) => {
        if (!state.initialized) return [];
        try {
          const result: any = await sendRequest(state, 'textDocument/foldingRange', {
            textDocument: { uri: getDocUri(model, state) },
          });
          if (!Array.isArray(result)) return [];
          return result.map((f: any) => ({
            start: f.startLine + 1,
            end:   f.endLine + 1,
            kind:  f.kind === 'comment' ? 'comment'
              : f.kind === 'imports' ? 'imports'
              : f.kind === 'region'  ? 'region'
              : undefined,
          }));
        } catch {
          return [];
        }
      },
    })
  );
}
