# Mono Editor — Master Roadmap & Wire Plan

**Goal:** Build `@mono/editor` into a standalone, canvas-rendered, mobile-first code editor with clean `editor.*` and `languages.*` namespaces (`Position`, `Range`, `Selection`, `Uri`) alongside existing `@mono/editor` exports.

### Legend
| Mark | Meaning |
|------|---------|
| ✅ | Complete & verified with automated tests |
| 🟡 | Partial / in progress |
| ❌ | Planned |

---

## Master 4-Phase Roadmap

### Phase 1 — Core API Surface & Daily Coding Engine — ✅ Complete
| Area | Status | Details |
|------|--------|---------|
| Zero-blink mobile completion tap | ✅ | `SuggestWidget` suppresses synthetic blur on non-drag `touchend` while keeping vertical scroll passive; `InputController.focus()` skips redundant focus churn |
| Multiline block-comment tokenizer accuracy | ✅ | `createRegexTokensProvider` matches multiline states from column 0 on indented lines; JS/TS, CSS & HTML block comments never leak past closing tokens |
| Pure Mono branding + `editor.*` / `languages.*` API | ✅ | Internal files (`monoTypes.ts`, `mono.ts`, `phase1-mono.test.mts`) & playground globals (`window.mono`) cleanly branded as Mono while preserving `editor.*` & `languages.*` namespaces |
| Core value types & constants | ✅ | `Position`, `Range`, `Selection`, `Uri`, `SelectionDirection`, `EndOfLineSequence`, `CompletionTriggerKind`, `IndentAction`, `KeyMod`, `KeyCode` (`erasableSyntaxOnly`-safe) |
| `LanguageConfiguration` registry + 11 built-in languages | ✅ | JS/TS/JSX/TSX, JSON, CSS, HTML, Java, Python, Markdown, YAML, Shell, SQL, C/C++ (+ Plaintext) |
| Auto-closing brackets/quotes, overtype, auto-surround & pair backspace | ✅ | Respects `autoClosingBrackets`, `autoClosingQuotes`, `autoSurround`, and `notIn: ['string', 'comment']` via token lookup |
| Data-driven `OnEnterEngine` | ✅ | Evaluates per-language `onEnterRules` & `indentationRules` (`IndentAction.None \| Indent \| IndentOutdent \| Outdent`) |
| Toggle Line Comment (`Ctrl+/`) & Block Comment (`Shift+Alt+A`) | ✅ | Per-language `comments` config, multi-line indent preservation, block-comment fallback for CSS/HTML, single undo step |
| Daily Line Operations | ✅ | Move Up/Down (`Alt+Up/Down`), Duplicate Up/Down (`Shift+Alt+Up/Down`), Delete Line (`Ctrl+Shift+K`), Insert Line Below/Above (`Ctrl+Enter` / `Ctrl+Shift+Enter`) |
| IME / Composition (`compositionstart/update/end`) | ✅ | Live unrecorded preview with canvas composition underline (Bengali, Hindi, CJK, Gboard) committed as 1 clean undo step on `compositionend` |

---

### Phase 2 — View Projection, Code Folding, Word Wrap & Visual Chrome — ✅ Complete
| Area | Status | Details |
|------|--------|---------|
| Unified `ViewLineProjection` | ✅ | Shared model-line ↔ visual-row mapping powering simultaneous code folding and word wrap with O(1) identity fast path |
| Code Folding end-to-end | ✅ | `FoldingModel` (language `#region` markers + indentation scopes), gutter chevrons (`⌄`/`›`), clickable inline `...` folded badges, commands & shortcuts (`Ctrl+Shift+[/]`), auto-unfold on hidden-line edit/reveal |
| Word Wrap (`wordWrap: 'on' \| 'off'`, `wrappingIndent`) | ✅ | Grapheme-aware soft wrapping over `ViewLineProjection` with `'none' \| 'same' \| 'indent'` continuation indentation and full hit-test/caret/selection/teardrop support |
| Bracket Pair Matching Highlight | ✅ | Highlights matching open/close bracket around caret using `LanguageConfiguration.brackets`, ignoring strings & comments |
| Indent Guides & Word Occurrence Highlight | ✅ | Vertical indentation guides with active enclosing block highlight + whole-word / selection occurrence highlights in viewport |
| Custom Overlay Scrollbar | ✅ | Focus-safe vertical & horizontal overlay thumbs (`'auto' \| 'visible' \| 'hidden'`), thumb drag, track jump, dark/light sync, and diagnostic/find overview ticks |
| Interactive Mono Playground Workbench | ✅ | Responsive developer workbench with collapsible Feature Controls sidebar (desktop panel / mobile drawer) to toggle every engine feature live across all 11 languages |

