# Mono Editor — Feature Audit Checklist & Mobile-First LSP / Virtual Text Roadmap

This plan audits the current Mono Editor codebase (marking every capability as completed, partial, missing, or intentionally excluded for mobile) and specifies a modular architecture for five major upgrades: opt-in Color Bullet hover, Monaco/VS Code-faithful Hover Docs and live Signature Help popups, Markdown `#` Sticky Scroll, Universal Multiline Wrap-Aware Ghost Text + Inlay Hints (Copilot/Codex-ready), and completion of the mobile-first LSP provider suite.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> All four product scope decisions below were confirmed during clarification and govern this plan. Please review the checklist and architecture before approving execution.

- **Color Bullet Hover Behavior (Confirmed)**: Opens on **tap/click only by default** (`colorDecoratorsOpenOnHover: false`) so scrolling or resting fingers on mobile never triggers accidental popups; desktop/host apps can opt in to hover-open via editor options.
- **Inline Virtual Text Scope (Confirmed)**: Build **both** Universal Multiline Ghost Text (wrapping cleanly in word-wrap mode, placeable at **any line and any column** via both Copilot/Codex-compatible `InlineCompletionsProvider` and a direct imperative plugin API) **and** LSP Inlay Hints.
- **Mobile-First LSP Scope (Confirmed)**: Implement all core mobile-relevant LSP providers **plus** Document/Range Semantic Tokens and Paste Edits, while **excluding** desktop-only/experimental providers (`DocumentDropEditProvider`, `NewSymbolNamesProvider`, Call/Type Hierarchy trees).
- **Hover & Signature Help Triggers (Confirmed)**: **Tap/command** triggers Hover Docs (plus optional desktop mouse dwell), while **Signature Help updates automatically and live** while typing function calls and navigating between parameters.

---

## 1. Codebase Capability Audit Checklist

Legend: `[x]` Completed · `[~]` Partial (needs upgrade) · `[ ]` Not Implemented · `[-]` Intentionally Excluded (desktop-heavy / non-mobile)

### A. Core Editor, Rendering & Syntax
- `[x]` Piece-table/line `TextModel`, atomic undo/redo grouping, CRLF/LF preservation, multi-cursor editing
- `[x]` Stateful Monarch syntax highlighting (multiline templates, nested `${expr}`, O(1) interned states, safety line-length & regex time budgets)
- `[x]` Mixed/embedded HTML (`<style>` CSS, `<script>` JS/TS/JSON, HTML5 raw-text `</script>`) & Markdown fenced code blocks with compact `LanguageSegment` binary search
- `[x]` 5-level theme-aware Rainbow Bracket Pair Colorization with customizable rules & 50k-line cutoff
- `[x]` Separate optional `@mono/editor/preview` entry with lazy dynamic `import()` for KaTeX & strict Mermaid
- `[x]` Code Folding (`FoldingModel` + `FoldingRangeProvider`), Word Wrap (`ViewLineProjection`), Indent Guides, Minimap, Axis-isolated Overlay Scrollbar
- `[x]` Find / Replace widget (regex, case, whole-word, preserve-case, compact layout), Rename Symbol popup (scroll-tracking, out-of-view state preservation, soft-keyboard safe)
- `[~]` **Color Bullets & Color Picker** — swatches + click-to-open picker + rules API work; missing explicit `colorDecoratorsOpenOnHover` option (default `false`) and optional desktop mouse hover trigger
- `[~]` **Sticky Scroll** — works for indentation scopes, folds, and word wrap; **missing Markdown `#`/`##`/`###` heading hierarchy** and `DocumentSymbolProvider`-backed `outlineModel`

### B. Popups & Live Intelligence UX
- `[~]` **LSP Hover Docs Popup** — basic Markdown card + separate diagnostic tooltip exist; **missing** unified VS Code/Monaco card anatomy (merged diagnostics + syntax-highlighted code blocks + hover range highlight + sticky hover + bottom action bar with Quick Fix / Go to Definition / Peek References)
- `[~]` **Live Parameter Hints (Signature Help)** — basic popup exists; **missing** syntax-highlighted signature line, live parameter re-highlighting on caret move inside arguments, multi-line call tracking, exact `[start, end]` / safe substring parameter matching, and compact mobile touch overload controls

