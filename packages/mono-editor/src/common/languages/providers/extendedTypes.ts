import type { IPosition, IRange } from '../../core/types';
import type {
  CancellationToken,
  CodeActionCommand,
  FormattingOptions,
  IMarkdownString,
  Location,
  LocationLink,
  ModelLike,
  TextEdit,
  WorkspaceEdit,
} from './baseTypes';

// ── Inline Completions & Universal Ghost Text (Copilot / Codex / AI) ─────────

export const InlineCompletionTriggerKind = {
  Invoke: 0,
  Automatic: 1,
} as const;

export type InlineCompletionTriggerKind =
  (typeof InlineCompletionTriggerKind)[keyof typeof InlineCompletionTriggerKind];

export interface InlineCompletionContext {
  readonly triggerKind: InlineCompletionTriggerKind;
  readonly selectedSuggestionInfo?: { range: IRange; text: string };
}

export interface InlineCompletionItem {
  readonly insertText: string;
  readonly filterText?: string;
  readonly range?: IRange;
  readonly command?: CodeActionCommand;
  /** Optional explicit anchor position (defaults to caret / range.start). */
  readonly position?: IPosition;
}

export interface InlineCompletionList {
  readonly items: readonly InlineCompletionItem[];
  dispose?(): void;
}

export interface InlineCompletionsProvider {
  provideInlineCompletions(
    model: ModelLike,
    position: IPosition,
    context: InlineCompletionContext,
    token?: CancellationToken,
  ):
    | InlineCompletionList
    | InlineCompletionItem[]
    | null
    | undefined
    | Promise<InlineCompletionList | InlineCompletionItem[] | null | undefined>;
  freeInlineCompletions?(completions: InlineCompletionList): void;
}

export type GhostTextKind = 'completion' | 'preview' | 'hint';

/**
 * Direct imperative ghost-text descriptor placeable at any line & any column
 * (e.g. Copilot/Codex multi-hunk previews, inline streaming suggestions, custom plugins).
 */
export interface GhostTextItem {
  readonly id?: string;
  readonly owner?: string;
  readonly lineNumber: number;
  readonly column: number;
  readonly text: string;
  readonly range?: IRange;
  readonly filterText?: string;
  readonly command?: CodeActionCommand;
  readonly kind?: GhostTextKind;
  readonly priority?: number;
  /** If false, ghost text persists across unrelated edits (remapping line numbers). Default true. */
  readonly autoClearOnEdit?: boolean;
  /** Render in italic style (overrides editor option). */
  readonly italic?: boolean;
}

// ── Inlay Hints ──────────────────────────────────────────────────────────────

export const InlayHintKind = {
  Type: 1,
  Parameter: 2,
} as const;

export type InlayHintKind = (typeof InlayHintKind)[keyof typeof InlayHintKind];

export interface InlayHintLabelPart {
  readonly label: string;
  readonly tooltip?: string | IMarkdownString;
  readonly command?: CodeActionCommand;
  readonly location?: Location;
}

export interface InlayHint {
  readonly position: IPosition;
  readonly label: string | readonly InlayHintLabelPart[];
  readonly kind?: InlayHintKind;
  readonly tooltip?: string | IMarkdownString;
  readonly paddingLeft?: boolean;
  readonly paddingRight?: boolean;
}

export interface InlayHintList {
  readonly hints: readonly InlayHint[];
  dispose?(): void;
}

export interface InlayHintsProvider {
  provideInlayHints(
    model: ModelLike,
    range: IRange,
    token?: CancellationToken,
  ):
    | InlayHintList
    | InlayHint[]
    | null
    | undefined
    | Promise<InlayHintList | InlayHint[] | null | undefined>;
  resolveInlayHint?(
    hint: InlayHint,
    token?: CancellationToken,
  ): InlayHint | null | undefined | Promise<InlayHint | null | undefined>;
}

// ── Navigation Extensions (TypeDefinition, Implementation, Declaration) ──────

export type DefinitionResult = Location | Location[] | LocationLink[] | null | undefined;

