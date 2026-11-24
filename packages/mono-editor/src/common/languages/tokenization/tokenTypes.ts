/**
 * VS Code / TextMate / Prism-inspired token roles.
 * Apps can map extra scopes via custom providers that still emit these types,
 * or use 'plain' + theme overrides.
 */
export type MonoTokenType =
  | 'plain'
  | 'comment'
  | 'string'
  | 'stringEscape'
  | 'templateDelimiter'
  | 'keyword'
  | 'keywordControl'
  | 'number'
  | 'boolean'
  | 'regexp'
  | 'operator'
  | 'punctuation'
  | 'variable'
  | 'function'
  | 'type'
  | 'class'
  | 'property'
  | 'decorator'
  | 'tag'
  | 'attribute'
  | 'selector'
  | 'unit'
  | 'constant'
  | 'macro'
  | 'heading'
  | 'emphasis'
  | 'strong'
  | 'link'
  | 'math'
  | 'codeInline'
  | 'invalid';

/** 1-based columns, end exclusive: paints [startColumn, endColumn). Lean: no per-token languageId. */
export interface MonoToken {
  startColumn: number;
  endColumn: number;
  type: MonoTokenType;
}

/**
 * Compact per-line embedded language span (1-based columns, end exclusive).
 * Omitted when an entire line belongs to the document's root language.
 */
export interface LanguageSegment {
  startColumn: number;
  endColumn: number;
  languageId: string;
}

export type MonoTokenTheme = Partial<Record<MonoTokenType, string>>;

/** Dark+ inspired defaults (VS Code / Prism-grade hierarchy) */
export const DEFAULT_TOKEN_COLORS: Record<MonoTokenType, string> = {
  plain: '#d4d4d4',
  comment: '#6a9955',
  string: '#ce9178',
  stringEscape: '#d7ba7d',
  templateDelimiter: '#569cd6',
  keyword: '#569cd6',
  keywordControl: '#c586c0',
  number: '#b5cea8',
  boolean: '#569cd6',
  regexp: '#d16969',
  operator: '#d4d4d4',
  punctuation: '#d4d4d4',
  variable: '#9cdcfe',
  function: '#dcdcaa',
  type: '#4ec9b0',
  class: '#4ec9b0',
  property: '#9cdcfe',
  decorator: '#dcdcaa',
  tag: '#569cd6',
  attribute: '#9cdcfe',
  selector: '#d7ba7d',
  unit: '#b5cea8',
  constant: '#4fc1ff',
  macro: '#c586c0',
  heading: '#569cd6',
  emphasis: '#ce9178',
  strong: '#569cd6',
  link: '#4ec9b0',
  math: '#dcdcaa',
  codeInline: '#ce9178',
  invalid: '#f44747',
};
