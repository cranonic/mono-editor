// src/core/services/lsp/providers/index.ts
//
// Registers Monaco language providers against the active LSP connection.
// For the TypeScript family (ts / tsx / js / jsx) one typescript-language-server
// process serves all four language IDs, so we register providers for every
// member of the family.

import type { LspState } from '../types';
import type { LspOptions } from '../types';

import { registerCompletion }        from './completion';
import { registerHover }             from './hover';
import {
  registerDefinition,
  registerTypeDefinition,
  registerImplementation,
} from './definition';
import { registerReferences }        from './references';
import { registerDocumentSymbol }    from './documentSymbol';
import { registerDocumentHighlight } from './documentHighlight';
import { registerDocumentLink }      from './documentLink';
import { registerCodeAction }        from './codeAction';
import { registerCodeLens }          from './codeLens';
import { registerFoldingRange }      from './foldingRange';
import { registerDocumentFormatting } from './formatting';
import { registerOnTypeFormatting }  from './onTypeFormatting';
import { registerSelectionRange }    from './selectionRange';
import { registerSignatureHelp }     from './signatureHelp';
import { registerSemanticTokens }    from './semanticTokens';
import { registerColorProvider }     from './color';
import { registerInlayHints }        from './inlayHints';
import { registerRename }            from './rename';

/** Languages that share a single typescript-language-server process. */
export const TS_JS_FAMILY = [
  'typescript',
  'typescriptreact',
  'javascript',
  'javascriptreact',
] as const;

export function isTsJsFamily(langId: string): boolean {
  return (TS_JS_FAMILY as readonly string[]).includes(langId);
}

function serverHas(caps: Record<string, unknown>, key: string): boolean {
  // true / {} / { resolveProvider: ... } all mean supported
  return caps[key] != null && caps[key] !== false;
}

/**
 * Register all Mono language providers backed by the active LSP connection.
 * When the connected language is any member of the TS/JS family, providers are
 * registered for every family member so switching tabs (js ↔ ts ↔ tsx) keeps
 * completions, symbols, hover, etc. working without a reconnect.
 *
 * Providers the server did not advertise (e.g. documentLink on TLS) are skipped
 * to avoid noisy -32601 "Unhandled method" errors in the console.
 */
export function registerProviders(state: LspState, options: LspOptions = {}): void {
  const primary = state.languageId;
  const langs = isTsJsFamily(primary)
    ? [...TS_JS_FAMILY]
    : [primary];

  const caps = state.serverCapabilities || {};

  for (const lang of langs) {
    state.languageId = lang;

    if (options.completion !== false)        registerCompletion(state);
    if (options.signatureHelp !== false && serverHas(caps, 'signatureHelpProvider')) {
      registerSignatureHelp(state);
    }
    // Hover — MDN / docs (HTML LS, TS, etc.). Default on unless explicitly disabled.
    if (options.hover !== false)             registerHover(state);
    if (options.references !== false || options.definition !== false) {
      registerDefinition(state);
      if (serverHas(caps, 'typeDefinitionProvider')) {
        registerTypeDefinition(state);
      }
      if (serverHas(caps, 'implementationProvider')) {
        registerImplementation(state);
      }
    }
    if (options.references !== false && serverHas(caps, 'referencesProvider')) {
      registerReferences(state);
    }
    // Rename — always register when server may support it (JDT LS does)
    if (options.rename !== false) {
      registerRename(state);
    }
    if (options.documentSymbol !== false)    registerDocumentSymbol(state);
    if (options.documentHighlight !== false) registerDocumentHighlight(state);

    // TLS does not implement documentLink / documentColor → skip when missing
    if (serverHas(caps, 'documentLinkProvider')) {
      registerDocumentLink(state);
    }
    if (options.codeActions !== false)       registerCodeAction(state);
    if (options.codeLens && serverHas(caps, 'codeLensProvider')) {
      registerCodeLens(state);
    }
    if (options.foldingRange !== false)      registerFoldingRange(state);
    if (options.selectionRange !== false && serverHas(caps, 'selectionRangeProvider')) {
      registerSelectionRange(state);
    }
    registerDocumentFormatting(state);
    if (options.onTypeFormatting !== false && serverHas(caps, 'documentOnTypeFormattingProvider')) {
      registerOnTypeFormatting(state);
    }
    if (options.semanticTokens !== false && serverHas(caps, 'semanticTokensProvider')) {
      registerSemanticTokens(state);
    }

    if (
      options.colorProvider !== false &&
      serverHas(caps, 'colorProvider')
    ) {
      registerColorProvider(state);
    }

    // Inlay: prefer server capability; never skip just because a setting is missing.
    const serverOffersInlay = serverHas(caps, 'inlayHintProvider');
    if (options.inlayHints !== false || serverOffersInlay) {
      registerInlayHints(state);
    }
  }

  state.languageId = primary;
  console.log(
    `[LSP] registerProviders done primary=${primary} langs=${langs.join(',')} ` +
    `inlayHints opt=${options.inlayHints} serverInlay=${serverHas(caps, 'inlayHintProvider')}`,
  );
}

/** Dispose every Monaco provider registered for this connection. */
export function teardownProviders(state: LspState): void {
  for (const d of state.disposables) {
    try { d.dispose(); } catch { /* ignore */ }
  }
  state.disposables = [];
}
