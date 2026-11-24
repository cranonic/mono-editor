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

export type MonoLineNumbers = 'on' | 'off';

// ── Gutter layout (CSS px): [ left pad | line numbers | pad | fold chevron | border ] ──
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
  lineNumbersMinChars: number;
  lineCount: number;
  charWidth: number;
}): { gutterWidth: number; foldGutterWidth: number; gutterNumberPad: number } {
  const foldGutterWidth = params.lineNumbers && params.foldingEnabled ? GUTTER_FOLD_WIDTH : 0;
  const gutterNumberPad = foldGutterWidth > 0 ? GUTTER_NUMBER_PAD_FOLD : GUTTER_NUMBER_PAD;
  const digits = Math.max(params.lineNumbersMinChars, String(Math.max(1, params.lineCount)).length);
  const gutterWidth = params.lineNumbers
    ? Math.ceil(GUTTER_LEFT_PAD + digits * params.charWidth + gutterNumberPad) + foldGutterWidth
    : 0;
  return { gutterWidth, foldGutterWidth, gutterNumberPad };
}

export interface OverlayScrollbarOptions {
  vertical?: 'auto' | 'visible' | 'hidden';
  horizontal?: 'auto' | 'visible' | 'hidden';
  /** Completely hide vertical scrollbar (opacity 0, non-interactive) when scrolling stops. Default `true`. */
  hideVerticalOnScrollEnd?: boolean;
  /** Completely hide horizontal scrollbar (opacity 0, non-interactive) when scrolling stops. Default `true`. */
  hideHorizontalOnScrollEnd?: boolean;
  verticalScrollbarSize?: number;
  horizontalScrollbarSize?: number;
  fadeDelayMs?: number;
}

export interface MonoMinimapOptions {
  /** Enable code overview minimap. Default `false`. */
  enabled?: boolean;
  /** Dock side. Default `'right'`. */
  side?: 'right' | 'left';
  /** Fixed pixel width of the minimap strip. Default `80`. */
  width?: number;
  /** Max characters per line sampled. Default `120`. */
  maxColumn?: number;
  /** Slider visibility behavior. Default `'mouseover'`. */
  showSlider?: 'always' | 'mouseover';
  /** Render token-colored miniature bars instead of solid muted blocks. Default `true`. */
  renderCharacters?: boolean;
}

export interface MonoEditorOptions {
  value?: string;
  language?: string;
  readOnly?: boolean;
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  tabSize?: number;
  lineNumbers?: MonoLineNumbers;
  /**
   * Minimum digit columns reserved for line numbers (Monaco `lineNumbersMinChars`).
   * The gutter width follows the real line count (10 lines → 2 digits, 1000 lines → 4); this only sets the floor.
   * Default `2`.
   */
  lineNumbersMinChars?: number;
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
  /**
   * Whether hovering a color swatch with a mouse opens the Color Picker automatically.
   * Defaults to `false` so mobile scrolling / resting fingers never accidentally trigger popups.
   */
  colorDecoratorsOpenOnHover?: boolean;
  colorDecoratorsRules?: ColorDecoratorRules;
  /** Monaco-style Hover Docs popup options. */
  hover?: {
    enabled?: boolean;
    delay?: number;
    sticky?: boolean;
    above?: boolean;
    openOnMouseHover?: boolean;
  };
  /** LSP Inlay Hints options (parameter & type annotations). */
  inlayHints?: {
    enabled?: boolean;
    fontSize?: number;
    fontFamily?: string;
    padding?: boolean;
  };
  /** Multiline Ghost Text / AI Inline Completions options. */
  inlineSuggest?: {
    enabled?: boolean;
    debounceMs?: number;
    showToolbar?: 'always' | 'touch' | 'onHover' | 'never';
    italic?: boolean;
  };
  /** LSP Semantic Token highlighting overlay options. */
  semanticHighlighting?: {
    enabled?: boolean;
  };
  /** Enable clickable document links (default `true`). */
  links?: boolean;
  /** Theme-aware 5-level Rainbow Bracket Pair Colorization config. */
  bracketPairColorization?: Partial<BracketPairColorizationOptions>;
  /** Safety cap: lines longer than this skip full regex tokenization (default 20_000). */
  maxTokenizationLineLength?: number;
  minimap?: MonoMinimapOptions;
  model?: IMonoTextModel;
  /** @internal Share an existing backing TextModel directly (used by embedded References Peek editor). */
  _sharedTextModel?: TextModel;
  /** @internal Compact nested peek editor mode (disables nested peek/minimap chrome). */
  _isPeekEditor?: boolean;
}

export type EditorOptionKey = keyof MonoEditorOptions;

/**
 * Computes which option keys are explicitly provided in an `updateOptions(patch)` call,
 * allowing subsystems to react cleanly without sprawling imperative if-chains.
 */
export function diffEditorOptions(patch: Partial<MonoEditorOptions>): Set<EditorOptionKey> {
  const changed = new Set<EditorOptionKey>();
  for (const k of Object.keys(patch) as EditorOptionKey[]) {
    if (patch[k] !== undefined) changed.add(k);
  }
  return changed;
}