### C. Inline Virtual Text & AI Plugin Surface
- `[ ]` **Universal Multiline Ghost Text (Wrap-Aware)** — faded greyish ghost text at **any line & any position**, virtual vertical gap rows for multiline suggestions, full word-wrap support, `registerInlineCompletionsProvider` + direct `setGhostTexts()` plugin API for Copilot/Codex/AI edit previews, partial word/line accept, cycling, and touch accept bar
- `[ ]` **Inlay Hints (`registerInlayHintsProvider`)** — inline type & parameter hints with unified horizontal layout projection, padding, tooltips, and clickable command parts

### D. Complete LSP Provider Registry Audit
| Category | Provider API | Status | Notes / Mobile Verdict |
| :--- | :--- | :---: | :--- |
| **Completions** | `registerCompletionItemProvider` | `[x]` | Done (embedded-aware, snippets, trigger chars, resolve) |
| **Completions** | `registerInlineCompletionsProvider` | `[ ]` | **Add** — Copilot / Codex / AI ghost-text engine |
| **Docs & Hints** | `registerHoverProvider` | `[~]` | **Upgrade** — exact Monaco/VS Code unified hover card |
| **Docs & Hints** | `registerSignatureHelpProvider` | `[~]` | **Upgrade** — live parameter highlight + multi-line call tracking |
| **Docs & Hints** | `registerInlayHintsProvider` | `[ ]` | **Add** — inline parameter & type annotations |
| **Navigation** | `registerDefinitionProvider` | `[x]` | Done (embedded-aware, multi-model jump) |
| **Navigation** | `registerTypeDefinitionProvider` | `[ ]` | **Add** — Go to Type Definition (reuses definition jump) |
| **Navigation** | `registerImplementationProvider` | `[ ]` | **Add** — Go to Implementation (reuses definition/peek) |
| **Navigation** | `registerDeclarationProvider` | `[ ]` | **Add** — Go to Declaration (reuses definition jump) |
| **Navigation** | `registerReferenceProvider` | `[x]` | Done (VS Code-style inline References Peek View) |
| **Navigation** | `registerDocumentHighlightProvider` | `[ ]` | **Add** — Read / Write / Text semantic occurrence highlights |
| **Navigation** | `registerDocumentSymbolProvider` | `[ ]` | **Add** — Powers Outline API & Sticky Scroll `outlineModel` |
| **Navigation** | `registerLinkProvider` | `[ ]` | **Add** — Tap/Ctrl-click URL & file links with underline |
| **Refactoring** | `registerRenameProvider` | `[x]` | Done (scroll-tracking, mobile-safe popup) |
| **Refactoring** | `registerCodeActionProvider` | `[x]` | Done (lightbulb + Quick Fix menu + hover action integration) |
| **Formatting** | `registerDocumentFormattingEditProvider` | `[x]` | Done |
| **Formatting** | `registerDocumentRangeFormattingEditProvider` | `[x]` | Done |
| **Formatting** | `registerOnTypeFormattingEditProvider` | `[ ]` | **Add** — auto-format on `;`, `}`, `\n` |
| **Structure** | `registerFoldingRangeProvider` | `[x]` | Done |
| **Structure** | `registerSelectionRangeProvider` | `[ ]` | **Add** — Smart Expand / Shrink Selection (huge win on mobile!) |
| **Semantics** | `registerDocumentSemanticTokensProvider` | `[ ]` | **Add** — LSP semantic token overlay (full + delta) on top of Monarch |
| **Semantics** | `registerDocumentRangeSemanticTokensProvider` | `[ ]` | **Add** — viewport-only semantic tokens for fast mobile perf |
| **Colors** | `registerColorProvider` | `[x]` | Done (+ add `colorDecoratorsOpenOnHover: false` default) |
| **Clipboard** | `registerDocumentPasteEditProvider` | `[ ]` | **Add** — smart paste hooks (auto-import, paste-as-link) |
| **Mobile-Pruned** | `registerDocumentDropEditProvider` | `[-]` | **Skip** — desktop drag-and-drop file/text onto canvas |
| **Mobile-Pruned** | `registerNewSymbolNamesProvider` | `[-]` | **Skip** — experimental VS Code AI rename suggestion API |
| **Mobile-Pruned** | Call / Type Hierarchy & Linked Editing | `[-]` | **Skip** — heavy desktop sidebar tree widgets |

---

## 2. User Experience & Visual Design

