export {
  createMonoDiffNavigator,
  createMonoEditor,
  editor,
  getActiveMonoEditors,
  MonoDiffEditor,
  MonoEditor,
  onDidCreateMonoDiffEditor,
  type DiffUpdateEvent,
  type ICodeEditorOpener,
  type IDiffEditorModel,
  type IDiffEditorModelChangedEvent,
  type IDiffEditorViewState,
  type IDiffNavigator,
  type IDiffNavigatorOptions,
  type IHideUnchangedRegionsOptions,
  type IMonoDiffEditor,
  type IStandaloneTextModel,
  type MonoDiffEditorOptions,
} from './api/editor.api';
export { languages } from './api/languages.api';
export { TextModel } from './common/model/TextModel';

// Core geometry, URI & erasable enum constants
export {
  CompletionTriggerKind,
  ContentWidgetPositionPreference,
  EndOfLineSequence,
  IndentAction,
  KeyCode,
  KeyMod,
  MouseTargetType,
  OverlayWidgetPositionPreference,
  Position,
  Range,
  ScrollType,
  Selection,
  SelectionDirection,
  TrackedRangeStickiness,
  Uri,
} from './common/core';
export type {
  IContentSizeChangedEvent,
  IContentWidget,
  IContentWidgetPosition,
  IContextKey,
  ICursorStateComputer,
  IDimension,
  IEditorLayoutInfo,
  IEditorMouseEvent,
  IEditorViewState,
  IModelContentChange,
  IModelContentChangedEvent,
  IModelDecorationsChangedEvent,
  IModelLanguageChangedEvent,
  IModelOptionsChangedEvent,
  IMouseTarget,
  IOverlayWidget,
  IOverlayWidgetPosition,
  IPasteEvent,
  ITextModelResolvedOptions,
  ITextModelUpdateOptions,
  IViewZone,
  IViewZoneChangeAccessor,
  IWordAtPosition,
  UriComponents,
} from './common/core';

export type {
  CursorBlinkingMode,
  CursorStyleMode,
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
  MonoErrorLensOptions,
  MonoLineNumbers,
  MonoMobileQuickKeysOptions,
  RenderLineHighlightMode,
  RenderWhitespaceMode,
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

// Daily editing operations (comment toggle, line move/duplicate/delete/insert + line transforms)
export {
  deleteLines,
  duplicateLines,
  insertLine,
  moveLines,
  toggleBlockComment,
  toggleLineComment,
} from './common/editOperations/EditOperations';
export {
  convertIndentation,
  deleteDuplicateLines,
  joinLines,
  sortLines,
  transformCase,
  transposeCharacters,
  trimTrailingWhitespace,
} from './common/editOperations/lineTransforms';
export { computeDiff, computeLineDiff } from './common/diff/myersDiff';
export type {
  DiffChangeHunk,
  DiffHunk,
  DiffInlineRow,
  DiffRowKind,
  DiffSideBySideRow,
  ICharChange,
  IDiffComputationOptions,
  IDiffComputationResult,
  ILineChange,
  IMovedText,
  InlineDiffRow,
  LineDiffResult,
  SideBySideDiffRow,
} from './common/diff/myersDiff';

export { DEFAULT_STICKY_SCROLL } from './common/viewModel/StickyScroll';
export { MarkdownScopeFinder, OutlineScopeFinder, StructureScopeFinder } from './common/viewModel/markdownSticky';
export type {
  IScopeFinder,
  MonoStickyScrollOptions,
  StickyLine,
  StickyRenderLine,
} from './common/viewModel/StickyScroll';

// Document Structure Engine (S1-S6: Folding, Outlines, Scopes) & Breadcrumbs API
export {
  buildBracketNodes,
  buildHeadingNodes,
  buildKeywordNodes,
  buildOffsideNodes,
  buildStructureTree,
  buildSymbolsFromTree,
  buildTagNodes,
  DEFAULT_HTML_VOID_TAGS,
  DEFAULT_OPTIONAL_END_TAGS,
  DEFAULT_STRUCTURE_MAX_LINE_LENGTH,
  DEFAULT_STRUCTURE_MAX_LINES,
  DocumentStructureService,
  isColumnIgnoredByTokens,
  queryScopeAt,
  scanDocumentBrackets,
  StructureKind,
  structureTreeToFoldingRanges,
} from './common/structure';
export type {
  BracketScanOptions,
  BracketScanResult,
  IDocumentStructure,
  LineTokensProvider,
  ScannedBracket,
  StructureBuildOptions,
  StructureEngineKind,
  StructureKeywordPair,
  StructureLanguageRules,
  StructureNodeDraft,
  StructureScopeItem,
  StructureTree,
} from './common/structure';
export {
  DEFAULT_BREADCRUMBS_OPTIONS,
  isSymbolKindVisibleInBreadcrumbs,
  resolveBreadcrumbsOptions,
  sortBreadcrumbSymbols,
} from './common/breadcrumbs/breadcrumbsTypes';
export type {
  BreadcrumbItemKind,
  IBreadcrumbItem,
  IBreadcrumbsModel,
  IBreadcrumbsPathProvider,
  IBreadcrumbsSnapshot,
  ResolvedBreadcrumbsOptions,
} from './common/breadcrumbs/breadcrumbsTypes';
export type {
  BreadcrumbPathMode,
  BreadcrumbSymbolSortOrder,
  FoldingStrategy,
  MonoBreadcrumbsKindFilter,
  MonoBreadcrumbsOptions,
  MonoFoldingOptions,
  MonoQuickNavOptions,
} from './common/config/editorOptions';
export type { IGoToLineRequestEvent } from './browser/editor/editorTypes';

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
  evaluateWhenExpression,
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
export {
  BUILTIN_CLIPBOARD_COMMANDS,
  createMenuEvalContext,
  MenuId,
  MenuRegistry,
  menus,
  registerDefaultEditorMenuEntries,
} from './platform/menus';
export type {
  MenuEvalContext,
  MonoMenuEntry,
  ResolvedMenuEntry,
  ResolvedMenuGroup,
} from './platform/menus';
export { PaletteService } from './platform/palette';
export { createRowGeometry } from './browser/view/viewLayout';
export type { RowGeometry } from './browser/view/viewLayout';
export type { IInlayHintClickEvent } from './common/languages';
export { computeDocsPlacement } from './contrib/suggest/widget/suggestDetailsPane';
export {
  capPopupMaxWidth,
  placePopupHorizontal,
  POPUP_MAX_WIDTH_RATIO,
} from './common/util/popupPlacement';
export type {
  PopupHorizontalInput,
  PopupHorizontalResult,
} from './common/util/popupPlacement';
export { placeSuggestDocs } from './common/util/suggestDocsPlacement';
export type {
  PlaceSuggestDocsInput,
  SuggestDocsBoxRect,
  SuggestDocsCaretBand,
  SuggestDocsPlacementResult,
} from './common/util/suggestDocsPlacement';
export { computeSignaturePlacement } from './contrib/signatureHelp/SignatureHelpWidget';
export {
  computeCascadeTiming,
  computeMenuPlacement,
  computeMenuSafeArea,
} from './contrib/contextMenu/menuPlacement';
export { markersAtPosition } from './contrib/hover/HoverController';
export { resolveHoverAndDiagnosticsTriggers } from './contrib/hover/HoverContribution';

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
  HC_BLACK_ID,
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
  MarkerTag,
} from './common/decorations';
export type {
  IEditorDecorationsCollection,
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
  CodeLens,
  CodeLensList,
  CodeLensProvider,
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
  LinkedEditingRangeProvider,
  LinkedEditingRanges,
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
