# Mono Editor — Feature Status Matrix

Truthful audit of what is currently implemented in `src/` (supersedes the older `docs/check.md`).

Legend: **Implemented** · **Partial** · **Planned**

---

## 1. Text Model & Editing Core (`src/common/`)

| Feature | Status | Notes |
|---|---|---|
| Incremental line-splice `TextModel` | Implemented | Lazy cached `getValue()`, offset ↔ position, version IDs |
| Dirty tracking (`getAlternativeVersionId`) | Implemented | Tracks clean/dirty state across undo/redo |
| CRLF & LF auto-detection / preservation | Implemented | `getEOL()`, `setEOL()`, `EndOfLineSequence` |
| Word-level undo grouping + transactions | Implemented | Idle timer, caret-move break, Backspace/Delete bursts, `transact()` |
| Multi-model registry & `Uri` support | Implemented | `editor.createModel`, `getModel`, `getModels`, `setModel`, `onDidChangeModel` |
| Decorations & Markers (`DecorationsCollection`, `MarkerService`) | Implemented | Squiggles, line highlights, inline styles, diagnostics by owner |
| Piece-tree / rope buffer for 50 MB+ files | Planned | Phase 9 (behind the existing `TextModel` interface) |

## 2. Cursor, Selection & Daily Editing

| Feature | Status | Notes |
|---|---|---|
| Single cursor, Shift+Arrow, word/line navigation | Implemented | `Ctrl+Arrow`, `Ctrl+Backspace/Delete`, `Home/End`, `PageUp/PageDown` |
| Grapheme-safe caret movement (Bengali, Hindi, Emoji) | Implemented | `Intl.Segmenter` boundaries (`src/common/util/grapheme.ts`) |
| Multi-cursor editing | Implemented | `Ctrl+D`, `Ctrl+Shift+L`, `Alt+Click`, vertical cursor insert, Escape collapse |
| Auto-close pairs, overtype, auto-surround, pair backspace | Implemented | Respects `notIn` comment/string guard |
| `onEnter` auto-indent & JSDoc/list continuation | Implemented | Configured for all 12 built-in language families |
| Toggle line/block comment, move/duplicate/delete/insert lines | Implemented | Single-step undo transactions |
| Snippet expansion (`SnippetSession`) | Implemented | `$1`, `${1:default}`, `${1|a,b|}`, `$0`, Tab/Shift+Tab navigation |
| Column / box selection, expand/shrink selection, text transforms | Planned | Phase 6 |

## 3. Rendering, Viewport & Mobile UX (`src/browser/`)

| Feature | Status | Notes |
|---|---|---|
| Canvas 2D 7-pass rendering pipeline | Implemented | Background, highlights, text, decorations/carets, gutter, sticky, teardrops |
| Compact dynamic line-number gutter + fold chevrons | Implemented | Auto-scales digit columns (`lineNumbersMinChars = 2`) |
| Sticky Scroll (pinned at `y = 0`) | Implemented | Scope tracking even with collapsed folds; click-to-reveal |
| Code folding (indent + `#region` + provider) | Implemented | Gutter chevrons, fold/unfold all, reveal-on-edit |
| Word wrap (`ViewLineProjection`) | Implemented | Grapheme-aware wrapping combined seamlessly with folding |
| Bracket matching, visible occurrences, indent guides | Implemented | Active scope guide highlight |
| Overlay scrollbars (axis-isolated auto-hide) | Implemented | Vertical scroll never flashes horizontal bar & vice-versa; overview ticks |
| Minimap (`MinimapController`) | Implemented | Scaled canvas preview, viewport slider, click/drag scroll |
| Mobile touch UX: teardrop handles, fling scroll, IME composition | Implemented | Dynamic contrast-softened teardrop/caret colors, zero focus-churn |
| `renderWhitespace`, rulers, glyph margin, inline inlay hints / CodeLens | Planned | Phase 7 |

## 4. Language Intelligence & Widgets (`src/contrib/`)

| Feature | Status | Notes |
|---|---|---|
| 12 built-in language tokenizers & configs | Implemented | JS/TS, HTML, CSS, JSON, Python, Java, C/C++, Markdown, YAML, Shell, SQL, Plaintext |
| Autocomplete (`SuggestWidget` / `SuggestController`) | Implemented | Fuzzy scoring, trigger chars, mobile tap-safe accept, details pane, snippets |
| Hover popup (`HoverController` / `HoverWidget`) | Implemented | Provider + diagnostic hover, CSP-safe Markdown DOM, auto-hides on scroll/cursor move |
| Signature Help (`SignatureHelpController` / `Widget`) | Implemented | Trigger & retrigger chars, active parameter highlight, signature cycling |
| Find & Replace (`FindController` / `FindWidget`) | Implemented | Regex/case/whole-word, top-inset gap pushing lines cleanly below widget |
| Peek References (`ReferencesPeekView`) | Implemented | VS Code split view: live-synced nested `MonoEditor` + reference list + pointer arrow |
| Go to Definition & Inline Rename | Implemented | `F12` jump, `F2` inline rename widget with atomic `WorkspaceEdit` |
| Code Actions & Lightbulb | Implemented | Quick Fix lightbulb & menu for diagnostic/refactor actions |
| Document & Selection Formatting | Implemented | Provider-driven atomic edits |
| Inline Color Bullets & Monaco-style Color Picker | Implemented | Hex/RGB/HSL/named detection, `<style>`/`<script>`/custom rules API, comment guard |
| Context Menu, Command Palette, Keybinding Service | Implemented | 32 built-in `MonoCommands`, customizable items & styles |
| Built-in Themes (5 themes) | Implemented | `mscode-dark`, `mscode-light`, `mscode-amoled`, `solarized-dark`, `solarized-light` |
| Document symbols / Outline / Inlay hints / Ghost-text inline completions | Planned | Phase 8 |
| Diff editor (`createDiffEditor`) | Planned | Phase 10 |