### A. Visual Identity & Surface Discipline
- **Editor-Native Restraint**: All popups (Hover Docs, Signature Help, Ghost Text Touch Bar) inherit the active Mono theme (`mscode-dark`, `mscode-light`, `mscode-amoled`, `solarized-dark`, `solarized-light`) with `1px` hairline borders, single-level elevation shadow, zero nested card boxes, zero decorative status dots, and zero static pill enclosures.
- **Typography**: UI labels and prose use the editor's crisp sans stack (`Plus Jakarta Sans` / system sans at `12px–13px`, `1.45` line-height); code signatures, fenced blocks, ghost text, and inlay hints strictly use the editor's configured monospace font with `tabular-nums` on overload indices (`1/3`).
- **Touch-First Ergonomics**: Every interactive button inside Hover action bars, Signature Help overload arrows, and mobile Ghost Text controls provides comfortable hit targets (`>= 36–44px` tap area on touch) while keeping floating chrome compact so mobile code visibility stays above 85% of the viewport.

### B. Exact VS Code / Monaco Hover Docs Popup
```
┌──────────────────────────────────────────────────────────┐
│ ⊘  Property 'timeout' is missing in type '{ url }' (ts)  │  ← Unified Diagnostic section
├──────────────────────────────────────────────────────────┤
│ function fetchData(url: string, timeout?: number): Task  │  ← Syntax-highlighted code block
├──────────────────────────────────────────────────────────┤
│ Fetches JSON with automatic retry & abort controller.    │  ← Safe DOM Markdown prose
│ • `timeout` — request budget in ms (default `5000`)      │
├──────────────────────────────────────────────────────────┤
│ Quick Fix...   Go to Definition   Peek References        │  ← Status / Action footer bar
└──────────────────────────────────────────────────────────┘
```
- **Hover Range Highlight**: Subtle translucent highlight on the hovered token/range (`hover.range`) while the card is open.
- **Sticky Interactive Card**: Hovering/tapping inside the card keeps it open so users can scroll long docs, copy code, or trigger Quick Fix / Go to Definition; scrolling the editor or typing dismisses it cleanly.

### C. Exact VS Code / Monaco Live Signature Help Popup
```
┌──────────────────────────────────────────────────────────┐
│ ▲ 1/2 ▼  fetchData(url: string, timeout?: number): Task  │  ← Active param bold + accent + underline
├──────────────────────────────────────────────────────────┤
│ timeout — Request budget in milliseconds (default 5000). │  ← Active parameter doc
│ Fetches JSON with automatic retry & abort controller.    │  ← Muted function overview doc
└──────────────────────────────────────────────────────────┘
```
- Positioned **above** the caret line by default (preventing overlap with autocomplete suggestions below), flipping below only if near the top edge.
- Updates **live** on `(`, `,`, backspace, and horizontal cursor movement across arguments (including multi-line call expressions), automatically tracking nested parentheses depth.

### D. Multiline Ghost Text & Inlay Hints Visual Behavior
```
 12 │ function greet(name: string) {
 13 │   const label = format(user: name, locale: "en");
    │                        ^^^^^       ^^^^^^^  ← Inlay Hints (subdued inline chips)
 14 │   return `Hello ${name}`█.trim().toUpperCase();
    │                          ^^^^^^^^^^^^^^^^^^^^^  ← Inline Ghost Text (greyish faded)
    │     .replace(/\s+/g, " ")                     ← Virtual Ghost Row 1 (blank gutter!)
    │     .slice(0, 64);                            ← Virtual Ghost Row 2 (wraps in wrap mode!)
 15 │ }                                             ← Real line 15 shifts cleanly down
```
- **Ghost Text Styling**: Theme-driven faded greyish foreground (`editorGhostText.foreground`, e.g., `#7c7c7c` / `rgba(fg, 0.45)`), optional italic styling, clearly distinguishable from real code and comments.
- **Touch Accept Strip**: On touch interactions when ghost text is active, a minimal unobtrusive action bar (`Accept · Word · 1/2 · Dismiss`) appears near the bottom/anchor without stealing textarea focus.

### E. Markdown `#` Sticky Scroll & Color Bullet Hover Guard
- **Markdown Sticky Scroll**: Scrolling past `# Architecture` → `## Tokenization` → `### Safety Limits` pins the active heading stack cleanly at the top with smooth VS Code push-up transitions, ignoring `#` characters inside fenced code blocks.
- **Color Bullet Default**: Scrolling past CSS/HTML color swatches on mobile never flashes a color palette. Only explicit tap/click opens the picker unless `colorDecoratorsOpenOnHover: true` is configured.

---

## 3. Key Product Decisions & Trade-Offs

