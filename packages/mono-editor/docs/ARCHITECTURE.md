# Mono Editor Architecture

Mono Editor follows a strict, Monaco-inspired **5-layer architecture** inside `src/` so that pure text/model/language logic is 100% DOM-free, rendering is a composable pass pipeline, and optional IDE features live in isolated contributions.

---

## 1. Layer Stack & Dependency Rules

```
                  ┌──────────────────────────────────────┐
                  │  src/api/   (Public Façade & Types)  │
                  │  + src/index.ts, src/react/          │
                  └──────────────────┬───────────────────┘
                                     │
                  ┌──────────────────▼───────────────────┐
                  │  src/contrib/ (13 Optional Features) │
                  │  IEditorContribution — no cross-     │
                  │  contrib imports, no contrib -> api  │
                  └──────────────────┬───────────────────┘
                                     │
                  ┌──────────────────▼───────────────────┐
                  │  src/browser/ (DOM & Canvas Engine)  │
                  │  editor/ · view/ · render/ · input/  │
                  └──────────────────┬───────────────────┘
                                     │
                  ┌──────────────────▼───────────────────┐
                  │  src/platform/ (Commands, Keys,      │
                  │  Palette, Theme, Icons, Haptic)      │
                  └──────────────────┬───────────────────┘
                                     │
                  ┌──────────────────▼───────────────────┐
                  │  src/common/ (100% DOM-Free Core)    │
                  │  core/ · model/ · decorations/ ·     │
                  │  cursor/ · editOperations/ ·         │
                  │  languages/ · color/ · viewModel/    │
                  └──────────────────────────────────────┘
```

### Enforced Dependency Matrix

| Layer | Allowed Imports | Forbidden |
|---|---|---|
| `src/common/` | `common/` only | `platform/`, `browser/`, `contrib/`, `api/`, any DOM globals (`window`, `document`, `HTMLElement`, `CanvasRenderingContext2D`, `KeyboardEvent`, etc.) |
| `src/platform/` | `common/`, `platform/` | `browser/`, `contrib/`, `api/` |
| `src/browser/` | `common/`, `platform/`, `browser/` | `contrib/`, `api/` |
| `src/contrib/<feat>/` | `common/`, `platform/`, `browser/`, own `<feat>/` | Other `contrib/<other>/` folders, `api/` |
| `src/api/` | `common/`, `platform/`, `browser/`, `contrib/`, `api/` | Nothing else in `src/` may import `api/` (only `src/index.ts` and `src/react/` may) |

All rules—plus zero circular imports, zero raw `innerHTML`, and per-file size budgets (`≤ 600` lines for logic files, `≤ 400` lines for `src/browser/editor/MonoEditor.ts`, `≤ 80` lines for `CanvasRenderer.paint()`)—are enforced automatically by:

```bash
npm run check:arch
```

---

## 2. Module Map

### `src/common/` — Pure DOM-Free Core (Node & Worker Ready)
- `core/` — Value objects (`Position`, `Range`, `Selection`, `Uri`, `SelectionState`, `KeyCode`/`KeyMod`, `EndOfLineSequence`, `SelectionDirection`, `MonoDisposable`).
- `model/` — `TextModel` (incremental line-splice buffer, CRLF/LF preservation, version & alternative version IDs), `EditStack` (word-level undo grouping + transactions), `modelRegistry`.
- `decorations/` — `DecorationsCollection` and `MarkerService` (diagnostics per URI/owner).
- `config/` — `editorOptions.ts` (defaults, gutter & typography metrics), `themeTypes.ts`, `menuTypes.ts`.
- `cursor/` — `cursorMotion.ts` (word/line/document navigation, multi-cursor helpers).
- `editOperations/` — `EditOperations.ts` (toggle comment, move/duplicate/delete/insert lines), `typeOperations.ts` (auto-close, overtype, auto-surround, pair backspace), `indentOperations.ts`, `CodeFeatures.ts` (bracket match, visible occurrences, indent guides), `SnippetSession.ts` (TextMate snippet parser & placeholder navigation).
- `languages/` — `TokenizationSupport` (lazy/incremental per-line tokenizer), `createRegexTokensProvider`, 12 built-in language tokenizers (`defaults/`), 12 language configurations (`configurations/`), `onEnterEngine.ts`, `languageFeaturesService.ts` + `providers/types.ts` (LSP-aligned provider registries).
- `color/` — Built-in color literal detection (`hex`, `rgb/rgba`, `hsl/hsla`, CSS named colors), embedded `<style>`/`<script>` scope detection, rule evaluation, and color formatting.
- `viewModel/` — `FoldingModel` (indent + `#region` folding), `ViewLineProjection` (visual ↔ model line mapping combining folding + grapheme word-wrap), `StickyScroll` (indent-scope sticky header calculation pinned at `y = 0`).
- `util/` — `grapheme.ts` (`Intl.Segmenter` grapheme boundaries for Bengali/Hindi/emoji conjuncts).

