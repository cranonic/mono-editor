import type {
  CancellationToken,
  CodeActionCommand,
  FormattingOptions,
  IMarkdownString,
  IRange,
  IWorkspaceTextEdit,
  Location,
  LocationLink,
  ModelLike,
  TextEdit,
  WorkspaceEdit,
} from './baseTypes';

export type {
  CancellationToken,
  CodeActionCommand,
  FormattingOptions,
  IMarkdownString,
  IRange,
  IWorkspaceTextEdit,
  Location,
  LocationLink,
  ModelLike,
  TextEdit,
  WorkspaceEdit,
};

export interface CompletionItemLabel {
  label: string;
  description?: string;
}

export const CompletionItemInsertTextRule = {
  None: 0,
  KeepWhitespace: 1,
  InsertAsSnippet: 4,
} as const;

export type CompletionItemInsertTextRule =
  (typeof CompletionItemInsertTextRule)[keyof typeof CompletionItemInsertTextRule];

export interface CompletionItem {
  label: string | CompletionItemLabel;
  kind?: number;
  detail?: string;
  documentation?: string | IMarkdownString;
  insertText?: string;
  insertTextRules?: number;
  sortText?: string;
  filterText?: string;
  range?: IRange;
  preselect?: boolean;
  commitCharacters?: string[];
  additionalTextEdits?: TextEdit[];
  textEdit?: { range: IRange; text: string };
}

export const CompletionItemKind = {
  Text: 0,
  Method: 1,
  Function: 2,
  Constructor: 3,
  Field: 4,
  Variable: 5,
  Class: 6,
  Interface: 7,
  Module: 8,
  Property: 9,
  Unit: 10,
  Value: 11,
  Enum: 12,
  Keyword: 13,
  Snippet: 14,
  Color: 15,
  File: 16,
  Reference: 17,
  Folder: 18,
  EnumMember: 19,
  Constant: 20,
  Struct: 21,
  Event: 22,
  Operator: 23,
  TypeParameter: 24,
} as const;

export type CompletionItemKind = (typeof CompletionItemKind)[keyof typeof CompletionItemKind];

export interface CompletionList {
  suggestions: CompletionItem[];
  incomplete?: boolean;
}

export interface CompletionContext {
  triggerKind: number;
  triggerCharacter?: string;
}

export interface HoverContentsItem {
  value: string;
}

export interface Hover {
  contents: string | string[] | HoverContentsItem | HoverContentsItem[];
  range?: IRange;
}

export interface FoldingRange {
  start: number;
  end: number;
  kind?: string;
}

export interface ParameterInformation {
  label: string | [number, number];
  documentation?: string | IMarkdownString;
}

export interface SignatureInformation {
  label: string;
  documentation?: string | IMarkdownString;
  parameters: ParameterInformation[];
  activeParameter?: number;
}

export interface SignatureHelp {
  signatures: SignatureInformation[];
  activeSignature: number;
  activeParameter: number;
}

export interface SignatureHelpResult {
  value: SignatureHelp;
  dispose?(): void;
}

export interface SignatureHelpContext {
  triggerKind: number;
  triggerCharacter?: string;
  isRetrigger: boolean;
  activeSignatureHelp?: SignatureHelp;
}

export interface ReferenceContext {
  includeDeclaration: boolean;
}

export interface RenameLocation {
  range: IRange;
  text: string;
  rejectReason?: string;
}

export interface CodeAction {
  title: string;
  kind?: string;
  isPreferred?: boolean;
  edit?: WorkspaceEdit;
  command?: CodeActionCommand;
}

export interface CodeActionList {
  actions: readonly CodeAction[];
  dispose?(): void;
}

export interface CodeActionContext {
  markers: readonly unknown[];
  only?: string;
}

export interface IColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}

export interface IColorInformation {
  range: IRange;
  color: IColor;
}

export interface IColorPresentation {
  label: string;
  textEdit?: TextEdit;
  additionalTextEdits?: TextEdit[];
}

