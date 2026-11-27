import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

const vscodeShim = path.resolve(__dirname, './src/shims/vscode.ts');
const tsLibDir = path.resolve(__dirname, './node_modules/typescript/lib');
const optionalTsExtDir = path.resolve(__dirname, '../extensions/ts');

const TS_STDLIB_FILES = [
  'lib.es5.d.ts',
  'lib.es2015.core.d.ts',
  'lib.es2015.collection.d.ts',
  'lib.es2015.iterable.d.ts',
  'lib.es2015.promise.d.ts',
  'lib.es2015.symbol.d.ts',
  'lib.es2016.array.include.d.ts',
  'lib.es2017.object.d.ts',
  'lib.es2018.promise.d.ts',
  'lib.es2019.array.d.ts',
  'lib.es2020.promise.d.ts',
  'lib.es2020.string.d.ts',
  'lib.es2022.array.d.ts',
  'lib.es2022.object.d.ts',
  'lib.dom.d.ts',
  'lib.dom.iterable.d.ts',
];

/**
 * Provides TypeScript stdlib .d.ts contents as plain strings via a virtual module.
 * Avoids Vite 8's dependency optimizer stripping `.d.ts?raw` imports in dev mode.
 */
function tsLspLibsPlugin(): Plugin {
  const virtualId = 'virtual:ts-lsp-libs';
  const resolvedId = '\0' + virtualId;
  return {
    name: 'ms-ts-lsp-libs',
    resolveId(id) {
      if (id === virtualId) return resolvedId;
      return null;
    },
    load(id) {
      if (id !== resolvedId) return null;
      const libs: Record<string, string> = {};
      for (const name of TS_STDLIB_FILES) {
        const full = path.join(tsLibDir, name);
        if (fs.existsSync(full)) {
          libs[name] = fs.readFileSync(full, 'utf8');
        }
      }
      return `export default ${JSON.stringify(libs)};`;
    },
  };
}

/**
 * Optionally bundles `packages/extensions/ts` as a built-in extension ONLY if present on disk.
 * When `packages/extensions/ts` is removed or omitted before building mscode, this exports
 * `null` so `vite dev`, `vite build`, and `tsc -b` succeed with zero errors and the user can
 * install the extension later via `.msxt`.
 */
function optionalBuiltinExtensionsPlugin(): Plugin {
  const virtualId = 'virtual:optional-builtin-extensions';
  const resolvedId = '\0' + virtualId;
  return {
    name: 'ms-optional-builtin-extensions',
    resolveId(id) {
      if (id === virtualId) return resolvedId;
      return null;
    },
    load(id) {
      if (id !== resolvedId) return null;
      const manifestPath = path.join(optionalTsExtDir, 'manifest.json');
      const serverConfigPath = path.join(optionalTsExtDir, 'serverConfig.js');
      if (!fs.existsSync(manifestPath) || !fs.existsSync(serverConfigPath)) {
        return 'export const OPTIONAL_TS_BUILTIN = null;';
      }
      const toImport = (rel: string) =>
        JSON.stringify(path.join(optionalTsExtDir, rel).replace(/\\/g, '/'));
      const hasFile = (rel: string) => fs.existsSync(path.join(optionalTsExtDir, rel));

      const lines: string[] = [
        `import manifest from ${toImport('manifest.json')};`,
        `import { TS_JS_LANGS, buildServerConfig } from ${toImport('serverConfig.js')};`,
      ];
      lines.push(
        hasFile('settings.json')
          ? `import settings from ${toImport('settings.json')};`
          : 'const settings = {};',
      );
      lines.push(
        hasFile('snippets/typescript.json')
          ? `import tsSnippets from ${toImport('snippets/typescript.json')};`
          : 'const tsSnippets = {};',
      );
      lines.push(
        hasFile('snippets/javascript.json')
          ? `import jsSnippets from ${toImport('snippets/javascript.json')};`
          : 'const jsSnippets = {};',
      );
      lines.push(
        hasFile('README.md')
          ? `import readme from ${JSON.stringify(path.join(optionalTsExtDir, 'README.md').replace(/\\/g, '/') + '?raw')};`
          : 'const readme = "";',
      );
      lines.push(
        hasFile('CHANGELOG.md')
          ? `import changelog from ${JSON.stringify(path.join(optionalTsExtDir, 'CHANGELOG.md').replace(/\\/g, '/') + '?raw')};`
          : 'const changelog = "";',
      );
      lines.push(
        hasFile('image/icon.png')
          ? `import iconUrl from ${toImport('image/icon.png')};`
          : 'const iconUrl = "";',
      );
      lines.push(
        'export const OPTIONAL_TS_BUILTIN = { manifest, settings, tsSnippets, jsSnippets, readme, changelog, iconUrl, TS_JS_LANGS, buildServerConfig };',
      );
      return lines.join('\n');
    },
  };
}

export default defineConfig({
  plugins: [react(), tsLspLibsPlugin(), optionalBuiltinExtensionsPlugin()],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './src') },
      { find: '@mono/editor/preview', replacement: path.resolve(__dirname, '../mono-editor/src/preview/index.ts') },
      { find: '@mono/editor/react', replacement: path.resolve(__dirname, '../mono-editor/src/react/MonoEditor.tsx') },
      { find: '@mono/editor', replacement: path.resolve(__dirname, '../mono-editor/src/index.ts') },
      { find: 'vscode', replacement: vscodeShim },
    ],
  },
  worker: {
    format: 'es',
    plugins: () => [tsLspLibsPlugin()],
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    hmr: false,
  },
  preview: {
    port: 3000,
    host: '0.0.0.0',
  },
});
