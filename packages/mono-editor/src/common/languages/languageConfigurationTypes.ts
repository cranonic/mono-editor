import type { IndentAction } from '../core/enums';

export interface CommentRule {
  lineComment?: string | null;
  blockComment?: CharacterPair | null;
}

export type CharacterPair = [string, string];

export interface IAutoClosingPair {
  open: string;
  close: string;
}

export interface IAutoClosingPairConditional extends IAutoClosingPair {
  notIn?: ('string' | 'comment')[];
}

export interface IndentationRule {
  decreaseIndentPattern: RegExp;
  increaseIndentPattern: RegExp;
  indentNextLinePattern?: RegExp | null;
  unIndentedLinePattern?: RegExp | null;
}

export interface EnterAction {
  indentAction: IndentAction;
  appendText?: string;
  removeText?: number;
}

export interface OnEnterRule {
  beforeText: RegExp;
  afterText?: RegExp;
  previousLineText?: RegExp;
  action: EnterAction;
}

export interface FoldingMarkers {
  start: RegExp;
  end: RegExp;
}

export interface FoldingRules {
  offSide?: boolean;
  markers?: FoldingMarkers;
}

export type StructureEngineKind = 'brackets' | 'offside' | 'tags' | 'headings' | 'keywords';

export interface StructureKeywordPair {
  readonly open: RegExp;
  readonly close: RegExp;
}

export interface StructureLanguageRules {
  readonly engine?: StructureEngineKind;
  readonly brackets?: readonly CharacterPair[];
  readonly offSide?: boolean;
  readonly blockOpener?: RegExp;
  readonly keywordPairs?: readonly StructureKeywordPair[];
  readonly voidTags?: readonly string[];
  readonly optionalEndTags?: readonly string[];
  readonly rawTextTags?: readonly string[];
  readonly commentLinePrefix?: string;
  readonly blockComment?: readonly [string, string];
  readonly importPattern?: RegExp;
  readonly regionMarkers?: FoldingMarkers;
}

export interface LanguageConfiguration {
  comments?: CommentRule;
  brackets?: CharacterPair[];
  wordPattern?: RegExp;
  indentationRules?: IndentationRule;
  onEnterRules?: OnEnterRule[];
  autoClosingPairs?: IAutoClosingPairConditional[];
  surroundingPairs?: IAutoClosingPair[];
  autoCloseBefore?: string;
  folding?: FoldingRules;
  structure?: StructureLanguageRules;
}

export interface ILanguageExtensionPoint {
  id: string;
  extensions?: string[];
  filenames?: string[];
  aliases?: string[];
  mimetypes?: string[];
}

export type AutoClosingBehavior = 'always' | 'languageDefined' | 'beforeWhitespace' | 'never';
export type AutoSurroundBehavior = 'languageDefined' | 'quotes' | 'brackets' | 'never';
export type AutoIndentBehavior = 'none' | 'keep' | 'brackets' | 'advanced' | 'full';