### `src/platform/` — Cross-Cutting Services
- `commands/` — `CommandsRegistry`, `CommandService`, `ContextKeyService`, `MonoCommands` (32 command IDs).
- `keybindings/` — `KeybindingService` (keyboard chord matching + context expressions).
- `palette/` — `PaletteService` (command palette query & execution).
- `theme/` — `MonoThemeService`, `widgetTheme.ts` (resolved CSS vars + softened dynamic caret/teardrop colors), `mapTokens.ts`, and 5 built-in themes (`mscode-dark`, `mscode-light`, `mscode-amoled`, `solarized-dark`, `solarized-light`).
- `icons/` — Local bundled `codicon.ttf` + `codicon.css` + extra SVG registry.
- `haptic/` — Touch vibration and press feedback helpers.

### `src/browser/` — DOM & Canvas Engine
- `editor/` — Composition root (`MonoEditor.ts` < 400 lines), `editorBootstrap.ts`, `editorContributions.ts` (contribution registry), `editorEvents.ts`, `editorLifecycle.ts`, `modelController.ts`, `cursorApi.ts`, `defaultKeybindings.ts`, `editorTypes.ts`.
- `render/` — `CanvasRenderer.ts` orchestrating 7 composable passes sharing a single `FrameContext`:
  1. `backgroundPass` — editor background, active line highlight, indent guides, fold ranges
  2. `highlightsPass` — selection, occurrences, find matches, bracket matches, whole-line decorations
  3. `textPass` — syntax-highlighted runs, inline color swatches, IME composition underline
  4. `decorationsAndCaretsPass` — diagnostic squiggles, inline decorations, primary & secondary carets
  5. `gutterPass` — compact dynamic line-number gutter + fold chevrons
  6. `stickyPass` — sticky scroll header pinned at `y = 0` above content
  7. `teardropsPass` — mobile touch selection teardrop handles
  Also contains `textLayout.ts` (grapheme-aware hit-test & X-measurement cache) and `markdownDom.ts` (CSP-safe Markdown → DOM builder).
- `view/` — `ViewController.ts` (scroll viewport, dirty-frame rAF loop, top-inset coordination), `hitTest.ts`, `viewLayout.ts`, `stickyScrollController.ts`, and `viewParts/` (`OverlayScrollbar`, `MinimapController`, `HandleVisibility`).
- `input/` — `InputController.ts` (hidden `<textarea>` bridge), `textAreaBridge.ts`, `keyboardHandler.ts`, `compositionHandler.ts` (IME), and `pointer/` (`PointerController`, `teardropHandles`, `touchScroll` with axis-locked momentum fling).

### `src/contrib/` — 13 Isolated Optional Contributions
Every feature implements `IEditorContribution` (defined in `src/browser/editor/editorTypes.ts`) and registers via `registerEditorContribution()` in `src/contrib/index.ts`:
1. `contextMenu` — Floating touch/desktop context menu
2. `suggest` — Autocomplete popup + details pane + fuzzy filter
3. `signatureHelp` — Parameter hints popup
4. `rename` — Inline symbol rename widget
5. `referencesPeek` — VS Code-style split Peek References view (live-synced nested `MonoEditor` + reference list)
6. `colorPicker` — Inline color swatches + Monaco-style HSV/alpha color picker
7. `hover` — Token & diagnostic hover popup
8. `find` — Find & Replace bar (reports height to `ViewController.topInsetPx`)
9. `folding` — Gutter fold toggle & fold commands
10. `multiCursor` — `Ctrl+D`, `Ctrl+Shift+L`, vertical cursor insertion
11. `format` — Document & selection formatting commands
12. `definition` — Go to Definition (`F12`)
13. `codeAction` — Lightbulb widget & Quick Fix menu

### `src/api/` — Public Façade
- `types/` — Cleanly split public types (`theme.ts`, `options.ts`, `model.ts`, `events.ts`, `editor.ts`, `index.ts`).
- `editor.api.ts` — `editor.*` namespace (`create`, `createModel`, `getModel`, `getModels`, `defineTheme`, `setTheme`, `setModelMarkers`, `getModelMarkers`, `onDidChangeMarkers`, `setModelLanguage`, `getEditors`) and `createMonoEditor` (which triggers `registerBuiltInContributions()`).
- `languages.api.ts` — `languages.*` namespace (language & provider registration).
- `src/index.ts` — Single barrel re-exporting the entire public API surface.
- `src/react/MonoEditor.tsx` — React wrapper component.

---

## 3. Data & Rendering Flow

```
Pointer / Keyboard / IME Event
   │
   ▼
browser/input (InputController / PointerController)
   │  executes edits via TextModel / SelectionState / Commands
   ▼
common/model (TextModel + EditStack)
   │  updates lines, increments versionId, notifies listeners
   ▼
browser/editor (MonoEditor)
   ├── emits public events (onDidChangeModelContent, Cursor, Scroll)
   └── fans out lifecycle hooks to mounted IEditorContributions
   ▼
browser/view (ViewController) ──► schedules single rAF paint
   ▼
browser/render (CanvasRenderer.paint)
   └── builds FrameContext ──► runs 7 render passes ──► paints canvas + viewParts
```