export interface TypeDefinitionProvider {
  provideTypeDefinition(
    model: ModelLike,
    position: IPosition,
    token?: CancellationToken,
  ): DefinitionResult | Promise<DefinitionResult>;
}

export interface ImplementationProvider {
  provideImplementation(
    model: ModelLike,
    position: IPosition,
    token?: CancellationToken,
  ): DefinitionResult | Promise<DefinitionResult>;
}

export interface DeclarationProvider {
  provideDeclaration(
    model: ModelLike,
    position: IPosition,
    token?: CancellationToken,
  ): DefinitionResult | Promise<DefinitionResult>;
}

// ── Document Highlights ──────────────────────────────────────────────────────

export const DocumentHighlightKind = {
  Text: 0,
  Read: 1,
  Write: 2,
} as const;

export type DocumentHighlightKind =
  (typeof DocumentHighlightKind)[keyof typeof DocumentHighlightKind];

export interface DocumentHighlight {
  readonly range: IRange;
  readonly kind?: DocumentHighlightKind;
}

export interface DocumentHighlightProvider {
  provideDocumentHighlights(
    model: ModelLike,
    position: IPosition,
    token?: CancellationToken,
  ): DocumentHighlight[] | null | undefined | Promise<DocumentHighlight[] | null | undefined>;
}

// ── Document Symbols (Outline & Sticky Scroll outlineModel) ──────────────────

export const SymbolKind = {
  File: 0,
  Module: 1,
  Namespace: 2,
  Package: 3,
  Class: 4,
  Method: 5,
  Property: 6,
  Field: 7,
  Constructor: 8,
  Enum: 9,
  Interface: 10,
  Function: 11,
  Variable: 12,
  Constant: 13,
  String: 14,
  Number: 15,
  Boolean: 16,
  Array: 17,
  Object: 18,
  Key: 19,
  Null: 20,
  EnumMember: 21,
  Struct: 22,
  Event: 23,
  Operator: 24,
  TypeParameter: 25,
} as const;

export type SymbolKind = (typeof SymbolKind)[keyof typeof SymbolKind];

export const SymbolTag = {
  Deprecated: 1,
} as const;

export type SymbolTag = (typeof SymbolTag)[keyof typeof SymbolTag];

export interface DocumentSymbol {
  readonly name: string;
  readonly detail?: string;
  readonly kind: SymbolKind;
  readonly tags?: readonly SymbolTag[];
  readonly range: IRange;
  readonly selectionRange: IRange;
  readonly children?: readonly DocumentSymbol[];
}

export interface DocumentSymbolProvider {
  displayName?: string;
  provideDocumentSymbols(
    model: ModelLike,
    token?: CancellationToken,
  ): DocumentSymbol[] | null | undefined | Promise<DocumentSymbol[] | null | undefined>;
}

// ── Document Links ───────────────────────────────────────────────────────────

export interface ILink {
  readonly range: IRange;
  readonly url?: string | { toString(): string };
  readonly tooltip?: string;
}

export interface ILinksList {
  readonly links: readonly ILink[];
  dispose?(): void;
}

export interface LinkProvider {
  provideLinks(
    model: ModelLike,
    token?: CancellationToken,
  ): ILinksList | ILink[] | null | undefined | Promise<ILinksList | ILink[] | null | undefined>;
  resolveLink?(link: ILink, token?: CancellationToken): ILink | null | undefined | Promise<ILink | null | undefined>;
}

// ── Selection Range (Smart Expand / Shrink) ──────────────────────────────────

export interface SelectionRange {
  readonly range: IRange;
  readonly parent?: SelectionRange;
}

export interface SelectionRangeProvider {
  provideSelectionRanges(
    model: ModelLike,
    positions: readonly IPosition[],
    token?: CancellationToken,
  ): SelectionRange[][] | SelectionRange[] | null | undefined | Promise<SelectionRange[][] | SelectionRange[] | null | undefined>;
}