---

### Phase 3 — Rich IntelliSense, Multi-Model & LSP Parity — ✅ Complete
| Area | Status | Details |
|------|--------|---------|
| Sticky Scroll with collapsed folds | ✅ | `StickyScroll.headersForRows` maps visual rows to visible model lines so sticky headers stay active and accurate even with collapsed folds or active word wrap |
| Independent auto-hide Vertical & Horizontal Scrollbars | ✅ | Separate `scrollbar.hideVerticalOnScrollEnd` & `scrollbar.hideHorizontalOnScrollEnd` flags (both `true` by default) that completely hide thumbs (`opacity: 0`, `pointerEvents: 'none'`) after scrolling stops |
| Authentic Codicon Find Widget, focus safety & live theme sync | ✅ | Bundled local `codicon.ttf` glyphs matching Monaco Find icons, focus-safe inputs (`InputController` & `MonoEditor` guards), and `resolveWidgetTheme` live dark/light synchronization across all floating widgets |
| Dynamic Caret & Teardrop Syntax Color | ✅ | `dynamicCaretColor` API (default `true`): caret, active sticky caret, teardrop & attached tip caret adopt token color at position; selection start & end handles independently match their own token colors |
| Snippets & Rich Suggest | ✅ | `SnippetSession` (`$1`, `${1:def}`, `${1\|a,b\|}`, `$0`, `Tab`/`Shift+Tab`/`Escape`, multi-line indent), Suggest Markdown docs side panel + `resolveCompletionItem`, `commitCharacters`, and single-undo `additionalTextEdits` |
| Safe Markdown Hover & Signature Help | ✅ | DOM-only `renderMarkdownToDom` (zero `innerHTML`) in `HoverWidget` + theme-synced `SignatureHelpController` / `SignatureHelpWidget` (`(`, `,`, `Ctrl+Shift+Space`, active parameter highlight, overload switcher) |
| Multi-model & URI lifecycle | ✅ | `editor.createModel` backed by real `TextModel`, `editor.setModel(model)` with per-URI view-state caching (`scrollTop`, `scrollLeft`, `selection`, `collapsedLines`), `onDidChangeModel`, `setModelLanguage` |
| CRLF (`\r\n`) & EOL normalization | ✅ | Auto-detects & preserves `\r\n` vs `\n`, exposes `getEOL()` / `setEOL(LF \| CRLF)`, CRLF-safe offsets, positions, undo/redo, and `InputController` editing |
| Formatting, Definition, References, Rename & Code Actions | ✅ | Full provider registries + `Shift+Alt+F` Format, `F12` Definition, `Shift+F12` References Peek, `F2` Focus-Safe Inline Rename, `Ctrl+.` & clickable Lightbulb Quick Fix applying `WorkspaceEdit` atomically |

---

