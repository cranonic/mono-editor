# Mono Editor — Feature Status Matrix

Truthful audit of what is currently implemented in `src/`.

Legend: **Implemented** · **Partial** · **Planned**

---

## 1. Text Model & Editing Core (`src/common/`)

| Feature | Status | Notes |
|---|---|---|
| Incremental line-splice `TextModel` | Implemented | Lazy cached `getValue()`, offset ↔ position, granular `changes[]` deltas (`isUndoing`/`isRedoing`/`isFlush`), version IDs |
| Full `IStandaloneTextModel` parity | Implemented | `getValueInRange`, `getLineLength`, `findMatches`/`Next`/`Previous`, `getWordAtPosition`, `validatePosition`/`Range`, `pushEditOperations`, `detectIndentation`, model decorations & lifecycle events |
| Dirty tracking (`getAlternativeVersionId`) | Implemented | Tracks clean/dirty state across undo/redo |
| CRLF & LF auto-detection / preservation | Implemented | `getEOL()`, `setEOL()`, `EndOfLineSequence` |
| Word-level undo grouping + transactions | Implemented | Idle timer, caret-move break, Backspace/Delete bursts, `transact()` |
| Decorations & Markers (`DecorationsCollection`, `MarkerService`) | Implemented | Squiggles, line highlights, glyph margin icons, `MarkerTag.Unnecessary`/`Deprecated`, `createDecorationsCollection()` |
| Piece-tree / rope buffer for 50 MB+ files | Planned | Future optimization behind `TextModel` |

## 2. Cursor, Selection & Daily Editing

| Feature | Status | Notes |
|---|---|---|
| Single cursor, Shift+Arrow, word/line navigation | Implemented | `Ctrl+Arrow`, `Ctrl+Backspace/Delete`, `Home/End`, `PageUp/PageDown`, `stickyTabStops` |
| Grapheme-safe caret movement (Bengali, Hindi, Emoji) | Implemented | `Intl.Segmenter` boundaries (`src/common/util/grapheme.ts`) |
| Multi-cursor editing & smart Selection Range | Implemented | `Ctrl+D`, `Ctrl+Shift+L`, `Alt+Click`, vertical cursor insert, smart expand/shrink selection, Escape collapse |
| Cursor styles, blinking & surrounding lines | Implemented | `line` / `block` / `underline` / `*-thin` / `block-outline`, `blink` / `smooth` / `phase` / `expand` / `solid`, `cursorSurroundingLines` |
| Auto-close pairs, overtype, auto-surround, pair backspace | Implemented | Respects `notIn` comment/string guard |
| `onEnter` auto-indent & JSDoc/list continuation | Implemented | Configured for all 21 built-in language families; supports `insertSpaces: false`, `detectIndentation`, `trimAutoWhitespace` |
| Daily line transforms & clipboard ergonomics | Implemented | Comment toggle, move/duplicate/delete/insert line, join/sort/dedupe/transpose lines, upper/lower/title case, trim trailing whitespace, convert spaces ↔ tabs, `emptySelectionClipboard`, `formatOnPaste` |
| Linked Editing / HTML paired tag auto-rename | Implemented | Built-in HTML/XML/JSX paired-tag sync + `LinkedEditingRangeProvider` |
| Snippet expansion (`SnippetSession`) | Implemented | `$1`, `${1:default}`, `${1|a,b|}`, `$0`, Tab/Shift+Tab navigation |

## 3. Rendering, Viewport, Accessibility & Mobile UX (`src/browser/`)

