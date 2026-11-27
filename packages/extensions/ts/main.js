// main.js — TypeScript & JavaScript Language Features (Web Worker LSP + Alpine/native typescript-language-server)
// VS Code–style full language support for MS Code.

import { window, lsp, commands, workspace } from '@mscode/api';
import {
  TS_JS_LANGS,
  buildServerConfig,
  resolveTsOptions,
} from './serverConfig.js';

export { TS_JS_LANGS, buildServerConfig, resolveTsOptions };

export function activate(context) {
  console.log('[TypeScript] Activating — registering TS/JS LSP (Web Worker / Terminal)…');

  const config = buildServerConfig();
  const registration = lsp.registerServer(TS_JS_LANGS, config);

  if (registration && typeof registration.dispose === 'function') {
    context.subscriptions.push(registration);
  } else {
    context.subscriptions.push({
      dispose: () => {
        try { lsp.unregisterServer(TS_JS_LANGS); } catch (_) {}
      },
    });
  }

  // ── Commands ─────────────────────────────────────────────────────────────
  const restartCmd = commands.registerCommand('typescript.restartTsServer', () => {
    try {
      if (typeof lsp.stopServer === 'function') {
        for (const lang of TS_JS_LANGS) lsp.stopServer(lang);
      }
      lsp.unregisterServer(TS_JS_LANGS);
    } catch (_) {}

    const reg = lsp.registerServer(TS_JS_LANGS, buildServerConfig());
    if (reg && reg.dispose) context.subscriptions.push(reg);

    try {
      globalThis.dispatchEvent?.(
        new CustomEvent('ms-lsp-restart', { detail: { langs: TS_JS_LANGS } }),
      );
    } catch (_) {}

    window.showInformationMessage('TypeScript language server restarting…');
  });

  const toggleModeCmd = commands.registerCommand('typescript.selectServerMode', () => {
    const cfg = workspace.getConfiguration?.('typescript');
    const current = cfg?.get?.('server.mode', 'web-worker') || 'web-worker';
    const next = current === 'terminal' ? 'web-worker' : 'terminal';
    if (typeof cfg?.update === 'function') {
      cfg.update('server.mode', next);
    }
    try {
      globalThis.dispatchEvent?.(
        new CustomEvent('ms-lsp-restart', { detail: { langs: TS_JS_LANGS, mode: next } }),
      );
    } catch (_) {}
    window.showInformationMessage(
      next === 'terminal'
        ? 'TypeScript LSP switched to Terminal mode (typescript-language-server in Alpine/native).'
        : 'TypeScript LSP switched to Built-in Web Worker mode.',
    );
  });

  const goToConfigCmd = commands.registerCommand('typescript.goToProjectConfig', async () => {
    const folders = workspace.workspaceFolders || [];
    const root = folders[0]?.uri || workspace.workspacePath || '';
    if (!root) {
      window.showErrorMessage('No workspace folder open.');
      return;
    }
    const base = String(root).replace(/^file:\/\//, '');
    window.showInformationMessage(`Look for tsconfig.json / jsconfig.json under: ${base}`);
  });

  const selectVersionCmd = commands.registerCommand('typescript.selectTypeScriptVersion', () => {
    const cfg = workspace.getConfiguration?.('typescript');
    const mode = cfg?.get?.('server.mode', 'web-worker') || 'web-worker';
    const tsdk = cfg?.get?.('tsdk', '') || '';
    if (mode !== 'terminal') {
      window.showInformationMessage(
        'Using bundled TypeScript LanguageService (Web Worker mode). Change typescript.server.mode to "terminal" for external typescript-language-server.',
      );
      return;
    }
    window.showInformationMessage(
      tsdk
        ? `Using TypeScript from: ${tsdk}`
        : 'Using npm global / workspace TypeScript in terminal (set typescript.tsdk to override).',
    );
  });

  const openLogCmd = commands.registerCommand('typescript.openTsServerLog', () => {
    window.showInformationMessage(
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

  console.log('[TypeScript] registerServer done for', TS_JS_LANGS.join(', '));
}

export function deactivate() {
  try {
    lsp.unregisterServer(TS_JS_LANGS);
  } catch (_) {}
  console.log('[TypeScript] Deactivated.');
}
