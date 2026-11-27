// packages/extensions/ts/worker/tsLspEngine.ts
//
// Full JSON-RPC 2.0 TypeScript & JavaScript Language Server powered by
// TypeScript's LanguageService API. Runs inside a Web Worker in the browser
// AND directly in Node/Bun for unit/integration tests.
//
// Implements the full LSP surface used by MS Code IDE & Mono Editor:
//   - initialize / initialized / shutdown / workspace/didChangeConfiguration
//   - mscode/syncFiles (multi-file workspace virtual filesystem sync)
//   - textDocument/didOpen / didChange / didClose / didSave
//   - textDocument/publishDiagnostics (syntactic + semantic + suggestion)
//   - textDocument/completion + completionItem/resolve (with auto-imports & docs)
//   - textDocument/hover
//   - textDocument/signatureHelp
//   - textDocument/definition, typeDefinition, implementation
//   - textDocument/references
//   - textDocument/prepareRename, textDocument/rename (multi-file)
//   - textDocument/documentSymbol (hierarchical)
//   - textDocument/documentHighlight
//   - textDocument/codeAction (quick fixes + organize imports) + codeAction/resolve
//   - textDocument/foldingRange
//   - textDocument/selectionRange
//   - textDocument/formatting, rangeFormatting, onTypeFormatting
//   - textDocument/inlayHint
//   - textDocument/semanticTokens/full

import type * as TS from 'typescript';
import { DOM_MINIMAL_DTS, MINIMAL_ES_FALLBACK_DTS } from './libDts';

