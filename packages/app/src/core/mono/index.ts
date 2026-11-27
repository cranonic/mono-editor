/**
 * Unified Mono Editor API facade for MSCode IDE.
 * Backed 100% by real `@mono/editor` (zero Monaco dependencies or no-op shims).
 */
import {
  editor as rawEditor,
  languages as rawLanguages,
  createMonoEditor,
  createMonoDiffNavigator,
  getActiveMonoEditors,
  MonoEditor,
  MonoDiffEditor,
  Uri,
  Range,
  Position,
  Selection,
  MarkerSeverity,
  MarkerTag,
  KeyCode,
  KeyMod,
  CompletionTriggerKind,
  CompletionItemKind,
  CompletionItemInsertTextRule,
  ContentWidgetPositionPreference,
  OverlayWidgetPositionPreference,
  EndOfLineSequence,
  IndentAction,
  MouseTargetType,
  ScrollType,
  TrackedRangeStickiness,
  SymbolKind,
  SymbolTag,
  DocumentHighlightKind,
  InlayHintKind,
  InlineCompletionTriggerKind,
  monoThemeService,
  registerBuiltinThemes,
  languageFeatures,
  createRegexTokensProvider,
} from '@mono/editor';

export {
  createMonoEditor,
  createMonoDiffNavigator,
  getActiveMonoEditors,
  MonoEditor,
  MonoDiffEditor,
  Uri,
  Range,
  Position,
  Selection,
  MarkerSeverity,
  MarkerTag,
  KeyCode,
  KeyMod,
  CompletionTriggerKind,
  CompletionItemKind,
  CompletionItemInsertTextRule,
  ContentWidgetPositionPreference,
  OverlayWidgetPositionPreference,
  EndOfLineSequence,
  IndentAction,
  MouseTargetType,
  ScrollType,
  TrackedRangeStickiness,
  SymbolKind,
  SymbolTag,
  DocumentHighlightKind,
  InlayHintKind,
  InlineCompletionTriggerKind,
  monoThemeService,
  registerBuiltinThemes,
  languageFeatures,
  createRegexTokensProvider,
};

export type {
  IMonoEditor,
  IMonoDiffEditor,
  IMonoTextModel,
  IStandaloneTextModel,
  MonoEditorOptions,
  MonoDiffEditorOptions,
  MonoDisposable,
  MonoContentChangeEvent,
  IPosition,
  ISelection,
  IRange,
  IMarker,
  IMarkerData,
  IMarkdownString,
  IModelDeltaDecoration,
  IIdentifiedSingleEditOperation,
  ICursorPositionChangedEvent,
  ICursorSelectionChangedEvent,
  IContentWidget,
  IOverlayWidget,
  IDiffEditorModel,
} from '@mono/editor';

export type CancellationToken = {
  isCancellationRequested: boolean;
  onCancellationRequested?: (listener: () => void) => { dispose(): void };
};
export type IDisposable = { dispose(): void };
export type ITokenThemeRule = {
  token: string;
  foreground?: string;
  background?: string;
  fontStyle?: string;
};
export type Thenable<T> = PromiseLike<T>;

export const EditorOption = {
  fontFamily: 'fontFamily',
  fontSize: 'fontSize',
  fontWeight: 'fontWeight',
  lineHeight: 'lineHeight',
  tabSize: 'tabSize',
  readOnly: 'readOnly',
} as const;

export const InjectedTextCursorStops = {
  None: 0,
  Left: 1,
  Right: 2,
  Both: 3,
} as const;

export const FoldingRangeKind = {
  Comment: { value: 'comment' },
  Imports: { value: 'imports' },
  Region: { value: 'region' },
} as const;

export const SignatureHelpTriggerKind = {
  Invoke: 1,
  TriggerCharacter: 2,
  ContentChange: 3,
} as const;

export const CodeActionTriggerType = {
  Invoke: 1,
  Auto: 2,
} as const;

