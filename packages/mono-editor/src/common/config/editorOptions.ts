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

export const DEFAULT_MONO_FONT_FAMILY =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace, 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji'";

export function withEmojiFontFallback(fontFamily: string): string {
  const f = (fontFamily || '').trim();
  if (!f) return DEFAULT_MONO_FONT_FAMILY;
  return /emoji/i.test(f)
    ? f
    : `${f}, 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji'`;
}

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
export type CursorSurroundingLinesStyleMode = 'default' | 'all';
export type CursorSmoothCaretAnimationMode = 'off' | 'explicit' | 'on';
export type MultiCursorModifierMode = 'ctrlCmd' | 'alt';
export type MultiCursorPasteMode = 'spread' | 'full';

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

export interface MonoContextMenuOptions {
  enabled?: boolean;
  type?: 'horizontal' | 'vertical';
  animation?: 'cascade' | 'smooth' | 'none';
  horizontal?: {
    showIcons?: boolean;
    more?: {
      showIcons?: boolean;
      showShortcuts?: boolean;
    };
  };
  vertical?: {
    showIcons?: boolean;
    showShortcuts?: boolean;
  };
  maxHeight?: number;
}

export type AcceptSuggestionOnEnterMode = 'on' | 'smart' | 'off';
export type SuggestSelectionMode = 'first' | 'recentlyUsed' | 'recentlyUsedByPrefix';
export type SuggestInsertMode = 'insert' | 'replace';
export type SuggestPreviewMode = 'prefix' | 'subword' | 'subwordSmart';
export type WordBasedSuggestionsMode = 'off' | 'currentDocument' | 'matchingDocuments' | 'allDocuments';
export type SnippetSuggestionsMode = 'top' | 'bottom' | 'inline' | 'none';
export type TabCompletionMode = 'on' | 'off' | 'onlySnippets';
export type LightbulbEnabledMode = 'off' | 'on' | 'onCode';
export type FoldingStrategy = 'auto' | 'syntax' | 'indentation';

export interface MonoFoldingOptions {
  enabled?: boolean;
  strategy?: FoldingStrategy;
  maxLines?: number;
}

export interface MonoQuickNavOptions {
  gotoLine?: 'builtin' | 'external';
  gotoSymbol?: 'builtin' | 'external';
}

export type BreadcrumbPathMode = 'on' | 'off' | 'last';
export type BreadcrumbSymbolSortOrder = 'position' | 'name' | 'type';
export type BreadcrumbFolderClickBehavior = 'expand' | 'enter';

export interface MonoBreadcrumbsKindFilter {
  showFiles?: boolean;
  showModules?: boolean;
  showNamespaces?: boolean;
  showPackages?: boolean;
  showClasses?: boolean;
  showMethods?: boolean;
  showProperties?: boolean;
  showFields?: boolean;
  showConstructors?: boolean;
  showEnums?: boolean;
  showInterfaces?: boolean;
  showFunctions?: boolean;
  showVariables?: boolean;
  showConstants?: boolean;
  showStrings?: boolean;
  showNumbers?: boolean;
  showBooleans?: boolean;
  showArrays?: boolean;
  showObjects?: boolean;
  showKeys?: boolean;
  showNull?: boolean;
  showEnumMembers?: boolean;
  showStructs?: boolean;
  showEvents?: boolean;
  showOperators?: boolean;
  showTypeParameters?: boolean;
}

export interface MonoBreadcrumbsOptions extends MonoBreadcrumbsKindFilter {
  enabled?: boolean;
  filePath?: BreadcrumbPathMode;
  symbolPath?: BreadcrumbPathMode;
  icons?: boolean;
  symbolSortOrder?: BreadcrumbSymbolSortOrder;
  symbolPathSeparator?: string;
  /** Show right-aligned symbol kind/type detail text in the breadcrumb picker (default: false). */
  showSymbolDetails?: boolean;
  /** Behavior when tapping/clicking a folder row in the breadcrumb picker: 'expand' (inline tree, default) or 'enter' (drill-down). */
  folderClickBehavior?: BreadcrumbFolderClickBehavior;
}

