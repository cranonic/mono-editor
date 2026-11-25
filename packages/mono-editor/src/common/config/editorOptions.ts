import type { BracketPairColorizationOptions } from '../brackets/bracketColorizerTypes';
import type { ColorDecoratorRules } from '../color/colorTypes';
import type { IMonoTextModel } from '../core/types';
import type {
  AutoClosingBehavior,
  AutoIndentBehavior,
  AutoSurroundBehavior,
} from '../languages/languageConfigurationTypes';
import type { TextModel } from '../model/TextModel';
import type { MonoStickyScrollOptions } from '../viewModel/StickyScroll';
import type { WordWrapMode, WrappingIndentMode } from '../viewModel/ViewLineProjection';
import type { MonoEditorTheme } from './themeTypes';

export type MonoLineNumbers =
  | 'on'
  | 'off'
  | 'relative'
  | 'interval'
  | ((lineNumber: number) => string);

export type RenderWhitespaceMode = 'none' | 'boundary' | 'selection' | 'trailing' | 'all';
export type RenderLineHighlightMode = 'none' | 'gutter' | 'line' | 'all';
export type CursorStyleMode =
  | 'line'
  | 'block'
  | 'underline'
  | 'line-thin'
  | 'block-outline'
  | 'underline-thin';
export type CursorBlinkingMode = 'blink' | 'smooth' | 'phase' | 'expand' | 'solid';

// ── Gutter layout (CSS px): [ glyph margin | left pad | line numbers | pad | fold chevron | border ] ──
/** Space reserved on the far left for breakpoints / bookmarks when `glyphMargin` is true. */
export const GUTTER_GLYPH_MARGIN_WIDTH = 18;
/** Space left of the line numbers. */
export const GUTTER_LEFT_PAD = 6;
/** Numbers → right border when there is no fold column. */
export const GUTTER_NUMBER_PAD = 6;
/** Numbers → fold chevron column (kept tight so the chevron sits next to the numbers). */
export const GUTTER_NUMBER_PAD_FOLD = 4;
/** Width of the fold chevron column. */
export const GUTTER_FOLD_WIDTH = 14;

export interface RenderMetrics {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  gutterWidth: number;
  /** Reserved width on the left edge of the gutter for breakpoints/glyphs (0 when glyphMargin is off). */
  glyphMarginWidth?: number;
  /** Reserved width on the right edge of the gutter for fold chevrons (0 when folding is off). */
  foldGutterWidth?: number;
  /** Space between the right edge of the line numbers and the fold chevron area (default 6). */
  gutterNumberPad?: number;
  charWidth: number;
  paddingLeft: number;
  paddingTop: number;
}

/** Single source of truth for gutter width & metrics (shared by editor and renderer). */
export function computeGutterLayout(params: {
  lineNumbers: boolean;
  foldingEnabled: boolean;
  glyphMargin?: boolean;
  lineNumbersMinChars: number;
  lineCount: number;
  charWidth: number;
}): {
  gutterWidth: number;
  glyphMarginWidth: number;
  foldGutterWidth: number;
  gutterNumberPad: number;
} {
  const glyphMarginWidth = params.glyphMargin ? GUTTER_GLYPH_MARGIN_WIDTH : 0;
  const foldGutterWidth = params.lineNumbers && params.foldingEnabled ? GUTTER_FOLD_WIDTH : 0;
  const gutterNumberPad = foldGutterWidth > 0 ? GUTTER_NUMBER_PAD_FOLD : GUTTER_NUMBER_PAD;
  const digits = Math.max(params.lineNumbersMinChars, String(Math.max(1, params.lineCount)).length);
  const numbersWidth = params.lineNumbers
    ? Math.ceil(GUTTER_LEFT_PAD + digits * params.charWidth + gutterNumberPad) + foldGutterWidth
    : 0;
  const gutterWidth = glyphMarginWidth + numbersWidth;
  return { gutterWidth, glyphMarginWidth, foldGutterWidth, gutterNumberPad };
}

export interface OverlayScrollbarOptions {
  vertical?: 'auto' | 'visible' | 'hidden';
  horizontal?: 'auto' | 'visible' | 'hidden';
  hideVerticalOnScrollEnd?: boolean;
  hideHorizontalOnScrollEnd?: boolean;
  verticalScrollbarSize?: number;
  horizontalScrollbarSize?: number;
  fadeDelayMs?: number;
}

