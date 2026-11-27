// src/features/editor/hooks/useLspSync.ts
//
// Manages LSP lifecycle for the active code editor tab.
// Supports dual-mode language servers (e.g. TypeScript extension):
//   - 'web-worker' (default): Full TypeScript LanguageService in a Web Worker with
//     multi-file workspace sync — works in both browser preview and Android.
//   - 'terminal': External language server (e.g. typescript-language-server) running
//     in Alpine (proot) or native Termux terminal over WebSocket ↔ stdio.

import { useEffect, useRef, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import * as monaco from '@/core/mono';

import { fs } from '@/core/fileSystem';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { useStatusBarStore } from '@/features/statusbar/store/statusBarStore';
import { useNotificationStore } from '@/store/notificationStore';
import { useTabStore } from '@/store/tabStore';
import { useOutputStore } from '@/features/termis/components/output/store/outputStore';
import { getBuiltinWorkerFactory } from '@/features/extensions/builtin/builtinExtensions';

import type { ILspService } from '@/core/services/ILspService';
import { lspProcessManager as realProcessManager } from '@/features/lsp/LspProcessManager';
import { lspMockProcessManager } from '@/features/lsp/LspMockProcessManager';
import { LspService } from '@/core/services/lsp/LspService';
import { LspMockService } from '@/core/services/lsp/LspMockService';
import { toLspUri } from '@/core/services/lsp/utils/uriHelpers';

const NativeTerminal = registerPlugin<any>('NativeTerminal');

export const realLspService = new LspService();
export const mockLspService = new LspMockService();

const isWeb = Capacitor.getPlatform() === 'web';

/**
 * Always expose the real LspService so both Web Worker LSP (browser + Android)
 * and Terminal LSP (Android Alpine/native) share one live service singleton.
 */
export const activeLspService: ILspService = realLspService;
export function getActiveLspService(): ILspService {
  return activeLspService;
}

const activeProcessManager = isWeb ? lspMockProcessManager : realProcessManager;

const MONACO_FALLBACK_LANGS = new Set([
  'javascript', 'typescript', 'javascriptreact', 'typescriptreact',
  'json', 'html', 'css', 'scss', 'less',
]);

const MONACO_ONLY_LANGS = new Set(['json', 'css', 'scss', 'less']);

const TS_FAMILY = new Set(['typescript', 'typescriptreact', 'javascript', 'javascriptreact']);

const WORKSPACE_SCAN_EXTS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|d\.ts)$/i;
const WORKSPACE_CONFIG_NAMES = new Set(['tsconfig.json', 'jsconfig.json', 'package.json']);
const WORKSPACE_SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.vite',
  'coverage', '.cache', '.turbo', 'out', 'target', 'vendor',
]);
const MAX_WORKSPACE_FILES = 150;
const MAX_WORKSPACE_FILE_BYTES = 256 * 1024;
const MAX_WORKSPACE_DEPTH = 6;

let lastNotifiedLang: string | null = null;

function refractorLangId(langId: string): string {
  const map: Record<string, string> = {
    javascript: 'Js', typescript: 'Ts',
    javascriptreact: 'Jsx', typescriptreact: 'Tsx',
    python: 'Py', markdown: 'Md', cpp: 'C++', c: 'C',
  };
  return map[langId] ?? (langId.charAt(0).toUpperCase() + langId.slice(1));
}

function sameFamily(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  if (a === b) return true;
  return TS_FAMILY.has(a) && TS_FAMILY.has(b);
}

function getDynamicConfig(langId: string): any | undefined {
  const realConfigs = (realProcessManager as any).dynamicConfigs as Record<string, any> | undefined;
  const mockConfigs = (lspMockProcessManager as any).dynamicConfigs as Record<string, any> | undefined;
  const lookup = (configs?: Record<string, any>) => {
    if (!configs) return undefined;
    if (configs[langId]) return configs[langId];
    if (langId === 'typescriptreact' && configs['typescript']) return configs['typescript'];
    if (langId === 'javascriptreact' && configs['javascript']) return configs['javascript'];
    if (langId === 'javascript' && configs['typescript']) return configs['typescript'];
    return undefined;
  };
  return lookup(realConfigs) ?? lookup(mockConfigs);
}