export interface MonoSuggestOptions {
  docs?: 'off' | 'auto' | 'side' | 'below';
  mode?: 'palette' | 'ghost';
  insertMode?: SuggestInsertMode;
  filterGraceful?: boolean;
  localityBonus?: boolean;
  preview?: boolean;
  previewMode?: SuggestPreviewMode;
  showIcons?: boolean;
  showStatusBar?: boolean;
  matchOnWordStartOnly?: boolean;
  showMethods?: boolean;
  showFunctions?: boolean;
  showConstructors?: boolean;
  showFields?: boolean;
  showVariables?: boolean;
  showClasses?: boolean;
  showStructs?: boolean;
  showInterfaces?: boolean;
  showModules?: boolean;
  showProperties?: boolean;
  showEvents?: boolean;
  showOperators?: boolean;
  showUnits?: boolean;
  showValues?: boolean;
  showConstants?: boolean;
  showEnums?: boolean;
  showEnumMembers?: boolean;
  showKeywords?: boolean;
  showWords?: boolean;
  showColors?: boolean;
  showFiles?: boolean;
  showReferences?: boolean;
  showFolders?: boolean;
  showTypeParameters?: boolean;
  showSnippets?: boolean;
  showUsers?: boolean;
  showIssues?: boolean;
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
  cursorWidth?: number;
  cursorBlinking?: CursorBlinkingMode;
  cursorSurroundingLines?: number;
  cursorSurroundingLinesStyle?: CursorSurroundingLinesStyleMode;
  cursorSmoothCaretAnimation?: CursorSmoothCaretAnimationMode;
  multiCursorModifier?: MultiCursorModifierMode;
  multiCursorPaste?: MultiCursorPasteMode;
  multiCursorLimit?: number;
  linkedEditing?: boolean;
  codeLens?: boolean;
  codeLensFontSize?: number;
  codeLensFontFamily?: string;
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
  acceptSuggestionOnCommitCharacter?: boolean;
  acceptSuggestionOnEnter?: AcceptSuggestionOnEnterMode;
  suggestSelection?: SuggestSelectionMode;
  suggestFontSize?: number;
  suggestLineHeight?: number;
  suggestMatchOnWordStartOnly?: boolean;
  wordBasedSuggestions?: WordBasedSuggestionsMode;
  snippetSuggestions?: SnippetSuggestionsMode;
  tabCompletion?: TabCompletionMode;
  suggest?: MonoSuggestOptions;
  signatureHelp?: {
    enabled?: boolean;
    trigger?: 'auto' | 'manual';
    cycle?: boolean;
  };
  autoClosingBrackets?: AutoClosingBehavior;
  autoClosingQuotes?: AutoClosingBehavior;
  autoSurround?: AutoSurroundBehavior;
  autoIndent?: AutoIndentBehavior;
  wordWrap?: WordWrapMode;
  wrappingIndent?: WrappingIndentMode;
  folding?: boolean | MonoFoldingOptions;
  foldingStrategy?: FoldingStrategy;
  quickNav?: MonoQuickNavOptions;
  breadcrumbs?: MonoBreadcrumbsOptions;
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
    trigger?: 'click' | 'hover' | 'off';
    delay?: number;
    hidingDelay?: number;
    sticky?: boolean;
    above?: boolean;
    openOnMouseHover?: boolean;
  };
  diagnostics?: {
    popup?: 'hover' | 'click' | 'off';
  };
  lightbulb?: {
    enabled?: LightbulbEnabledMode;
  };
  contextMenu?: MonoContextMenuOptions;
  inlayHints?: {
    enabled?: boolean;
    fontSize?: number;
    fontFamily?: string;
    padding?: boolean;
    onClick?: 'placeCursor' | 'bubble' | 'none';
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
