// src/features/settings/config/branchs/editor/parts/suggestionSettings.ts
import type { IConfigurationSection } from '@/core/extensionAPI/registry/configurationRegistry';

export const suggestionProperties: IConfigurationSection['properties'] = {
  // ── Quick Suggestions (Mono Native) ──────────────────────────────────────

  'editor.quickSuggestions': {
    title: 'Quick Suggestions',
    type: 'select',
    subCategory: 'Suggestions',
    defaultValue: 'on',
    order: 1,
    tags: ['suggestions', 'intellisense', 'mono'],
    markdownDescription:
      'Controls whether suggestions should automatically show up while typing.\n\n' +
      '- `on` — Shows suggestions inside the suggest widget.\n' +
      '- `off` — Quick suggestions are disabled.\n' +
      '- `inline` — Shows suggestions as inline ghost text.',
    enum: ['on', 'off', 'inline'],
    enumItemLabels: ['On', 'Off', 'Inline (Ghost)'],
  },

  'editor.quickSuggestions.comments': {
    title: 'Quick Suggestions In Comments',
    type: 'boolean',
    subCategory: 'Suggestions',
    defaultValue: false,
    order: 2,
    tags: ['suggestions', 'mono'],
    description: 'Enable quick suggestions while typing inside comments.',
  },

  'editor.quickSuggestions.strings': {
    title: 'Quick Suggestions In Strings',
    type: 'boolean',
    subCategory: 'Suggestions',
    defaultValue: false,
    order: 3,
    tags: ['suggestions', 'mono'],
    description: 'Enable quick suggestions while typing inside string literals.',
  },

  'editor.quickSuggestionsDelay': {
    title: 'Quick Suggestions Delay',
    type: 'number',
    subCategory: 'Suggestions',
    defaultValue: 10,
    minimum: 0,
    maximum: 1000,
    order: 4,
    tags: ['suggestions', 'mono'],
    markdownDescription: 'Controls the delay in milliseconds after which quick suggestions will show up.',
  },

  'editor.suggestOnTriggerCharacters': {
    title: 'Suggest On Trigger Characters',
    type: 'boolean',
    subCategory: 'Suggestions',
    defaultValue: true,
    order: 5,
    tags: ['suggestions', 'mono'],
    markdownDescription: 'Controls whether suggestions should automatically show up when typing trigger characters (e.g. `.`).',
  },

  'editor.suggest.mode': {
    title: 'Suggest Presentation Mode',
    type: 'select',
    subCategory: 'Suggestions',
    defaultValue: 'palette',
    order: 6,
    tags: ['suggestions', 'mono'],
    description: 'Choose whether completions display in the VS Code-style completion palette or inline ghost text.',
    enum: ['palette', 'ghost'],
    enumItemLabels: ['Palette Popup', 'Inline Ghost Text'],
  },

  'editor.suggest.docs': {
    title: 'Suggest Documentation Pane',
    type: 'select',
    subCategory: 'Suggestions',
    defaultValue: 'auto',
    order: 7,
    tags: ['suggestions', 'docs', 'mono'],
    description: 'Controls how the documentation detail pane is positioned relative to the completion list.',
    enum: ['auto', 'side', 'below', 'off'],
    enumItemLabels: ['Auto', 'Side', 'Below', 'Off'],
  },

  // ── Suggest Acceptance, Selection & Filtering (Mono Native) ──────────────

  'editor.acceptSuggestionOnCommitCharacter': {
    title: 'Accept Suggestion On Commit Character',
    type: 'boolean',
    subCategory: 'Suggestions',
    defaultValue: true,
    order: 8,
    tags: ['suggestions', 'mono'],
    markdownDescription: 'Controls whether suggestions should be accepted on commit characters.',
  },

  'editor.acceptSuggestionOnEnter': {
    title: 'Accept Suggestion On Enter',
    type: 'select',
    subCategory: 'Suggestions',
    defaultValue: 'on',
    order: 9,
    tags: ['suggestions', 'mono'],
    markdownDescription: 'Controls whether suggestions should be accepted on `Enter`, in addition to `Tab`.',
    enum: ['on', 'smart', 'off'],
    enumItemLabels: ['On', 'Smart', 'Off'],
  },

  'editor.suggestSelection': {
    title: 'Suggest Selection',
    type: 'select',
    subCategory: 'Suggestions',
    defaultValue: 'first',
    order: 10,
    tags: ['suggestions', 'mono'],
    description: 'Controls how suggestions are pre-selected when showing the suggest list.',
    enum: ['first', 'recentlyUsed', 'recentlyUsedByPrefix'],
    enumItemLabels: ['First', 'Recently Used', 'Recently Used By Prefix'],
  },

  'editor.suggestFontSize': {
    title: 'Suggest Font Size',
    type: 'number',
    subCategory: 'Suggestions',
    defaultValue: 0,
    minimum: 0,
    maximum: 100,
    order: 11,
    tags: ['suggestions', 'mono'],
    markdownDescription: 'Font size override for the suggest widget. When set to `0`, uses `#editor.fontSize#`.',
  },

  'editor.suggestLineHeight': {
    title: 'Suggest Line Height',
    type: 'number',
    subCategory: 'Suggestions',
    defaultValue: 0,
    minimum: 0,
    maximum: 1000,
    order: 12,
    tags: ['suggestions', 'mono'],
    markdownDescription: 'Line height override in pixels for rows in the suggest widget. Set `0` for automatic sizing.',
  },

  'editor.suggest.insertMode': {
    title: 'Suggest Insert Mode',
    type: 'select',
    subCategory: 'Suggestions',
    defaultValue: 'insert',
    order: 13,
    tags: ['suggestions', 'mono'],
    markdownDescription: 'Controls whether words are overwritten when accepting completions.',
    enum: ['insert', 'replace'],
    enumItemLabels: ['Insert', 'Replace'],
  },

  'editor.suggest.filterGraceful': {
    title: 'Suggest Filter Graceful',
    type: 'boolean',
    subCategory: 'Suggestions',
    defaultValue: true,
    order: 14,
    tags: ['suggestions', 'mono'],
    markdownDescription: 'Controls graceful fuzzy matching of suggestions.',
  },

  'editor.suggest.localityBonus': {
    title: 'Suggest Locality Bonus',
    type: 'boolean',
    subCategory: 'Suggestions',
    defaultValue: false,
    order: 15,
    tags: ['suggestions', 'mono'],
    markdownDescription: 'Controls sorting of completions by proximity to the cursor.',
  },

  'editor.suggest.shareSuggestSelections': {
    title: 'Suggest Share Selections',
    type: 'boolean',
    subCategory: 'Suggestions',
    defaultValue: false,
    order: 16,
    tags: ['suggestions'],
    supportStatus: 'removed',
    supportNote: 'Monaco cross-window selection cache — not needed in Mono Editor.',
    markdownDescription: 'Controls whether the suggestion selection persists across editor sessions.',
  },

  'editor.suggest.preview': {
    title: 'Suggest Preview',
    type: 'boolean',
    subCategory: 'Suggestions',
    defaultValue: false,
    order: 17,
    tags: ['suggestions', 'mono'],
    markdownDescription: 'Controls whether to preview the selected suggestion inline as ghost text in the editor.',
  },

  'editor.suggest.previewMode': {
    title: 'Suggest Preview Mode',
    type: 'select',
    subCategory: 'Suggestions',
    defaultValue: 'subwordSmart',
    order: 18,
    tags: ['suggestions', 'mono'],
    markdownDescription: 'Controls the way in which the inline completion preview is shown.',
    enum: ['prefix', 'subword', 'subwordSmart'],
    enumItemLabels: ['Prefix', 'Subword', 'Subword Smart'],
  },

  'editor.suggest.showIcons': {
    title: 'Suggest Show Icons',
    type: 'boolean',
    subCategory: 'Suggestions',
    defaultValue: true,
    order: 19,
    tags: ['suggestions', 'mono'],
    markdownDescription: 'Controls whether to show or hide icons in suggestions.',
  },

  'editor.suggest.showStatusBar': {
    title: 'Suggest Show Status Bar',
    type: 'boolean',
    subCategory: 'Suggestions',
    defaultValue: false,
    order: 20,
    tags: ['suggestions', 'mono'],
    markdownDescription: 'Controls the visibility of the status bar at the bottom of the suggest widget.',
  },

  'editor.suggestMatchOnWordStartOnly': {
    title: 'Suggest Match On Word Start Only',
    type: 'boolean',
    subCategory: 'Suggestions',
    defaultValue: true,
    order: 21,
    tags: ['suggestions', 'mono'],
    markdownDescription: 'Controls whether filtering suggestions requires matching on word start.',
  },

  // ── Word-Based Suggestions ────────────────────────────────────────────────

  'editor.wordBasedSuggestions': {
    title: 'Word Based Suggestions',
    type: 'select',
    subCategory: 'Suggestions',
    defaultValue: 'matchingDocuments',
    order: 25,
    tags: ['suggestions', 'mono'],
    markdownDescription: 'Controls which documents are used to compute word based completions.',
    enum: ['off', 'currentDocument', 'matchingDocuments', 'allDocuments'],
    enumItemLabels: ['Off', 'Current Document', 'Matching Documents', 'All Documents'],
  },

  'editor.wordBasedSuggestionsOnlySameLanguage': {
    title: 'Word Based Suggestions Only Same Language',
    type: 'boolean',
    subCategory: 'Suggestions',
    defaultValue: false,
    order: 26,
    tags: ['suggestions'],
    supportStatus: 'removed',
    supportNote: 'Deprecated legacy Monaco setting superseded by editor.wordBasedSuggestions.',
    markdownDescription: 'Legacy flag superseded by `#editor.wordBasedSuggestions#`.',
  },

  // ── Inline Suggest / Ghost Text (Mono Native) ────────────────────────────

  'editor.inlineSuggest.enabled': {
    title: 'Inline Suggest (Ghost Text)',
    type: 'boolean',
    subCategory: 'Inline Suggest',
    defaultValue: true,
    order: 27,
    tags: ['suggestions', 'inline', 'ghost', 'mono'],
    description: 'Enable inline multiline ghost-text completions from registered inline completion providers.',
  },

  'editor.inlineSuggest.debounceMs': {
    title: 'Inline Suggest Debounce (ms)',
    type: 'number',
    subCategory: 'Inline Suggest',
    defaultValue: 150,
    minimum: 0,
    maximum: 2000,
    order: 28,
    tags: ['suggestions', 'inline', 'mono'],
    description: 'Delay in milliseconds after typing before requesting inline ghost-text completions.',
  },

  'editor.inlineSuggest.showToolbar': {
    title: 'Inline Suggest Toolbar',
    type: 'select',
    subCategory: 'Inline Suggest',
    defaultValue: 'touch',
    order: 29,
    tags: ['suggestions', 'inline', 'mono'],
    description: 'Controls when the accept/next/dismiss toolbar is shown for inline ghost-text completions.',
    enum: ['always', 'touch', 'onHover', 'never'],
    enumItemLabels: ['Always', 'Touch Only', 'On Hover', 'Never'],
  },

  'editor.inlineSuggest.italic': {
    title: 'Inline Suggest Italic Style',
    type: 'boolean',
    subCategory: 'Inline Suggest',
    defaultValue: true,
    order: 29.5,
    tags: ['suggestions', 'inline', 'mono'],
    description: 'Render inline ghost-text suggestions in italics.',
  },

  // ── Suggest Item Visibility (Mono Native) ────────────────────────────────

  'editor.suggest.showMethods': { title: 'Show Methods in Suggestions', type: 'boolean', defaultValue: true, order: 30, subCategory: 'Suggestions > Suggest Item Visibility', tags: ['suggestions', 'mono'], description: 'Controls whether method-completions are shown in the suggest widget.' },
  'editor.suggest.showFunctions': { title: 'Show Functions in Suggestions', type: 'boolean', defaultValue: true, order: 31, subCategory: 'Suggestions > Suggest Item Visibility', tags: ['suggestions', 'mono'], description: 'Controls whether function-completions are shown in the suggest widget.' },
  'editor.suggest.showConstructors': { title: 'Show Constructors in Suggestions', type: 'boolean', defaultValue: true, order: 32, subCategory: 'Suggestions > Suggest Item Visibility', tags: ['suggestions', 'mono'], description: 'Controls whether constructor-completions are shown in the suggest widget.' },
  'editor.suggest.showFields': { title: 'Show Fields in Suggestions', type: 'boolean', defaultValue: true, order: 33, subCategory: 'Suggestions > Suggest Item Visibility', tags: ['suggestions', 'mono'], description: 'Controls whether field-completions are shown in the suggest widget.' },
  'editor.suggest.showVariables': { title: 'Show Variables in Suggestions', type: 'boolean', defaultValue: true, order: 34, subCategory: 'Suggestions > Suggest Item Visibility', tags: ['suggestions', 'mono'], description: 'Controls whether variable-completions are shown in the suggest widget.' },
  'editor.suggest.showClasses': { title: 'Show Classes in Suggestions', type: 'boolean', defaultValue: true, order: 35, subCategory: 'Suggestions > Suggest Item Visibility', tags: ['suggestions', 'mono'], description: 'Controls whether class-completions are shown in the suggest widget.' },
  'editor.suggest.showStructs': { title: 'Show Structs in Suggestions', type: 'boolean', defaultValue: true, order: 36, subCategory: 'Suggestions > Suggest Item Visibility', tags: ['suggestions', 'mono'], description: 'Controls whether struct-completions are shown in the suggest widget.' },
  'editor.suggest.showInterfaces': { title: 'Show Interfaces in Suggestions', type: 'boolean', defaultValue: true, order: 37, subCategory: 'Suggestions > Suggest Item Visibility', tags: ['suggestions', 'mono'], description: 'Controls whether interface-completions are shown in the suggest widget.' },
  'editor.suggest.showModules': { title: 'Show Modules in Suggestions', type: 'boolean', defaultValue: true, order: 38, subCategory: 'Suggestions > Suggest Item Visibility', tags: ['suggestions', 'mono'], description: 'Controls whether module-completions are shown in the suggest widget.' },
  'editor.suggest.showProperties': { title: 'Show Properties in Suggestions', type: 'boolean', defaultValue: true, order: 39, subCategory: 'Suggestions > Suggest Item Visibility', tags: ['suggestions', 'mono'], description: 'Controls whether property-completions are shown in the suggest widget.' },
  'editor.suggest.showEvents': { title: 'Show Events in Suggestions', type: 'boolean', defaultValue: true, order: 40, subCategory: 'Suggestions > Suggest Item Visibility', tags: ['suggestions', 'mono'], description: 'Controls whether event-completions are shown in the suggest widget.' },
  'editor.suggest.showOperators': { title: 'Show Operators in Suggestions', type: 'boolean', defaultValue: true, order: 41, subCategory: 'Suggestions > Suggest Item Visibility', tags: ['suggestions', 'mono'], description: 'Controls whether operator-completions are shown in the suggest widget.' },
  'editor.suggest.showUnits': { title: 'Show Units in Suggestions', type: 'boolean', defaultValue: true, order: 42, subCategory: 'Suggestions > Suggest Item Visibility', tags: ['suggestions', 'mono'], description: 'Controls whether unit-completions are shown in the suggest widget.' },
  'editor.suggest.showValues': { title: 'Show Values in Suggestions', type: 'boolean', defaultValue: true, order: 43, subCategory: 'Suggestions > Suggest Item Visibility', tags: ['suggestions', 'mono'], description: 'Controls whether value-completions are shown in the suggest widget.' },
  'editor.suggest.showConstants': { title: 'Show Constants in Suggestions', type: 'boolean', defaultValue: true, order: 44, subCategory: 'Suggestions > Suggest Item Visibility', tags: ['suggestions', 'mono'], description: 'Controls whether constant-completions are shown in the suggest widget.' },
  'editor.suggest.showEnums': { title: 'Show Enums in Suggestions', type: 'boolean', defaultValue: true, order: 45, subCategory: 'Suggestions > Suggest Item Visibility', tags: ['suggestions', 'mono'], description: 'Controls whether enum-completions are shown in the suggest widget.' },
  'editor.suggest.showEnumMembers': { title: 'Show Enum Members in Suggestions', type: 'boolean', defaultValue: true, order: 46, subCategory: 'Suggestions > Suggest Item Visibility', tags: ['suggestions', 'mono'], description: 'Controls whether enumMember-completions are shown in the suggest widget.' },
  'editor.suggest.showKeywords': { title: 'Show Keywords in Suggestions', type: 'boolean', defaultValue: true, order: 47, subCategory: 'Suggestions > Suggest Item Visibility', tags: ['suggestions', 'mono'], description: 'Controls whether keyword-completions are shown in the suggest widget.' },
  'editor.suggest.showWords': { title: 'Show Words in Suggestions', type: 'boolean', defaultValue: true, order: 48, subCategory: 'Suggestions > Suggest Item Visibility', tags: ['suggestions', 'mono'], description: 'Controls whether word-based completions are shown in the suggest widget.' },
  'editor.suggest.showColors': { title: 'Show Colors in Suggestions', type: 'boolean', defaultValue: true, order: 49, subCategory: 'Suggestions > Suggest Item Visibility', tags: ['suggestions', 'mono'], description: 'Controls whether color-completions are shown in the suggest widget.' },
  'editor.suggest.showFiles': { title: 'Show Files in Suggestions', type: 'boolean', defaultValue: true, order: 50, subCategory: 'Suggestions > Suggest Item Visibility', tags: ['suggestions', 'mono'], description: 'Controls whether file-completions are shown in the suggest widget.' },
  'editor.suggest.showReferences': { title: 'Show References in Suggestions', type: 'boolean', defaultValue: true, order: 51, subCategory: 'Suggestions > Suggest Item Visibility', tags: ['suggestions', 'mono'], description: 'Controls whether reference-completions are shown in the suggest widget.' },
  'editor.suggest.showFolders': { title: 'Show Folders in Suggestions', type: 'boolean', defaultValue: true, order: 52, subCategory: 'Suggestions > Suggest Item Visibility', tags: ['suggestions', 'mono'], description: 'Controls whether folder-completions are shown in the suggest widget.' },
  'editor.suggest.showTypeParameters': { title: 'Show Type Parameters in Suggestions', type: 'boolean', defaultValue: true, order: 53, subCategory: 'Suggestions > Suggest Item Visibility', tags: ['suggestions', 'mono'], description: 'Controls whether typeParameter-completions are shown in the suggest widget.' },
  'editor.suggest.showSnippets': { title: 'Show Snippets in Suggestions', type: 'boolean', defaultValue: true, order: 54, subCategory: 'Suggestions > Suggest Item Visibility', tags: ['suggestions', 'snippet', 'mono'], description: 'Controls whether snippet-completions are shown in the suggest widget.' },
  'editor.suggest.showUsers': { title: 'Show Users in Suggestions', type: 'boolean', defaultValue: true, order: 55, subCategory: 'Suggestions > Suggest Item Visibility', tags: ['suggestions', 'mono'], description: 'Controls whether user-completions are shown in the suggest widget.' },
  'editor.suggest.showIssues': { title: 'Show Issues in Suggestions', type: 'boolean', defaultValue: true, order: 56, subCategory: 'Suggestions > Suggest Item Visibility', tags: ['suggestions', 'mono'], description: 'Controls whether issue-completions are shown in the suggest widget.' },

  // ── Snippet & Tab ─────────────────────────────────────────────────────────

  'editor.snippetSuggestions': {
    title: 'Snippet Suggestions',
    type: 'select',
    subCategory: 'Suggestions',
    defaultValue: 'inline',
    order: 60,
    tags: ['suggestions', 'snippet', 'mono'],
    description: 'Controls whether snippets are shown with other suggestions and how they are sorted.',
    enum: ['top', 'bottom', 'inline', 'none'],
    enumItemLabels: ['Top', 'Bottom', 'Inline', 'None'],
  },

  'editor.tabCompletion': {
    title: 'Tab Completion',
    type: 'select',
    subCategory: 'Suggestions',
    defaultValue: 'off',
    order: 61,
    tags: ['suggestions', 'tab', 'mono'],
    description: 'Enables tab completions.',
    enum: ['on', 'off', 'onlySnippets'],
    enumItemLabels: ['On', 'Off', 'Only Snippets'],
  },

  // ── Parameter Hints / Signature Help (Mono Native) ───────────────────────

  'editor.parameterHints.enabled': {
    title: 'Parameter Hints (Signature Help) Enabled',
    type: 'boolean',
    defaultValue: true,
    order: 70,
    subCategory: 'Parameter Hints',
    tags: ['suggestions', 'hints', 'signature', 'mono'],
    markdownDescription:
      'Enables a pop-up that shows parameter documentation and type information as you type a function call.\n\n' +
      '**Example:** Typing `console.log(` shows the signature `log(message?: any, ...optionalParams: any[]): void`.',
  },

  'editor.signatureHelp.trigger': {
    title: 'Signature Help Trigger Mode',
    type: 'select',
    defaultValue: 'auto',
    order: 71,
    subCategory: 'Parameter Hints',
    tags: ['suggestions', 'hints', 'signature', 'mono'],
    description: 'Controls whether parameter signature hints trigger automatically while typing or only on manual invocation.',
    enum: ['auto', 'manual'],
    enumItemLabels: ['Auto', 'Manual Only'],
  },

  'editor.parameterHints.cycle': {
    title: 'Parameter Hints Cycle',
    type: 'boolean',
    defaultValue: false,
    order: 72,
    subCategory: 'Parameter Hints',
    tags: ['suggestions', 'hints', 'mono'],
    description: 'Controls whether the parameter hints menu cycles or closes when reaching the end of the list.',
  },

  // ── Hover (Mono Native) ──────────────────────────────────────────────────

  'editor.hover.enabled': {
    title: 'Hover Enabled',
    type: 'boolean',
    defaultValue: true,
    order: 80,
    subCategory: 'Hover',
    tags: ['hover', 'mono'],
    description: 'Controls whether hover documentation is shown.',
  },

  'editor.hover.trigger': {
    title: 'Hover Trigger Mode',
    type: 'select',
    defaultValue: 'click',
    order: 81,
    subCategory: 'Hover',
    tags: ['hover', 'mono'],
    description: 'Controls how hover documentation is triggered in Mono Editor (auto hover, click/tap on symbol, or off).',
    enum: ['hover', 'click', 'off'],
    enumItemLabels: ['Auto / Hover', 'Click / Tap', 'Off'],
  },

  'editor.hover.delay': {
    title: 'Hover Delay (ms)',
    type: 'number',
    defaultValue: 300,
    minimum: 0,
    maximum: 10000,
    order: 82,
    subCategory: 'Hover',
    tags: ['hover', 'mono'],
    description: 'Controls the delay in milliseconds after which the hover is shown.',
  },

  'editor.hover.sticky': {
    title: 'Hover Sticky',
    type: 'boolean',
    defaultValue: true,
    order: 83,
    subCategory: 'Hover',
    tags: ['hover', 'mono'],
    description: 'Controls whether the hover should remain visible when the pointer moves over it.',
  },

  'editor.hover.above': {
    title: 'Hover Above',
    type: 'boolean',
    defaultValue: true,
    order: 84,
    subCategory: 'Hover',
    tags: ['hover', 'mono'],
    description: 'Prefer showing hovers above the line when space is available.',
  },

  'editor.hover.openOnMouseHover': {
    title: 'Open Hover On Mouse Hover',
    type: 'boolean',
    defaultValue: false,
    order: 85,
    subCategory: 'Hover',
    tags: ['hover', 'mono'],
    description: 'Allow opening hover documentation when hovering with a mouse pointer even in click trigger mode.',
  },

  'editor.hover.hidingDelay': {
    title: 'Hover Hiding Delay',
    type: 'number',
    defaultValue: 300,
    minimum: 0,
    maximum: 10000,
    order: 86,
    subCategory: 'Hover',
    tags: ['hover', 'mono'],
    markdownDescription: 'Controls the delay in milliseconds after which the hover widget is hidden when `#editor.hover.sticky#` is enabled.',
  },

  // ── Inlay Hints (Mono Native) ────────────────────────────────────────────

  'editor.inlayHints.enabled': {
    title: 'Inlay Hints Enabled',
    type: 'select',
    defaultValue: 'on',
    order: 90,
    subCategory: 'Inlay Hints',
    tags: ['hints', 'intellisense', 'mono'],
    markdownDescription:
      'Enables inlay hints in Mono Editor.\n\n' +
      '- `on` — Always visible\n' +
      '- `off` — Hidden',
    enum: ['on', 'off'],
    enumItemLabels: ['On', 'Off'],
  },

  'editor.inlayHints.fontSize': {
    title: 'Inlay Hints Font Size',
    type: 'number',
    defaultValue: 0,
    minimum: 0,
    maximum: 100,
    order: 91,
    subCategory: 'Inlay Hints',
    tags: ['hints', 'font', 'mono'],
    markdownDescription: 'Controls font size of inlay hints. When set to `0`, scales automatically with `#editor.fontSize#`.',
  },

  'editor.inlayHints.fontFamily': {
    title: 'Inlay Hints Font Family',
    type: 'string',
    defaultValue: '',
    order: 92,
    subCategory: 'Inlay Hints',
    tags: ['hints', 'font', 'mono'],
    markdownDescription: 'Controls font family of inlay hints. When empty, `#editor.fontFamily#` is used.',
  },

  'editor.inlayHints.padding': {
    title: 'Inlay Hints Padding',
    type: 'boolean',
    defaultValue: false,
    order: 93,
    subCategory: 'Inlay Hints',
    tags: ['hints', 'mono'],
    description: 'Enables padding around inlay hint chips in the editor.',
  },

  'editor.inlayHints.onClick': {
    title: 'Inlay Hints Click Behavior',
    type: 'select',
    defaultValue: 'placeCursor',
    order: 94,
    subCategory: 'Inlay Hints',
    tags: ['hints', 'mono'],
    description: 'Controls what happens when tapping or clicking an inline inlay hint chip.',
    enum: ['placeCursor', 'bubble', 'none'],
    enumItemLabels: ['Place Cursor', 'Show Info Bubble', 'None'],
  },

  // ── Code Lens (Mono Native) ──────────────────────────────────────────────

  'editor.codeLens': {
    title: 'Code Lens',
    type: 'boolean',
    defaultValue: true,
    order: 100,
    subCategory: 'Code Lens',
    tags: ['display', 'codelens', 'mono'],
    markdownDescription: 'Controls whether Mono Editor shows actionable CodeLens annotations above declarations.',
  },

  'editor.codeLensFontFamily': {
    title: 'Code Lens Font Family',
    type: 'string',
    defaultValue: '',
    order: 101,
    subCategory: 'Code Lens',
    tags: ['codelens', 'font', 'mono'],
    markdownDescription: 'Controls the font family for CodeLens. When empty, `#editor.fontFamily#` is used.',
  },

  'editor.codeLensFontSize': {
    title: 'Code Lens Font Size',
    type: 'number',
    defaultValue: 0,
    minimum: 0,
    maximum: 100,
    order: 102,
    subCategory: 'Code Lens',
    tags: ['codelens', 'font', 'mono'],
    markdownDescription: 'Controls the font size in pixels for CodeLens. When set to `0`, scales with `#editor.fontSize#`.',
  },

  // ── Light Bulb (Mono Native) ─────────────────────────────────────────────

  'editor.lightbulb.enabled': {
    title: 'Light Bulb Enabled',
    type: 'select',
    defaultValue: 'on',
    order: 110,
    tags: ['display', 'quickfix', 'mono'],
    markdownDescription: 'Controls whether to show the light bulb for quick fixes and code actions.',
    enum: ['off', 'on', 'onCode'],
    enumItemLabels: ['Off', 'On', 'On Code'],
  },
};