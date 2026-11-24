export {
  createMonoEditor,
  editor,
  getActiveMonoEditors,
  MonoEditor,
  type IStandaloneTextModel,
} from './api/editor.api';
export { languages } from './api/languages.api';

// Core geometry, URI & erasable enum constants
export {
  CompletionTriggerKind,
  EndOfLineSequence,
  IndentAction,
  KeyCode,
  KeyMod,
  Position,
  Range,
  Selection,
  SelectionDirection,
  Uri,
} from './common/core';
export type { UriComponents } from './common/core';

export type {
  ICursorPositionChangedEvent,
  ICursorSelectionChangedEvent,
  IEditorContribution,
  IIdentifiedSingleEditOperation,
  IModelChangedEvent,
  IMonoEditor,
  IMonoEditorAction,
  IMonoTextModel,
  IPosition,
  IScrollEvent,
  ISelection,
  MonoContentChangeEvent,
  MonoDisposable,
  MonoEditorOptions,
  MonoEditorTheme,
  MonoLineNumbers,
} from './api/types';
export { DEFAULT_THEME } from './api/types';

// Syntax highlighting & LanguageConfiguration (expandable API)
export {
  clearLanguageConfigurations,
  createRegexTokensProvider,
  DEFAULT_TOKEN_COLORS,
  evaluateOnEnter,
  getLanguageConfiguration,
  getLanguages,
  registerDefaultLanguageConfigurations,
  registerDefaultLanguages,
  registerLanguage,
  setLanguageConfiguration,
} from './common/languages';
export type {
  AutoClosingBehavior,
  AutoIndentBehavior,
  AutoSurroundBehavior,
  CharacterPair,
  CommentRule,
  EnterAction,
  EvaluatedEnterResult,
  FoldingMarkers,
  FoldingRules,
  IAutoClosingPair,
  IAutoClosingPairConditional,
  ILanguageExtensionPoint,
  IndentationRule,
  LanguageConfiguration,
  LanguageSegment,
  LineTokenizeResult,
  MonoToken,
  MonoTokensProvider,
  MonoTokenTheme,
  MonoTokenType,
  OnEnterRule,
  RegexProviderOptions,
  RegexRule,
  TokenizeLineOptions,
} from './common/languages';

// Theme-aware 5-level Rainbow Bracket Pair Colorization
export {
  BracketColorizer,
  clampRainbowLevels,
  DEFAULT_BRACKET_COLORIZATION_OPTIONS,
  DEFAULT_BRACKET_PAIRS,
  DEFAULT_RAINBOW_BRACKET_COLORS,
  DEFAULT_UNEXPECTED_BRACKET_COLOR,
  resolveBracketColorizationOptions,
} from './common/brackets';
export type {
  BracketColorizationRule,
  BracketPairColorizationOptions,
  BracketPairDef,
  LineBracketColor,
  LineTokensLookup,
} from './common/brackets';

// Daily editing operations (comment toggle, line move/duplicate/delete/insert)
export {
  deleteLines,
  duplicateLines,
  insertLine,
  moveLines,
  toggleBlockComment,
  toggleLineComment,
} from './common/editOperations/EditOperations';

export { DEFAULT_STICKY_SCROLL } from './common/viewModel/StickyScroll';
export { MarkdownScopeFinder, OutlineScopeFinder } from './common/viewModel/markdownSticky';
export type {
  IScopeFinder,
  MonoStickyScrollOptions,
  StickyLine,
  StickyRenderLine,
} from './common/viewModel/StickyScroll';

// Phase 6: Universal Multiline Ghost Text & Inlay Hints virtual layout
export {
  buildWrappedGhostRows,
  collectInlineVirtualElements,
  extractNextGhostLine,
  extractNextGhostWord,
  GhostTextModel,
  INLAY_CHIP_PAD_X,
  INLAY_OUTER_MARGIN,
  mapVirtualXToRealX,
  splitGhostText,
  virtualAdvanceBeforeColumn,
  virtualElementStartX,
} from './common/virtualText';
export type {
  GhostAcceptResult,
  GhostTextItem,
  GhostTextKind,
  InlineGhostRun,
  InlineVirtualElement,
  LineVirtualInputs,
  NormalizedGhostText,
  ResolvedInlayHint,
  VirtualGhostRow,
} from './common/virtualText';