export interface MonoMinimapOptions {
  enabled?: boolean;
  side?: 'right' | 'left';
  width?: number;
  maxColumn?: number;
  showSlider?: 'always' | 'mouseover';
  renderCharacters?: boolean;
}

export interface MonoErrorLensOptions {
  enabled?: boolean;
  maxLength?: number;
}

export interface MonoMobileQuickKeysOptions {
  enabled?: boolean;
  /** Custom key definitions overriding default mobile coding bar. */
  keys?: readonly { label: string; insert?: string; command?: string }[];
}

export interface MonoEditorOptions {
  value?: string;
  language?: string;
  readOnly?: boolean;
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  tabSize?: number;
  insertSpaces?: boolean;
  detectIndentation?: boolean;
  trimAutoWhitespace?: boolean;
  stickyTabStops?: boolean;
  emptySelectionClipboard?: boolean;
  formatOnPaste?: boolean;
  lineNumbers?: MonoLineNumbers;
  lineNumbersMinChars?: number;
  glyphMargin?: boolean;
  renderWhitespace?: RenderWhitespaceMode;
  rulers?: readonly number[];
  renderLineHighlight?: RenderLineHighlightMode;
  cursorStyle?: CursorStyleMode;
  cursorBlinking?: CursorBlinkingMode;
  cursorSurroundingLines?: number;
  linkedEditing?: boolean;
  codeLens?: boolean;
  errorLens?: boolean | MonoErrorLensOptions;
  pinchZoom?: boolean;
  mobileQuickKeys?: boolean | MonoMobileQuickKeysOptions;
  ariaLabel?: string;
  accessibilitySupport?: 'auto' | 'on' | 'off';
  theme?: Partial<MonoEditorTheme>;
  overscan?: number;
  undoGroupIdleMs?: number;
  stickyScroll?: MonoStickyScrollOptions;
  bracketEnterIndent?: boolean;
  scrollBeyondLastLine?: boolean;
  quickSuggestions?:
    | boolean
    | {
        other?: boolean | 'on' | 'off';
        comments?: boolean | 'on' | 'off';
        strings?: boolean | 'on' | 'off';
      };
  quickSuggestionsDelay?: number;
  suggestOnTriggerCharacters?: boolean;
  autoClosingBrackets?: AutoClosingBehavior;
  autoClosingQuotes?: AutoClosingBehavior;
  autoSurround?: AutoSurroundBehavior;
  autoIndent?: AutoIndentBehavior;
  wordWrap?: WordWrapMode;
  wrappingIndent?: WrappingIndentMode;
  folding?: boolean;
  guides?: {
    indentation?: boolean;
    highlightActiveIndentation?: boolean;
  };
  matchBrackets?: 'always' | 'near' | 'never';
  occurrencesHighlight?: boolean;
  scrollbar?: OverlayScrollbarOptions;
  dynamicCaretColor?: boolean;
  colorDecorators?: boolean;
  colorDecoratorsOpenOnHover?: boolean;
  colorDecoratorsRules?: ColorDecoratorRules;
  hover?: {
    enabled?: boolean;
    delay?: number;
    sticky?: boolean;
    above?: boolean;
    openOnMouseHover?: boolean;
  };
  inlayHints?: {
    enabled?: boolean;
    fontSize?: number;
    fontFamily?: string;
    padding?: boolean;
  };
  inlineSuggest?: {
    enabled?: boolean;
    debounceMs?: number;
    showToolbar?: 'always' | 'touch' | 'onHover' | 'never';
    italic?: boolean;
  };
  semanticHighlighting?: {
    enabled?: boolean;
  };
  links?: boolean;
  bracketPairColorization?: Partial<BracketPairColorizationOptions>;
  maxTokenizationLineLength?: number;
  minimap?: MonoMinimapOptions;
  model?: IMonoTextModel;
  /** @internal Share an existing backing TextModel directly (used by embedded References Peek editor). */
  _sharedTextModel?: TextModel;
  /** @internal Compact nested peek editor mode (disables nested peek/minimap chrome). */
  _isPeekEditor?: boolean;
}

export type EditorOptionKey = keyof MonoEditorOptions;

export function diffEditorOptions(patch: Partial<MonoEditorOptions>): Set<EditorOptionKey> {
  const changed = new Set<EditorOptionKey>();
  for (const k of Object.keys(patch) as EditorOptionKey[]) {
    if (patch[k] !== undefined) changed.add(k);
  }
  return changed;
}