function resolveServerMode(
  dynamicConfig: any,
  settings: Record<string, any>,
): 'web-worker' | 'terminal' {
  if (!dynamicConfig) return 'terminal';
  const hasWorker = !!(dynamicConfig.workerId && getBuiltinWorkerFactory(dynamicConfig.workerId));
  const settingKey = dynamicConfig.serverModeSetting as string | undefined;
  const configured = settingKey ? settings?.[settingKey] : undefined;

  if (configured === 'terminal') return 'terminal';
  if (configured === 'web-worker' && hasWorker) return 'web-worker';
  if (dynamicConfig.defaultMode === 'web-worker' && hasWorker) return 'web-worker';
  return 'terminal';
}

function resolveFileUri(
  tab: { id: string; filePath?: string; title?: string } | undefined,
  model: monaco.editor.ITextModel,
): string {
  if (tab?.filePath) {
    const p = tab.filePath;
    return p.startsWith('file://') ? p : `file://${p.startsWith('/') ? p : `/${p}`}`;
  }
  if (tab?.id && tab.id.startsWith('file://')) return tab.id;
  const mu = model?.uri?.toString?.() ?? '';
  if (mu && !mu.startsWith('inmemory')) return mu;
  const title = tab?.title ?? 'untitled.ts';
  return `file:///workspace/${title}`;
}

function computeRootPath(fileUri: string, workspacePath: string | null): string {
  const filePath = (() => {
    const raw = fileUri.replace(/^file:\/\//i, '').replace(/^\/storage\/emulated\/0/i, '/sdcard');
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  })();

  if (workspacePath) {
    const cleanWs = workspacePath
      .replace(/^file:\/\//i, '')
      .replace(/^\/storage\/emulated\/0/i, '/sdcard')
      .replace(/\/+$/, '');
    if (cleanWs && (filePath.startsWith(cleanWs + '/') || filePath === cleanWs)) {
      return cleanWs;
    }
  }

  const lastSlash = filePath.lastIndexOf('/');
  return lastSlash > 0 ? filePath.substring(0, lastSlash) : '/workspace';
}

/**
 * Recursively scan the active workspace (bounded) for TS/JS/tsconfig/package.json files
 * to populate the Web Worker LanguageService virtual filesystem for cross-file intelligence.
 */
async function collectWorkspaceTsFiles(
  rootDir: string,
  openTabs: Array<{ id: string; filePath?: string; title?: string; content?: string }>,
): Promise<Array<{ uri: string; text: string }>> {
  const collected = new Map<string, string>();

  const addFile = (pathOrUri: string, text: string) => {
    if (collected.size >= MAX_WORKSPACE_FILES) return;
    if (text.length > MAX_WORKSPACE_FILE_BYTES) return;
    collected.set(toLspUri(pathOrUri), text);
  };

  // 1. Scan workspace filesystem safely
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_WORKSPACE_DEPTH || collected.size >= MAX_WORKSPACE_FILES) return;
    let entries: Array<{ name: string; path: string; isDirectory: boolean }>;
    try {
      entries = await fs.readDir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (collected.size >= MAX_WORKSPACE_FILES) break;
      if (entry.isDirectory) {
        if (WORKSPACE_SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        await walk(entry.path, depth + 1);
      } else if (
        WORKSPACE_SCAN_EXTS.test(entry.name) ||
        WORKSPACE_CONFIG_NAMES.has(entry.name)
      ) {
        try {
          const content = await fs.readFile(entry.path);
          if (typeof content === 'string') {
            addFile(entry.path, content);
          }
        } catch {
          /* skip unreadable file */
        }
      }
    }
  };

  if (rootDir && rootDir !== '/') {
    await walk(rootDir, 0);
  }

  // 2. Overlay any open tab contents & live MonoEditor models (always freshest)
  for (const t of openTabs) {
    const path = t.filePath || (t.id?.startsWith('file://') ? t.id : undefined);
    if (!path) continue;
    if (!WORKSPACE_SCAN_EXTS.test(path) && !WORKSPACE_CONFIG_NAMES.has(t.title ?? '')) continue;
    if (typeof (t as any).content === 'string') {
      collected.set(toLspUri(path), (t as any).content);
    }
  }

  for (const ed of monaco.editor.getEditors()) {
    const m = ed?.getModel?.();
    if (!m) continue;
    const lang = m.getLanguageId?.() ?? '';
    if (!TS_FAMILY.has(lang)) continue;
    const uri = activeLspService.getDocUriForModel?.(m) || m.uri?.toString?.();
    if (uri && !uri.startsWith('inmemory:')) {
      collected.set(toLspUri(uri), m.getValue());
    }
  }

  return Array.from(collected.entries()).map(([uri, text]) => ({ uri, text }));
}

function disableMonacoTsDiagnostics(langId: string) {
  const monacoLangs = monaco.languages as any;
  if (!monacoLangs?.typescript) return;
  const defaults =
    langId === 'javascript' || langId === 'javascriptreact'
      ? monacoLangs.typescript.javascriptDefaults
      : monacoLangs.typescript.typescriptDefaults;
  if (!defaults?.setDiagnosticsOptions) return;
  defaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: true,
    diagnosticCodesToIgnore: [],
  });
}

