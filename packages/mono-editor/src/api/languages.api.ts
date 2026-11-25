import { CompletionTriggerKind, IndentAction } from '../common/core/enums';
import type { MonoDisposable } from '../common/core/types';
import {
  clearLanguageConfigurations,
  getLanguageConfiguration,
  getLanguages,
  registerDefaultLanguageConfigurations,
  registerLanguage,
  setLanguageConfiguration,
} from '../common/languages/languageConfigurationRegistry';
import type {
  ILanguageExtensionPoint,
  LanguageConfiguration,
} from '../common/languages/languageConfigurationTypes';
import { languageFeatures } from '../common/languages/languageFeaturesService';
import {
  CompletionItemInsertTextRule,
  CompletionItemKind,
  DocumentHighlightKind,
  InlayHintKind,
  InlineCompletionTriggerKind,
  SymbolKind,
  SymbolTag,
  type CodeActionProvider,
  type CompletionProvider,
  type DeclarationProvider,
  type DefinitionProvider,
  type DocumentColorProvider,
  type DocumentFormattingEditProvider,
  type DocumentHighlightProvider,
  type DocumentPasteEditProvider,
  type DocumentRangeFormattingEditProvider,
  type DocumentRangeSemanticTokensProvider,
  type DocumentSemanticTokensProvider,
  type DocumentSymbolProvider,
  type FoldingRangeProvider,
  type HoverProvider,
  type ImplementationProvider,
  type InlayHintsProvider,
  type InlineCompletionsProvider,
  type LinkProvider,
  type OnTypeFormattingEditProvider,
  type ReferenceProvider,
  type RenameProvider,
  type SelectionRangeProvider,
  type SignatureHelpProvider,
  type TypeDefinitionProvider,
} from '../common/languages/providers/types';
import {
  languages as tokenLanguages,
  type MonoTokensProvider,
} from '../common/languages/tokenization/TokensProvider';

/**
 * Unified Monaco-compatible `languages` namespace combining:
 *  - Language registration & LanguageConfiguration
 *  - Tokenization providers
 *  - Complete mobile-first IntelliSense & LSP providers
 *  - Enum constants
 */
