/** Selection direction (matches Monaco SelectionDirection). */
export const SelectionDirection = {
  LTR: 0,
  RTL: 1,
} as const;
export type SelectionDirection = (typeof SelectionDirection)[keyof typeof SelectionDirection];

/** End-of-line sequence (matches Monaco EndOfLineSequence). */
export const EndOfLineSequence = {
  LF: 0,
  CRLF: 1,
} as const;
export type EndOfLineSequence = (typeof EndOfLineSequence)[keyof typeof EndOfLineSequence];

/** Completion trigger kind (matches Monaco languages.CompletionTriggerKind). */
export const CompletionTriggerKind = {
  Invoke: 0,
  TriggerCharacter: 1,
  TriggerForIncompleteCompletions: 2,
} as const;
export type CompletionTriggerKind =
  (typeof CompletionTriggerKind)[keyof typeof CompletionTriggerKind];

/** On-Enter indentation action (matches Monaco languages.IndentAction). */
export const IndentAction = {
  /** Insert new line and copy the previous line's indentation. */
  None: 0,
  /** Insert new line and indent once (relative to the previous line's indentation). */
  Indent: 1,
  /** Insert two new lines: first indented once, second keeping previous indentation. */
  IndentOutdent: 2,
  /** Insert new line and outdent once (relative to the previous line's indentation). */
  Outdent: 3,
} as const;
export type IndentAction = (typeof IndentAction)[keyof typeof IndentAction];
