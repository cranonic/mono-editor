# Mono Editor — Post-Phase 5 Roadmap

Phase 5 (5-layer Monaco-style architecture refactor) is **complete**. All subsequent phases build cleanly on `src/{common,platform,browser,contrib,api}` without modifying the core composition root.

```
Phase 5  Architecture refactor (DONE)     ──►  Unlocks parallel development across layers
Phase 6  Editing & cursor parity           ┐
Phase 7  Display, view API & widgets       ├─ Can proceed in parallel in separate folders
Phase 8  Language intelligence completion  ┘
Phase 9  Scale & performance (Piece-tree, Worker tokenizer)
Phase 10 Diff editor (inline + side-by-side)
Phase 11 Mobile excellence, accessibility & split npm packaging
```

---

## Phase 6 — Editing & Cursor Parity (`src/common/cursor/`, `src/common/editOperations/`)
- **Cursor & selection**: Column/box selection (`Alt+Shift+drag`), expand/shrink selection (`registerSelectionRangeProvider`), `cursorSurroundingLines`, cursor styles (`line/block/underline/thin`) & blink animations, cursor-state undo (`Ctrl+U`), `stickyTabStops`.
- **Text transforms**: Join lines, sort lines asc/desc, transpose letters, delete duplicate lines, case transforms (`upper/lower/title/snake/camel/kebab`), trim trailing whitespace, convert indentation (`tabs ↔ spaces`), `detectIndentation`.
- **Clipboard & DnD**: `emptySelectionClipboard`, multi-cursor per-line paste, `formatOnPaste`, text drag-and-drop.
- **Smart editing**: Auto-close/auto-rename HTML & JSX tags, linked editing ranges, Emmet expansion, Go to Line (`Ctrl+G`) widget.
- **Model & Decoration parity**: Granular `onDidChangeContent` deltas, `pushEditOperations(cursorStateComputer)`, `TrackedRangeStickiness`, `before`/`after` inline decoration content.

## Phase 7 — Display, View API & Widgets (`src/browser/render/passes/`, `src/browser/view/`)
- **Render passes**: `renderWhitespace`, `renderControlCharacters`, vertical `rulers`, `renderLineHighlight` modes, relative/interval/custom line numbers, Unicode invisible/ambiguous highlight, RTL/bidi lines, bracket-pair colorization & guides.
- **Gutter & rulers**: Glyph margin (`glyphMarginClassName` for breakpoints/run icons), full overview ruler (diagnostics, find, selection, git diff).
- **Public view API**: `addContentWidget`, `addOverlayWidget`, `changeViewZones`, `onMouseDown/Move/Up/Leave`, `getTargetAtClientPoint`, `getVisibleRanges`, `getLayoutInfo`, `automaticLayout` (`ResizeObserver`), `createContextKey`.
- **Inline UI**: Inlay hints, CodeLens (via view zones), inline Error Lens, `MarkerTag` (`unnecessary` fade, `deprecated` strikethrough).

## Phase 8 — Language Intelligence Completion (`src/common/languages/`, `src/contrib/`)
- **Providers**: Document symbols (Outline / Breadcrumbs / Go to Symbol `Ctrl+Shift+O`), document highlights, clickable links, on-type formatting, semantic tokens, inline completions (AI ghost text + Tab accept), type/implementation/declaration navigation.
- **Peek & Hover**: Peek Definition (`Alt+F12`), merged multi-provider hovers, sticky hover, `prepareRename` + rename preview, organize imports / source actions.
- **Tokenization**: Optional TextMate (`vscode-textmate` + Oniguruma WASM) or Tree-sitter WASM backend, embedded language scopes, additional grammars (Rust, Go, Kotlin, Swift, PHP, Ruby, C#, Dart, XML, TOML, Gradle, Dockerfile).
- **LSP bridge**: Separate `@mono/lsp-client` package kept outside `common/` and `browser/`.

## Phase 9 — Scale & Performance (`src/common/model/`, Workers)
- **Piece-tree / rope `TextModel`**: Target opening 50 MB / 1M lines in `< 1.5s` with `< 8ms` edit latency behind the existing `TextModel` interface.
- **Worker tokenization**: Viewport-first tokenization with background time-slicing and `maxTokenizationLineLength`.
- **Long-line & rendering optimizations**: `stopRenderingLineAfter`, chunked wrap cache, static text vs overlay canvas layers, dirty-rect repaint, zero per-frame allocations.
- **Incremental structures**: Incremental indent-scope & folding updates, async cancellable Find in large files, auto large-file mode.

## Phase 10 — Diff Editor
- `editor.createDiffEditor` & `IDiffEditor` with Myers/histogram line diff + inline char-level diff in a Worker.
- Side-by-side on wide screens, auto-inline on narrow mobile screens, synchronized scroll, hunk revert controls, collapse unchanged regions, `F7`/`Shift+F7` navigation.

## Phase 11 — Mobile Excellence, Accessibility & Packaging
- **Mobile**: `visualViewport` soft-keyboard inset handling, quick-keyboard modifier bar, selection loupe, pinch-zoom, IME compatibility matrix (Gboard, SwiftKey, Samsung, Bengali Avro/Ridmik, Hindi, CJK).
- **Accessibility**: ARIA roles (`textbox`, `aria-multiline`, `aria-activedescendant`), TalkBack/screen-reader mode, `tabFocusMode`, high-contrast & reduced-motion support.
- **Packaging**: Split packages (`@mono/editor-core`, `@mono/editor`, `@mono/editor-react`), lazy language chunks, ESM + CJS + `.d.ts`, API docs, and Mono Studio app hook migration.
