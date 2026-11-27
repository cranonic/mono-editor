// src/features/extensions/builtin/builtinExtensions.ts
//
// Manages:
//   1) Built-in Web Worker LSP factories (always available, including for .msxt-installed extensions)
//   2) Optional bundled workspace extensions (e.g. packages/extensions/ts when present at build time;
//      gracefully empty when omitted so users can build without it and install via .msxt).

import type { Extension } from '../types';
import TsLspWorker from '@/features/lsp/workers/tsLsp.worker.ts?worker';
import {
  OPTIONAL_TS_BUILTIN,
  type OptionalTsBuiltinBundle,
} from 'virtual:optional-builtin-extensions';

export const BUILTIN_STORE_PREFIX = 'builtin://';

export interface BuiltinExtensionContext {
  subscriptions: Array<{ dispose: () => void }>;
  extensionId: string;
  extensionPath: string;
  extension: {
    id: string;
    extensionPath: string;
    isActive: boolean;
    manifestJSON: any;
  };
}

export interface BuiltinExtensionEntry {
  id: string;
  storeDir: string;
  manifest: Record<string, any>;
  iconUrl: string;
  jsonFiles: Record<string, any>;
  textFiles: Record<string, string>;
  activate: (context: BuiltinExtensionContext, api: any) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}

/**
 * Factory registry for built-in Web Worker LSP servers keyed by `config.workerId`.
 * Always present in MS Code so extensions installed via `.msxt` can declare
 * `{ workerId: 'typescript' }` even if `packages/extensions/ts` was omitted at build time.
 */
const WORKER_FACTORIES: Record<string, () => Worker> = {
  typescript: () => new TsLspWorker({ name: 'ms-ts-lsp-worker' }),
};

export function createBuiltinLspWorker(workerId: string): Worker | null {
  const factory = WORKER_FACTORIES[workerId];
  return factory ? factory() : null;
}

export function getBuiltinWorkerFactory(workerId: string): (() => Worker) | undefined {
  return WORKER_FACTORIES[workerId];
}

