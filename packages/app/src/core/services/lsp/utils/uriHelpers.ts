// src/core/services/lsp/utils/uriHelpers.ts
//
// Normalize file URIs between Mono/Monaco model URIs, on-disk Android paths,
// browser virtual workspaces, and LSP file:// URIs.
//
// Critical: path segments MUST be percent-encoded (spaces → %20).

import { Capacitor } from '@capacitor/core';
import type * as monaco from '@/core/mono';
import type { LspState } from '../types';

const fallbackModelKeys = new WeakMap<object, string>();
let nextFallbackModelId = 1;

/**
 * Stable unique key for a Mono or Monaco text model.
 * Prevents collisions on `IMonoTextModel` instances where `.id` is undefined.
 */
export function getModelKey(model: monaco.editor.ITextModel | null | undefined): string {
  if (!model) return 'unknown-model';
  if (typeof (model as any).id === 'string' && (model as any).id) {
    return (model as any).id;
  }
  const uriStr = model.uri?.toString?.() ?? (model as any).uriString;
  if (typeof uriStr === 'string' && uriStr) {
    return uriStr;
  }
  if (typeof model === 'object') {
    let key = fallbackModelKeys.get(model as object);
    if (!key) {
      key = `mono-model-${nextFallbackModelId++}`;
      fallbackModelKeys.set(model as object, key);
    }
    return key;
  }
  return String(model);
}

/**
 * Encode an absolute filesystem path as a valid file:// URI.
 * Each path segment is encodeURIComponent'd so spaces and non-ASCII are legal.
 */
function pathToFileUri(absPath: string): string {
  let path = absPath.replace(/\\/g, '/');
  if (!path.startsWith('/')) path = `/${path}`;

  // /storage/emulated/0 → /sdcard (same volume, shorter for servers)
  path = path.replace(/^\/storage\/emulated\/0/i, '/sdcard');

  const encoded = path
    .split('/')
    .map((seg) => (seg === '' ? '' : encodeURIComponent(seg)))
    .join('/');

  return `file://${encoded}`;
}

/**
 * Strip file:// scheme and return a decoded filesystem path (starts with /).
 */
export function fileUriToPath(uri: string): string {
  let rest = uri.replace(/^file:\/\//i, '');
  if (!rest.startsWith('/')) rest = `/${rest}`;
  try {
    return decodeURIComponent(rest);
  } catch {
    return rest;
  }
}

/**
 * Canonicalize a path or URI into a stable file:// URI that language servers
 * understand. Maps /storage/emulated/0 → /sdcard and percent-encodes segments.
 */
export function toLspUri(input: string): string {
  if (!input) return 'file:///workspace';

  const u = input.trim();

  if (u.startsWith('file://') || u.startsWith('FILE://')) {
    return pathToFileUri(fileUriToPath(u));
  }

  if (u.startsWith('/')) {
    return pathToFileUri(u);
  }

  return pathToFileUri(`/workspace/${u.replace(/^\.\//, '')}`);
}

/**
 * Convert an LSP file:// URI back to a form Mono / the rest of the app uses.
 * Maps /sdcard → /storage/emulated/0 only on native Android so web workspace paths stay intact.
 */
export function fromLspUri(lspUri: string): string {
  if (!lspUri) return '';
  let path = fileUriToPath(lspUri);
  if (Capacitor.isNativePlatform()) {
    path = path.replace(/^\/sdcard/i, '/storage/emulated/0');
  }
  return pathToFileUri(path);
}

/**
 * Resolve the document URI that should be sent to the language server for a
 * given editor model. Prefer the explicit mapping registered via
 * registerModelUri(); fall back to the model's own URI.
 */
export function getDocUri(
  model: monaco.editor.ITextModel,
  state: LspState,
): string {
  const key = getModelKey(model);
  const mapped = state.modelUriMap.get(key);
  if (mapped) {
    return toLspUri(mapped);
  }

  const mu = model?.uri?.toString?.() ?? '';
  if (mu && !mu.startsWith('inmemory:')) {
    return toLspUri(mu);
  }

  const lang = model?.getLanguageId?.() ?? '';
  const ext =
    lang === 'typescriptreact' ? '.tsx'
      : lang === 'typescript' ? '.ts'
      : lang === 'javascriptreact' ? '.jsx'
      : lang === 'javascript' ? '.js'
      : '';
  return toLspUri(`/workspace/untitled-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}${ext}`);
}