/**
 * Extended `editor` namespace backed directly by `@mono/editor`.
 */
export const editor = {
  ...rawEditor,
  EditorOption,
  InjectedTextCursorStops,
  removeAllMarkers(owner: string): void {
    for (const m of rawEditor.getModels()) {
      rawEditor.setModelMarkers(m, owner, []);
    }
    for (const ed of getActiveMonoEditors()) {
      ed.setModelMarkers(owner, []);
    }
  },
} as typeof rawEditor & {
  EditorOption: typeof EditorOption;
  InjectedTextCursorStops: typeof InjectedTextCursorStops;
  removeAllMarkers(owner: string): void;
};

export namespace editor {
  export type ITextModel = any;
  export type IStandaloneCodeEditor = any;
  export type ICodeEditor = any;
  export type IDiffEditor = any;
  export type IStandaloneDiffEditor = any;
  export type IMarker = any;
  export type IMarkerData = any;
  export type IModelDeltaDecoration = any;
  export type IContentWidget = any;
  export type IEditorOptions = any;
  export type EditorOption = string | number;
  export type IIdentifiedSingleEditOperation = any;
  export type ICursorPositionChangedEvent = any;
  export type ITokenThemeRule = {
    token: string;
    foreground?: string;
    background?: string;
    fontStyle?: string;
  };
}

/**
 * Extended `languages` namespace backed directly by `@mono/editor`.
 * Accepts single languageId or string[] selectors seamlessly.
 */
function registerForSelector<P>(
  selector: string | readonly string[] | { language?: string },
  fn: (langId: string, provider: P) => { dispose(): void },
  provider: P,
): { dispose(): void } {
  const langs: string[] = Array.isArray(selector)
    ? [...selector]
    : typeof selector === 'string'
      ? [selector]
      : selector && typeof selector === 'object' && 'language' in selector && selector.language
        ? [selector.language]
        : ['*'];
  const disposables = langs.map((id) => fn(id, provider));
  return {
    dispose() {
      for (const d of disposables) {
        try {
          d.dispose();
        } catch {
          /* ignore */
        }
      }
    },
  };
}

export const languages = {
  ...rawLanguages,
  FoldingRangeKind,
  SignatureHelpTriggerKind,
  CodeActionTriggerType,
  registerCompletionItemProvider(selector: any, provider: any) {
    return registerForSelector(selector, rawLanguages.registerCompletionItemProvider, provider);
  },
  registerDocumentSymbolProvider(selector: any, provider: any) {
    return registerForSelector(selector, rawLanguages.registerDocumentSymbolProvider, provider);
  },
  registerHoverProvider(selector: any, provider: any) {
    return registerForSelector(selector, rawLanguages.registerHoverProvider, provider);
  },
  registerDefinitionProvider(selector: any, provider: any) {
    return registerForSelector(selector, rawLanguages.registerDefinitionProvider, provider);
  },
  registerTypeDefinitionProvider(selector: any, provider: any) {
    return registerForSelector(selector, rawLanguages.registerTypeDefinitionProvider, provider);
  },
  registerImplementationProvider(selector: any, provider: any) {
    return registerForSelector(selector, rawLanguages.registerImplementationProvider, provider);
  },
  registerReferenceProvider(selector: any, provider: any) {
    return registerForSelector(selector, rawLanguages.registerReferenceProvider, provider);
  },
  registerRenameProvider(selector: any, provider: any) {
    return registerForSelector(selector, rawLanguages.registerRenameProvider, provider);
  },
  registerCodeActionProvider(selector: any, provider: any) {
    return registerForSelector(selector, rawLanguages.registerCodeActionProvider, provider);
  },
  registerCodeLensProvider(selector: any, provider: any) {
    return registerForSelector(selector, rawLanguages.registerCodeLensProvider, provider);
  },
  registerDocumentHighlightProvider(selector: any, provider: any) {
    return registerForSelector(selector, rawLanguages.registerDocumentHighlightProvider, provider);
  },
  registerLinkProvider(selector: any, provider: any) {
    return registerForSelector(selector, rawLanguages.registerLinkProvider, provider);
  },
  registerDocumentFormattingEditProvider(selector: any, provider: any) {
    return registerForSelector(selector, rawLanguages.registerDocumentFormattingEditProvider, provider);
  },
  registerDocumentRangeFormattingEditProvider(selector: any, provider: any) {
    return registerForSelector(selector, rawLanguages.registerDocumentRangeFormattingEditProvider, provider);
  },
  registerOnTypeFormattingEditProvider(selector: any, provider: any) {
    return registerForSelector(selector, rawLanguages.registerOnTypeFormattingEditProvider, provider);
  },
  registerFoldingRangeProvider(selector: any, provider: any) {
    return registerForSelector(selector, rawLanguages.registerFoldingRangeProvider, provider);
  },
  registerSelectionRangeProvider(selector: any, provider: any) {
    return registerForSelector(selector, rawLanguages.registerSelectionRangeProvider, provider);
  },
  registerSignatureHelpProvider(selector: any, provider: any) {
    return registerForSelector(selector, rawLanguages.registerSignatureHelpProvider, provider);
  },
  registerDocumentSemanticTokensProvider(selector: any, provider: any) {
    return registerForSelector(selector, rawLanguages.registerDocumentSemanticTokensProvider, provider);
  },
  registerInlayHintsProvider(selector: any, provider: any) {
    return registerForSelector(selector, rawLanguages.registerInlayHintsProvider, provider);
  },
  registerColorProvider(selector: any, provider: any) {
    return registerForSelector(selector, rawLanguages.registerColorProvider, provider);
  },
};

