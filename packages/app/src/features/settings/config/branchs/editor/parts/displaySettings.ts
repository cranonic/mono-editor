// src/features/settings/config/branchs/editor/parts/displaySettings.ts
import type { IConfigurationSection } from '@/core/extensionAPI/registry/configurationRegistry';

export const displayProperties: IConfigurationSection['properties'] = {
  // ── Line Numbers ─────────────────────────────────────────────────────────

  'editor.lineNumbers': {
    title: 'Line Numbers',
    type: 'select',
    defaultValue: 'on',
    order: 1,
    tags: ['display', 'gutter', 'mono'],
    description: 'Controls the display of line numbers.',
    enum: ['off', 'on', 'relative', 'interval'],
    enumItemLabels: ['Off', 'On', 'Relative', 'Interval'],
    enumDescriptions: [
      'Line numbers are not rendered.',
      'Line numbers are rendered as absolute numbers.',
      'Line numbers are rendered as distance in lines to cursor position.',
      'Line numbers are rendered every 10 lines.',
    ],
  },

  'editor.lineNumbersMinChars': {
    title: 'Line Numbers Min Chars',
    type: 'number',
    defaultValue: 3,
    minimum: 1,
    maximum: 10,
    order: 2,
    tags: ['display', 'gutter', 'mono'],
    description: 'Minimum number of digit columns reserved for the line numbers gutter.',
  },

  'editor.lineDecorationsWidth': {
    title: 'Line Decorations Width',
    type: 'number',
    defaultValue: 4.5,
    minimum: 0,
    maximum: 1000,
    order: 3,
    tags: ['display', 'gutter'],
    supportStatus: 'removed',
    supportNote: 'Monaco CSS gutter spacing option — Mono Editor computes gutter layout automatically.',
    markdownDescription: 'Controls the width of the space reserved for decorations in the gutter (in pixels).',
  },

  // ── Word Wrap ────────────────────────────────────────────────────────────

  'editor.wordWrap': {
    title: 'Word Wrap',
    type: 'select',
    defaultValue: 'off',
    order: 10,
    tags: ['display', 'wrap', 'mono'],
    description: 'Controls how lines should wrap in Mono Editor.',
    enum: ['off', 'on'],
    enumItemLabels: ['Off', 'On (Viewport)'],
    enumDescriptions: [
      'Lines will never wrap.',
      'Lines will wrap at the viewport width.',
    ],
  },

  'editor.wordWrapColumn': {
    title: 'Word Wrap Column',
    type: 'number',
    defaultValue: 80,
    minimum: 1,
    maximum: 10000,
    order: 11,
    tags: ['display', 'wrap'],
    supportStatus: 'not-available',
    markdownDescription: 'Controls the column at which to wrap when column-based word wrap is supported.',
  },

  'editor.wrappingIndent': {
    title: 'Wrapping Indent',
    type: 'select',
    defaultValue: 'same',
    order: 12,
    tags: ['display', 'wrap', 'mono'],
    description: 'Controls the indentation of wrapped lines.',
    enum: ['none', 'same', 'indent'],
    enumItemLabels: ['None', 'Same', 'Indent'],
    enumDescriptions: [
      'No indentation — wrapped lines begin at column 1.',
      'Wrapped lines get the same indentation as the parent.',
      'Wrapped lines get +1 indentation compared to the parent.',
    ],
  },

  'editor.wordWrapBreakAfterCharacters': {
    title: 'Word Wrap Break After Characters',
    type: 'string',
    defaultValue: ' \t})]?|/&.,;¢°′″‰℃、。｡､￠，．：；？！％・･ゝゞヽヾーァィゥェォッャュョ・。',
    order: 13,
    tags: ['wrap'],
    supportStatus: 'removed',
    supportNote: 'Monaco-specific CJK wrap break rule string — not used in Mono Editor.',
    description: 'Configure word wrapping characters. A break will be introduced after these characters.',
  },

  // ── Rulers ───────────────────────────────────────────────────────────────

  'editor.rulers': {
    title: 'Rulers',
    type: 'string',
    defaultValue: '',
    order: 15,
    tags: ['display', 'mono'],
    markdownDescription:
      'Render vertical rulers after a certain number of characters.\n\n' +
      'Use comma-separated numbers for multiple rulers. Example: `80, 120`.\n\n' +
      'No rulers are drawn if left empty.',
  },

  // ── Whitespace ───────────────────────────────────────────────────────────

  'editor.renderWhitespace': {
    title: 'Render Whitespace',
    type: 'select',
    defaultValue: 'selection',
    order: 20,
    tags: ['display', 'whitespace', 'mono'],
    description: 'Controls how the editor should render whitespace characters.',
    enum: ['none', 'boundary', 'selection', 'trailing', 'all'],
    enumItemLabels: ['None', 'Boundary', 'Selection', 'Trailing', 'All'],
    enumDescriptions: [
      'No whitespace characters are rendered.',
      'Whitespace characters are rendered only on word boundaries.',
      'Whitespace characters are rendered only when selected.',
      'Trailing whitespace characters are rendered.',
      'All whitespace characters are rendered.',
    ],
  },

  'editor.experimentalWhitespaceRendering': {
    title: 'Experimental Whitespace Rendering',
    type: 'select',
    defaultValue: 'svg',
    order: 21,
    tags: ['display', 'whitespace'],
    supportStatus: 'removed',
    supportNote: 'Monaco DOM/SVG whitespace experiment — Mono Editor draws whitespace natively on Canvas.',
    markdownDescription: 'Legacy Monaco whitespace rendering backend selector.',
    enum: ['svg', 'font', 'off'],
    enumItemLabels: ['SVG', 'Font', 'Off'],
  },

  'editor.renderControlCharacters': {
    title: 'Render Control Characters',
    type: 'boolean',
    defaultValue: true,
    order: 22,
    tags: ['display'],
    supportStatus: 'not-available',
    description: 'Controls whether the editor should render control characters.',
  },

  // ── Links, Color Decorators, Error Lens & Diagnostics ────────────────────

  'editor.links': {
    title: 'Clickable Links',
    type: 'boolean',
    defaultValue: true,
    order: 23,
    tags: ['display', 'links', 'mono'],
    description: 'Controls whether the editor detects URLs and makes them clickable.',
  },

  'editor.colorDecorators': {
    title: 'Color Decorators',
    type: 'boolean',
    defaultValue: true,
    order: 24,
    subCategory: 'Color Decorators',
    tags: ['display', 'color', 'mono'],
    description: 'Controls whether Mono Editor renders inline color swatches and a color picker for color literals.',
  },

  'editor.colorDecoratorsOpenOnHover': {
    title: 'Open Color Picker On Hover',
    type: 'boolean',
    defaultValue: false,
    order: 25,
    subCategory: 'Color Decorators',
    tags: ['display', 'color', 'mono'],
    description: 'Open the color picker automatically when hovering a color swatch instead of clicking it.',
  },

  'editor.colorDecorators.allowInComments': {
    title: 'Color Decorators In Comments',
    type: 'boolean',
    defaultValue: false,
    order: 26,
    subCategory: 'Color Decorators',
    tags: ['display', 'color', 'mono'],
    description: 'Allow detecting and displaying color swatches inside comments.',
  },

  'editor.colorDecorators.context': {
    title: 'Color Decorators Context',
    type: 'select',
    defaultValue: 'auto',
    order: 27,
    subCategory: 'Color Decorators',
    tags: ['display', 'color', 'mono'],
    description: 'Controls where color literals are detected inside code.',
    enum: ['auto', 'stringsOnly', 'outsideStrings', 'all'],
    enumItemLabels: ['Auto (Language Aware)', 'Strings Only', 'Outside Strings', 'All'],
  },

  'editor.errorLens.enabled': {
    title: 'Error Lens Enabled',
    type: 'boolean',
    defaultValue: false,
    order: 28,
    subCategory: 'Diagnostics',
    tags: ['display', 'diagnostics', 'errorLens', 'mono'],
    description: 'Render inline diagnostic messages (errors and warnings) at the end of affected lines.',
  },

  'editor.errorLens.maxLength': {
    title: 'Error Lens Max Length',
    type: 'number',
    defaultValue: 120,
    minimum: 20,
    maximum: 500,
    order: 29,
    subCategory: 'Diagnostics',
    tags: ['display', 'diagnostics', 'errorLens', 'mono'],
    description: 'Maximum character length of an inline Error Lens message before truncation.',
  },

  'editor.diagnostics.popup': {
    title: 'Diagnostics Popup Trigger',
    type: 'select',
    defaultValue: 'click',
    order: 30,
    subCategory: 'Diagnostics',
    tags: ['display', 'diagnostics', 'mono'],
    description: 'Controls how diagnostic error/warning popups are triggered in Mono Editor.',
    enum: ['hover', 'click', 'off'],
    enumItemLabels: ['Hover / Auto', 'Click / Tap', 'Off'],
  },

  // ── Line Highlight ───────────────────────────────────────────────────────

  'editor.renderLineHighlight': {
    title: 'Render Line Highlight',
    type: 'select',
    subCategory: 'Highlighting',
    defaultValue: 'line',
    order: 31,
    tags: ['display', 'mono'],
    description: 'Controls how the editor should render the current line highlight.',
    enum: ['none', 'gutter', 'line', 'all'],
    enumItemLabels: ['None', 'Gutter', 'Line', 'All'],
    enumDescriptions: [
      'No current line highlight is rendered.',
      'The gutter is highlighted.',
      'The line is highlighted.',
      'Both the gutter and the line are highlighted.',
    ],
  },

  'editor.renderLineHighlightOnlyWhenFocus': {
    title: 'Render Line Highlight Only When Focused',
    type: 'boolean',
    subCategory: 'Highlighting',
    defaultValue: false,
    order: 32,
    tags: ['display'],
    supportStatus: 'not-available',
    description: 'Controls if the editor should render the current line highlight only when the editor is focused.',
  },

  // ── Word & Selection Highlighting ────────────────────────────────────────

  'editor.occurrencesHighlight': {
    title: 'Occurrences Highlight',
    type: 'select',
    defaultValue: 'singleFile',
    order: 33,
    tags: ['display', 'highlight', 'mono'],
    subCategory: 'Highlighting',
    markdownDescription:
      'Controls whether the editor should highlight symbol occurrences in the current file.\n\n' +
      '- `off` — No occurrence highlighting.\n' +
      '- `singleFile` — Highlights occurrences in the current file.',
    enum: ['off', 'singleFile', 'multiFile'],
    enumItemLabels: ['Off', 'Single File', 'Multi File'],
  },

  'editor.selectionHighlight': {
    title: 'Selection Highlight',
    type: 'boolean',
    subCategory: 'Highlighting',
    defaultValue: true,
    order: 34,
    tags: ['display', 'highlight', 'selection'],
    supportStatus: 'not-available',
    markdownDescription: 'Controls whether the editor should separately highlight matches similar to the selection.',
  },

  // ── Bracket Matching ─────────────────────────────────────────────────────

  'editor.matchBrackets': {
    title: 'Match Brackets',
    type: 'select',
    defaultValue: 'always',
    order: 40,
    tags: ['display', 'brackets', 'mono'],
    description: 'Highlight matching brackets.',
    enum: ['always', 'near', 'never'],
    enumItemLabels: ['Always', 'Near', 'Never'],
    enumDescriptions: [
      'Always highlight matching brackets.',
      'Highlight matching brackets only when one bracket is next to the cursor.',
      'Never highlight matching brackets.',
    ],
  },

  // ── Bracket Pair Colorization ─────────────────────────────────────────────

  'editor.bracketPairColorization.enabled': {
    title: 'Bracket Pair Colorization',
    type: 'boolean',
    defaultValue: true,
    order: 45,
    subCategory: 'Bracket Pair Colorization',
    tags: ['display', 'brackets', 'color', 'mono'],
    markdownDescription: 'Controls whether rainbow bracket pair colorization is enabled.',
  },

  'editor.bracketPairColorization.independentColorPoolPerBracketType': {
    title: 'Independent Color Pool Per Bracket Type',
    type: 'boolean',
    defaultValue: false,
    order: 46,
    subCategory: 'Bracket Pair Colorization',
    tags: ['display', 'brackets', 'color', 'mono'],
    markdownDescription:
      'Controls whether each bracket type uses its own independent color pool.\n\n' +
      '| Setting | Result |\n' +
      '|:--------|:-------|\n' +
      '| `false` | `()` `[]` `{}` share one color pool |\n' +
      '| `true` | Each type has its own color pool |',
  },

  'editor.bracketPairColorization.maxLevels': {
    title: 'Rainbow Bracket Nesting Levels',
    type: 'number',
    defaultValue: 5,
    minimum: 1,
    maximum: 5,
    order: 47,
    subCategory: 'Bracket Pair Colorization',
    tags: ['display', 'brackets', 'color', 'mono'],
    description: 'Number of distinct nesting color levels for rainbow bracket pair colorization (1–5).',
  },

  'editor.bracketPairColorization.maxLines': {
    title: 'Bracket Colorization Max Lines',
    type: 'number',
    defaultValue: 20000,
    minimum: 100,
    maximum: 200000,
    order: 48,
    subCategory: 'Bracket Pair Colorization',
    tags: ['display', 'brackets', 'performance', 'mono'],
    description: 'Performance cutoff: skip bracket pair colorization for files exceeding this line count.',
  },

  'editor.bracketPairColorization.maxLineLength': {
    title: 'Bracket Colorization Max Line Length',
    type: 'number',
    defaultValue: 10000,
    minimum: 100,
    maximum: 200000,
    order: 49,
    subCategory: 'Bracket Pair Colorization',
    tags: ['display', 'brackets', 'performance', 'mono'],
    description: 'Performance cutoff: skip scanning brackets on lines longer than this character count.',
  },

  // ── Guides ───────────────────────────────────────────────────────────────

  'editor.guides.indentation': {
    title: 'Indentation Guides',
    type: 'boolean',
    defaultValue: true,
    order: 50,
    subCategory: 'Guides',
    tags: ['display', 'indent', 'mono'],
    description: 'Controls whether the editor should render indent guides.',
  },

  'editor.guides.highlightActiveIndentation': {
    title: 'Highlight Active Indentation',
    type: 'select',
    defaultValue: 'true',
    order: 51,
    subCategory: 'Guides',
    tags: ['display', 'indent', 'mono'],
    description: 'Controls whether the editor should highlight the active indent guide.',
    enum: ['true', 'always', 'false'],
    enumItemLabels: ['True', 'Always', 'False'],
  },

  'editor.guides.bracketPairs': {
    title: 'Bracket Pair Guides',
    type: 'select',
    defaultValue: 'false',
    order: 52,
    subCategory: 'Guides',
    tags: ['display', 'brackets'],
    supportStatus: 'not-available',
    description: 'Controls whether bracket pair guides are enabled or not.',
    enum: ['true', 'active', 'false'],
    enumItemLabels: ['True', 'Active', 'False'],
  },

  'editor.guides.bracketPairsHorizontal': {
    title: 'Bracket Pair Horizontal Guides',
    type: 'select',
    defaultValue: 'active',
    order: 53,
    subCategory: 'Guides',
    tags: ['display', 'brackets'],
    supportStatus: 'not-available',
    description: 'Controls whether horizontal bracket pair guides are enabled or not.',
    enum: ['true', 'active', 'false'],
    enumItemLabels: ['True', 'Active', 'False'],
  },

  // ── Folding ──────────────────────────────────────────────────────────────

  'editor.folding': {
    title: 'Folding',
    type: 'boolean',
    defaultValue: true,
    order: 60,
    tags: ['display', 'folding', 'mono'],
    description: 'Controls whether the editor has code folding enabled.',
  },

  'editor.foldingStrategy': {
    title: 'Folding Strategy',
    type: 'select',
    defaultValue: 'auto',
    order: 61,
    tags: ['folding', 'mono'],
    description: 'Controls the strategy for computing folding ranges (Auto prefers LSP when available, falling back to syntax structure).',
    enum: ['auto', 'syntax', 'indentation'],
    enumItemLabels: ['Auto (LSP or Syntax)', 'Syntax Only', 'Indentation'],
  },

  'editor.foldingHighlight': {
    title: 'Folding Highlight',
    type: 'boolean',
    defaultValue: true,
    order: 62,
    tags: ['folding'],
    supportStatus: 'not-available',
    description: 'Controls whether the editor should highlight folded ranges.',
  },

  'editor.foldingImportsByDefault': {
    title: 'Fold Imports By Default',
    type: 'boolean',
    defaultValue: false,
    order: 63,
    tags: ['folding'],
    supportStatus: 'not-available',
    description: 'Controls whether the editor automatically collapses import ranges.',
  },

  'editor.foldingMaximumRegions': {
    title: 'Folding Maximum Regions',
    type: 'number',
    defaultValue: 5000,
    minimum: 10,
    maximum: 65000,
    order: 64,
    tags: ['folding', 'performance'],
    supportStatus: 'removed',
    supportNote: 'Monaco internal folding region cap — not needed in Mono Editor.',
    markdownDescription: 'Controls the maximum number of foldable regions.',
  },

  'editor.showFoldingControls': {
    title: 'Show Folding Controls',
    type: 'select',
    defaultValue: 'mouseover',
    order: 65,
    tags: ['folding', 'gutter'],
    supportStatus: 'not-available',
    description: 'Controls when the folding controls on the gutter are shown.',
    enum: ['always', 'never', 'mouseover'],
    enumItemLabels: ['Always', 'Never', 'Mouse Over'],
  },

  'editor.foldingPosition': {
    title: 'Folding Icon Position',
    type: 'select',
    order: 66,
    enum: ['left', 'right'],
    enumItemLabels: ['Left', 'Right'],
    defaultValue: 'right',
    supportStatus: 'removed',
    supportNote: 'Legacy Monaco CSS gutter override — Mono Canvas gutter positions fold chevrons natively.',
    markdownDescription: 'Show folding controls on the left or right of the line numbers.',
  },

  // ── Glyph Margin ─────────────────────────────────────────────────────────

  'editor.glyphMargin': {
    title: 'Glyph Margin',
    type: 'boolean',
    defaultValue: false,
    order: 70,
    tags: ['display', 'gutter', 'mono'],
    description: 'Controls whether the editor should render the vertical glyph margin for breakpoints and decorations.',
  },

  // ── Padding ──────────────────────────────────────────────────────────────

  'editor.padding.top': {
    title: 'Padding Top',
    type: 'number',
    defaultValue: 0,
    minimum: 0,
    maximum: 1000,
    order: 75,
    tags: ['display'],
    supportStatus: 'not-available',
    markdownDescription: 'Controls the amount of space (in pixels) between the top edge of the editor and the first line.',
  },

  'editor.padding.bottom': {
    title: 'Padding Bottom',
    type: 'number',
    defaultValue: 0,
    minimum: 0,
    maximum: 1000,
    order: 76,
    tags: ['display'],
    supportStatus: 'not-available',
    markdownDescription: 'Controls the amount of space (in pixels) between the bottom edge of the editor and the last line.',
  },

  // ── Semantic Highlighting ─────────────────────────────────────────────────

  'editor.semanticHighlighting.enabled': {
    title: 'Semantic Highlighting',
    type: 'select',
    defaultValue: 'configuredByTheme',
    order: 80,
    subCategory: 'Highlighting > Semantic Highlighting',
    tags: ['display', 'highlight', 'color', 'mono'],
    markdownDescription:
      'Controls whether semantic token coloring is enabled for languages that support it.\n\n' +
      '- `true` — Always enabled.\n' +
      '- `false` — Always disabled.\n' +
      '- `configuredByTheme` — Enabled by theme (recommended).',
    enum: ['true', 'false', 'configuredByTheme'],
    enumItemLabels: ['Always On', 'Always Off', 'Configured By Theme'],
  },

  // ── Unicode Highlight ────────────────────────────────────────────────────

  'editor.unicodeHighlight.ambiguousCharacters': {
    title: 'Unicode: Ambiguous Characters',
    type: 'boolean',
    defaultValue: true,
    order: 90,
    subCategory: 'Highlighting > Unicode Highlight',
    tags: ['display', 'unicode', 'security'],
    supportStatus: 'not-available',
    markdownDescription: 'Controls whether characters that can be confused with basic ASCII characters are highlighted.',
  },

  'editor.unicodeHighlight.invisibleCharacters': {
    title: 'Unicode: Invisible Characters',
    type: 'boolean',
    defaultValue: true,
    order: 91,
    subCategory: 'Highlighting > Unicode Highlight',
    tags: ['display', 'unicode', 'security'],
    supportStatus: 'not-available',
    markdownDescription: 'Controls whether invisible Unicode characters are highlighted.',
  },

  'editor.unicodeHighlight.nonBasicASCII': {
    title: 'Unicode: Non-Basic ASCII',
    type: 'select',
    defaultValue: 'inUntrustedWorkspace',
    order: 92,
    subCategory: 'Highlighting > Unicode Highlight',
    tags: ['display', 'unicode'],
    supportStatus: 'not-available',
    markdownDescription: 'Controls whether all non-basic ASCII characters are highlighted.',
    enum: ['true', 'false', 'inUntrustedWorkspace'],
    enumItemLabels: ['Always', 'Never', 'In Untrusted Workspaces Only'],
  },

  'editor.unicodeHighlight.includeComments': {
    title: 'Unicode: Include Comments',
    type: 'select',
    defaultValue: 'inUntrustedWorkspace',
    order: 93,
    subCategory: 'Highlighting > Unicode Highlight',
    tags: ['display', 'unicode'],
    supportStatus: 'not-available',
    markdownDescription: 'Controls whether characters in comments should also be subject to unicode highlighting.',
    enum: ['true', 'false', 'inUntrustedWorkspace'],
    enumItemLabels: ['Always', 'Never', 'In Untrusted Workspaces Only'],
  },

  'editor.unicodeHighlight.includeStrings': {
    title: 'Unicode: Include Strings',
    type: 'select',
    defaultValue: 'true',
    order: 94,
    subCategory: 'Highlighting > Unicode Highlight',
    tags: ['display', 'unicode'],
    supportStatus: 'not-available',
    markdownDescription: 'Controls whether characters in strings should also be subject to unicode highlighting.',
    enum: ['true', 'false', 'inUntrustedWorkspace'],
    enumItemLabels: ['Always', 'Never', 'In Untrusted Workspaces Only'],
  },

  // ── Deprecated / Unused ──────────────────────────────────────────────────

  'editor.showDeprecated': {
    title: 'Show Deprecated',
    type: 'boolean',
    defaultValue: true,
    order: 100,
    tags: ['display', 'linting'],
    supportStatus: 'not-available',
    markdownDescription: 'Controls strikethrough rendering of deprecated variables.',
  },

  'editor.showUnused': {
    title: 'Show Unused',
    type: 'boolean',
    defaultValue: true,
    order: 101,
    tags: ['display', 'linting'],
    supportStatus: 'not-available',
    markdownDescription: 'Controls fading/dimming of unused variables.',
  },

  // ── Sticky Scroll ────────────────────────────────────────────────────────

  'editor.stickyScroll.enabled': {
    title: 'Sticky Scroll',
    type: 'boolean',
    defaultValue: true,
    order: 110,
    subCategory: 'Sticky Scroll',
    tags: ['display', 'scroll', 'mono'],
    markdownDescription: 'Shows the nested current scopes pinned at the top of the editor during scroll.',
  },

  'editor.stickyScroll.maxLineCount': {
    title: 'Sticky Scroll Max Line Count',
    type: 'number',
    defaultValue: 5,
    minimum: 1,
    maximum: 10,
    order: 111,
    subCategory: 'Sticky Scroll',
    tags: ['display', 'scroll', 'mono'],
    markdownDescription: 'Defines the maximum number of sticky lines to show at the top of the editor.',
  },

  'editor.stickyScroll.defaultModel': {
    title: 'Sticky Scroll Default Model',
    type: 'select',
    defaultValue: 'outlineModel',
    order: 112,
    subCategory: 'Sticky Scroll',
    tags: ['display', 'scroll', 'mono'],
    description: 'Defines the model to use for determining which lines to stick.',
    enum: ['outlineModel', 'indentationModel'],
    enumItemLabels: ['Outline Model', 'Indentation Model'],
  },

  'editor.stickyScroll.scrollWithEditor': {
    title: 'Sticky Scroll With Editor',
    type: 'boolean',
    defaultValue: true,
    order: 113,
    subCategory: 'Sticky Scroll',
    tags: ['display', 'scroll', 'mono'],
    markdownDescription: "Enable smooth push/scroll of sticky lines with the editor's scrolling.",
  },

  'editor.stickyScroll.activeLineSticky': {
    title: 'Pin Active Caret Line At Top',
    type: 'boolean',
    defaultValue: false,
    order: 114,
    subCategory: 'Sticky Scroll',
    tags: ['display', 'scroll', 'mono'],
    description: 'When the active cursor line scrolls above the viewport, pin it as an extra sticky row at the top.',
  },

  'editor.stickyScroll.bottomActiveSticky': {
    title: 'Bottom Active Line Sticky Bar',
    type: 'boolean',
    defaultValue: true,
    order: 115,
    subCategory: 'Sticky Scroll',
    tags: ['display', 'scroll', 'mono'],
    description: 'When the active cursor line is below the viewport, show a bottom sticky bar above the status area.',
  },

  // ── Scrollbar ────────────────────────────────────────────────────────────

  'editor.scrollbar.vertical': {
    title: 'Vertical Scrollbar',
    type: 'select',
    defaultValue: 'auto',
    order: 120,
    subCategory: 'Scrollbar',
    tags: ['scroll', 'mono'],
    description: 'Controls the visibility of the vertical scrollbar.',
    enum: ['auto', 'visible', 'hidden'],
    enumItemLabels: ['Auto', 'Visible', 'Hidden'],
  },

  'editor.scrollbar.horizontal': {
    title: 'Horizontal Scrollbar',
    type: 'select',
    defaultValue: 'auto',
    order: 121,
    subCategory: 'Scrollbar',
    tags: ['scroll', 'mono'],
    description: 'Controls the visibility of the horizontal scrollbar.',
    enum: ['auto', 'visible', 'hidden'],
    enumItemLabels: ['Auto', 'Visible', 'Hidden'],
  },

  'editor.scrollbar.verticalScrollbarSize': {
    title: 'Vertical Scrollbar Size',
    type: 'number',
    defaultValue: 10,
    minimum: 2,
    maximum: 60,
    order: 122,
    subCategory: 'Scrollbar',
    tags: ['scroll', 'mono'],
    markdownDescription: 'Controls the width of the vertical overlay scrollbar in pixels.',
  },

  'editor.scrollbar.horizontalScrollbarSize': {
    title: 'Horizontal Scrollbar Size',
    type: 'number',
    defaultValue: 10,
    minimum: 2,
    maximum: 60,
    order: 123,
    subCategory: 'Scrollbar',
    tags: ['scroll', 'mono'],
    markdownDescription: 'Controls the height of the horizontal overlay scrollbar in pixels.',
  },

  'editor.scrollbar.hideVerticalOnScrollEnd': {
    title: 'Auto-Hide Vertical Scrollbar',
    type: 'boolean',
    defaultValue: true,
    order: 124,
    subCategory: 'Scrollbar',
    tags: ['scroll', 'mono'],
    description: 'Automatically fade out the vertical overlay scrollbar after scrolling ends.',
  },

  'editor.scrollbar.hideHorizontalOnScrollEnd': {
    title: 'Auto-Hide Horizontal Scrollbar',
    type: 'boolean',
    defaultValue: true,
    order: 125,
    subCategory: 'Scrollbar',
    tags: ['scroll', 'mono'],
    description: 'Automatically fade out the horizontal overlay scrollbar after scrolling ends.',
  },

  'editor.scrollbar.autoHideDelay': {
    title: 'Scrollbar Auto Hide Delay (ms)',
    type: 'number',
    defaultValue: 1200,
    minimum: 100,
    maximum: 5000,
    order: 126,
    subCategory: 'Scrollbar',
    tags: ['scroll', 'mono'],
    markdownDescription: 'Time in milliseconds before the overlay scrollbar fades out after scrolling stops.',
  },

  'editor.scrollBeyondLastLine': {
    title: 'Scroll Beyond Last Line',
    type: 'boolean',
    defaultValue: true,
    order: 127,
    subCategory: 'Scrollbar',
    tags: ['scroll', 'mono'],
    description: 'Controls whether the editor will scroll beyond the last line.',
  },

  'editor.scrollbar.scrollByPage': {
    title: 'Scroll By Page',
    type: 'boolean',
    defaultValue: false,
    order: 128,
    subCategory: 'Scrollbar',
    tags: ['scroll'],
    supportStatus: 'not-available',
    description: 'Controls whether clicks in the scrollbar track scroll by page or jump to the click position.',
  },

  'editor.smoothScrolling': {
    title: 'Smooth Scrolling',
    type: 'boolean',
    defaultValue: false,
    order: 129,
    subCategory: 'Scrollbar',
    tags: ['scroll'],
    supportStatus: 'not-available',
    description: 'Controls whether the editor will scroll using an animation.',
  },

  'editor.fastScrollSensitivity': {
    title: 'Fast Scroll Sensitivity',
    type: 'number',
    defaultValue: 5,
    minimum: 1,
    maximum: 20,
    order: 130,
    subCategory: 'Scrollbar',
    tags: ['scroll'],
    supportStatus: 'not-available',
    markdownDescription: 'Scrolling speed multiplier when pressing `Alt`.',
  },

  'editor.mouseWheelScrollSensitivity': {
    title: 'Mouse Wheel Scroll Sensitivity',
    type: 'number',
    defaultValue: 1,
    minimum: 0.1,
    maximum: 20,
    order: 131,
    subCategory: 'Scrollbar',
    tags: ['scroll'],
    supportStatus: 'not-available',
    description: 'A multiplier to be used on the deltaX and deltaY of mouse wheel scroll events.',
  },

  'editor.scrollBeyondLastColumn': {
    title: 'Scroll Beyond Last Column',
    type: 'number',
    defaultValue: 5,
    minimum: 0,
    maximum: 100,
    order: 132,
    subCategory: 'Scrollbar',
    tags: ['scroll'],
    supportStatus: 'not-available',
    markdownDescription: 'Controls the number of extra characters beyond which the editor will scroll horizontally.',
  },

  // Removed legacy Monaco / old custom scrollbar settings
  'editor.scrollbar.alwaysConsumeMouseWheel': {
    title: 'Always Consume Mouse Wheel',
    type: 'boolean',
    defaultValue: true,
    order: 133,
    subCategory: 'Scrollbar',
    tags: ['scroll'],
    supportStatus: 'removed',
    supportNote: 'Monaco DOM wheel quirk — Mono Editor handles viewport scroll natively.',
    description: 'Always consume mouse wheel events.',
  },

  'editor.scrollbar.useShadows': {
    title: 'Scrollbar Use Shadows',
    type: 'boolean',
    defaultValue: true,
    order: 134,
    subCategory: 'Scrollbar',
    tags: ['scroll', 'display'],
    supportStatus: 'removed',
    supportNote: 'Monaco DOM scroll shadow — not used in Mono Editor.',
    markdownDescription: 'Controls whether the scrollbar casts a shadow where the content is scrolled.',
  },

  'editor.scrollbar.verticalHasArrows': {
    title: 'Vertical Scrollbar Has Arrows',
    type: 'boolean',
    defaultValue: false,
    order: 135,
    subCategory: 'Scrollbar',
    tags: ['scroll'],
    supportStatus: 'removed',
    supportNote: 'Legacy desktop scrollbar arrows — not needed in Mono Editor.',
    markdownDescription: 'Controls whether the vertical scrollbar has arrow buttons.',
  },

  'editor.scrollbar.horizontalHasArrows': {
    title: 'Horizontal Scrollbar Has Arrows',
    type: 'boolean',
    defaultValue: false,
    order: 136,
    subCategory: 'Scrollbar',
    tags: ['scroll'],
    supportStatus: 'removed',
    supportNote: 'Legacy desktop scrollbar arrows — not needed in Mono Editor.',
    markdownDescription: 'Controls whether the horizontal scrollbar has arrow buttons.',
  },

  'editor.scrollbar.arrowSize': {
    title: 'Scrollbar Arrow Size',
    type: 'number',
    defaultValue: 11,
    minimum: 0,
    maximum: 100,
    order: 137,
    subCategory: 'Scrollbar',
    tags: ['scroll'],
    supportStatus: 'removed',
    supportNote: 'Legacy desktop scrollbar arrows — not needed in Mono Editor.',
    markdownDescription: 'Controls the size of the scrollbar arrow buttons in pixels.',
  },

  'editor.scrollPredominantAxis': {
    title: 'Scroll Predominant Axis',
    type: 'boolean',
    defaultValue: true,
    order: 138,
    subCategory: 'Scrollbar',
    tags: ['scroll'],
    supportStatus: 'removed',
    supportNote: 'Monaco trackpad axis lock — not needed in Mono Editor.',
    markdownDescription: 'Scroll only along the predominant axis when scrolling both vertically and horizontally.',
  },

  'editor.scrollbar.thumbWidth': {
    title: 'Scrollbar Thumb Width (Legacy)',
    type: 'number',
    defaultValue: 15,
    minimum: 2,
    maximum: 50,
    order: 139,
    subCategory: 'Scrollbar',
    tags: ['scroll', 'mobile'],
    supportStatus: 'removed',
    supportNote: 'Old custom Monaco scrollbar overlay — use editor.scrollbar.verticalScrollbarSize instead.',
    markdownDescription: 'Legacy mobile custom scrollbar thumb width.',
  },

  'editor.scrollbar.trackWidth': {
    title: 'Scrollbar Hit Track Width (Legacy)',
    type: 'number',
    defaultValue: 32,
    minimum: 10,
    maximum: 100,
    order: 140,
    subCategory: 'Scrollbar',
    tags: ['scroll', 'touch'],
    supportStatus: 'removed',
    supportNote: 'Old custom Monaco scrollbar overlay — Mono overlay scrollbar handles touch hits natively.',
    markdownDescription: 'Legacy mobile custom scrollbar touch target width.',
  },

  'editor.scrollbar.thumbFixedSize': {
    title: 'Scrollbar Thumb Fixed Height (Legacy)',
    type: 'number',
    defaultValue: 50,
    minimum: 10,
    maximum: 200,
    order: 141,
    subCategory: 'Scrollbar',
    tags: ['scroll', 'mobile'],
    supportStatus: 'removed',
    supportNote: 'Old custom Monaco scrollbar overlay — replaced by Mono native overlay scrollbar.',
    markdownDescription: 'Legacy static height for custom scrollbar thumb.',
  },

  // ── Performance & Accessibility ──────────────────────────────────────────

  'editor.overscan': {
    title: 'Viewport Overscan Lines',
    type: 'number',
    defaultValue: 4,
    minimum: 0,
    maximum: 30,
    order: 145,
    subCategory: 'Performance',
    tags: ['performance', 'mono'],
    description: 'Number of extra lines pre-rendered above and below the visible viewport for smoother scrolling.',
  },

  'editor.maxTokenizationLineLength': {
    title: 'Max Tokenization Line Length',
    type: 'number',
    defaultValue: 20000,
    minimum: 100,
    maximum: 999999,
    order: 146,
    subCategory: 'Performance',
    tags: ['performance', 'mono'],
    markdownDescription: 'Lines above this character length will **not** be tokenized for performance reasons.',
  },

  'editor.accessibilitySupport': {
    title: 'Accessibility Support',
    type: 'select',
    defaultValue: 'auto',
    order: 147,
    subCategory: 'Performance',
    tags: ['accessibility', 'mono'],
    description: 'Controls screen-reader accessibility optimizations in Mono Editor.',
    enum: ['auto', 'on', 'off'],
    enumItemLabels: ['Auto', 'On', 'Off'],
  },

  'editor.largeFileOptimizations': {
    title: 'Large File Optimizations',
    type: 'boolean',
    defaultValue: true,
    order: 148,
    subCategory: 'Performance',
    tags: ['performance'],
    supportStatus: 'not-available',
    markdownDescription: 'Special handling for very large files to disable expensive features automatically.',
  },

  'editor.stopRenderingLineAfter': {
    title: 'Stop Rendering Line After',
    type: 'number',
    defaultValue: 10000,
    minimum: -1,
    maximum: 999999,
    order: 149,
    subCategory: 'Performance',
    tags: ['performance'],
    supportStatus: 'removed',
    supportNote: 'Monaco DOM span limit — Mono Canvas only paints visible viewport columns.',
    markdownDescription: 'Legacy Monaco guard to stop rendering DOM spans after N characters.',
  },
};