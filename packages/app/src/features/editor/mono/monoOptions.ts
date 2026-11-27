// src/features/editor/mono/monoOptions.ts
// Maps MSCode IDE settings cleanly onto MonoEditorOptions (@mono/editor).

import type {
  AutoClosingBehavior,
  AutoIndentBehavior,
  AutoSurroundBehavior,
  BreadcrumbFolderClickBehavior,
  BreadcrumbPathMode,
  BreadcrumbSymbolSortOrder,
  CursorBlinkingMode,
  CursorStyleMode,
  FoldingStrategy,
  MonoEditorOptions,
  MonoLineNumbers,
  RenderLineHighlightMode,
  RenderWhitespaceMode,
  WordWrapMode,
  WrappingIndentMode,
} from '@mono/editor';

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return fallback;
}

function parseRulers(v: unknown): number[] {
  if (Array.isArray(v)) {
    return v.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
  }
  if (typeof v === 'string' && v.trim().length > 0) {
    return v
      .split(/[,\s]+/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
  }
  return [];
}

function resolveLineHeight(rawLineHeight: unknown, fontSize: number): number | undefined {
  const lh = Number(rawLineHeight);
  if (!Number.isFinite(lh) || lh <= 0) return undefined;
  if (lh > 0 && lh < 8) return Math.round(fontSize * lh);
  return Math.round(lh);
}

/**
 * Translates MSCode IDE settings (`editor.*`) into a full `MonoEditorOptions` patch.
 */
export function buildMonoEditorOptions(
  settings: Record<string, unknown> = {},
): Partial<MonoEditorOptions> {
  const fontSize = Math.max(6, Math.min(100, num(settings['editor.fontSize'], 13)));
  const fontFamily =
    (typeof settings['editor.fontFamily'] === 'string' && settings['editor.fontFamily'].trim()) ||
    "'Fira Code', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  const lineHeight = resolveLineHeight(settings['editor.lineHeight'], fontSize);

  // Line numbers
  const rawLN = String(settings['editor.lineNumbers'] ?? 'on');
  const lineNumbers: MonoLineNumbers =
    rawLN === 'off' || rawLN === 'relative' || rawLN === 'interval' ? rawLN : 'on';

  // Word wrap & wrapping indent
  const rawWrap = String(settings['editor.wordWrap'] ?? 'off');
  const wordWrap: WordWrapMode = rawWrap === 'off' ? 'off' : 'on';

  const rawWrapIndent = String(settings['editor.wrappingIndent'] ?? 'same');
  const wrappingIndent: WrappingIndentMode =
    rawWrapIndent === 'none'
      ? 'none'
      : rawWrapIndent === 'indent' || rawWrapIndent === 'deepIndent'
        ? 'indent'
        : 'same';

  // Whitespace / line highlight / cursor
  const rawWs = String(settings['editor.renderWhitespace'] ?? 'selection');
  const renderWhitespace: RenderWhitespaceMode = (
    ['none', 'boundary', 'selection', 'trailing', 'all'].includes(rawWs) ? rawWs : 'selection'
  ) as RenderWhitespaceMode;

  const rawLhMode = String(settings['editor.renderLineHighlight'] ?? 'line');
  const renderLineHighlight: RenderLineHighlightMode = (
    ['none', 'gutter', 'line', 'all'].includes(rawLhMode) ? rawLhMode : 'line'
  ) as RenderLineHighlightMode;

  const rawCursorStyle = String(settings['editor.cursorStyle'] ?? 'line');
  const cursorStyle: CursorStyleMode = (
    ['line', 'block', 'underline', 'line-thin', 'block-outline', 'underline-thin'].includes(
      rawCursorStyle,
    )
      ? rawCursorStyle
      : 'line'
  ) as CursorStyleMode;

  const rawCursorBlink = String(settings['editor.cursorBlinking'] ?? 'blink');
  const cursorBlinking: CursorBlinkingMode = (
    ['blink', 'smooth', 'phase', 'expand', 'solid'].includes(rawCursorBlink)
      ? rawCursorBlink
      : 'blink'
  ) as CursorBlinkingMode;

  // Quick suggestions & suggest widget
  const rawQS = settings['editor.quickSuggestions'];
  const qsEnabled = rawQS !== 'off' && rawQS !== false;
  const qsComments = bool(settings['editor.quickSuggestions.comments'], false);
  const qsStrings = bool(settings['editor.quickSuggestions.strings'], false);

  const rawSuggestMode = String(
    settings['editor.suggest.mode'] ?? (rawQS === 'inline' ? 'ghost' : 'palette'),
  );
  const suggestMode: 'palette' | 'ghost' = rawSuggestMode === 'ghost' ? 'ghost' : 'palette';

  const rawSuggestDocs = String(settings['editor.suggest.docs'] ?? 'auto');
  const suggestDocs: 'off' | 'auto' | 'side' | 'below' = (
    ['off', 'auto', 'side', 'below'].includes(rawSuggestDocs) ? rawSuggestDocs : 'auto'
  ) as 'off' | 'auto' | 'side' | 'below';

  const rawAcceptEnter = String(settings['editor.acceptSuggestionOnEnter'] ?? 'on');
  const acceptSuggestionOnEnter: 'on' | 'smart' | 'off' = (
    ['on', 'smart', 'off'].includes(rawAcceptEnter) ? rawAcceptEnter : 'on'
  ) as 'on' | 'smart' | 'off';

  const rawSuggestSelection = String(settings['editor.suggestSelection'] ?? 'first');
  const suggestSelection: 'first' | 'recentlyUsed' | 'recentlyUsedByPrefix' = (
    ['first', 'recentlyUsed', 'recentlyUsedByPrefix'].includes(rawSuggestSelection)
      ? rawSuggestSelection
      : 'first'
  ) as 'first' | 'recentlyUsed' | 'recentlyUsedByPrefix';

  const rawSuggestInsertMode = String(settings['editor.suggest.insertMode'] ?? 'insert');
  const suggestInsertMode: 'insert' | 'replace' =
    rawSuggestInsertMode === 'replace' ? 'replace' : 'insert';

  const rawSuggestPreviewMode = String(settings['editor.suggest.previewMode'] ?? 'subwordSmart');
  const suggestPreviewMode: 'prefix' | 'subword' | 'subwordSmart' = (
    ['prefix', 'subword', 'subwordSmart'].includes(rawSuggestPreviewMode)
      ? rawSuggestPreviewMode
      : 'subwordSmart'
  ) as 'prefix' | 'subword' | 'subwordSmart';

  const rawWordBased = String(settings['editor.wordBasedSuggestions'] ?? 'matchingDocuments');
  const wordBasedSuggestions: 'off' | 'currentDocument' | 'matchingDocuments' | 'allDocuments' = (
    ['off', 'currentDocument', 'matchingDocuments', 'allDocuments'].includes(rawWordBased)
      ? rawWordBased
      : 'matchingDocuments'
  ) as 'off' | 'currentDocument' | 'matchingDocuments' | 'allDocuments';

  const rawSnippetSuggestions = String(settings['editor.snippetSuggestions'] ?? 'inline');
  const snippetSuggestions: 'top' | 'bottom' | 'inline' | 'none' = (
    ['top', 'bottom', 'inline', 'none'].includes(rawSnippetSuggestions)
      ? rawSnippetSuggestions
      : 'inline'
  ) as 'top' | 'bottom' | 'inline' | 'none';

  const rawTabCompletion = String(settings['editor.tabCompletion'] ?? 'off');
  const tabCompletion: 'on' | 'off' | 'onlySnippets' = (
    ['on', 'off', 'onlySnippets'].includes(rawTabCompletion) ? rawTabCompletion : 'off'
  ) as 'on' | 'off' | 'onlySnippets';

  const rawLightbulb = String(settings['editor.lightbulb.enabled'] ?? 'on');
  const lightbulbEnabled: 'off' | 'on' | 'onCode' = (
    ['off', 'on', 'onCode'].includes(rawLightbulb) ? rawLightbulb : 'on'
  ) as 'off' | 'on' | 'onCode';

  const suggestFontSize = Math.max(0, Math.min(100, num(settings['editor.suggestFontSize'], 0)));
  const suggestLineHeight = Math.max(0, Math.min(1000, num(settings['editor.suggestLineHeight'], 0)));

  // Sticky scroll
  const rawStickyModel = String(settings['editor.stickyScroll.defaultModel'] ?? 'outlineModel');
  const stickyDefaultModel: 'outlineModel' | 'indentationModel' =
    rawStickyModel === 'outlineModel' ? 'outlineModel' : 'indentationModel';

  // Occurrences highlight (Mono uses boolean)
  const rawOcc = settings['editor.occurrencesHighlight'];
  const occurrencesHighlight =
    typeof rawOcc === 'boolean' ? rawOcc : rawOcc !== 'off' && rawOcc !== undefined ? true : false;

  // Guides
  const rawActiveIndent = settings['editor.guides.highlightActiveIndentation'];
  const highlightActiveIndentation =
    typeof rawActiveIndent === 'boolean' ? rawActiveIndent : rawActiveIndent !== 'false';

  // Semantic highlighting
  const rawSemantic = settings['editor.semanticHighlighting.enabled'];
  const semanticEnabled =
    typeof rawSemantic === 'boolean' ? rawSemantic : rawSemantic !== 'false';

  // Inlay hints
  const rawInlay = settings['editor.inlayHints.enabled'];
  const inlayEnabled = typeof rawInlay === 'boolean' ? rawInlay : rawInlay !== 'off';
  const inlayFontSize = num(settings['editor.inlayHints.fontSize'], 0);
  const inlayFontFamily = String(settings['editor.inlayHints.fontFamily'] ?? '').trim();
  const rawInlayClick = String(settings['editor.inlayHints.onClick'] ?? 'placeCursor');
  const inlayOnClick: 'placeCursor' | 'bubble' | 'none' = (
    ['placeCursor', 'bubble', 'none'].includes(rawInlayClick) ? rawInlayClick : 'placeCursor'
  ) as 'placeCursor' | 'bubble' | 'none';

  // Code lens
  const codeLensFontSize = num(settings['editor.codeLensFontSize'], 0);
  const codeLensFontFamily = String(settings['editor.codeLensFontFamily'] ?? '').trim();

  // Hover
  const rawHoverTrigger = String(settings['editor.hover.trigger'] ?? 'hover');
  const hoverTrigger: 'click' | 'hover' | 'off' = (
    ['click', 'hover', 'off'].includes(rawHoverTrigger) ? rawHoverTrigger : 'hover'
  ) as 'click' | 'hover' | 'off';

  // Diagnostics popup
  const rawDiagPopup = String(settings['editor.diagnostics.popup'] ?? 'hover');
  const diagPopup: 'hover' | 'click' | 'off' = (
    ['hover', 'click', 'off'].includes(rawDiagPopup) ? rawDiagPopup : 'hover'
  ) as 'hover' | 'click' | 'off';

  // Context menu (native Mono Editor menu)
  const rawCtxType = String(settings['editor.contextMenu.type'] ?? 'horizontal');
  const ctxType: 'horizontal' | 'vertical' =
    rawCtxType === 'vertical' ? 'vertical' : 'horizontal';
  const rawCtxAnim = String(settings['editor.contextMenu.animation'] ?? 'cascade');
  const ctxAnim: 'cascade' | 'smooth' | 'none' = (
    ['cascade', 'smooth', 'none'].includes(rawCtxAnim) ? rawCtxAnim : 'cascade'
  ) as 'cascade' | 'smooth' | 'none';

  // Inline suggest
  const rawInlineToolbar = String(settings['editor.inlineSuggest.showToolbar'] ?? 'touch');
  const inlineToolbar: 'always' | 'touch' | 'onHover' | 'never' = (
    ['always', 'touch', 'onHover', 'never'].includes(rawInlineToolbar) ? rawInlineToolbar : 'touch'
  ) as 'always' | 'touch' | 'onHover' | 'never';

  // Color decorators context
  const rawColorCtx = String(settings['editor.colorDecorators.context'] ?? 'auto');
  const colorContext: 'auto' | 'stringsOnly' | 'outsideStrings' | 'all' = (
    ['auto', 'stringsOnly', 'outsideStrings', 'all'].includes(rawColorCtx) ? rawColorCtx : 'auto'
  ) as 'auto' | 'stringsOnly' | 'outsideStrings' | 'all';

  // Accessibility support
  const rawA11y = String(settings['editor.accessibilitySupport'] ?? 'auto');
  const accessibilitySupport: 'auto' | 'on' | 'off' = (
    ['auto', 'on', 'off'].includes(rawA11y) ? rawA11y : 'auto'
  ) as 'auto' | 'on' | 'off';

  // Scrollbar visibility
  const rawSbV = String(settings['editor.scrollbar.vertical'] ?? 'auto');
  const sbV: 'auto' | 'visible' | 'hidden' = (
    ['auto', 'visible', 'hidden'].includes(rawSbV) ? rawSbV : 'auto'
  ) as 'auto' | 'visible' | 'hidden';
  const rawSbH = String(settings['editor.scrollbar.horizontal'] ?? 'auto');
  const sbH: 'auto' | 'visible' | 'hidden' = (
    ['auto', 'visible', 'hidden'].includes(rawSbH) ? rawSbH : 'auto'
  ) as 'auto' | 'visible' | 'hidden';

  // Auto-closing / surround / indent
  const autoClosingBrackets = (
    ['always', 'languageDefined', 'beforeWhitespace', 'never'].includes(
      String(settings['editor.autoClosingBrackets']),
    )
      ? String(settings['editor.autoClosingBrackets'])
      : 'languageDefined'
  ) as AutoClosingBehavior;

  const autoClosingQuotes = (
    ['always', 'languageDefined', 'beforeWhitespace', 'never'].includes(
      String(settings['editor.autoClosingQuotes']),
    )
      ? String(settings['editor.autoClosingQuotes'])
      : 'languageDefined'
  ) as AutoClosingBehavior;

  const autoSurround = (
    ['languageDefined', 'quotes', 'brackets', 'never'].includes(
      String(settings['editor.autoSurround']),
    )
      ? String(settings['editor.autoSurround'])
      : 'languageDefined'
  ) as AutoSurroundBehavior;

  const autoIndent = (
    ['none', 'keep', 'brackets', 'advanced', 'full'].includes(
      String(settings['editor.autoIndent']),
    )
      ? String(settings['editor.autoIndent'])
      : 'full'
  ) as AutoIndentBehavior;

  const matchBrackets = (
    ['always', 'near', 'never'].includes(String(settings['editor.matchBrackets']))
      ? String(settings['editor.matchBrackets'])
      : 'always'
  ) as 'always' | 'near' | 'never';

  // Folding strategy
  const rawFoldingStrategy = String(settings['editor.foldingStrategy'] ?? 'auto');
  const foldingStrategy: FoldingStrategy =
    rawFoldingStrategy === 'syntax' || rawFoldingStrategy === 'indentation'
      ? rawFoldingStrategy
      : 'auto';

  // Breadcrumbs (VS Code full option set)
  const rawBcFilePath = String(settings['breadcrumbs.filePath'] ?? 'on');
  const bcFilePath: BreadcrumbPathMode =
    rawBcFilePath === 'off' || rawBcFilePath === 'last' ? rawBcFilePath : 'on';
  const rawBcSymbolPath = String(settings['breadcrumbs.symbolPath'] ?? 'on');
  const bcSymbolPath: BreadcrumbPathMode =
    rawBcSymbolPath === 'off' || rawBcSymbolPath === 'last' ? rawBcSymbolPath : 'on';
  const rawBcSort = String(settings['breadcrumbs.symbolSortOrder'] ?? 'position');
  const bcSort: BreadcrumbSymbolSortOrder =
    rawBcSort === 'name' || rawBcSort === 'type' ? rawBcSort : 'position';
  const rawBcFolderBehavior = String(settings['breadcrumbs.folderClickBehavior'] ?? 'expand');
  const bcFolderBehavior: BreadcrumbFolderClickBehavior =
    rawBcFolderBehavior === 'enter' ? 'enter' : 'expand';

  return {
    // Font
    fontSize,
    fontFamily,
    ...(lineHeight ? { lineHeight } : {}),

    // Editing & Indentation
    readOnly: bool(settings['editor.readOnly'], false),
    tabSize: Math.max(1, Math.min(32, num(settings['editor.tabSize'], 4))),
    insertSpaces: bool(settings['editor.insertSpaces'], true),
    detectIndentation: bool(settings['editor.detectIndentation'], true),
    trimAutoWhitespace: bool(settings['editor.trimAutoWhitespace'], true),
    stickyTabStops: bool(settings['editor.stickyTabStops'], false),
    emptySelectionClipboard: bool(settings['editor.emptySelectionClipboard'], true),
    formatOnPaste: bool(settings['editor.formatOnPaste'], false),
    linkedEditing: bool(settings['editor.linkedEditing'], false),
    autoClosingBrackets,
    autoClosingQuotes,
    autoSurround,
    autoIndent,
    bracketEnterIndent: bool(settings['editor.bracketEnterIndent'], true),
    undoGroupIdleMs: Math.max(50, num(settings['editor.undoGroupIdleMs'], 500)),

    // Display & Gutter
    lineNumbers,
    lineNumbersMinChars: Math.max(1, Math.min(10, num(settings['editor.lineNumbersMinChars'], 3))),
    glyphMargin: bool(settings['editor.glyphMargin'], false),
    renderWhitespace,
    rulers: parseRulers(settings['editor.rulers']),
    renderLineHighlight,
    wordWrap,
    wrappingIndent,
    folding: bool(settings['editor.folding'], true),
    foldingStrategy,
    quickNav: {
      gotoLine: 'external',
      gotoSymbol: 'external',
    },
    breadcrumbs: {
      enabled: bool(settings['breadcrumbs.enabled'], true),
      filePath: bcFilePath,
      symbolPath: bcSymbolPath,
      icons: bool(settings['breadcrumbs.icons'], true),
      symbolSortOrder: bcSort,
      showSymbolDetails: bool(settings['breadcrumbs.showSymbolDetails'], false),
      folderClickBehavior: bcFolderBehavior,
      showFiles: bool(settings['breadcrumbs.showFiles'], true),
      showModules: bool(settings['breadcrumbs.showModules'], true),
      showNamespaces: bool(settings['breadcrumbs.showNamespaces'], true),
      showPackages: bool(settings['breadcrumbs.showPackages'], true),
      showClasses: bool(settings['breadcrumbs.showClasses'], true),
      showMethods: bool(settings['breadcrumbs.showMethods'], true),
      showProperties: bool(settings['breadcrumbs.showProperties'], true),
      showFields: bool(settings['breadcrumbs.showFields'], true),
      showConstructors: bool(settings['breadcrumbs.showConstructors'], true),
      showEnums: bool(settings['breadcrumbs.showEnums'], true),
      showInterfaces: bool(settings['breadcrumbs.showInterfaces'], true),
      showFunctions: bool(settings['breadcrumbs.showFunctions'], true),
      showVariables: bool(settings['breadcrumbs.showVariables'], true),
      showConstants: bool(settings['breadcrumbs.showConstants'], true),
      showStrings: bool(settings['breadcrumbs.showStrings'], true),
      showNumbers: bool(settings['breadcrumbs.showNumbers'], true),
      showBooleans: bool(settings['breadcrumbs.showBooleans'], true),
      showArrays: bool(settings['breadcrumbs.showArrays'], true),
      showObjects: bool(settings['breadcrumbs.showObjects'], true),
      showKeys: bool(settings['breadcrumbs.showKeys'], true),
      showNull: bool(settings['breadcrumbs.showNull'], true),
      showEnumMembers: bool(settings['breadcrumbs.showEnumMembers'], true),
      showStructs: bool(settings['breadcrumbs.showStructs'], true),
      showEvents: bool(settings['breadcrumbs.showEvents'], true),
      showOperators: bool(settings['breadcrumbs.showOperators'], true),
      showTypeParameters: bool(settings['breadcrumbs.showTypeParameters'], true),
    },
    matchBrackets,
    occurrencesHighlight,
    scrollBeyondLastLine: bool(settings['editor.scrollBeyondLastLine'], true),
    links: bool(settings['editor.links'], true),

    // Cursor
    cursorStyle,
    cursorBlinking,
    cursorSurroundingLines: Math.max(0, num(settings['editor.cursorSurroundingLines'], 0)),
    dynamicCaretColor: bool(settings['editor.dynamicCaretColor'], false),

    // Guides
    guides: {
      indentation: bool(settings['editor.guides.indentation'], true),
      highlightActiveIndentation,
    },

    // Bracket Pair Colorization
    bracketPairColorization: {
      enabled: bool(settings['editor.bracketPairColorization.enabled'], true),
      maxLevels: Math.max(1, Math.min(5, num(settings['editor.bracketPairColorization.maxLevels'], 5))),
      independentColorPoolPerBracketType: bool(
        settings['editor.bracketPairColorization.independentColorPoolPerBracketType'],
        false,
      ),
      maxLines: Math.max(100, num(settings['editor.bracketPairColorization.maxLines'], 20000)),
      maxLineLength: Math.max(100, num(settings['editor.bracketPairColorization.maxLineLength'], 10000)),
    },

    // Sticky Scroll
    stickyScroll: {
      enabled: bool(settings['editor.stickyScroll.enabled'], true),
      maxLineCount: Math.max(1, Math.min(10, num(settings['editor.stickyScroll.maxLineCount'], 5))),
      defaultModel: stickyDefaultModel,
      scrollWithEditor: bool(settings['editor.stickyScroll.scrollWithEditor'], true),
      activeLineSticky: bool(settings['editor.stickyScroll.activeLineSticky'], false),
      bottomActiveSticky: bool(settings['editor.stickyScroll.bottomActiveSticky'], true),
    },

    // Scrollbar
    scrollbar: {
      vertical: sbV,
      horizontal: sbH,
      hideVerticalOnScrollEnd: bool(settings['editor.scrollbar.hideVerticalOnScrollEnd'], true),
      hideHorizontalOnScrollEnd: bool(settings['editor.scrollbar.hideHorizontalOnScrollEnd'], true),
      verticalScrollbarSize: Math.max(2, num(settings['editor.scrollbar.verticalScrollbarSize'], 10)),
      horizontalScrollbarSize: Math.max(2, num(settings['editor.scrollbar.horizontalScrollbarSize'], 10)),
      fadeDelayMs: Math.max(100, num(settings['editor.scrollbar.autoHideDelay'], 1200)),
    },

    // Minimap
    minimap: {
      enabled: bool(settings['editor.minimap.enabled'], false),
      side: settings['editor.minimap.side'] === 'left' ? 'left' : 'right',
      width: Math.max(40, Math.min(300, num(settings['editor.minimap.width'], 84))),
      maxColumn: Math.max(20, num(settings['editor.minimap.maxColumn'], 120)),
      showSlider: settings['editor.minimap.showSlider'] === 'always' ? 'always' : 'mouseover',
      renderCharacters: bool(settings['editor.minimap.renderCharacters'], true),
    },

    // Suggestions & Signature Help
    quickSuggestions: qsEnabled
      ? { other: true, comments: qsComments, strings: qsStrings }
      : false,
    quickSuggestionsDelay: Math.max(0, num(settings['editor.quickSuggestionsDelay'], 10)),
    suggestOnTriggerCharacters: bool(settings['editor.suggestOnTriggerCharacters'], true),
    acceptSuggestionOnCommitCharacter: bool(settings['editor.acceptSuggestionOnCommitCharacter'], true),
    acceptSuggestionOnEnter,
    suggestSelection,
    suggestFontSize,
    suggestLineHeight,
    suggestMatchOnWordStartOnly: bool(settings['editor.suggestMatchOnWordStartOnly'], true),
    wordBasedSuggestions,
    snippetSuggestions,
    tabCompletion,
    suggest: {
      docs: suggestDocs,
      mode: suggestMode,
      insertMode: suggestInsertMode,
      filterGraceful: bool(settings['editor.suggest.filterGraceful'], true),
      localityBonus: bool(settings['editor.suggest.localityBonus'], false),
      preview: bool(settings['editor.suggest.preview'], false),
      previewMode: suggestPreviewMode,
      showIcons: bool(settings['editor.suggest.showIcons'], true),
      showStatusBar: bool(settings['editor.suggest.showStatusBar'], false),
      matchOnWordStartOnly: bool(settings['editor.suggestMatchOnWordStartOnly'], true),
      showMethods: bool(settings['editor.suggest.showMethods'], true),
      showFunctions: bool(settings['editor.suggest.showFunctions'], true),
      showConstructors: bool(settings['editor.suggest.showConstructors'], true),
      showFields: bool(settings['editor.suggest.showFields'], true),
      showVariables: bool(settings['editor.suggest.showVariables'], true),
      showClasses: bool(settings['editor.suggest.showClasses'], true),
      showStructs: bool(settings['editor.suggest.showStructs'], true),
      showInterfaces: bool(settings['editor.suggest.showInterfaces'], true),
      showModules: bool(settings['editor.suggest.showModules'], true),
      showProperties: bool(settings['editor.suggest.showProperties'], true),
      showEvents: bool(settings['editor.suggest.showEvents'], true),
      showOperators: bool(settings['editor.suggest.showOperators'], true),
      showUnits: bool(settings['editor.suggest.showUnits'], true),
      showValues: bool(settings['editor.suggest.showValues'], true),
      showConstants: bool(settings['editor.suggest.showConstants'], true),
      showEnums: bool(settings['editor.suggest.showEnums'], true),
      showEnumMembers: bool(settings['editor.suggest.showEnumMembers'], true),
      showKeywords: bool(settings['editor.suggest.showKeywords'], true),
      showWords: bool(settings['editor.suggest.showWords'], true),
      showColors: bool(settings['editor.suggest.showColors'], true),
      showFiles: bool(settings['editor.suggest.showFiles'], true),
      showReferences: bool(settings['editor.suggest.showReferences'], true),
      showFolders: bool(settings['editor.suggest.showFolders'], true),
      showTypeParameters: bool(settings['editor.suggest.showTypeParameters'], true),
      showSnippets: bool(settings['editor.suggest.showSnippets'], true),
      showUsers: bool(settings['editor.suggest.showUsers'], true),
      showIssues: bool(settings['editor.suggest.showIssues'], true),
    },
    signatureHelp: {
      enabled: bool(settings['editor.parameterHints.enabled'], true),
      trigger: settings['editor.signatureHelp.trigger'] === 'manual' ? 'manual' : 'auto',
      cycle: bool(settings['editor.parameterHints.cycle'], false),
    },

    // Inline Suggest (Ghost Text)
    inlineSuggest: {
      enabled: bool(settings['editor.inlineSuggest.enabled'], true),
      debounceMs: Math.max(0, num(settings['editor.inlineSuggest.debounceMs'], 150)),
      showToolbar: inlineToolbar,
      italic: bool(settings['editor.inlineSuggest.italic'], true),
    },

    // Hover, Diagnostics & Lightbulb
    hover: {
      enabled: bool(settings['editor.hover.enabled'], true),
      trigger: hoverTrigger,
      delay: Math.max(0, num(settings['editor.hover.delay'], 300)),
      hidingDelay: Math.max(0, num(settings['editor.hover.hidingDelay'], 300)),
      sticky: bool(settings['editor.hover.sticky'], true),
      above: bool(settings['editor.hover.above'], true),
      openOnMouseHover: bool(settings['editor.hover.openOnMouseHover'], true),
    },
    diagnostics: {
      popup: diagPopup,
    },
    lightbulb: {
      enabled: lightbulbEnabled,
    },
    errorLens: {
      enabled: bool(settings['editor.errorLens.enabled'], false),
      maxLength: Math.max(20, num(settings['editor.errorLens.maxLength'], 120)),
    },

    // Inlay Hints
    inlayHints: {
      enabled: inlayEnabled,
      ...(inlayFontSize > 0 ? { fontSize: inlayFontSize } : {}),
      ...(inlayFontFamily ? { fontFamily: inlayFontFamily } : {}),
      padding: bool(settings['editor.inlayHints.padding'], false),
      onClick: inlayOnClick,
    },

    // Code Lens
    codeLens: bool(settings['editor.codeLens'], true),
    ...(codeLensFontSize > 0 ? { codeLensFontSize } : {}),
    ...(codeLensFontFamily ? { codeLensFontFamily } : {}),

    // Color Decorators
    colorDecorators: bool(settings['editor.colorDecorators'], true),
    colorDecoratorsOpenOnHover: bool(settings['editor.colorDecoratorsOpenOnHover'], false),
    colorDecoratorsRules: {
      enabled: bool(settings['editor.colorDecorators'], true),
      allowInComments: bool(settings['editor.colorDecorators.allowInComments'], false),
      context: colorContext,
    },

    // Semantic Highlighting
    semanticHighlighting: {
      enabled: semanticEnabled,
    },

    // Native Mono Context Menu
    contextMenu: {
      enabled: bool(settings['editor.contextMenu.enabled'], true),
      type: ctxType,
      animation: ctxAnim,
      horizontal: {
        showIcons: bool(settings['editor.contextMenu.horizontal.showIcons'], true),
        more: {
          showIcons: bool(settings['editor.contextMenu.horizontal.more.showIcons'], true),
          showShortcuts: bool(settings['editor.contextMenu.horizontal.more.showShortcuts'], true),
        },
      },
      vertical: {
        showIcons: bool(settings['editor.contextMenu.vertical.showIcons'], true),
        showShortcuts: bool(settings['editor.contextMenu.vertical.showShortcuts'], true),
      },
      maxHeight: Math.max(120, num(settings['editor.contextMenu.maxHeight'], 260)),
    },

    // Mobile & Touch
    pinchZoom: bool(settings['editor.pinchZoom'], true),
    mobileQuickKeys: {
      enabled: bool(settings['editor.mobileQuickKeys.enabled'], false),
    },

    // Performance & Accessibility
    overscan: Math.max(0, Math.min(30, num(settings['editor.overscan'], 4))),
    maxTokenizationLineLength: Math.max(100, num(settings['editor.maxTokenizationLineLength'], 20000)),
    accessibilitySupport,
  };
}