// Phase 2: Folding, Word Wrap Projection, Code Features & Overlay Scrollbar
export { ViewLineProjection } from './common/viewModel/ViewLineProjection';
export type {
  VisualLine,
  WordWrapMode,
  WrappingIndentMode,
} from './common/viewModel/ViewLineProjection';
export { computeIndentFoldingRanges, FoldingModel } from './common/viewModel/FoldingModel';
export { OverlayScrollbar } from './browser/view/viewParts/OverlayScrollbar';
export type {
  OverlayScrollbarOptions,
  OverviewTick,
  ScrollbarState,
  ScrollbarVisibility,
} from './browser/view/viewParts/OverlayScrollbar';
export {
  computeIndentGuides,
  findMatchingBracket,
  findVisibleOccurrences,
} from './common/editOperations/CodeFeatures';
export type {
  BracketMatchPair,
  IndentGuideInfo,
  OccurrenceHighlight,
} from './common/editOperations/CodeFeatures';

// Phase 3: Snippets, Safe Markdown, Dynamic Caret Color & Widget Theme
export { hasSnippetSyntax, parseSnippet, SnippetSession } from './common/editOperations/SnippetSession';
export type { ParsedSnippet } from './common/editOperations/SnippetSession';
export { renderHighlightedCodeToDom, renderMarkdownToDom } from './browser/render/markdownDom';
export {
  COLOR_SWATCH_ADVANCE,
  resolveDynamicCaretColor,
  softenDynamicColor,
} from './browser/render/CanvasRenderer';
export type { ColorHit, InlayHintHit, LinkHit } from './browser/render/CanvasRenderer';
export { SignatureHelpController } from './contrib/signatureHelp/SignatureHelpController';
export { SignatureHelpWidget } from './contrib/signatureHelp/SignatureHelpWidget';
export { InlineRenameWidget } from './contrib/rename/InlineRenameWidget';
export { ReferencesPeekWidget } from './contrib/referencesPeek/ReferencesPeekWidget';
export { CodeActionLightbulbWidget } from './contrib/codeAction/CodeActionLightbulbWidget';

// Phase 4: Inline References Peek View, Color Bullets & Picker, Minimap, 6 Additional Tokenizers
export { ReferencesPeekView } from './contrib/referencesPeek/ReferencesPeekView';
export type {
  PeekReferenceItem,
  ReferencesPeekCallbacks,
} from './contrib/referencesPeek/ReferencesPeekView';
export { ColorPickerWidget } from './contrib/colorPicker/ColorPickerWidget';
export type { ColorPickerHandlers } from './contrib/colorPicker/ColorPickerWidget';
export {
  CSS_NAMED_COLORS,
  DEFAULT_COLOR_DECORATOR_RULES,
  detectLineColors,
  detectLineEmbeddedScope,
  formatColorPresentation,
  parseColorLiteral,
} from './common/color';
export type {
  ColorContextMode,
  ColorDecoratorRules,
  ColorFormat,
  ColorFormatOptions,
  ColorMatch,
  ColorRuleContext,
  ColorScopeRule,
  EmbeddedColorScope,
  RgbaColor,
} from './common/color';
export { DEFAULT_MINIMAP_OPTIONS, MinimapController } from './browser/view/viewParts/MinimapController';
export type {
  MinimapDecorations,
  MonoMinimapOptions,
} from './browser/view/viewParts/MinimapController';
export { createJavaTokensProvider } from './common/languages/defaults/java';
export { createCppTokensProvider } from './common/languages/defaults/cpp';
export { createMarkdownTokensProvider } from './common/languages/defaults/markdown';
export { createYamlTokensProvider } from './common/languages/defaults/yaml';
export { createShellTokensProvider } from './common/languages/defaults/shell';
export { createSqlTokensProvider } from './common/languages/defaults/sql';

export { DEFAULT_MENU_STYLE, MENU_ICONS } from './common/config/menuTypes';
export type {
  MonoMenuContext,
  MonoMenuItem,
  MonoMenuItemId,
  MonoMenuStyle,
} from './common/config/menuTypes';

export { KeybindingService, MonoCommands } from './platform/keybindings/KeybindingService';
export type { MonoKeybinding } from './platform/keybindings/KeybindingService';