export const languages = {
  CompletionItemKind,
  CompletionItemInsertTextRule,
  CompletionTriggerKind,
  IndentAction,
  InlineCompletionTriggerKind,
  InlayHintKind,
  DocumentHighlightKind,
  SymbolKind,
  SymbolTag,

  register(language: ILanguageExtensionPoint): void {
    registerDefaultLanguageConfigurations();
    registerLanguage(language);
  },

  getLanguages(): ILanguageExtensionPoint[] {
    registerDefaultLanguageConfigurations();
    return getLanguages();
  },

  setLanguageConfiguration(languageId: string, configuration: LanguageConfiguration): MonoDisposable {
    registerDefaultLanguageConfigurations();
    return setLanguageConfiguration(languageId, configuration);
  },

  getLanguageConfiguration(languageId: string): LanguageConfiguration | undefined {
    registerDefaultLanguageConfigurations();
    return getLanguageConfiguration(languageId);
  },

  clearLanguageConfigurations(): void {
    clearLanguageConfigurations();
  },

  registerTokensProvider(provider: MonoTokensProvider): MonoDisposable {
    return tokenLanguages.registerTokensProvider(provider);
  },

  setTokensProvider(
    languageId: string,
    provider: Omit<MonoTokensProvider, 'languageId'> & { languageId?: string },
  ): MonoDisposable {
    return tokenLanguages.registerTokensProvider({
      languageId: provider.languageId ?? languageId,
      getInitialState: () => provider.getInitialState(),
      tokenizeLine: (line, state) => provider.tokenizeLine(line, state),
    });
  },

  getTokensProvider(languageId: string): MonoTokensProvider | undefined {
    return tokenLanguages.getTokensProvider(languageId);
  },

  getRegisteredLanguageIds(): string[] {
    return tokenLanguages.getRegisteredLanguageIds();
  },

  clearTokensProviders(): void {
    tokenLanguages.clearTokensProviders();
  },

  registerCompletionItemProvider(languageId: string, provider: CompletionProvider): MonoDisposable {
    return languageFeatures.registerCompletionItemProvider(languageId, provider);
  },

  registerInlineCompletionsProvider(
    languageId: string,
    provider: InlineCompletionsProvider,
  ): MonoDisposable {
    return languageFeatures.registerInlineCompletionsProvider(languageId, provider);
  },

  registerHoverProvider(languageId: string, provider: HoverProvider): MonoDisposable {
    return languageFeatures.registerHoverProvider(languageId, provider);
  },

  registerInlayHintsProvider(languageId: string, provider: InlayHintsProvider): MonoDisposable {
    return languageFeatures.registerInlayHintsProvider(languageId, provider);
  },

  registerFoldingRangeProvider(languageId: string, provider: FoldingRangeProvider): MonoDisposable {
    return languageFeatures.registerFoldingRangeProvider(languageId, provider);
  },

  registerSignatureHelpProvider(languageId: string, provider: SignatureHelpProvider): MonoDisposable {
    return languageFeatures.registerSignatureHelpProvider(languageId, provider);
  },

  registerDocumentFormattingEditProvider(
    languageId: string,
    provider: DocumentFormattingEditProvider,
  ): MonoDisposable {
    return languageFeatures.registerDocumentFormattingEditProvider(languageId, provider);
  },

  registerDocumentRangeFormattingEditProvider(
    languageId: string,
    provider: DocumentRangeFormattingEditProvider,
  ): MonoDisposable {
    return languageFeatures.registerDocumentRangeFormattingEditProvider(languageId, provider);
  },

  registerOnTypeFormattingEditProvider(
    languageId: string,
    provider: OnTypeFormattingEditProvider,
  ): MonoDisposable {
    return languageFeatures.registerOnTypeFormattingEditProvider(languageId, provider);
  },

  registerDefinitionProvider(languageId: string, provider: DefinitionProvider): MonoDisposable {
    return languageFeatures.registerDefinitionProvider(languageId, provider);
  },

  registerTypeDefinitionProvider(
    languageId: string,
    provider: TypeDefinitionProvider,
  ): MonoDisposable {
    return languageFeatures.registerTypeDefinitionProvider(languageId, provider);
  },

  registerImplementationProvider(
    languageId: string,
    provider: ImplementationProvider,
  ): MonoDisposable {
    return languageFeatures.registerImplementationProvider(languageId, provider);
  },

  registerDeclarationProvider(languageId: string, provider: DeclarationProvider): MonoDisposable {
    return languageFeatures.registerDeclarationProvider(languageId, provider);
  },

  registerReferenceProvider(languageId: string, provider: ReferenceProvider): MonoDisposable {
    return languageFeatures.registerReferenceProvider(languageId, provider);
  },

  registerDocumentHighlightProvider(
    languageId: string,
    provider: DocumentHighlightProvider,
  ): MonoDisposable {
    return languageFeatures.registerDocumentHighlightProvider(languageId, provider);
  },

  registerDocumentSymbolProvider(
    languageId: string,
    provider: DocumentSymbolProvider,
  ): MonoDisposable {
    return languageFeatures.registerDocumentSymbolProvider(languageId, provider);
  },

  registerLinkProvider(languageId: string, provider: LinkProvider): MonoDisposable {
    return languageFeatures.registerLinkProvider(languageId, provider);
  },

  registerSelectionRangeProvider(
    languageId: string,
    provider: SelectionRangeProvider,
  ): MonoDisposable {
    return languageFeatures.registerSelectionRangeProvider(languageId, provider);
  },

  registerDocumentSemanticTokensProvider(
    languageId: string,
    provider: DocumentSemanticTokensProvider,
  ): MonoDisposable {
    return languageFeatures.registerDocumentSemanticTokensProvider(languageId, provider);
  },

  registerDocumentRangeSemanticTokensProvider(
    languageId: string,
    provider: DocumentRangeSemanticTokensProvider,
  ): MonoDisposable {
    return languageFeatures.registerDocumentRangeSemanticTokensProvider(languageId, provider);
  },

  registerDocumentPasteEditProvider(
    languageId: string,
    provider: DocumentPasteEditProvider,
  ): MonoDisposable {
    return languageFeatures.registerDocumentPasteEditProvider(languageId, provider);
  },

  registerRenameProvider(languageId: string, provider: RenameProvider): MonoDisposable {
    return languageFeatures.registerRenameProvider(languageId, provider);
  },

  registerCodeActionProvider(languageId: string, provider: CodeActionProvider): MonoDisposable {
    return languageFeatures.registerCodeActionProvider(languageId, provider);
  },

  registerColorProvider(languageId: string, provider: DocumentColorProvider): MonoDisposable {
    return languageFeatures.registerColorProvider(languageId, provider);
  },

  registerCodeLensProvider(
    languageId: string,
    provider: import('../common/languages/providers/extendedTypes').CodeLensProvider,
  ): MonoDisposable {
    return languageFeatures.registerCodeLensProvider(languageId, provider);
  },

  registerLinkedEditingRangeProvider(
    languageId: string,
    provider: import('../common/languages/providers/extendedTypes').LinkedEditingRangeProvider,
  ): MonoDisposable {
    return languageFeatures.registerLinkedEditingRangeProvider(languageId, provider);
  },

  onLanguage(languageId: string, callback: () => void): MonoDisposable {
    return languageFeatures.onLanguage(languageId, callback);
  },

  getEncodedLanguageId(languageId: string): number {
    return languageFeatures.getEncodedLanguageId(languageId);
  },
};
