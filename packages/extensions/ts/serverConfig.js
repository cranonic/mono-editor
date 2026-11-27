// serverConfig.js — Shared TypeScript/JavaScript LSP configuration & options resolver.
// Imported by both main.js (sandboxed extension) and built-in extension registration.

/** Language IDs handled by one TypeScript language server (Web Worker or terminal TLS). */
export const TS_JS_LANGS = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'];

/**
 * Pinned versions for external terminal mode (Alpine proot + native Termux):
 * Classic TS 5.8 ships lib/tsserver.js; typescript-language-server 4.3.3 has full LSP + inlay hints.
 */
export const TYPESCRIPT_VERSION = '5.8.3';
export const TS_LANGUAGE_SERVER_VERSION = '4.3.3';

/**
 * Shell check that works cleanly in BOTH Alpine Linux (proot, where $PREFIX is unset
 * and global npm root is /usr/lib/node_modules or /usr/local/lib/node_modules)
 * and Termux native (where $PREFIX is set).
 */
export const TS_CHECK_CMD =
  'command -v typescript-language-server >/dev/null 2>&1 && ' +
  '(test -f "${PREFIX:-/usr}/lib/node_modules/typescript/lib/tsserver.js" || ' +
  'test -f "/usr/local/lib/node_modules/typescript/lib/tsserver.js" || ' +
  'test -f "$(npm root -g 2>/dev/null)/typescript/lib/tsserver.js")';

/**
 * Post-install shell commands safe for both Alpine (proot) and Termux (native).
 */
export const TS_POST_INSTALL = [
  'TS_PREFIX="${PREFIX:-$(npm prefix -g 2>/dev/null || echo /usr)}" && ' +
    'npm uninstall -g --prefix "$TS_PREFIX" typescript 2>/dev/null || true',
  `TS_PREFIX="\${PREFIX:-\$(npm prefix -g 2>/dev/null || echo /usr)}" && ` +
    `npm install -g --prefix "$TS_PREFIX" "typescript@${TYPESCRIPT_VERSION}" "typescript-language-server@${TS_LANGUAGE_SERVER_VERSION}"`,
  'TS_ROOT="$(npm root -g 2>/dev/null || echo "${PREFIX:-/usr}/lib/node_modules")" && ' +
    'echo "[TS-ext] installed tsserver at: $TS_ROOT/typescript/lib/tsserver.js" && ' +
    'test -f "$TS_ROOT/typescript/lib/tsserver.js" && command -v typescript-language-server >/dev/null 2>&1',
];

/**
 * Build initialization / feature options from workspace settings.
 * Used identically by BOTH Web Worker mode and terminal typescript-language-server mode.
 */