- **Unified Inline Virtual Text Layout (Ghost Text + Inlay Hints + Color Swatches)**
  - *Chosen Approach*: Introduce a single pure layout mapping layer (`InlineDecorationLayout`) that computes visual segments and X-offsets for a line containing real text, color swatches, inlay hints, and inline ghost text, plus virtual continuation rows in `ViewLineProjection` for multiline/wrapped ghost text.
  - *Why*: Keeping caret positioning, tap-to-column hit testing, selection highlight rectangles, word wrap, and canvas rendering driven by **one** shared coordinate system prevents off-by-one cursor bugs when inlay hints or ghost text appear mid-line.
  - *Alternatives Considered*: Drawing ghost text or inlay hints as ad-hoc DOM overlays — rejected because DOM overlays drift during 60fps canvas scroll, break word wrap, and cannot insert real vertical gaps between canvas lines.
- **Dual Ghost Text API (LSP Provider + Imperative Plugin API)**
  - *Chosen Approach*: Support both Monaco-standard `languages.registerInlineCompletionsProvider` (automatic/explicit AI completions) and direct `editor.setGhostTexts(items)` / `clearGhostTexts(owner)` for multi-anchor, arbitrary-position ghost text.
  - *Why*: Future Copilot/Codex plugins, multi-hunk AI edit previews, and custom domain assistants often need to place ghost text at arbitrary lines/columns (not just the active caret) or stream tokens incrementally.
- **Semantic Tokens as an Additive Overlay**
  - *Chosen Approach*: Keep Mono's fast O(1) Monarch tokenizer for instant first-frame paint, and layer `DocumentSemanticTokensProvider` / `DocumentRangeSemanticTokensProvider` results asynchronously as a sparse per-line override cache.
  - *Why*: Guarantees zero typing latency on mobile while delivering full LSP semantic precision (readonly constants, deprecated strikethrough, parameter vs property distinction) once the language server responds.
