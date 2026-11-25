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

/** Decoration range stickiness when typing at range edges (matches Monaco TrackedRangeStickiness). */
export const TrackedRangeStickiness = {
  AlwaysGrowsWhenTypingAtEdges: 0,
  NeverGrowsWhenTypingAtEdges: 1,
  GrowsOnlyWhenTypingBefore: 2,
  GrowsOnlyWhenTypingAfter: 3,
} as const;
export type TrackedRangeStickiness =
  (typeof TrackedRangeStickiness)[keyof typeof TrackedRangeStickiness];

/** Scroll animation mode (matches Monaco ScrollType). */
export const ScrollType = {
  Smooth: 0,
  Immediate: 1,
} as const;
export type ScrollType = (typeof ScrollType)[keyof typeof ScrollType];

/** Hit-test target kind returned by `getTargetAtClientPoint` & mouse events (matches Monaco MouseTargetType). */
export const MouseTargetType = {
  UNKNOWN: 0,
  TEXTAREA: 1,
  GUTTER_GLYPH_MARGIN: 2,
  GUTTER_LINE_NUMBERS: 3,
  GUTTER_LINE_DECORATIONS: 4,
  GUTTER_VIEW_ZONE: 5,
  CONTENT_TEXT: 6,
  CONTENT_EMPTY: 7,
  CONTENT_VIEW_ZONE: 8,
  CONTENT_WIDGET: 9,
  OVERVIEW_RULER: 10,
  SCROLLBAR: 11,
  OVERLAY_WIDGET: 12,
  OUTSIDE_EDITOR: 13,
} as const;
export type MouseTargetType = (typeof MouseTargetType)[keyof typeof MouseTargetType];

/** Positioning preference for content widgets (matches Monaco ContentWidgetPositionPreference). */
export const ContentWidgetPositionPreference = {
  EXACT: 0,
  ABOVE: 1,
  BELOW: 2,
} as const;
export type ContentWidgetPositionPreference =
  (typeof ContentWidgetPositionPreference)[keyof typeof ContentWidgetPositionPreference];

/** Positioning preference for overlay widgets (matches Monaco OverlayWidgetPositionPreference). */
export const OverlayWidgetPositionPreference = {
  TOP_RIGHT_CORNER: 0,
  BOTTOM_RIGHT_CORNER: 1,
  TOP_CENTER: 2,
} as const;
export type OverlayWidgetPositionPreference =
  (typeof OverlayWidgetPositionPreference)[keyof typeof OverlayWidgetPositionPreference];
