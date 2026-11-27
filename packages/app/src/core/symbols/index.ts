// src/core/symbols/index.ts

import * as mono from '@/core/mono';
import { symbolManager } from './SymbolManager';

// ─── CENTRAL ROUTING PROVIDER SCHEMES ─────────────────────────────────────────
import { lspSymbolProvider } from './providers/LspSymbolProvider';
import { monoNativeProvider } from './providers/MonoNativeProvider';
import { regexFallbackProvider } from './providers/RegexFallbackProvider';

// ─── LANGUAGE SPECIFIC OVERRIDE SUB-PROVIDERS ─────────────────────────────────
import { cSymbolProvider } from './languages/cSymbols';
import { pythonSymbolProvider } from './languages/pythonSymbols';
import { javaSymbolProvider } from './languages/javaSymbols';
import { jsSymbolProvider } from './languages/jsSymbols';
import { cssSymbolProvider } from './languages/cssSymbols';
import { htmlSymbolProvider } from './languages/htmlSymbols';
import { rustSymbolProvider } from './languages/rustSymbols';
import { markdownSymbolProvider } from './languages/markdownSymbols';

/**
 * Initializes, registers, and bridges structural document symbol extractors
 * with the underlying Mono Editor framework.
 */
export const bootstrapSymbolProviders = () => {
  // ─── CUSTOM PRIORITY ARCHITECTURE MAPPINGS ───
  // LSP (100) > Mono structure engine (85) > language-specific regex fallbacks (50) > generic regex
  symbolManager.customPriorities = {
    'mono-builtin': 85,
    'html-composer': 50,
    'css-regex': 50,
    'rust-lexer': 50,
    'markdown-composer': 50,
  };

  // ─── GLOBAL FALLBACK SUBSYSTEM REGISTRATIONS ───
  symbolManager.registerProvider('*', lspSymbolProvider);
  symbolManager.registerProvider('*', monoNativeProvider);
  symbolManager.registerProvider('*', regexFallbackProvider);

  // ─── EXPLICIT LANGUAGE RESOLUTION MODULES (kept as fallback — S8 out of scope) ───
  symbolManager.registerProvider('c', cSymbolProvider);
  symbolManager.registerProvider('cpp', cSymbolProvider);
  symbolManager.registerProvider('python', pythonSymbolProvider);
  symbolManager.registerProvider('java', javaSymbolProvider);
  symbolManager.registerProvider('javascript', jsSymbolProvider);
  symbolManager.registerProvider('typescript', jsSymbolProvider);
  symbolManager.registerProvider('css', cssSymbolProvider);
  symbolManager.registerProvider('html', htmlSymbolProvider);
  symbolManager.registerProvider('rust', rustSymbolProvider);
  symbolManager.registerProvider('markdown', markdownSymbolProvider);

  const customLanguages = [
    'html',
    'css',
    'javascript',
    'typescript',
    'python',
    'java',
    'c',
    'cpp',
    'rust',
    'markdown',
  ];

  const mapToMonoSymbol = (sym: any): any => ({
    name: sym.name,
    detail: sym.detail || '',
    kind: sym.kind,
    tags: [],
    range: sym.range,
    selectionRange: sym.selectionRange || sym.range,
    children: sym.children ? sym.children.map(mapToMonoSymbol) : [],
  });

  const fetchingModels = new Set<string>();

  mono.languages.registerDocumentSymbolProvider(customLanguages, {
    provideDocumentSymbols: async (model: any, _token: any) => {
      const uri = model.uri?.toString?.() ?? String(model.uriString ?? '');
      if (fetchingModels.has(uri)) return [];
      fetchingModels.add(uri);

      try {
        // First let Mono's own structure engine handle built-in outlines unless an external
        // LSP/extension provider supplies symbols; fall back to legacy regex only if Mono is empty.
        const monoSyms = await monoNativeProvider.provideSymbols(
          model.getValue?.() ?? '',
          model.getLanguageId?.() ?? 'plaintext',
          model,
        );
        if (monoSyms && monoSyms.length > 0) {
          return [];
        }
        const symbols = await symbolManager.getSymbols(model, [monoNativeProvider.id]);
        if (symbols && symbols.length > 0) {
          return symbols.map(mapToMonoSymbol);
        }
        return [];
      } catch (e) {
        console.error('[SymbolBridge] Document symbol provider error:', e);
        return [];
      } finally {
        fetchingModels.delete(uri);
      }
    },
  });
};

export { symbolManager } from './SymbolManager';
export * from './types';
