// src/core/services/lsp/LspProtocol.ts

import * as monaco from '@/core/mono';
import type { LspState } from './types';
import { sendRequest, sendNotify } from './LspTransport';
import { fromLspUri, getDocUri } from './utils/uriHelpers';

// ─── LSP CAPABILITIES DEFINITIONS ────────────────────────────────────────────
// Declaring client-supported features up front allows clean expansion patterns 
// when adding structural options like formatting, declarations, or code actions.

const CLIENT_CAPABILITIES = {
  offsetEncoding: ['utf-16', 'utf-8'],
  textDocument: {
    synchronization: {
      dynamicRegistration: true,
      willSave: false,
      didSave: true,
      willSaveWaitUntil: false,
    },
    completion: {
      dynamicRegistration: true,
      completionItem: {
        snippetSupport: true,
        commitCharactersSupport: true,
        documentationFormat: ['markdown', 'plaintext'],
        resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] },
      },
    },
    hover: {
      dynamicRegistration: true,
      contentFormat: ['markdown', 'plaintext'],
    },
    signatureHelp: {
      dynamicRegistration: true,
      signatureInformation: {
        documentationFormat: ['markdown', 'plaintext'],
        parameterInformation: { labelOffsetSupport: true },
      },
    },
    definition: {
      dynamicRegistration: true,
      linkSupport: true,
    },
    typeDefinition: {
      dynamicRegistration: true,
      linkSupport: true,
    },
    implementation: {
      dynamicRegistration: true,
      linkSupport: true,
    },
    rename: {
      dynamicRegistration: true,
      prepareSupport: true,
    },
    formatting: {
      dynamicRegistration: true,
    },
    rangeFormatting: {
      dynamicRegistration: true,
    },
    onTypeFormatting: {
      dynamicRegistration: true,
    },
    references: {
      dynamicRegistration: true,
    },
    documentHighlight: {
      dynamicRegistration: true,
    },
    documentSymbol: {
      dynamicRegistration: true,
      hierarchicalDocumentSymbolSupport: true,
    },
    codeAction: {
      dynamicRegistration: true,
      codeActionLiteralSupport: {
        codeActionKind: {
          valueSet: [
            'quickfix',
            'refactor',
            'refactor.extract',
            'refactor.inline',
            'refactor.rewrite',
            'source',
            'source.organizeImports',
          ],
        },
      },
      resolveSupport: { properties: ['edit'] },
    },
    codeLens: {
      dynamicRegistration: true,
    },
    documentLink: {
      dynamicRegistration: true,
    },
    foldingRange: {
      dynamicRegistration: true,
      rangeLimit: 5000,
      lineFoldingOnly: false,
    },
    selectionRange: {
      dynamicRegistration: true,
    },
    colorProvider: {
      dynamicRegistration: true,
    },
    publishDiagnostics: { relatedInformation: true, tagSupport: { valueSet: [1, 2] } },
    semanticTokens: {
      dynamicRegistration: true,
      requests: { full: true, range: true },
      multilineTokenSupport: true,
      overlappingTokenSupport: false,
    },
    inlayHint: {
      dynamicRegistration: true,
      resolveSupport: { properties: ['tooltip', 'textEdits'] },
    },
  },
  workspace: {
    didChangeConfiguration: { dynamicRegistration: true },
    workspaceFolders: true,
  },
};

// ─── WORKSPACE PROFILE HELPERS ────────────────────────────────────────────────
/**
 * Extracts a legible visual tag label out of deep system absolute file paths.
 */
export function getWorkspaceName(rootUri: string): string {
  const parts = decodeURI(rootUri).replace('file://', '').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? 'workspace';
}

// ─── HANDSHAKE SUBSYSTEM INITIATION ───────────────────────────────────────────
/**
 * Orchestrates the two-way initialize/initialized handshake lifecycle with the language server.
 */
