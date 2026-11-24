import {
  CompletionItemKind,
  type CodeActionProvider,
  type CompletionItem,
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
} from './providers/types';

export const completionOptions = {
  wordBasedSuggestions: true,
};

/** Simple word-based completion provider (fallback). */
export function createWordBasedCompletionProvider(): CompletionProvider {
  return {
    provideCompletionItems(model, position) {
      if (!completionOptions.wordBasedSuggestions) return { suggestions: [] };
      const line = model.getLineContent(position.lineNumber) || '';
      const before = line.slice(0, Math.max(0, position.column - 1));
      const m = before.match(/[A-Za-z_][A-Za-z0-9_]*$/);
      if (!m) return { suggestions: [] };
      const prefix = m[0];
      const text = model.getValue();
      const words = new Set<string>();
      const re = /[A-Za-z_][A-Za-z0-9_]{2,}/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(text))) {
        if (match[0] !== prefix && match[0].startsWith(prefix)) words.add(match[0]);
        if (words.size > 40) break;
      }
      const suggestions: CompletionItem[] = Array.from(words).map((w) => ({
        label: w,
        kind: CompletionItemKind.Text,
        insertText: w,
      }));
      return { suggestions };
    },
  };
}

function registerInMap<T>(map: Map<string, T[]>, languageId: string, provider: T): { dispose(): void } {
  const list = map.get(languageId) ?? [];
  list.push(provider);
  map.set(languageId, list);
  return {
    dispose: () => {
      const cur = map.get(languageId) ?? [];
      map.set(languageId, cur.filter((p) => p !== provider));
    },
  };
}

function getFromMap<T>(map: Map<string, T[]>, languageId: string, includeStar = true): T[] {
  const specific = map.get(languageId) ?? [];
  if (!includeStar) return [...specific];
  const star = map.get('*') ?? [];
  return [...specific, ...star];
}

export class LanguageFeaturesRegistry {
  private completion = new Map<string, CompletionProvider[]>();
  private inlineCompletions = new Map<string, InlineCompletionsProvider[]>();
  private hover = new Map<string, HoverProvider[]>();
  private inlayHints = new Map<string, InlayHintsProvider[]>();
  private folding = new Map<string, FoldingRangeProvider[]>();
  private signatureHelp = new Map<string, SignatureHelpProvider[]>();
  private formatting = new Map<string, DocumentFormattingEditProvider[]>();
  private rangeFormatting = new Map<string, DocumentRangeFormattingEditProvider[]>();
  private onTypeFormatting = new Map<string, OnTypeFormattingEditProvider[]>();
  private definition = new Map<string, DefinitionProvider[]>();
  private typeDefinition = new Map<string, TypeDefinitionProvider[]>();
  private implementation = new Map<string, ImplementationProvider[]>();
  private declaration = new Map<string, DeclarationProvider[]>();
  private references = new Map<string, ReferenceProvider[]>();
  private documentHighlight = new Map<string, DocumentHighlightProvider[]>();
  private documentSymbol = new Map<string, DocumentSymbolProvider[]>();
  private link = new Map<string, LinkProvider[]>();
  private selectionRange = new Map<string, SelectionRangeProvider[]>();
  private semanticTokens = new Map<string, DocumentSemanticTokensProvider[]>();
  private rangeSemanticTokens = new Map<string, DocumentRangeSemanticTokensProvider[]>();
  private pasteEdit = new Map<string, DocumentPasteEditProvider[]>();
  private rename = new Map<string, RenameProvider[]>();
  private codeAction = new Map<string, CodeActionProvider[]>();
  private color = new Map<string, DocumentColorProvider[]>();