function normalizeRelPath(p: string): string {
  return p.replace(/^\.\//, '').replace(/^\/+/, '');
}

function createTsBuiltinEntry(bundle: OptionalTsBuiltinBundle): BuiltinExtensionEntry {
  const {
    manifest: tsManifest,
    settings: tsSettings,
    tsSnippets,
    jsSnippets,
    readme: tsReadme,
    changelog: tsChangelog,
    iconUrl: tsIconUrl,
    TS_JS_LANGS,
    buildServerConfig,
  } = bundle;

  return {
    id: tsManifest.id,
    storeDir: `${BUILTIN_STORE_PREFIX}${tsManifest.id}`,
    manifest: tsManifest,
    iconUrl: tsIconUrl,
    jsonFiles: {
      'manifest.json': tsManifest,
      'settings.json': tsSettings,
      'snippets/typescript.json': tsSnippets,
      'snippets/javascript.json': jsSnippets,
    },
    textFiles: {
      'README.md': tsReadme,
      'CHANGELOG.md': tsChangelog,
      'LICENSE.txt': 'MIT License — MS Code TypeScript & JavaScript Language Support.',
    },
    activate(context, api) {
      const { window: win, lsp, commands, workspace } = api;
      const config = buildServerConfig();
      const registration = lsp.registerServer(TS_JS_LANGS, config);

      if (registration && typeof registration.dispose === 'function') {
        context.subscriptions.push(registration);
      } else {
        context.subscriptions.push({
          dispose: () => {
            try { lsp.unregisterServer(TS_JS_LANGS); } catch { /* ignore */ }
          },
        });
      }

      const restartCmd = commands.registerCommand('typescript.restartTsServer', () => {
        try {
          lsp.stopServer?.();
          lsp.unregisterServer(TS_JS_LANGS);
        } catch { /* ignore */ }

        const reg = lsp.registerServer(TS_JS_LANGS, buildServerConfig());
        if (reg && typeof reg.dispose === 'function') {
          context.subscriptions.push(reg);
        }

        try {
          window.dispatchEvent(
            new CustomEvent('ms-lsp-restart', { detail: { langs: TS_JS_LANGS } }),
          );
        } catch { /* ignore */ }

        win.showInformationMessage('TypeScript language server restarting…');
      });

      const toggleModeCmd = commands.registerCommand('typescript.selectServerMode', () => {
        const cfg = workspace.getConfiguration?.('typescript');
        const current = cfg?.get?.('server.mode', 'web-worker') || 'web-worker';
        const next = current === 'terminal' ? 'web-worker' : 'terminal';
        if (typeof cfg?.update === 'function') {
          cfg.update('server.mode', next);
        }
        try {
          window.dispatchEvent(
            new CustomEvent('ms-lsp-restart', { detail: { langs: TS_JS_LANGS, mode: next } }),
          );
        } catch { /* ignore */ }
        win.showInformationMessage(
          next === 'terminal'
            ? 'TypeScript LSP switched to Terminal mode (typescript-language-server in Alpine/native).'
            : 'TypeScript LSP switched to Built-in Web Worker mode.',
        );
      });

      const goToConfigCmd = commands.registerCommand('typescript.goToProjectConfig', () => {
        const folders = workspace.workspaceFolders || [];
        const root = folders[0]?.uri || workspace.workspacePath || '';
        if (!root) {
          win.showErrorMessage('No workspace folder open.');
          return;
        }
        const base = String(root).replace(/^file:\/\//, '');
        win.showInformationMessage(`Look for tsconfig.json / jsconfig.json under: ${base}`);
      });

      const selectVersionCmd = commands.registerCommand('typescript.selectTypeScriptVersion', () => {
        const cfg = workspace.getConfiguration?.('typescript');
        const mode = cfg?.get?.('server.mode', 'web-worker') || 'web-worker';
        const tsdk = cfg?.get?.('tsdk', '') || '';
        if (mode !== 'terminal') {
          win.showInformationMessage(
            'Using bundled TypeScript LanguageService (Web Worker mode). Change typescript.server.mode to "terminal" for external typescript-language-server.',
          );
          return;
        }
        win.showInformationMessage(
          tsdk
            ? `Using TypeScript from: ${tsdk}`
            : 'Using npm global / workspace TypeScript in terminal (set typescript.tsdk to override).',
        );
      });

      const openLogCmd = commands.registerCommand('typescript.openTsServerLog', () => {
        win.showInformationMessage(
          'See Output → "LSP: Ts". Set typescript.tsserver.log to terse/verbose, then Restart TS Server.',
        );
      });

      const reloadJsCmd = commands.registerCommand('javascript.reloadProjects', () => {
        commands.executeCommand('typescript.restartTsServer');
      });

      context.subscriptions.push(
        restartCmd,
        toggleModeCmd,
        goToConfigCmd,
        selectVersionCmd,
        openLogCmd,
        reloadJsCmd,
      );
    },
    deactivate() {
      // Disposables pushed to context.subscriptions handle unregistering the LSP server
    },
  };
}

export const BUILTIN_EXTENSIONS: BuiltinExtensionEntry[] = OPTIONAL_TS_BUILTIN
  ? [createTsBuiltinEntry(OPTIONAL_TS_BUILTIN)]
  : [];

const BUILTIN_BY_ID = new Map<string, BuiltinExtensionEntry>(
  BUILTIN_EXTENSIONS.map((e) => [e.id, e]),
);

export function isBuiltinStoreDir(storeDir: string | undefined | null): boolean {
  return typeof storeDir === 'string' && storeDir.startsWith(BUILTIN_STORE_PREFIX);
}

export function getBuiltinExtension(idOrStoreDir: string): BuiltinExtensionEntry | undefined {
  if (!idOrStoreDir) return undefined;
  const id = idOrStoreDir.startsWith(BUILTIN_STORE_PREFIX)
    ? idOrStoreDir.slice(BUILTIN_STORE_PREFIX.length)
    : idOrStoreDir;
  return BUILTIN_BY_ID.get(id);
}

export function loadBuiltinJson(storeDir: string, fileName: string): any | undefined {
  const entry = getBuiltinExtension(storeDir);
  if (!entry) return undefined;
  const rel = normalizeRelPath(fileName);
  return entry.jsonFiles[rel];
}

export function loadBuiltinText(storeDir: string, fileName: string): string | undefined {
  const entry = getBuiltinExtension(storeDir);
  if (!entry) return undefined;
  const rel = normalizeRelPath(fileName);
  return entry.textFiles[rel];
}

export function loadBuiltinIcon(storeDir: string): string | undefined {
  return getBuiltinExtension(storeDir)?.iconUrl;
}

export function toBuiltinExtensionModel(entry: BuiltinExtensionEntry): Extension {
  return {
    ...(entry.manifest as any),
    id: entry.id,
    publisher: entry.manifest.publisher || 'MS Code',
    icon: entry.iconUrl,
    storeDir: entry.storeDir,
    downloads: 0,
    rating: 5,
    isBuiltIn: true,
    isVerified: true,
    zipSize: 'Built-in',
  };
}