| Feature | Status | Notes |
|---|---|---|
| Canvas 2D multi-pass rendering pipeline | Implemented | Background, rulers, highlights, whitespace markers, text, inline virtual text, lifted inlay bubbles, error lens, decorations/carets, glyph margin + gutter, sticky scroll, teardrops |
| Unified view-zone geometry (`RowGeometry`) | Implemented | Single source of truth (`createRowGeometry`) across Canvas, hit-testing, Sticky Scroll, teardrops, and widgets; CodeLens scroll anchoring + `codeLensFontSize`/`codeLensFontFamily` |
| Display modes (`renderWhitespace`, `rulers`, `renderLineHighlight`, `lineNumbers`) | Implemented | `on` / `off` / `relative` / `interval` / custom line numbers; `none` / `boundary` / `selection` / `trailing` / `all` whitespace |
| Glyph Margin & inline Error Lens | Implemented | Breakpoint/bookmark glyphs with `MouseTargetType.GUTTER_GLYPH_MARGIN` hit-testing + muted inline diagnostics |
| Sticky Scroll (indent, fold, Markdown headings, Outline) | Implemented | `MarkdownScopeFinder` & `OutlineScopeFinder`, view-zone-aware push-out (`blockTopOfRow`), inline color bullets & swatch picker tap, click-to-reveal |
| Code folding & Word wrap (`ViewLineProjection`) | Implemented | Indent + `#region` + provider folding combined with grapheme-aware wrapping and `setHiddenAreas` |
| Bracket matching, 5-level Rainbow Brackets, occurrences, indent guides | Implemented | Token-aware bracket pool & active scope highlight; active-cursor bracket pair painted cleanly above selection fill |
| Full Monaco View API | Implemented | `addContentWidget`, `addOverlayWidget`, multi-zone `changeViewZones`, `getVisibleRanges`, `getLayoutInfo`, `getTargetAtClientPoint`, `saveViewState`/`restoreViewState`, `onMouse*` |
| Overlay scrollbars & Minimap | Implemented | Axis-isolated auto-hide scrollbars, overview ticks, scaled canvas minimap |
| Mobile-first touch UX | Implemented | `visualViewport` soft-keyboard bottom inset, non-focus-stealing `MobileQuickKeysBar` (with Parameter Hints key), pinch-to-zoom font scaling, virtual-text-aligned teardrop handles, fling scroll, IME composition |
| Accessibility & High Contrast | Implemented | `role="textbox"`, `aria-multiline`, `aria-label`, `aria-live="polite"` TalkBack/VoiceOver announcements, `hc-black` theme |

## 4. Language Intelligence, Diff & Widgets (`src/contrib/`)

| Feature | Status | Notes |
|---|---|---|
| 21 built-in ReDoS-safe language tokenizers & configs | Implemented | JS/TS, HTML, CSS, JSON, Python, Java, C/C++, Markdown, YAML, Shell, SQL, Plaintext + Rust, Go, Kotlin, Swift, PHP, Ruby, XML, TOML, Dockerfile (O(1) sticky regex engine) |
| Autocomplete, Ghost Text & Inlay Hints | Implemented | Fuzzy scoring, snippets, `suggest.docs` (`'off'` default, `Ctrl+Space` or touch `i` toggle, non-overlapping auto placement), `suggest.mode: 'ghost'` inline completion, multiline AI ghost text, clickable inlay hints (`inlayHints.onClick: 'placeCursor' \| 'bubble' \| 'none'`, animated bubble lift, `onDidClickInlayHint`) |
| Hover, Diagnostics Popup, Signature Help & CodeLens | Implemented | Independent `hover.trigger` and `diagnostics.popup` (`'click' \| 'hover' \| 'off'`, pointer-aware defaults), `signatureHelp: { enabled, trigger }` (`Ctrl+Shift+Space` manual trigger, opposite-side placement from completion list), clickable CodeLens view zones |
| Quick Navigation (`Go to Line`, `Go to Symbol`, `Peek Definition`) | Implemented | `Ctrl+G`, `Ctrl+Shift+O` with live filter, `Alt+F12` inline peek definition, `F12` jump |
| Find & Replace, References Peek, Inline Rename, Code Actions | Implemented | Regex/case/whole-word find, split References Peek view, `resolveRenameLocation` guard with toast, Quick Fix lightbulb |
| Inline Color Bullets & Color Picker | Implemented | Hex/RGB/HSL/named detection in main viewport and sticky scroll rows, `<style>`/`<script>`/custom rules API |
| Dual-Editor Diff Editor (`editor.createDiffEditor` / `MonoDiffEditor`) | Implemented | Full Monaco `IStandaloneDiffEditor` parity built on two real `MonoEditor` instances (`originalEditor`, `modifiedEditor`), editable modified pane by default (`readOnly: false`, `originalEditable: false`), Myers + char-level + move detection (`computeDiff`), synced vertical & independent horizontal scroll, draggable splitter, margin revert arrows, `hideUnchangedRegions`, auto-inline `< 900px`, `createDiffNavigator`, `F7`/`Shift+F7` |
| Monaco-Style Menus, Context Menu, Command Palette & Keybindings | Implemented | Declarative `menus` / `MenuId` registry with `when` & `enabledWhen` expression evaluator (`&&`, `\|\|`, `!`, `==`, `!=`, parens), `editor.addAction` context-menu integration, dual-mode `contextMenu` (`horizontal` bar with automatic `More (⋮)` overflow + `Back` header & WAAPI cascade, or `vertical` grouped list), desktop right-click, `visualViewport`-aware placement |
| Built-in Themes (6 themes) | Implemented | `mscode-dark`, `mscode-light`, `mscode-amoled`, `solarized-dark`, `solarized-light`, `hc-black` |
| Lazy Preview Entry (`@mono/editor/preview`) | Implemented | Optional `peerDependencies` for KaTeX/Mermaid, zero core bundle cost |