export interface CompletionProvider {
  triggerCharacters?: string[];
  provideCompletionItems(
    model: ModelLike,
    position: { lineNumber: number; column: number },
    context?: CompletionContext,
    token?: CancellationToken,
  ):
    | CompletionList
    | CompletionItem[]
    | null
    | undefined
    | Promise<CompletionList | CompletionItem[] | null | undefined>;
  resolveCompletionItem?(
    item: CompletionItem,
    token?: CancellationToken,
  ): CompletionItem | null | undefined | Promise<CompletionItem | null | undefined>;
}

export interface HoverProvider {
  provideHover(
    model: ModelLike,
    position: { lineNumber: number; column: number },
    token?: CancellationToken,
  ): Hover | null | undefined | Promise<Hover | null | undefined>;
}

export interface FoldingRangeProvider {
  provideFoldingRanges(
    model: ModelLike,
    context?: unknown,
    token?: CancellationToken,
  ): FoldingRange[] | null | undefined | Promise<FoldingRange[] | null | undefined>;
}

export interface SignatureHelpProvider {
  signatureHelpTriggerCharacters?: readonly string[];
  signatureHelpRetriggerCharacters?: readonly string[];
  provideSignatureHelp(
    model: ModelLike,
    position: { lineNumber: number; column: number },
    token?: CancellationToken,
    context?: SignatureHelpContext,
  ):
    | SignatureHelpResult
    | SignatureHelp
    | null
    | undefined
    | Promise<SignatureHelpResult | SignatureHelp | null | undefined>;
}

export interface DocumentFormattingEditProvider {
  displayName?: string;
  provideDocumentFormattingEdits(
    model: ModelLike,
    options: FormattingOptions,
    token?: CancellationToken,
  ): TextEdit[] | null | undefined | Promise<TextEdit[] | null | undefined>;
}

export interface DocumentRangeFormattingEditProvider {
  displayName?: string;
  provideDocumentRangeFormattingEdits(
    model: ModelLike,
    range: IRange,
    options: FormattingOptions,
    token?: CancellationToken,
  ): TextEdit[] | null | undefined | Promise<TextEdit[] | null | undefined>;
}

export interface DefinitionProvider {
  provideDefinition(
    model: ModelLike,
    position: { lineNumber: number; column: number },
    token?: CancellationToken,
  ):
    | Location
    | Location[]
    | LocationLink[]
    | null
    | undefined
    | Promise<Location | Location[] | LocationLink[] | null | undefined>;
}

export interface ReferenceProvider {
  provideReferences(
    model: ModelLike,
    position: { lineNumber: number; column: number },
    context: ReferenceContext,
    token?: CancellationToken,
  ): Location[] | null | undefined | Promise<Location[] | null | undefined>;
}

export interface RenameProvider {
  provideRenameEdits(
    model: ModelLike,
    position: { lineNumber: number; column: number },
    newName: string,
    token?: CancellationToken,
  ): WorkspaceEdit | null | undefined | Promise<WorkspaceEdit | null | undefined>;
  resolveRenameLocation?(
    model: ModelLike,
    position: { lineNumber: number; column: number },
    token?: CancellationToken,
  ): RenameLocation | null | undefined | Promise<RenameLocation | null | undefined>;
}

export interface CodeActionProvider {
  provideCodeActions(
    model: ModelLike,
    range: IRange,
    context: CodeActionContext,
    token?: CancellationToken,
  ):
    | CodeActionList
    | CodeAction[]
    | null
    | undefined
    | Promise<CodeActionList | CodeAction[] | null | undefined>;
}

export interface DocumentColorProvider {
  provideDocumentColors(
    model: ModelLike,
    token?: CancellationToken,
  ): IColorInformation[] | null | undefined | Promise<IColorInformation[] | null | undefined>;
  provideColorPresentations?(
    model: ModelLike,
    colorInfo: IColorInformation,
    token?: CancellationToken,
  ): IColorPresentation[] | null | undefined | Promise<IColorPresentation[] | null | undefined>;
}

export * from './extendedTypes';