  registerCompletionItemProvider(languageId: string, provider: CompletionProvider) {
    return registerInMap(this.completion, languageId, provider);
  }
  registerInlineCompletionsProvider(languageId: string, provider: InlineCompletionsProvider) {
    return registerInMap(this.inlineCompletions, languageId, provider);
  }
  registerHoverProvider(languageId: string, provider: HoverProvider) {
    return registerInMap(this.hover, languageId, provider);
  }
  registerInlayHintsProvider(languageId: string, provider: InlayHintsProvider) {
    return registerInMap(this.inlayHints, languageId, provider);
  }
  registerFoldingRangeProvider(languageId: string, provider: FoldingRangeProvider) {
    return registerInMap(this.folding, languageId, provider);
  }
  registerSignatureHelpProvider(languageId: string, provider: SignatureHelpProvider) {
    return registerInMap(this.signatureHelp, languageId, provider);
  }
  registerDocumentFormattingEditProvider(languageId: string, provider: DocumentFormattingEditProvider) {
    return registerInMap(this.formatting, languageId, provider);
  }
  registerDocumentRangeFormattingEditProvider(languageId: string, provider: DocumentRangeFormattingEditProvider) {
    return registerInMap(this.rangeFormatting, languageId, provider);
  }
  registerOnTypeFormattingEditProvider(languageId: string, provider: OnTypeFormattingEditProvider) {
    return registerInMap(this.onTypeFormatting, languageId, provider);
  }
  registerDefinitionProvider(languageId: string, provider: DefinitionProvider) {
    return registerInMap(this.definition, languageId, provider);
  }
  registerTypeDefinitionProvider(languageId: string, provider: TypeDefinitionProvider) {
    return registerInMap(this.typeDefinition, languageId, provider);
  }
  registerImplementationProvider(languageId: string, provider: ImplementationProvider) {
    return registerInMap(this.implementation, languageId, provider);
  }
  registerDeclarationProvider(languageId: string, provider: DeclarationProvider) {
    return registerInMap(this.declaration, languageId, provider);
  }
  registerReferenceProvider(languageId: string, provider: ReferenceProvider) {
    return registerInMap(this.references, languageId, provider);
  }
  registerDocumentHighlightProvider(languageId: string, provider: DocumentHighlightProvider) {
    return registerInMap(this.documentHighlight, languageId, provider);
  }
  registerDocumentSymbolProvider(languageId: string, provider: DocumentSymbolProvider) {
    return registerInMap(this.documentSymbol, languageId, provider);
  }
  registerLinkProvider(languageId: string, provider: LinkProvider) {
    return registerInMap(this.link, languageId, provider);
  }
  registerSelectionRangeProvider(languageId: string, provider: SelectionRangeProvider) {
    return registerInMap(this.selectionRange, languageId, provider);
  }
  registerDocumentSemanticTokensProvider(languageId: string, provider: DocumentSemanticTokensProvider) {
    return registerInMap(this.semanticTokens, languageId, provider);
  }
  registerDocumentRangeSemanticTokensProvider(languageId: string, provider: DocumentRangeSemanticTokensProvider) {
    return registerInMap(this.rangeSemanticTokens, languageId, provider);
  }
  registerDocumentPasteEditProvider(languageId: string, provider: DocumentPasteEditProvider) {
    return registerInMap(this.pasteEdit, languageId, provider);
  }
  registerRenameProvider(languageId: string, provider: RenameProvider) {
    return registerInMap(this.rename, languageId, provider);
  }
  registerCodeActionProvider(languageId: string, provider: CodeActionProvider) {
    return registerInMap(this.codeAction, languageId, provider);
  }
  registerColorProvider(languageId: string, provider: DocumentColorProvider) {
    return registerInMap(this.color, languageId, provider);
  }

  getCompletionProviders(languageId: string): CompletionProvider[] {
    return getFromMap(this.completion, languageId, true);
  }
  getInlineCompletionsProviders(languageId: string): InlineCompletionsProvider[] {
    return getFromMap(this.inlineCompletions, languageId, true);
  }
  getHoverProviders(languageId: string): HoverProvider[] {
    return getFromMap(this.hover, languageId, true);
  }
  getInlayHintsProviders(languageId: string): InlayHintsProvider[] {
    return getFromMap(this.inlayHints, languageId, true);
  }
  getFoldingProviders(languageId: string): FoldingRangeProvider[] {
    return getFromMap(this.folding, languageId, true);
  }
  getSignatureHelpProviders(languageId: string): SignatureHelpProvider[] {
    return getFromMap(this.signatureHelp, languageId, true);
  }
  getDocumentFormattingProviders(languageId: string): DocumentFormattingEditProvider[] {
    return getFromMap(this.formatting, languageId, true);
  }
  getDocumentRangeFormattingProviders(languageId: string): DocumentRangeFormattingEditProvider[] {
    return getFromMap(this.rangeFormatting, languageId, true);
  }
  getOnTypeFormattingProviders(languageId: string): OnTypeFormattingEditProvider[] {
    return getFromMap(this.onTypeFormatting, languageId, true);
  }
  getDefinitionProviders(languageId: string): DefinitionProvider[] {
    return getFromMap(this.definition, languageId, true);
  }
  getTypeDefinitionProviders(languageId: string): TypeDefinitionProvider[] {
    return getFromMap(this.typeDefinition, languageId, true);
  }
  getImplementationProviders(languageId: string): ImplementationProvider[] {
    return getFromMap(this.implementation, languageId, true);
  }
  getDeclarationProviders(languageId: string): DeclarationProvider[] {
    return getFromMap(this.declaration, languageId, true);
  }
  getReferenceProviders(languageId: string): ReferenceProvider[] {
    return getFromMap(this.references, languageId, true);
  }
  getDocumentHighlightProviders(languageId: string): DocumentHighlightProvider[] {
    return getFromMap(this.documentHighlight, languageId, true);
  }
  getDocumentSymbolProviders(languageId: string): DocumentSymbolProvider[] {
    return getFromMap(this.documentSymbol, languageId, true);
  }
  getLinkProviders(languageId: string): LinkProvider[] {
    return getFromMap(this.link, languageId, true);
  }
  getSelectionRangeProviders(languageId: string): SelectionRangeProvider[] {
    return getFromMap(this.selectionRange, languageId, true);
  }
  getDocumentSemanticTokensProviders(languageId: string): DocumentSemanticTokensProvider[] {
    return getFromMap(this.semanticTokens, languageId, true);
  }
  getDocumentRangeSemanticTokensProviders(languageId: string): DocumentRangeSemanticTokensProvider[] {
    return getFromMap(this.rangeSemanticTokens, languageId, true);
  }
  getDocumentPasteEditProviders(languageId: string): DocumentPasteEditProvider[] {
    return getFromMap(this.pasteEdit, languageId, true);
  }
  getRenameProviders(languageId: string): RenameProvider[] {
    return getFromMap(this.rename, languageId, true);
  }
  getCodeActionProviders(languageId: string): CodeActionProvider[] {
    return getFromMap(this.codeAction, languageId, true);
  }
  getColorProviders(languageId: string): DocumentColorProvider[] {
    return getFromMap(this.color, languageId, true);
  }
}

export const languageFeatures = new LanguageFeaturesRegistry();