export async function initializeLsp(state: LspState): Promise<void> {
  // Merge host defaults with extension-provided options (e.g. tsserver.path)
  const initializationOptions: Record<string, unknown> = {
    clangdFileStatus: true,
    ...(state.initializationOptions ?? {}),
  };

  console.log(
    '[LSP] initialize → rootUri=',
    state.rootUri,
    ' mode=',
    state.mode,
    ' initOptKeys=',
    Object.keys(initializationOptions),
  );

  try {
    const result = await sendRequest(state, 'initialize', {
      processId: null,
      rootUri: state.rootUri,
      capabilities: CLIENT_CAPABILITIES,
      initializationOptions,
      workspaceFolders: [{ uri: state.rootUri, name: getWorkspaceName(state.rootUri) }],
    });

    sendNotify(state, 'initialized', {});
    state.initialized = true;
    const caps = (result as any)?.capabilities ?? {};
    state.serverCapabilities = caps;
    const prefs = (initializationOptions as any)?.preferences;
    console.log(
      '[LSP] Handshake OK. Server caps:',
      Object.keys(caps).join(', ') || '(none)',
    );

    // Push settings so TLS / worker applies inlay & format prefs even if workspace/configuration
    // was answered before preferences were ready.
    if (prefs && typeof prefs === 'object') {
      try {
        sendNotify(state, 'workspace/didChangeConfiguration', {
          settings: {
            typescript: {
              preferences: prefs,
              format: (initializationOptions as any)?.formatOptions,
              inlayHints: {
                parameterNames: {
                  enabled: prefs.includeInlayParameterNameHints ?? 'all',
                },
                parameterTypes: {
                  enabled: !!prefs.includeInlayFunctionParameterTypeHints,
                },
                variableTypes: {
                  enabled: !!prefs.includeInlayVariableTypeHints,
                },
                propertyDeclarationTypes: {
                  enabled: !!prefs.includeInlayPropertyDeclarationTypeHints,
                },
                functionLikeReturnTypes: {
                  enabled: !!prefs.includeInlayFunctionLikeReturnTypeHints,
                },
                enumMemberValues: {
                  enabled: !!prefs.includeInlayEnumMemberValueHints,
                },
              },
            },
            javascript: {
              preferences: prefs,
              format: (initializationOptions as any)?.formatOptions,
              inlayHints: {
                parameterNames: {
                  enabled: prefs.includeInlayParameterNameHints ?? 'all',
                },
                parameterTypes: {
                  enabled: !!prefs.includeInlayFunctionParameterTypeHints,
                },
                variableTypes: {
                  enabled: !!prefs.includeInlayVariableTypeHints,
                },
              },
            },
          },
        });
      } catch (e) {
        console.warn('[LSP] didChangeConfiguration failed:', e);
      }
    }
  } catch (e: any) {
    const msg =
      e?.message ||
      e?.lspError?.message ||
      (typeof e === 'object' ? JSON.stringify(e) : String(e));
    console.error('[LSP] initialize FAILED:', msg);
    throw e instanceof Error ? e : new Error(msg);
  }
}

// ─── DIAGNOSTICS & TELEMETRY HANDLERS ─────────────────────────────────────────
/** Decode path for loose comparison (ignore encoding + /sdcard vs storage). */
function uriPathKey(uri: string): string {
  if (!uri) return '';
  let p = uri.replace(/^file:\/\//i, '');
  try {
    p = decodeURIComponent(p);
  } catch { /* keep */ }
  p = p.replace(/^\/storage\/emulated\/0/i, '/sdcard');
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p.toLowerCase();
}

export function handlePublishDiagnostics(state: LspState, params: any): void {
  const lspUri = (params?.uri as string) || '';
  const localUri = fromLspUri(lspUri);
  const diagKey = uriPathKey(lspUri);
  const localKey = uriPathKey(localUri);
  const diags = params?.diagnostics ?? [];

  const matchesModel = (m: any): boolean => {
    if (!m) return false;
    const docUri = getDocUri(m, state);
    const mUri = m.uri?.toString?.() ?? '';
    if (docUri === lspUri || (mUri && (mUri === localUri || mUri === lspUri))) return true;
    const mk = uriPathKey(docUri);
    const mu = uriPathKey(mUri);
    return Boolean(diagKey && (mk === diagKey || (mu && (mu === diagKey || mu === localKey))));
  };

  // Search BOTH standalone models AND active MonoEditor models
  const matchedModels = new Set<any>();
  for (const m of monaco.editor.getModels()) {
    if (matchesModel(m)) matchedModels.add(m);
  }

  const matchedEditors: any[] = [];
  for (const ed of monaco.editor.getEditors()) {
    const m = ed?.getModel?.();
    if (m && matchesModel(m)) {
      matchedModels.add(m);
      matchedEditors.push(ed);
    }
  }

  if (matchedModels.size === 0) {
    return;
  }

  const markers: monaco.editor.IMarkerData[] = diags.map((d: any) => ({
    severity: diagSeverity(d.severity),
    startLineNumber: (d.range?.start?.line ?? 0) + 1,
    startColumn: (d.range?.start?.character ?? 0) + 1,
    endLineNumber: (d.range?.end?.line ?? 0) + 1,
    endColumn: (d.range?.end?.character ?? 0) + 1,
    message: d.message ?? '',
    source: d.source ?? state.languageId,
    ...(d.code !== undefined ? { code: String(d.code) } : {}),
    ...(Array.isArray(d.tags) ? { tags: d.tags } : {}),
  }));

  for (const model of matchedModels) {
    try {
      monaco.editor.setModelMarkers(model, 'lsp', markers);
    } catch { /* ignore */ }
  }
  for (const ed of matchedEditors) {
    try {
      if (typeof ed.setModelMarkers === 'function') {
        ed.setModelMarkers('lsp', markers);
      }
    } catch { /* ignore */ }
  }

  console.log(`[LSP] diagnostics applied: ${markers.length} marker(s) on ${lspUri}`);
}

/**
 * Maps raw language server issue integers straight into functional Monaco severity definitions.
 */
function diagSeverity(s?: number): monaco.MarkerSeverity {
  if (s === 1) return monaco.MarkerSeverity.Error;
  if (s === 2) return monaco.MarkerSeverity.Warning;
  if (s === 3) return monaco.MarkerSeverity.Info;
  return monaco.MarkerSeverity.Hint;
}