export namespace languages {
  export type CompletionItem = any;
  export type CompletionList = any;
  export type CompletionItemProvider = any;
  export type CompletionItemKind = number;
  export type CompletionItemInsertTextRule = number;
  export type CompletionTriggerKind = number;
  export type Hover = any;
  export type HoverProvider = any;
  export type DefinitionProvider = any;
  export type ReferenceProvider = any;
  export type DocumentSymbol = any;
  export type DocumentSymbolProvider = any;
  export type SymbolKind = number;
  export type CodeAction = any;
  export type CodeActionProvider = any;
  export type CodeActionTriggerType = number;
  export type CodeLens = any;
  export type CodeLensProvider = any;
  export type DocumentFormattingEditProvider = any;
  export type DocumentRangeFormattingEditProvider = any;
  export type OnTypeFormattingEditProvider = any;
  export type FoldingRangeProvider = any;
  export type FoldingRange = any;
  export type FoldingRangeKind = any;
  export type SelectionRangeProvider = any;
  export type SelectionRange = any;
  export type SignatureHelpProvider = any;
  export type SignatureHelp = any;
  export type SignatureHelpTriggerKind = number;
  export type DocumentHighlightProvider = any;
  export type DocumentHighlight = any;
  export type DocumentHighlightKind = number;
  export type LinkProvider = any;
  export type ILink = any;
  export type RenameProvider = any;
  export type WorkspaceEdit = any;
  export type IWorkspaceTextEdit = any;
  export type InlayHintsProvider = any;
  export type InlayHint = any;
  export type InlayHintList = any;
  export type InlayHintKind = number;
  export type LanguageSelector = any;
  export type DocumentColorProvider = any;
  export type IColorInformation = any;
  export type IColorPresentation = any;
  export type ProviderResult<T = any> = T | undefined | null | Thenable<T | undefined | null>;
  export type TextEdit = any;
  export type FormattingOptions = any;
  export type Location = any;
  export type LocationLink = any;
  export type ILanguageExtensionPoint = any;
  export type LanguageConfiguration = any;
}

const mono = {
  editor,
  languages,
  Uri,
  Range,
  Position,
  Selection,
  MarkerSeverity,
  MarkerTag,
  KeyCode,
  KeyMod,
};

export default mono;