// Commands + palette engine (UI stays in app)
export {
  CommandService,
  CommandsRegistry,
  ContextKeyService,
} from './platform/commands';
export type {
  MonoAction,
  MonoCommand,
  MonoCommandHandler,
  MonoPaletteCommandItem,
  MonoPaletteItem,
  MonoPaletteProvideContext,
  MonoPaletteProvider,
  MonoRegisteredCommand,
} from './platform/commands';
export { PaletteService } from './platform/palette';

// Find / Replace (in-editor widget + engine)
export { FindController, findMatches } from './contrib/find';
export type { FindMatch, FindOptions, FindState } from './contrib/find';

export {
  codicon,
  FIND_ICON_SVG,
  FIND_ICONS,
  hasIcon,
  listCodicons,
  registerExtraIcon,
} from './platform/icons';
export type { CodiconId } from './platform/icons';

export { attachPressFeedback, haptic } from './platform/haptic/haptic';

// Theme (Monaco-level defineTheme / setTheme)
export {
  BUILTIN_THEME_IDS,
  isDarkColor,
  monoThemeService,
  MonoThemeService,
  MSCODE_AMOLED_ID,
  MSCODE_DARK_ID,
  MSCODE_LIGHT_ID,
  registerBuiltinThemes,
  resolveWidgetTheme,
  SOLARIZED_DARK_ID,
  SOLARIZED_LIGHT_ID,
} from './platform/theme';
export type {
  MonoColorTheme,
  MonoStandaloneThemeData,
  MonoThemeBase,
  MonoThemeRule,
  ResolvedMonoEditorTheme,
  ResolvedWidgetTheme,
} from './platform/theme';

// Decorations / markers (diagnostics)
export {
  DecorationsCollection,
  MarkerService,
  MarkerSeverity,
} from './common/decorations';
export type {
  IMarker,
  IMarkerData,
  IModelDecorationOptions,
  IModelDeltaDecoration,
  IRange,
} from './common/decorations';

// Language features (completion / hover / folding / signature help / mobile-first LSP)
export {
  analyzeCallContext,
  applySemanticTokenEdits,
  CompletionItemInsertTextRule,
  CompletionItemKind,
  decodeSemanticTokens,
  DocumentHighlightKind,
  InlayHintKind,
  InlineCompletionTriggerKind,
  languageFeatures,
  resolveParameterLabelRange,
  SemanticTokensCache,
  SymbolKind,
  SymbolTag,
} from './common/languages';
export type {
  ActiveCallContext,
  CodeAction,
  CodeActionContext,
  CodeActionList,
  CodeActionProvider,
  CompletionItem,
  CompletionList,
  CompletionProvider,
  DeclarationProvider,
  DefinitionProvider,
  DocumentColorProvider,
  DocumentFormattingEditProvider,
  DocumentHighlight,
  DocumentHighlightProvider,
  DocumentPasteContext,
  DocumentPasteEdit,
  DocumentPasteEditProvider,
  DocumentRangeFormattingEditProvider,
  DocumentRangeSemanticTokensProvider,
  DocumentSemanticTokensProvider,
  DocumentSymbol,
  DocumentSymbolProvider,
  FoldingRange,
  FoldingRangeProvider,
  FormattingOptions,
  Hover,
  HoverProvider,
  IColor,
  IColorInformation,
  IColorPresentation,
  ILink,
  ILinksList,
  IMarkdownString,
  InlayHint,
  InlayHintLabelPart,
  InlayHintsProvider,
  InlineCompletionContext,
  InlineCompletionItem,
  InlineCompletionList,
  InlineCompletionsProvider,
  IWorkspaceTextEdit,
  LinkProvider,
  Location,
  LocationLink,
  OnTypeFormattingEditProvider,
  ParameterInformation,
  ReferenceContext,
  ReferenceProvider,
  RenameLocation,
  RenameProvider,
  SelectionRange,
  SelectionRangeProvider,
  SemanticTokens,
  SemanticTokensEdit,
  SemanticTokensEdits,
  SemanticTokensLegend,
  SemanticTokenSpan,
  SignatureHelp,
  SignatureHelpContext,
  SignatureHelpProvider,
  SignatureHelpResult,
  SignatureInformation,
  TextEdit,
  TypeDefinitionProvider,
  WorkspaceEdit,
} from './common/languages';