// ── On-Type Formatting ───────────────────────────────────────────────────────

export interface OnTypeFormattingEditProvider {
  readonly autoFormatTriggerCharacters: readonly string[];
  provideOnTypeFormattingEdits(
    model: ModelLike,
    position: IPosition,
    ch: string,
    options: FormattingOptions,
    token?: CancellationToken,
  ): TextEdit[] | null | undefined | Promise<TextEdit[] | null | undefined>;
}

// ── Semantic Tokens (Full, Delta, Range) ─────────────────────────────────────

export interface SemanticTokensLegend {
  readonly tokenTypes: readonly string[];
  readonly tokenModifiers: readonly string[];
}

export interface SemanticTokens {
  readonly resultId?: string;
  readonly data: Uint32Array | readonly number[];
}

export interface SemanticTokensEdit {
  readonly start: number;
  readonly deleteCount: number;
  readonly data?: Uint32Array | readonly number[];
}

export interface SemanticTokensEdits {
  readonly resultId?: string;
  readonly edits: readonly SemanticTokensEdit[];
}

export interface DocumentSemanticTokensProvider {
  getLegend(): SemanticTokensLegend;
  provideDocumentSemanticTokens(
    model: ModelLike,
    lastResultId: string | null,
    token?: CancellationToken,
  ):
    | SemanticTokens
    | SemanticTokensEdits
    | null
    | undefined
    | Promise<SemanticTokens | SemanticTokensEdits | null | undefined>;
  releaseDocumentSemanticTokens?(resultId: string | undefined): void;
}

export interface DocumentRangeSemanticTokensProvider {
  getLegend(): SemanticTokensLegend;
  provideDocumentRangeSemanticTokens(
    model: ModelLike,
    range: IRange,
    token?: CancellationToken,
  ): SemanticTokens | null | undefined | Promise<SemanticTokens | null | undefined>;
}

// ── Document Paste Edits ─────────────────────────────────────────────────────

export interface DocumentPasteContext {
  readonly only?: string;
}

export interface DocumentPasteEdit {
  readonly insertText: string;
  readonly title?: string;
  readonly kind?: string;
  readonly additionalEdit?: WorkspaceEdit;
}

export interface DocumentPasteEditProvider {
  readonly pasteMimeTypes?: readonly string[];
  provideDocumentPasteEdits(
    model: ModelLike,
    ranges: readonly IRange[],
    dataTransfer: ReadonlyMap<string, string>,
    context: DocumentPasteContext,
    token?: CancellationToken,
  ):
    | DocumentPasteEdit
    | DocumentPasteEdit[]
    | null
    | undefined
    | Promise<DocumentPasteEdit | DocumentPasteEdit[] | null | undefined>;
}

// ── CodeLens ─────────────────────────────────────────────────────────────────

export interface CodeLens {
  readonly range: IRange;
  readonly id?: string;
  command?: CodeActionCommand;
}

export interface CodeLensList {
  readonly lenses: readonly CodeLens[];
  dispose?(): void;
}

export interface CodeLensProvider {
  onDidChange?: (listener: () => void) => { dispose(): void };
  provideCodeLenses(
    model: ModelLike,
    token?: CancellationToken,
  ): CodeLensList | CodeLens[] | null | undefined | Promise<CodeLensList | CodeLens[] | null | undefined>;
  resolveCodeLens?(
    model: ModelLike,
    codeLens: CodeLens,
    token?: CancellationToken,
  ): CodeLens | null | undefined | Promise<CodeLens | null | undefined>;
}

// ── Linked Editing (Auto-Rename HTML/JSX Tags) ───────────────────────────────

export interface LinkedEditingRanges {
  readonly ranges: readonly IRange[];
  readonly wordPattern?: RegExp;
}

export interface LinkedEditingRangeProvider {
  provideLinkedEditingRanges(
    model: ModelLike,
    position: IPosition,
    token?: CancellationToken,
  ): LinkedEditingRanges | null | undefined | Promise<LinkedEditingRanges | null | undefined>;
}