- **Mobile-First LSP Pruning**
  - *Chosen Approach*: Implement all 20 high-value mobile/touch & universal LSP providers, while omitting desktop-only drag-and-drop (`DocumentDropEditProvider`), experimental rename AI (`NewSymbolNamesProvider`), and heavy hierarchy sidebars.
  - *Why*: Keeps core bundle lean, memory low, and API surface focused on real mobile + web coding workflows.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Module Boundaries

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Public API Layer (editor.* / languages.* / MonoEditor <= 400 lines)    │
│  - New LSP registrations (InlineCompletions, InlayHints, Symbols,       │
│    DocHighlight, SelectionRange, OnTypeFormat, SemanticTokens, Links,   │
│    TypeDef/Impl/Decl, PasteEdit)                                        │
│  - Direct Ghost Text API: setGhostTexts / clearGhostTexts / accept*     │
│  - Options: colorDecoratorsOpenOnHover (false), hover, inlayHints,      │
│    inlineSuggest, semanticHighlighting                                  │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
┌───────────────────┐     ┌───────────────────────┐   ┌─────────────────────────┐
│ Pure Core (common)│     │ Canvas Render & View  │   │ Modular Contrib Plugins │
│ (100% DOM-free)   │     │ (browser)             │   │ (each <= 350 lines)     │
│                   │     │                       │   │                         │
│ • VirtualLine     │────▶│ • FrameContext        │◀──│ • InlineSuggest         │
│   Projection      │     │   (virtual rows +     │   │   (Provider + Direct    │
│   (folds + wrap + │     │    inline X shifts)   │   │    Ghost Text + Bar)    │
│    ghost rows)    │     │ • textPass            │   │ • InlayHints            │
│ • InlineVirtual   │     │   (tokens + semantic  │   │   (viewport fetch +     │
│   Layout          │     │    override + inlay   │   │    click/tooltip)       │
│   (swatches +     │     │    chips + ghost run) │   │ • Hover (Unified Card)  │
│    inlay + ghost) │     │ • highlightsPass      │   │   (Diag + Syntax +      │
│ • StickyScroll    │     │   (docHighlights +    │   │    Actions + Sticky)    │
│   (Indent + MD #  │     │    hoverRange + links)│   │ • SignatureHelp         │
│    + Outline)     │     │ • gutterPass          │   │   (Live param tracking  │
│ • SemanticTokens  │     │   (blank gutter on    │   │    + syntax highlight)  │
│   Decoder/Cache   │     │    virtual ghost rows)│   │ • ColorDecorator        │
│ • LanguageFeature │     │                       │   │   (tap default + opt-in │
│   Registry        │     │                       │   │    hover dwell)         │
│                   │     │                       │   │ • DocHighlight / Links /│
│                   │     │                       │   │   Symbols / SelRange /  │
│                   │     │                       │   │   OnTypeFormat / Paste  │
└───────────────────┘     └───────────────────────┘   └─────────────────────────┘
```

### Key Data Models & Modular Decomposition
- **Strict File-Size & Layer Discipline**: Every new module stays compact (`150–350` lines), respects the architecture guard (`common/` strictly DOM-free, zero cycles, zero raw `innerHTML`, `MonoEditor.ts <= 400` lines, every file `<= 600` lines), and separates pure state/layout math in `common/` from DOM/canvas widgets in `contrib/` and `browser/`.
- **Ghost Text State Model (`GhostTextItem`)**:
  - `{ id, owner, lineNumber, column, text, range?, filterText?, command?, kind?: 'completion' | 'preview' | 'hint', priority? }`
  - Splits `text` into `firstLine` (rendered inline at `(lineNumber, column)`) and `extraLines[]` (projected as virtual visual rows immediately beneath `lineNumber` with `isVirtualGhost: true` and `wrapWidthPx`-aware line wrapping).
  - Supports **any number of simultaneous ghost anchors across any lines/columns**; automatically tracks/remaps or clears anchors on edits according to item policy (`autoClearOnEdit` vs persistent plugin preview).
- **Inlay Hint State Model**:
  - Viewport-debounced fetch (`provideInlayHints(model, visibleRange, token)`) cached per line; each hint specifies `{ position, label: string | InlayHintLabelPart[], kind?: Type | Parameter, paddingLeft?, paddingRight?, tooltip? }`.
  - Contributes deterministic pixel advance to `InlineVirtualLayout` so text rendering, caret X, and tap hit-testing all stay exact.
- **Sticky Scroll Scope Providers**:
  - Pluggable scope strategy: `outlineModel` (from `DocumentSymbolProvider` when registered) → **Markdown Heading Scope Finder** (for `markdown` language, respecting `#`..`######` nesting and ignoring fenced code blocks) → `IndentScopeFinder` fallback.
- **Semantic Tokens Layer**:
  - Decodes standard LSP 5-integer relative deltas (`deltaLine, deltaStartChar, length, tokenType, tokenModifiers`) against provider `SemanticTokensLegend`, maps to Mono token types + font-style modifiers (`italic`, `bold`, `strikethrough`), and overlays cleanly on top of Monarch tokens during `textPass`.

### Interactive Component & State Flows
1. **Color Bullet Interaction**: Tap on swatch → `ColorDecoratorController.onColorSwatchClick` opens `ColorPickerWidget`. Mouse move over swatch → checked against `colorDecoratorsOpenOnHover`; when `false` (default), ignored completely; when `true`, schedules dwell timer cancelled on scroll/leave/touch.
2. **Hover Docs Lifecycle**: Tap/command (`Ctrl+K Ctrl+I`) or desktop dwell → fetches both overlapping `MarkerService` diagnostics AND `HoverProvider` contents + `CodeActionProvider` quick fixes → renders unified syntax-highlighted card anchored to `hover.range` → hovering over card freezes dismiss timer; scroll/edit/outside tap hides card and clears range highlight.
3. **Live Signature Help Lifecycle**: Typing `(`, `,`, or moving caret horizontally inside an open call → walks balanced parentheses backwards (across multiple lines) to compute active call context & argument index → queries `SignatureHelpProvider` → syntax-highlights signature with active parameter emphasized → `ArrowUp`/`ArrowDown` or touch buttons cycle overloads without losing editor focus.
4. **Ghost Text Plugin Lifecycle**: Typing triggers debounced `InlineCompletionsProvider` (or a plugin calls `editor.setGhostTexts(...)`) → `ViewLineProjection` inserts wrapped inline + virtual vertical gap rows → canvas paints faded greyish ghost text with blank gutter numbers → `Tab` / touch `Accept` applies edit as a clean undo step; `Ctrl+Right` / `Word` accepts next word and advances remaining ghost text; `Alt+]`/`Alt+[` cycles items; `Escape` dismisses.
5. **Verification Plan**: Automated unit & integration tests (all pure `common/` projection/layout/sticky/semantic-token/ghost-text math + Node DOM widget tests for Hover, Signature Help, Color hover-off default, and LSP providers), Playground interactive demos (Ghost Text Copilot simulator, Inlay Hints, Hover Docs, Live Signature Help, Markdown Sticky Scroll, Color hover toggle), architecture guard, TypeScript check, and production build verification.