### Phase 4 — Power Features, Color Decorators & Full Language Tokenizers — ✅ Complete (Core)
| Area | Status | Details |
|------|--------|---------|
| Hover auto-hide & Axis-isolated scrollbars | ✅ | Hover popups dismiss immediately on any scroll or cursor change; vertical scrolling never reveals the horizontal scrollbar and vice-versa |
| VS Code-Faithful Inline References Peek View | ✅ | Embedded directly in an inline `viewZone` (scrolls with document), top accent triangle tracks `scrollLeft`, header `<fileName> <dirPath> - References (N)` + `×`, live embedded `MonoEditor` sharing backing `TextModel` for 2-way real-time edits, stays open until `×`, `Escape`, or file switch |
| Find / Replace Top Viewport Gap | ✅ | Opening Find adds dynamic `topInsetPx` above line 1 (expands on Replace, collapses cleanly on close) with compact `3px` spacing so lines 1–2 and top matches are never obscured |
| Theme-Adaptive Softened Dynamic Caret & Teardrops | ✅ | `softenDynamicColor(hex, isDark)` adapts syntax colors to soft luminous tints on dark themes and calm readable tints on light themes |
| Monaco Inline Color Bullets, Color Picker & Rules API | ✅ | Built-in Hex/RGB(A)/HSL(A)/148 named color swatches, clickable HSV+Alpha Monaco Color Picker cycling Hex/RGB/HSL in 1 undo step, extensible `colorDecoratorsRules` API (`allowInComments`, `context`, `<style>`/`<script>`/`style="..."`, custom `tags`/`attributes`/`taggedTemplates`, `customRule`) + `languages.registerColorProvider` |
| Multi-cursor editing | ✅ | `Alt+Click`, `Ctrl+D` add next occurrence, `Ctrl+Shift+L` select all, `Ctrl+Alt+Up/Down`, `Escape` collapse, multi-caret typing/navigation/copy/cut/paste in single undo `transact()` |
| High-DPI Canvas Minimap | ✅ | Dockable `right`/`left` minimap with token-colored lines, selection/find/diagnostic markers, and focus-safe click & drag viewport slider |
| All 11 Built-in Language Tokenizers | ✅ | Added Java, C/C++, Markdown, YAML, Shell, and SQL tokenizers alongside JS/TS/JSON/CSS/HTML/Python |
| Diff Editor & Piece-table 100k+ scale | ❌ | Future Phase 5 |

---

## Verified Baseline Engine Core
- Incremental `TextModel` (line-splice edits, lazy offset cache, cached `getValue`, typing-burst undo grouping, `transact()`)
- Incremental viewport-only `TokenizationSupport` (fuzz-tested vs full re-tokenize)
- Grapheme-exact `TextLayoutCache` (Indic/Bengali/Hindi conjunct alignment, `0px` teardrop release accuracy)
- `scrollBeyondLastLine` blank bottom viewport area
- Touch scroll with fling physics, sticky scroll, Find/Replace widget, Context Menu, Command/Palette services, Decorations & Diagnostic Markers, VS Code themes (`defineTheme` / `setTheme`)

## Automated Test Suites
- `tests/phase1-mono.test.mts` — Core API, value types, 11 language configs, auto-close/overtype/surround/pair-backspace, OnEnter, comments, line ops, IME composition, suggest focus retention
- `tests/phase2-mono.test.mts` — Multiline block-comment fix (JS/CSS/HTML), zero-blink touch suggest accept, `ViewLineProjection` (folding + grapheme word wrap), `FoldingModel`, bracket pair matching, word occurrences, indent guides, `OverlayScrollbar`
- `tests/phase3-mono.test.mts` — Sticky Scroll + Folding, V/H auto-hide scrollbars, Codicon Find Widget + focus retention + theme sync, Dynamic Caret & independent selection teardrop colors, Snippets, Markdown DOM, Signature Help, Multi-Model view-state, CRLF/LF EOL, and LSP providers
- `tests/phase4-mono.test.mts` — Hover auto-hide, VS Code Inline References Peek View (viewZone + triangle tracking + 2-way shared model live sync), Find top viewport gap + 3px spacing, Theme-adaptive softened dynamic colors, Axis-isolated scrollbar reveal, Color Bullets & Rules API (`<style>`/`<script>`/comments/`customRule`) + Color Picker, Multi-Cursor editing/undo, Minimap, and 6 new language tokenizers (Java, C/C++, Markdown, YAML, Shell, SQL)
- `tests/editor-fixes.test.mts` — Grapheme layout, Bengali/Hindi teardrop alignment, auto-suggest, `scrollBeyondLastLine`
- `tests/slice-d.test.mts` — Incremental `TextModel` & tokenizer fuzz tests
- `tests/undo-group.test.mts` — Typing-burst undo grouping & transactions