function disableMonacoHtmlService() {
  const monacoLangs = monaco.languages as any;
  const defaults = monacoLangs?.html?.htmlDefaults;
  if (!defaults?.setOptions) return;
  try {
    defaults.setOptions({
      format: { enable: false },
      suggest: { html5: false },
    });
  } catch {
    /* ignore */
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useLspSync(editorInstance: any, tabId: string) {
  const settings = useSettingsStore((s) => s.settings);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const tabs = useTabStore((s) => s.tabs);
  const currentWorkspacePath = useTabStore((s) => s.currentWorkspacePath);
  const bootingRef = useRef(false);
  const [lifecycleTick, setLifecycleTick] = useState(0);

  // Register status-bar slot once — only visible on code editor tabs
  useEffect(() => {
    useStatusBarStore.getState().registerItem({
      id: 'lsp-status',
      alignment: 'right',
      priority: 55,
      label: 'LSP: Off',
      icon: 'check',
      when: "activeTabType == 'code'",
    });
  }, []);

  // React immediately when extensions register/unregister LSP servers or request restart
  useEffect(() => {
    const onConfigChanged = () => setLifecycleTick((t) => t + 1);
    const onRestart = () => {
      activeLspService.disconnect();
      activeProcessManager.stopServer();
      setLifecycleTick((t) => t + 1);
    };
    window.addEventListener('ms-lsp-config-changed', onConfigChanged);
    window.addEventListener('ms-lsp-restart', onRestart);
    return () => {
      window.removeEventListener('ms-lsp-config-changed', onConfigChanged);
      window.removeEventListener('ms-lsp-restart', onRestart);
    };
  }, []);

  useEffect(() => {
    if (tabId !== activeTabId || !editorInstance) return;

    const model = editorInstance.getModel();
    if (!model) return;

    const langId = model.getLanguageId();
    const notifId = `lsp-boot-${langId}`;
    const baseLang =
      langId === 'typescriptreact'
        ? 'typescript'
        : langId === 'javascriptreact'
          ? 'javascript'
          : langId;

    const isEnabled =
      settings[`lsp.${langId}.enabled`] ??
      settings[`lsp.${baseLang}.enabled`] ??
      settings[`${baseLang}.enable`] ??
      true;

    const dynamicConfig = getDynamicConfig(langId);
    const preferExternal = !!dynamicConfig && isEnabled;
    const isMonacoOnly =
      MONACO_ONLY_LANGS.has(langId) ||
      (MONACO_FALLBACK_LANGS.has(langId) && !preferExternal);

    if (isEnabled) {
      useStatusBarStore.getState().updateItem('lsp-status', {
        label: `{${refractorLangId(langId)}}`,
        icon: 'check',
        spin: false,
        color: 'var(--vscode-testing-iconPassed, #73c991)',
      });
    } else {
      useStatusBarStore.getState().updateItem('lsp-status', {
        label: 'LSP: Off',
        icon: 'check',
        color: 'inherit',
      });
    }

    const activeTab = tabs.find((t) => t.id === activeTabId);
    const fileUri = resolveFileUri(activeTab, model);

    if (!isMonacoOnly) {
      activeLspService.registerModelUri(model, fileUri);
    }

    // 1. BUILT-IN / NON-LSP FALLBACK (json/css/scss/less or ts/js if extension disabled)
    if (isMonacoOnly) {
      const monacoLangs = monaco.languages as any;

      if (TS_FAMILY.has(langId)) {
        const tsLang = monacoLangs?.typescript;
        const defaults = tsLang
          ? (langId === 'javascript' || langId === 'javascriptreact'
            ? tsLang.javascriptDefaults
            : tsLang.typescriptDefaults)
          : undefined;
        if (defaults) {
          const isLinting = settings[`lsp.${baseLang}.linting`] ?? true;
          defaults.setDiagnosticsOptions?.({
            noSemanticValidation: !isEnabled || !isLinting,
            noSyntaxValidation: !isEnabled || !isLinting,
            diagnosticCodesToIgnore: settings['lsp.javascript.ignoreCodes'] || [],
          });
          defaults.setEagerModelSync?.(true);
        }
      } else if (langId === 'json') {
        monacoLangs?.json?.jsonDefaults?.setDiagnosticsOptions?.({
          validate: isEnabled && settings['lsp.json.schemaValidation'] !== false,
          allowComments: true,
          schemaValidation: isEnabled ? 'error' : 'ignore',
        });
      } else if (langId === 'html') {
        monacoLangs?.html?.htmlDefaults?.setOptions?.({
          format: {
            enable: true,
            insertSpaces: settings['editor.insertSpaces'] ?? true,
            tabSize: settings['editor.tabSize'] ?? 4,
          },
          suggest: { html5: true },
        });
      } else if (['css', 'scss', 'less'].includes(langId)) {
        const cssOpts = {
          validate: isEnabled && (settings[`lsp.${langId}.linting`] ?? true),
          lint: {
            unknownProperties: settings['lsp.css.lint.unknownProperties'] !== false ? 'warning' : 'ignore',
            emptyRules: 'warning',
          },
        };
        if (langId === 'css') monacoLangs?.css?.cssDefaults?.setOptions?.(cssOpts);
        if (langId === 'scss') monacoLangs?.css?.scssDefaults?.setOptions?.(cssOpts);
        if (langId === 'less') monacoLangs?.css?.lessDefaults?.setOptions?.(cssOpts);
      }

      if (activeLspService.isConnected) {
        const currentLang = activeLspService.languageId || activeProcessManager.getActiveLanguage?.() || null;
        if (currentLang && !MONACO_FALLBACK_LANGS.has(currentLang)) {
          activeLspService.disconnect();
          activeProcessManager.stopServer(currentLang);
          lastNotifiedLang = null;
        }
      }
      return;
    }

    // ══════════════════════════════════════════════════════════════════════
    // 2. EXTENSION-DRIVEN LSP (Web Worker OR Alpine/Native Terminal Server)
    // ══════════════════════════════════════════════════════════════════════

    if (TS_FAMILY.has(langId)) {
      disableMonacoTsDiagnostics(langId);
    }
    if (langId === 'html') {
      disableMonacoHtmlService();
    }

    const currentLang = activeLspService.languageId || activeProcessManager.getActiveLanguage?.() || null;
    const currentMode = activeLspService.mode;

    if (!dynamicConfig || !isEnabled) {
      if (activeLspService.isConnected) {
        activeLspService.disconnect();
        activeProcessManager.stopServer(currentLang ?? undefined);
      }
      useStatusBarStore.getState().updateItem('lsp-status', {
        label: 'LSP: Off',
        icon: 'check',
        color: 'inherit',
      });
      return;
    }

    const desiredMode = resolveServerMode(dynamicConfig, settings);
    const modeChanged = activeLspService.isConnected && currentMode !== desiredMode;

    // Mode switched (e.g. web-worker ↔ terminal in settings): cleanly tear down old server
    if (modeChanged) {
      activeLspService.disconnect();
      activeProcessManager.stopServer(currentLang ?? undefined);
    }

    // Same language/family, same mode, already connected → fast path (no restart)
    if (
      !modeChanged &&
      sameFamily(currentLang, langId) &&
      activeLspService.isConnected
    ) {
      activeLspService.registerModelUri(model, fileUri);

      useStatusBarStore.getState().updateItem('lsp-status', {
        label: desiredMode === 'web-worker'
          ? `{${refractorLangId(langId)} · Worker}`
          : `{${refractorLangId(langId)}}`,
        icon: 'check',
        spin: false,
        color: 'var(--vscode-testing-iconPassed, #73c991)',
      });

      const syncTab = () => {
        activeLspService.notifyDocumentOpen(model);
        if (desiredMode === 'web-worker') {
          const rootDir = computeRootPath(fileUri, currentWorkspacePath);
          void collectWorkspaceTsFiles(rootDir, tabs as any).then((files) => {
            if (files.length > 0) activeLspService.syncWorkspaceFiles?.(files);
          });
        }
      };

      if (activeLspService.initialized) {
        syncTab();
      } else {
        activeLspService.waitUntilReady().then(syncTab).catch(() => {});
      }
      return;
    }

    // Different language family or dead connection → tear down previous server
    if (currentLang && (!sameFamily(currentLang, langId) || !activeLspService.isConnected)) {
      activeLspService.disconnect();
      activeProcessManager.invalidatePort?.(currentLang);
      activeProcessManager.stopServer(currentLang);
    }

    const channelName = `LSP: ${refractorLangId(langId)}`;
    useOutputStore.getState().createChannel(channelName);

    const outputChannel = {
      appendLine: (text: string) => {
        useOutputStore.getState().appendLog(channelName, `${text}\n`);
      },
      show: () => {
        useOutputStore.getState().setActiveChannel(channelName);
      },
    };

    useOutputStore.getState().registerKillHandler(channelName, () => {
      activeLspService.disconnect();
      activeProcessManager.stopServer(langId);
      useStatusBarStore.getState().updateItem('lsp-status', {
        label: 'LSP: Killed',
        icon: 'close',
        color: 'var(--ms-error)',
      });
    });

    const bootGeneration = ((bootingRef as any)._gen = ((bootingRef as any)._gen | 0) + 1);
    bootingRef.current = true;

    const buildLspOptions = (rootUri: string) => {
      let lspOptions: Record<string, any> = {
        mode: desiredMode,
        hover: settings[`lsp.${baseLang}.hover`] ?? true,
        completion: settings[`lsp.${baseLang}.completion`] ?? true,
        linting: settings[`lsp.${baseLang}.linting`] ?? true,
        references: settings[`lsp.${baseLang}.references`] ?? true,
        documentHighlight: settings[`lsp.${baseLang}.documentHighlight`] ?? true,
        documentSymbol: settings[`lsp.${baseLang}.documentSymbol`] ?? true,
        codeActions: settings[`lsp.${baseLang}.codeActions`] ?? true,
        codeLens: settings[`lsp.${baseLang}.codeLens`] ?? false,
        foldingRange: settings[`lsp.${baseLang}.foldingRange`] ?? true,
        inlayHints:
          settings[`lsp.${baseLang}.inlayHints`] ??
          settings['typescript.inlayHints.enabled'] ??
          true,
        semanticTokens: settings[`lsp.${baseLang}.semanticHighlighting`] ?? true,
        onTypeFormatting: settings[`lsp.${baseLang}.formatOnType`] ?? true,
        colorProvider: true,
        rootUri,
      };

      if (typeof dynamicConfig.resolveOptions === 'function') {
        lspOptions = { ...lspOptions, ...dynamicConfig.resolveOptions(settings) };
      }

      for (const key of Object.keys(settings || {})) {
        if (
          key.startsWith('typescript.') ||
          key.startsWith('javascript.') ||
          key.startsWith('lsp.typescript') ||
          key.startsWith('lsp.javascript') ||
          key.startsWith('editor.inlayHints')
        ) {
          if (lspOptions[key] === undefined) {
            lspOptions[key] = (settings as any)[key];
          }
        }
      }
      return lspOptions;
    };

    const boot = async () => {
      const isStale = () => (bootingRef as any)._gen !== bootGeneration;
      try {
        if (isStale()) return;

        const rootDir = computeRootPath(fileUri, currentWorkspacePath);
        const rootUri = toLspUri(rootDir);
        const lspOptions = buildLspOptions(rootUri);

        // ── PATH A: BUILT-IN WEB WORKER LSP (DEFAULT FOR TS/JS) ────────────
        if (desiredMode === 'web-worker') {
          const workerFactory = dynamicConfig.workerId
            ? getBuiltinWorkerFactory(dynamicConfig.workerId)
            : undefined;
          if (!workerFactory) {
            throw new Error(`No Web Worker factory registered for workerId="${dynamicConfig.workerId}"`);
          }

          outputChannel.appendLine(`[INFO] Starting ${langId} Web Worker LSP…`);
          useStatusBarStore.getState().updateItem('lsp-status', {
            label: `Starting ${refractorLangId(langId)}…`,
            icon: 'sync',
            spin: true,
          });

          if (isStale()) return;

          activeLspService.connectWorker?.(langId, workerFactory, lspOptions);
          await Promise.race([
            activeLspService.waitUntilReady(),
            new Promise<void>((_, reject) =>
              setTimeout(() => reject(new Error('Web Worker LSP initialize timeout (20s)')), 20_000),
            ),
          ]);

          if (isStale()) return;

          // Multi-file workspace sync before opening active document so imports resolve immediately
          const workspaceFiles = await collectWorkspaceTsFiles(rootDir, tabs as any);
          if (workspaceFiles.length > 0) {
            activeLspService.syncWorkspaceFiles?.(workspaceFiles);
          }

          activeLspService.registerModelUri(model, fileUri);
          activeLspService.notifyDocumentOpen(model);

          outputChannel.appendLine(
            `[INFO] ${refractorLangId(langId)} Web Worker LSP ready (${workspaceFiles.length} workspace file(s) synced).`,
          );

          useStatusBarStore.getState().updateItem('lsp-status', {
            label: `{${refractorLangId(langId)} · Worker}`,
            icon: 'check',
            spin: false,
            color: 'var(--vscode-testing-iconPassed, #73c991)',
          });

          if (lastNotifiedLang !== `${langId}:worker`) {
            lastNotifiedLang = `${langId}:worker`;
            useNotificationStore.getState().addNotification({
              id: notifId,
              type: 'info',
              title: `${refractorLangId(langId)} LSP Ready`,
              source: 'TS Web Worker',
              message: `TypeScript LanguageService running in Web Worker (${workspaceFiles.length} file(s) synced).`,
            });
            setTimeout(() => useNotificationStore.getState().dismissToast(notifId), 2500);
          }
          return;
        }

        // ── PATH B: EXTERNAL TERMINAL LSP (ALPINE PROOT / NATIVE TERMUX) ──
        if (isWeb) {
          outputChannel.appendLine(
            `[WARN] Terminal mode selected for ${langId}, but external terminal servers require Android/Alpine. Switch typescript.server.mode to "web-worker" in Settings to run in browser.`,
          );
          useStatusBarStore.getState().updateItem('lsp-status', {
            label: `{${refractorLangId(langId)} · Terminal N/A}`,
            icon: 'warning',
            spin: false,
            color: 'var(--vscode-editorWarning-foreground, #cca700)',
          });
          useNotificationStore.getState().addNotification({
            id: notifId,
            type: 'warning',
            title: 'Terminal LSP Unavailable in Browser',
            source: 'MS Code LSP',
            message:
              'External typescript-language-server runs in Alpine/Android terminal. Switch back to Web Worker mode to test in browser.',
            actions: dynamicConfig.workerId
              ? [
                  {
                    label: 'Use Web Worker',
                    variant: 'type1',
                    onClick: () => {
                      const key = dynamicConfig.serverModeSetting || 'typescript.server.mode';
                      useSettingsStore.getState().updateSetting(key, 'web-worker');
                    },
                  },
                ]
              : undefined,
          });
          return;
        }

        outputChannel.appendLine(`[INFO] Starting external ${langId} language server (terminal mode)…`);
        useStatusBarStore.getState().updateItem('lsp-status', {
          label: `Starting ${refractorLangId(langId)}…`,
          icon: 'sync',
          spin: true,
        });
        useNotificationStore.getState().addNotification({
          id: notifId,
          type: 'loading',
          title: `Initializing ${langId.toUpperCase()} Server`,
          source: 'MS Code LSP',
          message: 'Checking dependencies…',
        });

        const startKey =
          (realProcessManager as any).dynamicConfigs?.[langId]
            ? langId
            : TS_FAMILY.has(langId) && (realProcessManager as any).dynamicConfigs?.['typescript']
              ? 'typescript'
              : langId;

        let nativeLogHandle: { remove: () => void } | null = null;
        try {
          if (Capacitor.isNativePlatform()) {
            nativeLogHandle = await NativeTerminal.addListener(
              'onLog',
              (ev: { message?: string }) => {
                const line = ev?.message ?? '';
                if (!line) return;
                if (/\[LSP|typescript|tsserver|ProcessServer|node |PATH=|PREFIX=|html|MODULE|Error|exited|stderr|Cannot find/i.test(line)) {
                  outputChannel.appendLine(line);
                }
              },
            );
          }
        } catch (e) {
          outputChannel.appendLine(`[DEBUG] onLog bridge unavailable: ${e}`);
        }

        const port = await realProcessManager.startServer(startKey);
        if (!port) {
          outputChannel.appendLine(`[ERROR] Failed to start ${langId} server process.`);
          try { nativeLogHandle?.remove(); } catch { /* ignore */ }
          bootingRef.current = false;
          return;
        }

        if (startKey === 'typescript' || startKey === 'javascript') {
          for (const sib of TS_FAMILY) {
            if (sib !== startKey) realProcessManager.sharePort?.(startKey, sib);
          }
        }

        outputChannel.appendLine(`[INFO] Server process on port ${port}. Connecting…`);

        // Inject Termux $PREFIX tsserver.js ONLY when running in native Termux mode.
        // In Alpine (proot), typescript-language-server resolves its Alpine global tsserver.js
        // automatically (or honors explicit typescript.tsdk).
        const execMode = settings['terminal.defaultExecMode'] === 'native' ? 'native' : 'proot';
        if (
          TS_FAMILY.has(langId) &&
          Capacitor.isNativePlatform() &&
          execMode === 'native' &&
          !settings['typescript.tsdk']
        ) {
          try {
            const setup = await NativeTerminal.checkSetup();
            const prefix = setup?.prefix as string | undefined;
            if (prefix) {
              const tsFile = `${prefix}/lib/node_modules/typescript/lib/tsserver.js`;
              const prevTs = lspOptions.initializationOptions?.tsserver || {};
              lspOptions.initializationOptions = {
                ...(lspOptions.initializationOptions || {}),
                tsserver: {
                  ...prevTs,
                  path: tsFile,
                  maxTsServerMemory: Math.min(Number(prevTs.maxTsServerMemory) || 512, 768),
                },
              };
              outputChannel.appendLine(`[DEBUG] native tsserver.path → ${tsFile}`);
            }
          } catch (e) {
            outputChannel.appendLine(`[WARN] checkSetup() for tsserver.path failed: ${e}`);
          }
        } else if (TS_FAMILY.has(langId) && execMode === 'proot') {
          const prevTs = lspOptions.initializationOptions?.tsserver || {};
          lspOptions.initializationOptions = {
            ...(lspOptions.initializationOptions || {}),
            tsserver: {
              ...prevTs,
              maxTsServerMemory: Math.min(Number(prevTs.maxTsServerMemory) || 512, 768),
            },
          };
          outputChannel.appendLine(`[DEBUG] Alpine proot mode — using Alpine global tsserver.js`);
        }

        if (isStale()) return;

        activeLspService.connect(langId, `ws://127.0.0.1:${port}`, lspOptions);

        try {
          await Promise.race([
            activeLspService.waitUntilReady(),
            new Promise<void>((_, reject) =>
              setTimeout(
                () =>
                  reject(
                    new Error(
                      'LSP initialize timeout (45s) — check [LSP-stderr] / process exited above',
                    ),
                  ),
                45_000,
              ),
            ),
          ]);
        } finally {
          setTimeout(() => {
            try { nativeLogHandle?.remove(); } catch { /* ignore */ }
          }, 2000);
        }

        activeLspService.registerModelUri(model, fileUri);
        activeLspService.notifyDocumentOpen(model);

        outputChannel.appendLine(`[INFO] ${refractorLangId(langId)} Terminal LSP ready.`);
        outputChannel.show();

        realProcessManager.markAlive?.(startKey);
        realProcessManager.markAlive?.(langId);

        useStatusBarStore.getState().updateItem('lsp-status', {
          label: `{${refractorLangId(langId)}}`,
          icon: 'check',
          spin: false,
          color: 'var(--vscode-testing-iconPassed, #73c991)',
        });
        useNotificationStore.getState().updateNotification(notifId, {
          type: 'info',
          title: 'LSP Connected',
          message: `${refractorLangId(langId)} Language Server is ready.`,
        });
        setTimeout(() => useNotificationStore.getState().dismissToast(notifId), 3000);
        lastNotifiedLang = `${langId}:terminal`;
      } catch (err: any) {
        const msg =
          err?.message ||
          err?.lspError?.message ||
          (typeof err === 'object' ? JSON.stringify(err) : String(err));
        outputChannel.appendLine(`[ERROR] ${msg}`);
        console.error(`[LSP-Sync] Boot error for ${langId}:`, err);

        activeLspService.disconnect();
        activeProcessManager.stopServer(langId);
        activeProcessManager.invalidatePort?.(langId);

        if (desiredMode === 'terminal' && !(boot as any)._retried) {
          (boot as any)._retried = true;
          outputChannel.appendLine(`[INFO] Retrying ${langId} language server…`);
          bootingRef.current = false;
          setTimeout(() => {
            if (!bootingRef.current) {
              bootingRef.current = true;
              boot();
            }
          }, 400);
          return;
        }

        useStatusBarStore.getState().updateItem('lsp-status', {
          label: 'LSP Error',
          icon: 'error',
          spin: false,
          color: 'var(--vscode-errorForeground)',
        });
        useNotificationStore.getState().updateNotification(notifId, {
          type: 'error',
          message: `Boot failed: ${msg}`,
        });
      } finally {
        if ((bootingRef as any)._gen === bootGeneration) {
          if (!(boot as any)._retried || activeLspService.initialized) {
            bootingRef.current = false;
          }
        }
      }
    };

    boot();

    return () => {
      (bootingRef as any)._gen = ((bootingRef as any)._gen | 0) + 1;
      activeLspService.unregisterModelUri(model);
      bootingRef.current = false;
    };
  }, [editorInstance, settings, activeTabId, tabId, tabs, currentWorkspacePath, lifecycleTick]);
}
