// src/core/extensionAPI/modules/lspModule.ts

import { lspProcessManager } from '@/features/lsp/LspProcessManager';
import { lspMockProcessManager } from '@/features/lsp/LspMockProcessManager';

export interface LspServerConfig {
  /** Package names for native (Termux $PREFIX / pkg). */
  packages: string[];
  /** Optional Alpine/apk package names when terminal backend is proot. */
  prootPackages?: string[];
  /** Optional shell commands after packages are installed (e.g. 'npm install -g pyright'). */
  postInstall?: string[];
  /** Shell command to check if the server is already installed. Must return exit code 0. */
  checkCmd: string;
  /** The shell command that boots the LSP server process using standard I/O. */
  serverCmd: string;
  /** Optional built-in Web Worker LSP identifier (e.g. 'typescript'). */
  workerId?: string;
  /** Optional setting key controlling 'web-worker' vs 'terminal' mode (e.g. 'typescript.server.mode'). */
  serverModeSetting?: string;
  /** Default transport mode when setting is unset. */
  defaultMode?: 'web-worker' | 'terminal';
  /** Optional: map workspace settings → feature / initialization options (used by useLspSync). */
  resolveOptions?: (settings: Record<string, unknown>) => Record<string, unknown>;
}

function emitConfigChanged(languages: string[]): void {
  try {
    window.dispatchEvent(new CustomEvent('ms-lsp-config-changed', { detail: { languages } }));
  } catch {
    /* non-browser env */
  }
}

export const createLspModule = (_extId: string) => ({
  /**
   * Registers a language server for one or more language IDs.
   * Registered into both real and mock process managers so web and native
   * always resolve the extension's LSP configuration consistently.
   */
  registerServer: (languages: string[], config: LspServerConfig) => {
    languages.forEach((lang) => {
      lspProcessManager.registerDynamicConfig(lang, config);
      lspMockProcessManager.registerDynamicConfig(lang, config);
    });
    emitConfigChanged(languages);

    return {
      dispose: () => {
        languages.forEach((lang) => {
          lspProcessManager.stopServer(lang);
          lspProcessManager.removeDynamicConfig(lang);
          lspMockProcessManager.stopServer(lang);
          lspMockProcessManager.removeDynamicConfig(lang);
        });
        emitConfigChanged(languages);
      },
    };
  },

  /**
   * Unregisters and stops servers for the given language IDs.
   */
  unregisterServer: (languages: string[]): void => {
    languages.forEach((lang) => {
      lspProcessManager.stopServer(lang);
      lspProcessManager.removeDynamicConfig(lang);
      lspMockProcessManager.stopServer(lang);
      lspMockProcessManager.removeDynamicConfig(lang);
    });
    emitConfigChanged(languages);
  },

  /**
   * Install (if needed) and spawn the language server.
   */
  startServer: (language: string): Promise<number | null> => {
    return lspProcessManager.startServer(language);
  },

  /**
   * Stop one language server, or all if `language` is omitted.
   */
  stopServer: (language?: string): void => {
    lspProcessManager.stopServer(language);
    lspMockProcessManager.stopServer(language);
  },
});

export type LspModule = ReturnType<typeof createLspModule>;