export function resolveTsOptions(settings) {
  const s = settings || {};
  const get = (key, fallback) => (s[key] !== undefined && s[key] !== null ? s[key] : fallback);

  const inlayEnabled = get('typescript.inlayHints.enabled', true);
  const serverMode = get('typescript.server.mode', 'web-worker');

  const preferences = {
    includeCompletionsForModuleExports: get('typescript.suggest.autoImports', true),
    includeCompletionsForImportStatements: get('typescript.suggest.includeCompletionsForImportStatements', true),
    includeCompletionsWithSnippetText: get('typescript.suggest.completeFunctionCalls', true),
    includeAutomaticOptionalChainCompletions: get('typescript.suggest.enabled', true),
    includePackageJsonAutoImports: get('typescript.preferences.includePackageJsonAutoImports', 'auto'),
    importModuleSpecifierPreference: get('typescript.preferences.importModuleSpecifier', 'shortest'),
    importModuleSpecifierEnding: get('typescript.preferences.importModuleSpecifierEnding', 'auto'),
    jsxAttributeCompletionStyle: get('typescript.preferences.jsxAttributeCompletionStyle', 'auto'),
    allowIncompleteCompletions: true,
    allowTextChangesInNewFiles: true,
    providePrefixAndSuffixTextForRename: get('typescript.preferences.renameShorthandProperties', true),
    allowRenameOfImportPath: true,
    includeInlayParameterNameHints: inlayEnabled
      ? get('typescript.inlayHints.parameterNames.enabled', 'all')
      : 'none',
    includeInlayParameterNameHintsWhenArgumentMatchesName: !get(
      'typescript.inlayHints.parameterNames.suppressWhenArgumentMatchesName',
      true,
    ),
    includeInlayFunctionParameterTypeHints:
      inlayEnabled && get('typescript.inlayHints.parameterTypes.enabled', true),
    includeInlayVariableTypeHints:
      inlayEnabled && get('typescript.inlayHints.variableTypes.enabled', true),
    includeInlayVariableTypeHintsWhenTypeMatchesName: !get(
      'typescript.inlayHints.variableTypes.suppressWhenTypeMatchesName',
      true,
    ),
    includeInlayPropertyDeclarationTypeHints:
      inlayEnabled && get('typescript.inlayHints.propertyDeclarationTypes.enabled', true),
    includeInlayFunctionLikeReturnTypeHints:
      inlayEnabled && get('typescript.inlayHints.functionLikeReturnTypes.enabled', true),
    includeInlayEnumMemberValueHints:
      inlayEnabled && get('typescript.inlayHints.enumMemberValues.enabled', true),
    quotePreference: get('typescript.preferences.quoteStyle', 'auto'),
    includeCompletionsWithClassMemberSnippets: get(
      'typescript.suggest.classMemberSnippets.enabled',
      true,
    ),
    includeCompletionsWithObjectLiteralMethodSnippets: get(
      'typescript.suggest.objectLiteralMethodSnippets.enabled',
      true,
    ),
    useLabelDetailsInCompletionEntries: true,
  };

  const formatOptions = {
    insertSpaceAfterCommaDelimiter: get('typescript.format.insertSpaceAfterCommaDelimiter', true),
    insertSpaceAfterSemicolonInForStatements: get('typescript.format.insertSpaceAfterSemicolonInForStatements', true),
    insertSpaceBeforeAndAfterBinaryOperators: get('typescript.format.insertSpaceBeforeAndAfterBinaryOperators', true),
    insertSpaceAfterKeywordsInControlFlowStatements: get('typescript.format.insertSpaceAfterKeywordsInControlFlowStatements', true),
    insertSpaceAfterFunctionKeywordForAnonymousFunctions: get('typescript.format.insertSpaceAfterFunctionKeywordForAnonymousFunctions', true),
    insertSpaceBeforeFunctionParenthesis: get('typescript.format.insertSpaceBeforeFunctionParenthesis', false),
    placeOpenBraceOnNewLineForFunctions: get('typescript.format.placeOpenBraceOnNewLineForFunctions', false),
    placeOpenBraceOnNewLineForControlBlocks: get('typescript.format.placeOpenBraceOnNewLineForControlBlocks', false),
    semicolons: get('typescript.format.semicolons', 'ignore'),
    indentSize: get('typescript.format.indentSize', 2),
    convertTabsToSpaces: get('typescript.format.convertTabsToSpaces', true),
  };

  return {
    mode: serverMode === 'terminal' ? 'terminal' : 'web-worker',

    // Feature gates for LspService providers
    signatureHelp: get('typescript.suggest.enabled', true),
    completion: get('typescript.suggest.enabled', true),
    hover: get('typescript.hover.enabled', true),
    inlayHints: inlayEnabled && get('lsp.typescript.inlayHints', true),
    codeActions: get('typescript.suggest.enabled', true),
    semanticTokens: true,
    semanticHighlighting: true,
    onTypeFormatting: get('typescript.format.enable', true),

    hostInfo: 'mscode',
    preferences,
    formatOptions,

    initializationOptions: {
      preferences,
      formatOptions,
      tsserver: {
        ...(get('typescript.tsdk', '') ? { path: get('typescript.tsdk', '') } : {}),
        logVerbosity: get('typescript.tsserver.log', 'off'),
        maxTsServerMemory: get('typescript.tsserver.maxTsServerMemory', 3072),
      },
    },

    validate: {
      typescript: get('typescript.validate.enable', true),
      javascript: get('javascript.validate.enable', true),
    },

    format: {
      typescript: get('typescript.format.enable', true),
      javascript: get('javascript.format.enable', true),
    },

    locale: get('typescript.locale', 'auto'),
    disableAutomaticTypeAcquisition: get('typescript.disableAutomaticTypeAcquisition', false),
    npm: get('typescript.npm', ''),
    tsdk: get('typescript.tsdk', ''),
  };
}

/**
 * Build the LSP server registration config supporting both Web Worker (default)
 * and external Alpine/Termux typescript-language-server (terminal mode).
 */
export function buildServerConfig() {
  return {
    packages: ['nodejs', 'npm'],
    prootPackages: ['nodejs', 'npm'],
    postInstall: [...TS_POST_INSTALL],
    checkCmd: TS_CHECK_CMD,
    serverCmd: 'typescript-language-server --stdio',
    workerId: 'typescript',
    serverModeSetting: 'typescript.server.mode',
    defaultMode: 'web-worker',
    resolveOptions: resolveTsOptions,
  };
}
