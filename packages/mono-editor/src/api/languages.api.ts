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
  type CodeActionProvider,
  type CompletionProvider,
  type DefinitionProvider,
  type DocumentColorProvider,
  type DocumentFormattingEditProvider,
  type DocumentRangeFormattingEditProvider,
  type FoldingRangeProvider,
  type HoverProvider,
  type ReferenceProvider,
  type RenameProvider,
  type SignatureHelpProvider,
} from '../common/languages/providers/types';
import {
  languages as tokenLanguages,
  type MonoTokensProvider,
} from '../common/languages/tokenization/TokensProvider';

/**
 * Unified Monaco-compatible `languages` namespace combining:
 *  - Language registration & LanguageConfiguration
 *  - Tokenization providers
 *  - IntelliSense & LSP providers
 *  - Enum constants (`CompletionItemKind`, `CompletionItemInsertTextRule`, `CompletionTriggerKind`, `IndentAction`)
 */
export const languages = {
  CompletionItemKind,
  CompletionItemInsertTextRule,
  CompletionTriggerKind,
  IndentAction,

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

  registerHoverProvider(languageId: string, provider: HoverProvider): MonoDisposable {
    return languageFeatures.registerHoverProvider(languageId, provider);
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

  registerDefinitionProvider(languageId: string, provider: DefinitionProvider): MonoDisposable {
    return languageFeatures.registerDefinitionProvider(languageId, provider);
  },

  registerReferenceProvider(languageId: string, provider: ReferenceProvider): MonoDisposable {
    return languageFeatures.registerReferenceProvider(languageId, provider);
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
};