export interface JsonRpcMessage {
  jsonrpc?: '2.0';
  id?: number | string;
  method?: string;
  params?: any;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

interface VirtualFile {
  path: string;
  uri: string;
  content: string;
  version: number;
  languageId?: string;
}

const LIB_PREFIX = '/__ts_libs__/';
const DEFAULT_LIB_NAME = `${LIB_PREFIX}lib.esnext.d.ts`;

export const SEMANTIC_TOKEN_TYPES = [
  'class',
  'enum',
  'interface',
  'namespace',
  'typeParameter',
  'type',
  'parameter',
  'variable',
  'enumMember',
  'property',
  'function',
  'method',
] as const;

export const SEMANTIC_TOKEN_MODIFIERS = [
  'declaration',
  'static',
  'async',
  'readonly',
  'defaultLibrary',
  'local',
] as const;

function uriToPath(uri: string): string {
  if (!uri) return '/untitled.ts';
  if (uri.startsWith(LIB_PREFIX)) return uri;
  let p = uri.replace(/^file:\/\//i, '');
  try {
    p = decodeURIComponent(p);
  } catch {
    /* keep raw */
  }
  p = p.replace(/\\/g, '/');
  if (!p.startsWith('/')) p = `/${p}`;
  return p;
}

function pathToUri(path: string): string {
  if (path.startsWith('file://')) return path;
  const clean = path.replace(/\\/g, '/');
  const withSlash = clean.startsWith('/') ? clean : `/${clean}`;
  const encoded = withSlash
    .split('/')
    .map((seg) => (seg === '' ? '' : encodeURIComponent(seg)))
    .join('/');
  return `file://${encoded}`;
}

function isTsJsFilePath(p: string): boolean {
  return /\.(?:[cm]?tsx?|[cm]?jsx?|d\.ts)$/i.test(p);
}

function isJsPath(p: string): boolean {
  return /\.(?:[cm]?jsx?)$/i.test(p);
}

function normalizeTextSpan(
  sf: TS.SourceFile,
  start: number,
  length: number,
): { start: { line: number; character: number }; end: { line: number; character: number } } {
  const maxPos = sf.text.length;
  const safeStart = Math.max(0, Math.min(maxPos, start));
  const safeEnd = Math.max(safeStart, Math.min(maxPos, start + Math.max(0, length)));
  const s = sf.getLineAndCharacterOfPosition(safeStart);
  const e = sf.getLineAndCharacterOfPosition(safeEnd);
  return {
    start: { line: s.line, character: s.character },
    end: { line: e.line, character: e.character },
  };
}

function positionToOffset(sf: TS.SourceFile, pos: { line: number; character: number }): number {
  const line = Math.max(0, pos?.line ?? 0);
  const character = Math.max(0, pos?.character ?? 0);
  try {
    const lineStarts = sf.getLineStarts();
    if (line >= lineStarts.length) return sf.text.length;
    const off = sf.getPositionOfLineAndCharacter(line, character);
    return Math.max(0, Math.min(sf.text.length, off));
  } catch {
    return sf.text.length;
  }
}

function mapCompletionKind(tsKind: string): number {
  switch (tsKind) {
    case 'method':
    case 'member function':
      return 2; // Method
    case 'function':
    case 'local function':
      return 3; // Function
    case 'constructor':
      return 4; // Constructor
    case 'property':
    case 'getter':
    case 'setter':
    case 'JSX attribute':
      return 10; // Property
    case 'class':
    case 'local class':
      return 7; // Class
    case 'interface':
      return 8; // Interface
    case 'module':
    case 'external module name':
      return 9; // Module
    case 'enum':
      return 13; // Enum
    case 'enum member':
      return 20; // EnumMember
    case 'keyword':
    case 'primitive type':
      return 14; // Keyword
    case 'type':
    case 'type parameter':
      return 25; // TypeParameter
    case 'const':
    case 'let':
    case 'var':
    case 'local var':
    case 'parameter':
    case 'alias':
      return 6; // Variable
    case 'directory':
      return 19; // Folder
    case 'script':
      return 17; // File
    default:
      return 1; // Text
  }
}

function mapSymbolKind(tsKind: string): number {
  switch (tsKind) {
    case 'module':
    case 'external module name':
      return 2; // Module
    case 'class':
    case 'local class':
      return 5; // Class
    case 'method':
    case 'getter':
    case 'setter':
      return 6; // Method
    case 'property':
      return 7; // Property
    case 'constructor':
      return 9; // Constructor
    case 'enum':
      return 10; // Enum
    case 'interface':
      return 11; // Interface
    case 'function':
    case 'local function':
      return 12; // Function
    case 'var':
    case 'local var':
    case 'let':
    case 'parameter':
    case 'alias':
      return 13; // Variable
    case 'const':
      return 14; // Constant
    case 'enum member':
      return 22; // EnumMember
    case 'type':
    case 'type parameter':
      return 26; // TypeParameter
    default:
      return 13; // Variable
  }
}

function displayPartsToString(parts?: ReadonlyArray<{ text: string }>): string {
  if (!parts || !parts.length) return '';
  return parts.map((p) => p.text).join('');
}

function formatDocumentation(
  docs?: ReadonlyArray<{ text: string }>,
  tags?: ReadonlyArray<{ name: string; text?: string | ReadonlyArray<{ text: string }> }>,
): string {
  const sections: string[] = [];
  const main = displayPartsToString(docs).trim();
  if (main) sections.push(main);
  if (tags && tags.length > 0) {
    for (const t of tags) {
      const tagText =
        typeof t.text === 'string'
          ? t.text
          : Array.isArray(t.text)
            ? displayPartsToString(t.text)
            : '';
      sections.push(tagText ? `*@${t.name}* — ${tagText}` : `*@${t.name}*`);
    }
  }
  return sections.join('\n\n');
}

export interface TsLspEngineOptions {
  ts: typeof TS;
  send: (msg: JsonRpcMessage) => void;
  libs?: Record<string, string>;
}

export class TsLspEngine {
  private readonly ts: typeof TS;
  private readonly send: (msg: JsonRpcMessage) => void;
  private readonly libFiles = new Map<string, string>();
  private readonly files = new Map<string, VirtualFile>();
  private readonly openPaths = new Set<string>();
  private readonly pathByUri = new Map<string, string>();
  private rootPath = '/';
  private service: TS.LanguageService;
  private host: TS.LanguageServiceHost;
  private compilerOptions: TS.CompilerOptions;
  private settings: Record<string, any> = {};
  private preferences: Record<string, any> = {};
  private initialized = false;

  constructor(options: TsLspEngineOptions) {
    this.ts = options.ts;
    this.send = options.send;

    // Seed stdlib declarations
    const providedLibs = options.libs ?? {};
    const libKeys = Object.keys(providedLibs);
    if (libKeys.length > 0) {
      for (const [name, content] of Object.entries(providedLibs)) {
        const key = name.startsWith(LIB_PREFIX) ? name : `${LIB_PREFIX}${name}`;
        this.libFiles.set(key, content);
      }
      const hasFullDom = libKeys.some((k) => k.endsWith('lib.dom.d.ts'));
      if (!hasFullDom) {
        this.libFiles.set(`${LIB_PREFIX}lib.dom.minimal.d.ts`, DOM_MINIMAL_DTS);
      }
      const refs = [...this.libFiles.keys()]
        .filter((k) => k !== DEFAULT_LIB_NAME)
        .map((k) => `/// <reference path="${k}" />`)
        .join('\n');
      this.libFiles.set(DEFAULT_LIB_NAME, refs);
    } else {
      this.libFiles.set(
        DEFAULT_LIB_NAME,
        `${MINIMAL_ES_FALLBACK_DTS}\n${DOM_MINIMAL_DTS}`,
      );
    }

    this.compilerOptions = this.defaultCompilerOptions();
    this.host = this.createHost();
    this.service = this.ts.createLanguageService(
      this.host,
      this.ts.createDocumentRegistry(),
    );
  }

  private defaultCompilerOptions(): TS.CompilerOptions {
    return {
      target: this.ts.ScriptTarget.ES2022,
      module: this.ts.ModuleKind.ESNext,
      moduleResolution: this.ts.ModuleResolutionKind.Bundler,
      jsx: this.ts.JsxEmit.ReactJSX,
      allowJs: true,
      checkJs: false,
      strict: false,
      noEmit: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      resolveJsonModule: true,
      skipLibCheck: true,
      allowNonTsExtensions: true,
      isolatedModules: false,
      lib: [DEFAULT_LIB_NAME],
    };
  }

  private createHost(): TS.LanguageServiceHost {
    const ts = this.ts;
    const engine = this;
    return {
      getCompilationSettings: () => engine.compilerOptions,
      getCurrentDirectory: () => engine.rootPath,
      getDefaultLibFileName: () => DEFAULT_LIB_NAME,
      getScriptFileNames: () => {
        const names: string[] = [];
        for (const p of engine.libFiles.keys()) names.push(p);
        for (const f of engine.files.values()) {
          if (isTsJsFilePath(f.path)) names.push(f.path);
        }
        return names;
      },
      getScriptVersion: (fileName: string) => {
        if (engine.libFiles.has(fileName)) return '1';
        const f = engine.files.get(fileName);
        return f ? String(f.version) : '0';
      },
      getScriptSnapshot: (fileName: string) => {
        const lib = engine.libFiles.get(fileName);
        if (lib !== undefined) return ts.ScriptSnapshot.fromString(lib);
        const f = engine.files.get(fileName);
        if (f !== undefined) return ts.ScriptSnapshot.fromString(f.content);
        return undefined;
      },
      fileExists: (fileName: string) => {
        return engine.libFiles.has(fileName) || engine.files.has(fileName);
      },
      readFile: (fileName: string) => {
        return engine.libFiles.get(fileName) ?? engine.files.get(fileName)?.content;
      },
      directoryExists: (dirName: string) => {
        const prefix = dirName.endsWith('/') ? dirName : `${dirName}/`;
        for (const key of engine.files.keys()) {
          if (key.startsWith(prefix)) return true;
        }
        return dirName === '/' || dirName === engine.rootPath;
      },
      getDirectories: (dirName: string) => {
        const prefix = dirName.endsWith('/') ? dirName : `${dirName}/`;
        const dirs = new Set<string>();
        for (const key of engine.files.keys()) {
          if (!key.startsWith(prefix)) continue;
          const rest = key.slice(prefix.length);
          const slash = rest.indexOf('/');
          if (slash > 0) dirs.add(rest.slice(0, slash));
        }
        return [...dirs];
      },
      readDirectory: (rootDir: string) => {
        const prefix = rootDir.endsWith('/') ? rootDir : `${rootDir}/`;
        const out: string[] = [];
        for (const key of engine.files.keys()) {
          if (key.startsWith(prefix)) out.push(key);
        }
        return out;
      },
    };
  }

  private reloadTsConfig(): void {
    const candidates = [
      `${this.rootPath.replace(/\/$/, '')}/tsconfig.json`,
      `${this.rootPath.replace(/\/$/, '')}/jsconfig.json`,
      '/tsconfig.json',
      '/jsconfig.json',
    ];
    let configFile: VirtualFile | undefined;
    for (const c of candidates) {
      const f = this.files.get(c);
      if (f) {
        configFile = f;
        break;
      }
    }
    if (!configFile) {
      this.compilerOptions = this.defaultCompilerOptions();
      return;
    }

    try {
      const parsed = this.ts.parseConfigFileTextToJson(configFile.path, configFile.content);
      if (parsed.config && typeof parsed.config === 'object') {
        const converted = this.ts.convertCompilerOptionsFromJson(
          parsed.config.compilerOptions || {},
          this.rootPath,
        );
        this.compilerOptions = {
          ...this.defaultCompilerOptions(),
          ...(converted.options || {}),
          noEmit: true,
          skipLibCheck: true,
          allowNonTsExtensions: true,
        };
        return;
      }
    } catch {
      /* ignore invalid tsconfig */
    }
    this.compilerOptions = this.defaultCompilerOptions();
  }

  private upsertFile(uri: string, content: string, version?: number, languageId?: string): VirtualFile {
    const path = uriToPath(uri);
    const prev = this.files.get(path);
    const nextVersion = version ?? (prev ? prev.version + 1 : 1);
    const vf: VirtualFile = {
      path,
      uri,
      content,
      version: nextVersion,
      languageId: languageId ?? prev?.languageId,
    };
    this.files.set(path, vf);
    this.pathByUri.set(uri, path);
    if (/(?:tsconfig|jsconfig)\.json$/i.test(path)) {
      this.reloadTsConfig();
    }
    return vf;
  }

  private getSourceFile(uri: string): { path: string; sf: TS.SourceFile } | null {
    const path = this.pathByUri.get(uri) ?? uriToPath(uri);
    const program = this.service.getProgram();
    const sf = program?.getSourceFile(path);
    if (!sf) return null;
    return { path, sf };
  }

  private getSetting<T>(key: string, fallback: T): T {
    if (this.settings[key] !== undefined && this.settings[key] !== null) {
      return this.settings[key] as T;
    }
    // Walk nested config objects (e.g. typescript.inlayHints.variableTypes.enabled)
    const parts = key.split('.');
    let cur: any = this.settings;
    for (const p of parts) {
      if (cur == null || typeof cur !== 'object') {
        cur = undefined;
        break;
      }
      cur = cur[p];
    }
    return cur !== undefined && cur !== null ? (cur as T) : fallback;
  }

  private buildUserPreferences(filePath: string): TS.UserPreferences {
    const isJs = isJsPath(filePath);
    const prefix = isJs ? 'javascript' : 'typescript';
    const inlayMaster = this.getSetting('typescript.inlayHints.enabled', true);

    const paramNames = inlayMaster
      ? (this.preferences.includeInlayParameterNameHints ??
          this.getSetting(`${prefix}.inlayHints.parameterNames.enabled`, 'all'))
      : 'none';

    return {
      includeCompletionsForModuleExports: this.getSetting(`${prefix}.suggest.autoImports`, true),
      includeCompletionsForImportStatements: this.getSetting(
        'typescript.suggest.includeCompletionsForImportStatements',
        true,
      ),
      includeCompletionsWithSnippetText: this.getSetting(
        `${prefix}.suggest.completeFunctionCalls`,
        true,
      ),
      includeAutomaticOptionalChainCompletions: this.getSetting(`${prefix}.suggest.enabled`, true),
      importModuleSpecifierPreference: this.getSetting(
        'typescript.preferences.importModuleSpecifier',
        'shortest',
      ),
      importModuleSpecifierEnding: this.getSetting(
        'typescript.preferences.importModuleSpecifierEnding',
        'auto',
      ),
      quotePreference: this.getSetting(`${prefix}.preferences.quoteStyle`, 'auto'),
      providePrefixAndSuffixTextForRename: this.getSetting(
        'typescript.preferences.renameShorthandProperties',
        true,
      ),
      includeInlayParameterNameHints: paramNames,
      includeInlayParameterNameHintsWhenArgumentMatchesName: !this.getSetting(
        'typescript.inlayHints.parameterNames.suppressWhenArgumentMatchesName',
        true,
      ),
      includeInlayFunctionParameterTypeHints:
        inlayMaster &&
        (this.preferences.includeInlayFunctionParameterTypeHints ??
          this.getSetting(`${prefix}.inlayHints.parameterTypes.enabled`, !isJs)),
      includeInlayVariableTypeHints:
        inlayMaster &&
        (this.preferences.includeInlayVariableTypeHints ??
          this.getSetting(`${prefix}.inlayHints.variableTypes.enabled`, !isJs)),
      includeInlayVariableTypeHintsWhenTypeMatchesName: !this.getSetting(
        'typescript.inlayHints.variableTypes.suppressWhenTypeMatchesName',
        true,
      ),
      includeInlayPropertyDeclarationTypeHints:
        inlayMaster &&
        (this.preferences.includeInlayPropertyDeclarationTypeHints ??
          this.getSetting('typescript.inlayHints.propertyDeclarationTypes.enabled', !isJs)),
      includeInlayFunctionLikeReturnTypeHints:
        inlayMaster &&
        (this.preferences.includeInlayFunctionLikeReturnTypeHints ??
          this.getSetting(`${prefix}.inlayHints.functionLikeReturnTypes.enabled`, !isJs)),
      includeInlayEnumMemberValueHints:
        inlayMaster &&
        (this.preferences.includeInlayEnumMemberValueHints ??
          this.getSetting('typescript.inlayHints.enumMemberValues.enabled', !isJs)),
    };
  }

  private buildFormatSettings(options?: { tabSize?: number; insertSpaces?: boolean }): TS.FormatCodeSettings {
    return {
      indentSize: options?.tabSize ?? this.getSetting('typescript.format.indentSize', 2),
      tabSize: options?.tabSize ?? this.getSetting('typescript.format.indentSize', 2),
      convertTabsToSpaces:
        options?.insertSpaces ?? this.getSetting('typescript.format.convertTabsToSpaces', true),
      insertSpaceAfterCommaDelimiter: this.getSetting(
        'typescript.format.insertSpaceAfterCommaDelimiter',
        true,
      ),
      insertSpaceAfterSemicolonInForStatements: this.getSetting(
        'typescript.format.insertSpaceAfterSemicolonInForStatements',
        true,
      ),
      insertSpaceBeforeAndAfterBinaryOperators: this.getSetting(
        'typescript.format.insertSpaceBeforeAndAfterBinaryOperators',
        true,
      ),
      insertSpaceAfterKeywordsInControlFlowStatements: this.getSetting(
        'typescript.format.insertSpaceAfterKeywordsInControlFlowStatements',
        true,
      ),
      insertSpaceAfterFunctionKeywordForAnonymousFunctions: this.getSetting(
        'typescript.format.insertSpaceAfterFunctionKeywordForAnonymousFunctions',
        true,
      ),
      insertSpaceBeforeFunctionParenthesis: this.getSetting(
        'typescript.format.insertSpaceBeforeFunctionParenthesis',
        false,
      ),
      placeOpenBraceOnNewLineForFunctions: this.getSetting(
        'typescript.format.placeOpenBraceOnNewLineForFunctions',
        false,
      ),
      placeOpenBraceOnNewLineForControlBlocks: this.getSetting(
        'typescript.format.placeOpenBraceOnNewLineForControlBlocks',
        false,
      ),
      semicolons: this.getSetting('typescript.format.semicolons', 'ignore') as any,
      indentStyle: this.ts.IndentStyle.Smart,
      newLineCharacter: '\n',
    };
  }

  public handleMessage(msg: JsonRpcMessage): void {
    if (!msg || !msg.method) return;
    const isRequest = msg.id !== undefined && msg.id !== null;
    try {
      const result = this.dispatch(msg.method, msg.params);
      if (isRequest) {
        this.send({ jsonrpc: '2.0', id: msg.id, result: result ?? null });
      }
    } catch (err: any) {
      if (isRequest) {
        this.send({
          jsonrpc: '2.0',
          id: msg.id,
          error: {
            code: -32603,
            message: err?.message || String(err),
          },
        });
      }
    }
  }

  private dispatch(method: string, params: any): any {
    switch (method) {
      case 'initialize':
        return this.onInitialize(params);
      case 'initialized':
        this.initialized = true;
        return null;
      case 'shutdown':
        return null;
      case 'exit':
        this.dispose();
        return null;
      case 'workspace/didChangeConfiguration':
        this.onDidChangeConfiguration(params);
        return null;
      case 'mscode/syncFiles':
        this.onSyncFiles(params);
        return null;
      case 'textDocument/didOpen':
        this.onDidOpen(params);
        return null;
      case 'textDocument/didChange':
        this.onDidChange(params);
        return null;
      case 'textDocument/didClose':
        this.onDidClose(params);
        return null;
      case 'textDocument/didSave':
        if (params?.textDocument?.uri) {
          this.publishDiagnosticsForUri(params.textDocument.uri);
        }
        return null;
      case 'textDocument/completion':
        return this.onCompletion(params);
      case 'completionItem/resolve':
        return this.onCompletionResolve(params);
      case 'textDocument/hover':
        return this.onHover(params);
      case 'textDocument/signatureHelp':
        return this.onSignatureHelp(params);
      case 'textDocument/definition':
        return this.onDefinition(params);
      case 'textDocument/typeDefinition':
        return this.onTypeDefinition(params);
      case 'textDocument/implementation':
        return this.onImplementation(params);
      case 'textDocument/references':
        return this.onReferences(params);
      case 'textDocument/prepareRename':
        return this.onPrepareRename(params);
      case 'textDocument/rename':
        return this.onRename(params);
      case 'textDocument/documentSymbol':
        return this.onDocumentSymbol(params);
      case 'textDocument/documentHighlight':
        return this.onDocumentHighlight(params);
      case 'textDocument/codeAction':
        return this.onCodeAction(params);
      case 'codeAction/resolve':
        return params;
      case 'textDocument/foldingRange':
        return this.onFoldingRange(params);
      case 'textDocument/selectionRange':
        return this.onSelectionRange(params);
      case 'textDocument/formatting':
        return this.onFormatting(params);
      case 'textDocument/rangeFormatting':
        return this.onRangeFormatting(params);
      case 'textDocument/onTypeFormatting':
        return this.onOnTypeFormatting(params);
      case 'textDocument/inlayHint':
        return this.onInlayHint(params);
      case 'textDocument/semanticTokens/full':
        return this.onSemanticTokensFull(params);
      default:
        return null;
    }
  }

  private onInitialize(params: any): any {
    if (params?.rootUri) {
      this.rootPath = uriToPath(params.rootUri);
    }
    const initOpts = params?.initializationOptions ?? {};
    if (initOpts.preferences && typeof initOpts.preferences === 'object') {
      this.preferences = { ...initOpts.preferences };
    }
    if (initOpts.settings && typeof initOpts.settings === 'object') {
      this.settings = { ...this.settings, ...initOpts.settings };
    }
    this.initialized = true;

    return {
      capabilities: {
        textDocumentSync: 1, // Full
        completionProvider: {
          triggerCharacters: ['.', '"', "'", '/', '@', '<'],
          resolveProvider: true,
        },
        hoverProvider: true,
        signatureHelpProvider: {
          triggerCharacters: ['(', ',', '<'],
          retriggerCharacters: [')'],
        },
        definitionProvider: true,
        typeDefinitionProvider: true,
        implementationProvider: true,
        referencesProvider: true,
        documentHighlightProvider: true,
        documentSymbolProvider: true,
        codeActionProvider: {
          codeActionKinds: ['quickfix', 'refactor', 'source.organizeImports'],
          resolveProvider: true,
        },
        documentFormattingProvider: true,
        documentRangeFormattingProvider: true,
        documentOnTypeFormattingProvider: {
          firstTriggerCharacter: ';',
          moreTriggerCharacter: ['}', '\n'],
        },
        renameProvider: {
          prepareProvider: true,
        },
        foldingRangeProvider: true,
        selectionRangeProvider: true,
        inlayHintProvider: true,
        semanticTokensProvider: {
          legend: {
            tokenTypes: [...SEMANTIC_TOKEN_TYPES],
            tokenModifiers: [...SEMANTIC_TOKEN_MODIFIERS],
          },
          full: true,
          range: false,
        },
      },
      serverInfo: {
        name: 'mscode-typescript-worker-lsp',
        version: this.ts.version,
      },
    };
  }

  private onDidChangeConfiguration(params: any): void {
    const incoming = params?.settings;
    if (incoming && typeof incoming === 'object') {
      this.settings = { ...this.settings, ...incoming };
      if (incoming.typescript?.preferences) {
        this.preferences = { ...this.preferences, ...incoming.typescript.preferences };
      }
    }
    for (const p of this.openPaths) {
      const f = this.files.get(p);
      if (f) this.publishDiagnosticsForUri(f.uri);
    }
  }

  private onSyncFiles(params: any): void {
    const incoming: Array<{ uri: string; content?: string; text?: string; languageId?: string }> =
      Array.isArray(params?.files) ? params.files : [];
    const removeUris: string[] = Array.isArray(params?.removeUris) ? params.removeUris : [];

    for (const u of removeUris) {
      const p = uriToPath(u);
      if (!this.openPaths.has(p)) {
        this.files.delete(p);
        this.pathByUri.delete(u);
      }
    }

    for (const item of incoming) {
      const body = typeof item?.content === 'string' ? item.content : item?.text;
      if (!item?.uri || typeof body !== 'string') continue;
      const p = uriToPath(item.uri);
      // Do not clobber unsaved open editor buffers during background workspace scan
      if (this.openPaths.has(p) && this.files.has(p)) continue;
      this.upsertFile(item.uri, body, undefined, item.languageId);
    }

    // Re-validate open files now that imported workspace modules exist
    for (const p of this.openPaths) {
      const f = this.files.get(p);
      if (f) this.publishDiagnosticsForUri(f.uri);
    }
  }

  private onDidOpen(params: any): void {
    const td = params?.textDocument;
    if (!td?.uri) return;
    const vf = this.upsertFile(td.uri, td.text ?? '', td.version ?? 1, td.languageId);
    this.openPaths.add(vf.path);
    this.publishDiagnosticsForUri(td.uri);
  }

  private onDidChange(params: any): void {
    const td = params?.textDocument;
    const changes = params?.contentChanges;
    if (!td?.uri || !Array.isArray(changes) || changes.length === 0) return;
    const last = changes[changes.length - 1];
    if (typeof last?.text !== 'string') return;
    const vf = this.upsertFile(td.uri, last.text, td.version);
    this.openPaths.add(vf.path);
    this.publishDiagnosticsForUri(td.uri);
  }

  private onDidClose(params: any): void {
    const uri = params?.textDocument?.uri;
    if (!uri) return;
    const p = this.pathByUri.get(uri) ?? uriToPath(uri);
    this.openPaths.delete(p);
    // Keep file content in virtual FS so other open files can still import it!
    this.send({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: { uri, diagnostics: [] },
    });
  }

  private publishDiagnosticsForUri(uri: string): void {
    const entry = this.getSourceFile(uri);
    if (!entry) return;
    const { path, sf } = entry;

    const isJs = isJsPath(path);
    const validateEnabled = isJs
      ? this.getSetting('javascript.validate.enable', true)
      : this.getSetting('typescript.validate.enable', true);

    if (!validateEnabled) {
      this.send({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: { uri, diagnostics: [] },
      });
      return;
    }

    const syntactic = this.service.getSyntacticDiagnostics(path) ?? [];
    const semantic = isJs && !this.compilerOptions.checkJs
      ? []
      : (this.service.getSemanticDiagnostics(path) ?? []);
    const suggestion = this.service.getSuggestionDiagnostics(path) ?? [];

    const reportStyleAsWarn = this.getSetting('typescript.reportStyleChecksAsWarnings', true);
    const all = [...syntactic, ...semantic, ...suggestion];
    const diagnostics = all
      .filter((d) => d.start !== undefined)
      .map((d) => {
        const range = normalizeTextSpan(sf, d.start ?? 0, d.length ?? 1);
        let severity = 1; // Error
        if (d.category === this.ts.DiagnosticCategory.Warning) severity = 2;
        else if (d.category === this.ts.DiagnosticCategory.Suggestion) {
          severity = reportStyleAsWarn ? 2 : 4;
        } else if (d.category === this.ts.DiagnosticCategory.Message) {
          severity = 3;
        }
        const message = this.ts.flattenDiagnosticMessageText(d.messageText, '\n');
        const tags: number[] = [];
        if (d.reportsUnnecessary) tags.push(1);
        if (d.reportsDeprecated) tags.push(2);
        return {
          range,
          severity,
          code: d.code,
          source: isJs ? 'js' : 'ts',
          message,
          ...(tags.length ? { tags } : {}),
        };
      });

    this.send({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: { uri, diagnostics },
    });
  }

  private onCompletion(params: any): any {
    const uri = params?.textDocument?.uri;
    const entry = this.getSourceFile(uri);
    if (!entry) return { isIncomplete: false, items: [] };
    const { path, sf } = entry;
    const offset = positionToOffset(sf, params.position);
    const prefs = this.buildUserPreferences(path);

    const info = this.service.getCompletionsAtPosition(path, offset, {
      ...prefs,
      triggerCharacter: params?.context?.triggerCharacter,
    });
    if (!info || !info.entries.length) {
      return { isIncomplete: false, items: [] };
    }

    const maxItems = 250;
    const entries = info.entries.slice(0, maxItems);
    const items = entries.map((e) => {
      const replacementSpan = e.replacementSpan ?? info.optionalReplacementSpan;
      const textEdit = replacementSpan
        ? {
            range: normalizeTextSpan(sf, replacementSpan.start, replacementSpan.length),
            newText: e.insertText ?? e.name,
          }
        : undefined;

      return {
        label: e.name,
        kind: mapCompletionKind(e.kind),
        detail: e.labelDetails?.detail ?? e.sourceDisplay?.map((p) => p.text).join('') ?? undefined,
        sortText: e.sortText,
        filterText: e.filterText,
        insertText: e.insertText ?? e.name,
        insertTextFormat: e.isSnippet ? 2 : 1,
        ...(textEdit ? { textEdit } : {}),
        data: {
          uri,
          path,
          offset,
          name: e.name,
          source: e.source,
          data: e.data,
        },
      };
    });

    return {
      isIncomplete: info.entries.length > maxItems,
      items,
    };
  }

  private onCompletionResolve(item: any): any {
    const d = item?.data;
    if (!d?.path || !d?.name) return item;
    const entry = this.getSourceFile(d.uri);
    if (!entry) return item;

    const details = this.service.getCompletionEntryDetails(
      d.path,
      d.offset,
      d.name,
      this.buildFormatSettings(),
      d.source,
      this.buildUserPreferences(d.path),
      d.data,
    );
    if (!details) return item;

    const sig = displayPartsToString(details.displayParts).trim();
    const doc = formatDocumentation(details.documentation, details.tags);
    const resolved = { ...item };
    if (sig) resolved.detail = sig;
    if (doc || sig) {
      const parts: string[] = [];
      if (sig) parts.push(`\`\`\`ts\n${sig}\n\`\`\``);
      if (doc) parts.push(doc);
      resolved.documentation = { kind: 'markdown', value: parts.join('\n\n') };
    }

    // Auto-import code actions → additionalTextEdits!
    if (details.codeActions && details.codeActions.length > 0) {
      const additionalTextEdits: any[] = [];
      for (const ca of details.codeActions) {
        for (const change of ca.changes) {
          if (change.fileName !== d.path) continue;
          for (const tc of change.textChanges) {
            additionalTextEdits.push({
              range: normalizeTextSpan(entry.sf, tc.span.start, tc.span.length),
              newText: tc.newText,
            });
          }
        }
      }
      if (additionalTextEdits.length > 0) {
        resolved.additionalTextEdits = additionalTextEdits;
      }
    }

    return resolved;
  }

  private onHover(params: any): any {
    const uri = params?.textDocument?.uri;
    const entry = this.getSourceFile(uri);
    if (!entry) return null;
    const { path, sf } = entry;
    const offset = positionToOffset(sf, params.position);

    let quick = this.service.getQuickInfoAtPosition(path, offset);
    if (!quick && offset > 0 && /[A-Za-z0-9_$]/.test(sf.text[offset - 1] ?? '')) {
      quick = this.service.getQuickInfoAtPosition(path, offset - 1);
    }
    if (!quick) return null;
    if (quick.kind === 'keyword') return null;
    const spanText = sf.text.slice(quick.textSpan.start, quick.textSpan.start + quick.textSpan.length);
    if (spanText.length > 0 && /^[A-Za-z]+$/.test(spanText)) {
      const scanner = this.ts.createScanner(this.ts.ScriptTarget.Latest, true);
      scanner.setText(spanText);
      const tok = scanner.scan();
      if (
        tok >= this.ts.SyntaxKind.FirstKeyword &&
        tok <= this.ts.SyntaxKind.LastKeyword &&
        scanner.getTextPos() === spanText.length
      ) {
        return null;
      }
    }

    const sig = displayPartsToString(quick.displayParts).trim();
    const doc = formatDocumentation(quick.documentation, quick.tags);
    const mdParts: string[] = [];
    if (sig) mdParts.push(`\`\`\`ts\n${sig}\n\`\`\``);
    if (doc) mdParts.push(doc);
    if (!mdParts.length) return null;

    return {
      contents: {
        kind: 'markdown',
        value: mdParts.join('\n\n'),
      },
      range: normalizeTextSpan(sf, quick.textSpan.start, quick.textSpan.length),
    };
  }

  private onSignatureHelp(params: any): any {
    const uri = params?.textDocument?.uri;
    const entry = this.getSourceFile(uri);
    if (!entry) return null;
    const { path, sf } = entry;
    const offset = positionToOffset(sf, params.position);

    const help = this.service.getSignatureHelpItems(path, offset, {});
    if (!help || !help.items.length) return null;

    return {
      activeSignature: help.selectedItemIndex,
      activeParameter: help.argumentIndex,
      signatures: help.items.map((item) => {
        const prefix = displayPartsToString(item.prefixDisplayParts);
        const sep = displayPartsToString(item.separatorDisplayParts);
        const suffix = displayPartsToString(item.suffixDisplayParts);
        const paramLabels = item.parameters.map((p) => displayPartsToString(p.displayParts));
        const label = `${prefix}${paramLabels.join(sep)}${suffix}`;
        const doc = formatDocumentation(item.documentation, item.tags);
        return {
          label,
          documentation: doc ? { kind: 'markdown', value: doc } : undefined,
          parameters: item.parameters.map((p, idx) => ({
            label: paramLabels[idx]!,
            documentation: formatDocumentation(p.documentation) || undefined,
          })),
        };
      }),
    };
  }

  private mapDefInfos(infos?: ReadonlyArray<TS.DefinitionInfo | TS.ImplementationLocation>): any[] {
    if (!infos || !infos.length) return [];
    const program = this.service.getProgram();
    const out: any[] = [];
    for (const info of infos) {
      if (info.fileName.startsWith(LIB_PREFIX)) continue;
      const sf = program?.getSourceFile(info.fileName);
      if (!sf) continue;
      const vf = this.files.get(info.fileName);
      out.push({
        uri: vf?.uri ?? pathToUri(info.fileName),
        range: normalizeTextSpan(sf, info.textSpan.start, info.textSpan.length),
      });
    }
    return out;
  }

  private onDefinition(params: any): any {
    const entry = this.getSourceFile(params?.textDocument?.uri);
    if (!entry) return [];
    const offset = positionToOffset(entry.sf, params.position);
    const res = this.service.getDefinitionAndBoundSpan(entry.path, offset);
    return this.mapDefInfos(res?.definitions);
  }

  private onTypeDefinition(params: any): any {
    const entry = this.getSourceFile(params?.textDocument?.uri);
    if (!entry) return [];
    const offset = positionToOffset(entry.sf, params.position);
    return this.mapDefInfos(this.service.getTypeDefinitionAtPosition(entry.path, offset));
  }

  private onImplementation(params: any): any {
    const entry = this.getSourceFile(params?.textDocument?.uri);
    if (!entry) return [];
    const offset = positionToOffset(entry.sf, params.position);
    return this.mapDefInfos(this.service.getImplementationAtPosition(entry.path, offset));
  }

  private onReferences(params: any): any {
    const entry = this.getSourceFile(params?.textDocument?.uri);
    if (!entry) return [];
    const offset = positionToOffset(entry.sf, params.position);
    const refs = this.service.getReferencesAtPosition(entry.path, offset);
    if (!refs || !refs.length) return [];
    const includeDecl = params?.context?.includeDeclaration !== false;
    const program = this.service.getProgram();
    const out: any[] = [];
    for (const ref of refs) {
      if (ref.fileName.startsWith(LIB_PREFIX)) continue;
      if (!includeDecl && (ref as any).isDefinition) continue;
      const sf = program?.getSourceFile(ref.fileName);
      if (!sf) continue;
      const vf = this.files.get(ref.fileName);
      out.push({
        uri: vf?.uri ?? pathToUri(ref.fileName),
        range: normalizeTextSpan(sf, ref.textSpan.start, ref.textSpan.length),
      });
    }
    return out;
  }

  private onPrepareRename(params: any): any {
    const entry = this.getSourceFile(params?.textDocument?.uri);
    if (!entry) return null;
    const offset = positionToOffset(entry.sf, params.position);
    const info = this.service.getRenameInfo(entry.path, offset, { allowRenameOfImportPath: true });
    if (!info.canRename) return null;
    return {
      range: normalizeTextSpan(entry.sf, info.triggerSpan.start, info.triggerSpan.length),
      placeholder: info.displayName,
    };
  }

  private onRename(params: any): any {
    const entry = this.getSourceFile(params?.textDocument?.uri);
    if (!entry) return null;
    const offset = positionToOffset(entry.sf, params.position);
    const newName = String(params?.newName ?? '');
    if (!newName) return null;
    const info = this.service.getRenameInfo(entry.path, offset, { allowRenameOfImportPath: true });
    if (!info.canRename) return null;

    const locs = this.service.findRenameLocations(entry.path, offset, false, false, {
      providePrefixAndSuffixTextForRename: this.getSetting(
        'typescript.preferences.renameShorthandProperties',
        true,
      ),
    });
    if (!locs || !locs.length) return null;

    const program = this.service.getProgram();
    const changes: Record<string, any[]> = {};
    for (const loc of locs) {
      if (loc.fileName.startsWith(LIB_PREFIX)) continue;
      const sf = program?.getSourceFile(loc.fileName);
      if (!sf) continue;
      const vf = this.files.get(loc.fileName);
      const uri = vf?.uri ?? pathToUri(loc.fileName);
      if (!changes[uri]) changes[uri] = [];
      const text = `${loc.prefixText ?? ''}${newName}${loc.suffixText ?? ''}`;
      changes[uri]!.push({
        range: normalizeTextSpan(sf, loc.textSpan.start, loc.textSpan.length),
        newText: text,
      });
    }
    return { changes };
  }

  private onDocumentSymbol(params: any): any {
    const entry = this.getSourceFile(params?.textDocument?.uri);
    if (!entry) return [];
    const tree = this.service.getNavigationTree(entry.path);
    if (!tree) return [];

    const mapNode = (node: TS.NavigationTree): any | null => {
      if (!node.spans || !node.spans.length) return null;
      const span = node.spans[0]!;
      const nameSpan = node.nameSpan ?? span;
      const children = (node.childItems ?? [])
        .map(mapNode)
        .filter((c): c is NonNullable<typeof c> => c != null);

      return {
        name: node.text || '<anonymous>',
        detail: '',
        kind: mapSymbolKind(node.kind),
        range: normalizeTextSpan(entry.sf, span.start, span.length),
        selectionRange: normalizeTextSpan(entry.sf, nameSpan.start, nameSpan.length),
        children,
      };
    };

    // Unwrap top-level "<global>" / script / module wrapper node (matches VS Code / TLS)
    if (
      tree.childItems &&
      tree.childItems.length > 0 &&
      (tree.kind === 'script' || tree.kind === 'module' || tree.text === '<global>')
    ) {
      return tree.childItems.map(mapNode).filter(Boolean);
    }
    const single = mapNode(tree);
    return single ? [single] : [];
  }

  private onDocumentHighlight(params: any): any {
    const entry = this.getSourceFile(params?.textDocument?.uri);
    if (!entry) return [];
    const offset = positionToOffset(entry.sf, params.position);
    const groups = this.service.getDocumentHighlights(entry.path, offset, [entry.path]);
    if (!groups || !groups.length) return [];

    const out: any[] = [];
    for (const group of groups) {
      for (const span of group.highlightSpans) {
        out.push({
          range: normalizeTextSpan(entry.sf, span.textSpan.start, span.textSpan.length),
          kind: span.kind === this.ts.HighlightSpanKind.writtenReference ? 3 : 2,
        });
      }
    }
    return out;
  }

  private onCodeAction(params: any): any {
    const uri = params?.textDocument?.uri;
    const entry = this.getSourceFile(uri);
    if (!entry) return [];
    const { path, sf } = entry;
    const start = positionToOffset(sf, params.range?.start ?? { line: 0, character: 0 });
    const end = positionToOffset(sf, params.range?.end ?? params.range?.start ?? { line: 0, character: 0 });
    const diagCodeSet = new Set<number>(
      (params?.context?.diagnostics ?? [])
        .map((d: any) => Number(d?.code))
        .filter((n: number) => Number.isFinite(n)),
    );

    // Also inspect live diagnostics overlapping [start, end] so quick fixes work
    // even when the editor invokes codeAction with empty context.markers.
    const liveDiags = [
      ...this.service.getSemanticDiagnostics(path),
      ...this.service.getSuggestionDiagnostics(path),
    ];
    for (const d of liveDiags) {
      if (d.start === undefined) continue;
      const dStart = d.start;
      const dEnd = d.start + (d.length ?? 0);
      if (dEnd >= start && dStart <= end) {
        diagCodeSet.add(d.code);
      }
    }

    const diagCodes = [...diagCodeSet];

    const actions: any[] = [];
    const program = this.service.getProgram();

    const fileTextChangesToWorkspaceEdit = (fileChanges: readonly TS.FileTextChanges[]) => {
      const changes: Record<string, any[]> = {};
      for (const fc of fileChanges) {
        const targetSf = program?.getSourceFile(fc.fileName);
        if (!targetSf) continue;
        const vf = this.files.get(fc.fileName);
        const targetUri = vf?.uri ?? pathToUri(fc.fileName);
        if (!changes[targetUri]) changes[targetUri] = [];
        for (const tc of fc.textChanges) {
          changes[targetUri]!.push({
            range: normalizeTextSpan(targetSf, tc.span.start, tc.span.length),
            newText: tc.newText,
          });
        }
      }
      return { changes };
    };

    // 1. Diagnostic Quick Fixes
    if (diagCodes.length > 0) {
      const fixes = this.service.getCodeFixesAtPosition(
        path,
        start,
        end,
        diagCodes,
        this.buildFormatSettings(),
        this.buildUserPreferences(path),
      );
      for (const fix of fixes) {
        actions.push({
          title: fix.description,
          kind: 'quickfix',
          edit: fileTextChangesToWorkspaceEdit(fix.changes),
        });
      }
    }

    // 2. Organize Imports (source.organizeImports)
    const only: string[] | undefined = params?.context?.only;
    if (!only || only.some((k) => k.startsWith('source'))) {
      try {
        const orgChanges = this.service.organizeImports(
          { type: 'file', fileName: path },
          this.buildFormatSettings(),
          this.buildUserPreferences(path),
        );
        if (orgChanges && orgChanges.length > 0) {
          actions.push({
            title: 'Organize Imports',
            kind: 'source.organizeImports',
            edit: fileTextChangesToWorkspaceEdit(orgChanges),
          });
        }
      } catch {
        /* ignore organizeImports failures */
      }
    }

    return actions;
  }

  private onFoldingRange(params: any): any {
    const entry = this.getSourceFile(params?.textDocument?.uri);
    if (!entry) return [];
    const spans = this.service.getOutliningSpans(entry.path);
    if (!spans || !spans.length) return [];

    return spans
      .map((s) => {
        const r = normalizeTextSpan(entry.sf, s.textSpan.start, s.textSpan.length);
        if (r.end.line <= r.start.line) return null;
        let kind: string | undefined;
        if (s.kind === this.ts.OutliningSpanKind.Comment) kind = 'comment';
        else if (s.kind === this.ts.OutliningSpanKind.Imports) kind = 'imports';
        else if (s.kind === this.ts.OutliningSpanKind.Region) kind = 'region';
        return {
          startLine: r.start.line,
          endLine: r.end.line,
          ...(kind ? { kind } : {}),
        };
      })
      .filter(Boolean);
  }

  private onSelectionRange(params: any): any {
    const entry = this.getSourceFile(params?.textDocument?.uri);
    if (!entry) return [];
    const positions: Array<{ line: number; character: number }> = params?.positions ?? [];
    const convert = (sr: TS.SelectionRange): any => ({
      range: normalizeTextSpan(entry.sf, sr.textSpan.start, sr.textSpan.length),
      ...(sr.parent ? { parent: convert(sr.parent) } : {}),
    });
    return positions.map((pos) => {
      const off = positionToOffset(entry.sf, pos);
      const sr = this.service.getSmartSelectionRange(entry.path, off);
      return convert(sr);
    });
  }

  private onFormatting(params: any): any {
    const entry = this.getSourceFile(params?.textDocument?.uri);
    if (!entry) return [];
    const edits = this.service.getFormattingEditsForDocument(
      entry.path,
      this.buildFormatSettings(params?.options),
    );
    return edits.map((tc) => ({
      range: normalizeTextSpan(entry.sf, tc.span.start, tc.span.length),
      newText: tc.newText,
    }));
  }

  private onRangeFormatting(params: any): any {
    const entry = this.getSourceFile(params?.textDocument?.uri);
    if (!entry) return [];
    const start = positionToOffset(entry.sf, params.range.start);
    const end = positionToOffset(entry.sf, params.range.end);
    const edits = this.service.getFormattingEditsForRange(
      entry.path,
      start,
      end,
      this.buildFormatSettings(params?.options),
    );
    return edits.map((tc) => ({
      range: normalizeTextSpan(entry.sf, tc.span.start, tc.span.length),
      newText: tc.newText,
    }));
  }

  private onOnTypeFormatting(params: any): any {
    const entry = this.getSourceFile(params?.textDocument?.uri);
    if (!entry) return [];
    const offset = positionToOffset(entry.sf, params.position);
    const edits = this.service.getFormattingEditsAfterKeystroke(
      entry.path,
      offset,
      params.ch,
      this.buildFormatSettings(params?.options),
    );
    return edits.map((tc) => ({
      range: normalizeTextSpan(entry.sf, tc.span.start, tc.span.length),
      newText: tc.newText,
    }));
  }

  private onInlayHint(params: any): any {
    const entry = this.getSourceFile(params?.textDocument?.uri);
    if (!entry) return [];
    const { path, sf } = entry;
    const start = params?.range?.start ? positionToOffset(sf, params.range.start) : 0;
    const end = params?.range?.end ? positionToOffset(sf, params.range.end) : sf.text.length;
    const span: TS.TextSpan = { start, length: Math.max(0, end - start) };

    const hints = this.service.provideInlayHints(path, span, this.buildUserPreferences(path));
    if (!hints || !hints.length) return [];

    return hints.map((h) => {
      const lc = sf.getLineAndCharacterOfPosition(Math.max(0, Math.min(sf.text.length, h.position)));
      return {
        position: { line: lc.line, character: lc.character },
        label: h.text,
        kind: h.kind === this.ts.InlayHintKind.Parameter ? 2 : 1,
        paddingLeft: !!h.whitespaceBefore,
        paddingRight: !!h.whitespaceAfter,
      };
    });
  }

  private onSemanticTokensFull(params: any): any {
    const entry = this.getSourceFile(params?.textDocument?.uri);
    if (!entry) return { data: [] };
    const { path, sf } = entry;
    const span: TS.TextSpan = { start: 0, length: sf.text.length };
    const cls = this.service.getEncodedSemanticClassifications(
      path,
      span,
      this.ts.SemanticClassificationFormat.TwentyTwenty,
    );
    const raw = cls?.spans ?? [];
    if (!raw.length) return { data: [] };

    const data: number[] = [];
    let prevLine = 0;
    let prevChar = 0;

    for (let i = 0; i + 2 < raw.length; i += 3) {
      const start = raw[i]!;
      const length = raw[i + 1]!;
      const encoded = raw[i + 2]!;
      const tokenType = (encoded >> 8) - 1;
      const tokenModifiers = encoded & 0xff;
      if (tokenType < 0 || tokenType >= SEMANTIC_TOKEN_TYPES.length) continue;

      const lc = sf.getLineAndCharacterOfPosition(Math.max(0, Math.min(sf.text.length, start)));
      const deltaLine = lc.line - prevLine;
      const deltaStart = deltaLine === 0 ? lc.character - prevChar : lc.character;
      if (deltaLine < 0 || deltaStart < 0) continue;

      data.push(deltaLine, deltaStart, length, tokenType, tokenModifiers);
      prevLine = lc.line;
      prevChar = lc.character;
    }

    return { data };
  }

  public dispose(): void {
    try {
      this.service.dispose();
    } catch {
      /* ignore */
    }
    this.files.clear();
    this.openPaths.clear();
    this.pathByUri.clear();
    this.initialized = false;
  }
}
