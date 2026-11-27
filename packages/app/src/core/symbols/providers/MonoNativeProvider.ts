// src/core/symbols/providers/MonoNativeProvider.ts
import {
  buildStructureTree,
  getActiveMonoEditors,
  TextModel,
  type DocumentSymbol as MonoDocumentSymbol,
} from '@mono/editor';
import { SymbolSource } from '../types';
import type { SymbolProvider, DocumentSymbol, SymbolKind } from '../types';

function mapMonoSymbol(sym: MonoDocumentSymbol): DocumentSymbol {
  return {
    name: sym.name,
    detail: sym.detail ?? '',
    kind: sym.kind as SymbolKind,
    range: sym.range,
    selectionRange: sym.selectionRange ?? sym.range,
    children: sym.children?.length ? sym.children.map(mapMonoSymbol) : undefined,
    source: SymbolSource.MONO,
  };
}

/**
 * S7: Native Mono Editor structure-backed document symbol provider.
 * Uses the active editor's `getStructure().getOutline()` when matching the model,
 * or builds a fresh `StructureTree` directly via `@mono/editor`.
 * Falls back to `null` when empty so legacy regex scanners still serve as fallback.
 */
export const monoNativeProvider: SymbolProvider = {
  id: 'mono-builtin',
  source: SymbolSource.MONO,
  priority: 85,
  provideSymbols: async (
    text: string,
    languageId: string,
    model?: any,
  ): Promise<DocumentSymbol[] | null> => {
    try {
      // Fast path: reuse active Mono editor's cached structure service if model matches
      const editors = getActiveMonoEditors();
      const targetUri = model?.uri?.toString?.() ?? '';
      for (const ed of editors) {
        const edModel = ed.getModel?.();
        const edUri = edModel?.uri?.toString?.() ?? '';
        if (
          (targetUri && edUri && edUri === targetUri) ||
          (edModel && edModel === model) ||
          (ed.getLanguageId() === languageId && ed.getValue() === text)
        ) {
          const outline = ed.getStructure?.()?.getOutline?.();
          if (outline && outline.length > 0) {
            return outline.map(mapMonoSymbol);
          }
        }
      }

      if (!text || !text.trim()) return null;
      const tmpModel = new TextModel(text, languageId || 'plaintext');
      const tree = buildStructureTree(tmpModel);
      if (tree.symbols && tree.symbols.length > 0) {
        return tree.symbols.map(mapMonoSymbol);
      }
      return null;
    } catch {
      return null;
    }
  },
};
