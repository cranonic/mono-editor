import { describe, it, expect } from 'bun:test';
import {
  buildSymbolTreeRows,
  computeStickyAncestorIndices,
  isMatchingActiveSymbol,
  findDeepestSymbolAtLine,
} from '../src/features/editor/components/BreadCrumb/treeHelpers';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SymbolKind } from '../src/core/symbols/types';
import {
  TS_CHECK_CMD,
  TS_POST_INSTALL,
  buildServerConfig,
  resolveTsOptions,
} from '../../extensions/ts/serverConfig.js';

describe('Breadcrumb & Outline tree helpers', () => {
  const sampleTree = [
    {
      name: 'UserService',
      kind: SymbolKind.Class,
      detail: 'class',
      range: { startLineNumber: 1, startColumn: 1, endLineNumber: 30, endColumn: 1 },
      selectionRange: { startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 18 },
      children: [
        {
          name: 'fetchUser',
          kind: SymbolKind.Method,
          detail: 'async method',
          range: { startLineNumber: 5, startColumn: 3, endLineNumber: 18, endColumn: 3 },
          selectionRange: { startLineNumber: 5, startColumn: 9, endLineNumber: 5, endColumn: 18 },
          children: [
            {
              name: 'result',
              kind: SymbolKind.Constant,
              detail: 'const',
              range: { startLineNumber: 8, startColumn: 5, endLineNumber: 10, endColumn: 5 },
              selectionRange: { startLineNumber: 8, startColumn: 11, endLineNumber: 8, endColumn: 17 },
              children: [],
            },
          ],
        },
      ],
    },
  ];

  it('finds the deepest enclosing symbol at a cursor line', () => {
    expect(findDeepestSymbolAtLine(sampleTree as any, 9)?.name).toBe('result');
    expect(findDeepestSymbolAtLine(sampleTree as any, 12)?.name).toBe('fetchUser');
    expect(findDeepestSymbolAtLine(sampleTree as any, 2)?.name).toBe('UserService');
    expect(findDeepestSymbolAtLine(sampleTree as any, 50)).toBeNull();
  });

  it('matches active symbol by range or selectionRange startLineNumber', () => {
    const method = sampleTree[0].children[0] as any;
    expect(
      isMatchingActiveSymbol(method, {
        kind: 'symbol',
        label: 'fetchUser',
        range: { startLineNumber: 5, startColumn: 3, endLineNumber: 18, endColumn: 3 },
      }),
    ).toBe(true);
    expect(
      isMatchingActiveSymbol(method, {
        kind: 'symbol',
        label: 'fetchUser',
        range: { startLineNumber: 6, startColumn: 3, endLineNumber: 18, endColumn: 3 },
      }),
    ).toBe(false);
  });

  it('flattens symbol tree with active row highlight and computes sticky parent headers', () => {
    const rows = buildSymbolTreeRows(
      sampleTree as any,
      {
        kind: 'symbol',
        label: 'result',
        range: { startLineNumber: 8, startColumn: 5, endLineNumber: 10, endColumn: 5 },
      },
      new Set(),
    );
    expect(rows.length).toBe(3);
    expect(rows[2].isCurrent).toBe(true);
    expect(rows[0].isCurrent).toBe(false);
    expect(rows[2].depth).toBe(2);

    const sticky = computeStickyAncestorIndices(rows, 52, 26);
    expect(sticky).toEqual([0, 1]);
  });

  it('uses the same unified variable icon for const/let/var', () => {
    const iconMapSrc = readFileSync(
      resolve(__dirname, '../src/core/symbols/utils/iconMap.ts'),
      'utf8',
    );
    expect(iconMapSrc).toMatch(/case Kinds\.Variable:\s*case Kinds\.Constant:\s*return 'symbol-variable';/);
  });
});

describe('TypeScript extension serverConfig (Web Worker + Alpine terminal)', () => {
  it('defaults to web-worker mode and supports switching to terminal mode', () => {
    const cfg = buildServerConfig();
    expect(cfg.defaultMode).toBe('web-worker');
    expect(cfg.serverModeSetting).toBe('typescript.server.mode');
    expect(cfg.workerId).toBe('typescript');
    expect(cfg.prootPackages).toEqual(['nodejs', 'npm']);

    const defaultOpts = resolveTsOptions({});
    expect(defaultOpts.mode).toBe('web-worker');

    const termOpts = resolveTsOptions({ 'typescript.server.mode': 'terminal' });
    expect(termOpts.mode).toBe('terminal');
  });

  it('does not depend on Termux $PREFIX being set in Alpine proot checkCmd/postInstall', () => {
    expect(TS_CHECK_CMD).toContain('${PREFIX:-/usr}');
    expect(TS_CHECK_CMD).toContain('typescript-language-server');
    expect(TS_POST_INSTALL.every((cmd) => !cmd.includes('--prefix "$PREFIX"'))).toBe(true);
  });

  it('packages/extensions/ts/dist/main.js runs cleanly inside CJS sandbox for .msxt installs', () => {
    const bundleCode = readFileSync(
      resolve(__dirname, '../../extensions/ts/dist/main.js'),
      'utf8',
    );
    const registeredLangs: string[][] = [];
    const registeredConfigs: any[] = [];
    const registeredCommands: string[] = [];

    const mockApi = {
      window: { showInformationMessage: () => {}, showErrorMessage: () => {} },
      lsp: {
        registerServer: (langs: string[], cfg: any) => {
          registeredLangs.push(langs);
          registeredConfigs.push(cfg);
          return { dispose: () => {} };
        },
        unregisterServer: () => {},
        stopServer: () => {},
      },
      commands: {
        registerCommand: (id: string) => {
          registeredCommands.push(id);
          return { dispose: () => {} };
        },
        executeCommand: () => {},
      },
      workspace: {
        getConfiguration: () => ({ get: (_k: string, d: any) => d, update: () => {} }),
        workspaceFolders: [],
      },
    };

    const moduleObj = { exports: {} as any };
    const fn = new Function('require', 'module', 'exports', `"use strict";\n${bundleCode}\nreturn module.exports;`);
    const exported = fn((id: string) => {
      if (id === '@mscode/api') return mockApi;
      throw new Error(`Unexpected require: ${id}`);
    }, moduleObj, moduleObj.exports);

    expect(typeof exported.activate).toBe('function');
    expect(typeof exported.deactivate).toBe('function');

    const subscriptions: any[] = [];
    exported.activate({ subscriptions });

    expect(registeredLangs[0]).toEqual(['typescript', 'typescriptreact', 'javascript', 'javascriptreact']);
    expect(registeredConfigs[0].workerId).toBe('typescript');
    expect(registeredConfigs[0].defaultMode).toBe('web-worker');
    expect(registeredConfigs[0].serverModeSetting).toBe('typescript.server.mode');
    expect(registeredCommands).toContain('typescript.restartTsServer');
    expect(registeredCommands).toContain('typescript.selectServerMode');
  });
});
