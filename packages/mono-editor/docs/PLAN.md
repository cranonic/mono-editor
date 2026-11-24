# Mono Editor — Architecture Refactor & Roadmap (Phase 5 → 11)

> Place at `packages/mono-editor/docs/PLAN.md`.
> Audited against `cranonic/mscode` `main` @ `7b3ce83` (all line counts below are from that commit).
> `docs/check.md` is **stale** (it still lists word navigation, PageUp/Down, goal column, folding, minimap … as ❌ although they exist). Treat this file + `MONO_WIRE_PLAN.md` as the source of truth; Phase 5 step 5.0 regenerates a truthful feature matrix.

---

## 0. TL;DR for the developer

1. **Phase 5 is a pure refactor.** Zero behaviour change, zero public-API change. Goal: split the giant files into a Monaco-style `common / browser / contrib / platform` layout so the editor stays maintainable for years.
2. **Phases 6–11 are features** (listed in §6), each only started after Phase 5's gates are green.
3. Every step is **small, reversible and test-gated** (§4). Never "big-bang" move everything in one commit.

---

## 1. Why this is needed (measured problems)

| Problem | Evidence (current `main`) |
|---|---|
| God class | `src/api/MonoEditor.ts` = **3,345 lines**. Constructor ≈ lines 179–706 (≈530 lines). `registerDefaultKeybindings` ≈ 2116–2513 (≈400). LSP commands (`runFormat…`, `runRevealDefinition`, `runFindReferences`, `runRenameSymbol`, `runQuickFix`, code-action lightbulb) ≈ 2797–3260 (≈460). Context-menu, colour-decorator, diagnostics-hover, folding API, multi-cursor helpers, view-state caching, event emitters are all in the same class. |
| One method paints everything | `src/render/CanvasRenderer.ts` (1,174 lines): `paint()` spans ≈ lines 221–1070 (**≈850-line single method**). |
| Input god-file | `src/input/InputController.ts` = 1,288 lines: IME, clipboard, auto-close/surround/overtype, Enter/indent, multi-cursor delete and a ≈310-line `onKeyDown` (979–1288) in one class. |
| Pointer god-file | `src/input/PointerController.ts` (746): tap/double-tap/long-press, fling, teardrop handles, auto-scroll, word-select; `onDown`≈150, `onUp`≈100 lines. |
| View god-file | `src/view/ViewController.ts` (828): option setters, scroll, viewZones, sticky, hit-testing, painting orchestration. |
| Data mixed with logic | `src/language/LanguageConfiguration.ts` (924): 12 language configs + registry + `evaluateOnEnter` in one file. `contrib/color/colorEngine.ts` (815), `contrib/suggest/SuggestWidget.ts` (828), `language/features.ts` (526). |
| No layering | `core/` imports from `api/` (`monoTypes.ts` imports `../api/types`), `api/MonoEditor.ts` imports everything. Nothing stops a DOM import inside "core". |
| Tests rely on internals | `tests/*.mts` contain 68 `as any` / bracket-access sites (many are DOM mocks, some reach private members such as `ed.view` / `ed.metrics()` in browser harnesses) → splitting classes can silently break them unless an explicit test-hook surface exists. Classify them in 5.0.3. |

Total today: **~24k lines in `src/`**.

---

## 2. Target structure (Monaco-style)

Monaco's rule: `common` has **no DOM**, `browser` is the view/input/widgets, `contrib` are optional features that plug in through a contribution registry, `standalone`/`api` is the public façade. Mono mirrors that:

```
packages/mono-editor/src/
├─ index.ts                       # public barrel ONLY (no logic)
├─ api/                           # PUBLIC surface (types + factories + namespaces)
│  ├─ index.ts
│  ├─ editor.api.ts               # editor.* namespace (createModel, create, setTheme, …)
│  ├─ languages.api.ts            # languages.* namespace (register*Provider, setLanguageConfiguration…)
│  └─ types/                      # types.ts split: options.ts, editor.ts, model.ts, events.ts, decorations.ts, commands.ts
│
├─ common/                        # DOM-FREE, runs in Node → unit-testable without a browser
│  ├─ core/                       # position, range, selection, uri, enums (SelectionDirection, EndOfLineSequence, KeyCode, KeyMod…)
│  ├─ model/                      # textModel, editStack, eol, modelRegistry, (later) pieceTree/
│  ├─ decorations/                # DecorationsCollection, MarkerService, types
│  ├─ cursor/                     # cursor state, cursorMotion (word/page/home/end/goal column), multiCursor
│  ├─ editOperations/             # typeOperations (auto-close/surround/overtype), onEnter, comments, lineOps, indent, snippetSession
│  ├─ languages/
│  │   ├─ languageRegistry.ts, languageConfigurationRegistry.ts, onEnterEngine.ts
│  │   ├─ configurations/         # ONE FILE PER LANGUAGE: javascript.ts, json.ts, css.ts, html.ts, java.ts, python.ts, markdown.ts, yaml.ts, shell.ts, sql.ts, cpp.ts, plaintext.ts
│  │   ├─ tokenization/           # tokenizationSupport, tokensProvider, createRegexTokensProvider, tokenTypes
│  │   ├─ providers/              # one file per provider kind: completion, hover, definition, references, rename, codeAction, formatting, signature, color, folding, …
│  │   └─ defaults/               # registerDefaults + per-language tokenizers
│  ├─ config/                     # editorOptions.ts: defaults + validate + diff (what changed) for updateOptions
│  ├─ viewModel/                  # viewLineProjection (fold+wrap), stickyScrollModel, indentScopeFinder, foldingModel
│  └─ util/                       # event emitter, disposable, async (debounce/cancellation), strings, colour parsing
│
├─ browser/                       # DOM / canvas
│  ├─ editor/
│  │   ├─ monoEditor.ts           # COMPOSITION ROOT ONLY (≤400 lines): builds services, registers contributions, exposes IMonoEditor
│  │   ├─ editorContributions.ts  # registerEditorContribution(), IEditorContribution { id; dispose() }
│  │   ├─ modelController.ts      # setModel, per-URI view-state cache, content/model events
│  │   ├─ cursorApi.ts            # get/setPosition/Selection(s), reveal*, scroll get/set
│  │   ├─ editorEvents.ts         # onDidChange*, focus/blur/scroll/cursor emitters
│  │   └─ defaultKeybindings.ts   # data table (was registerDefaultKeybindings)
│  ├─ view/
│  │   ├─ viewController.ts       # thin: owns layout + schedules paint
│  │   ├─ viewLayout.ts           # scrollHeight/Width, viewZones, insets (topInsetPx), clamp
│  │   ├─ scrollManager.ts        # touch/wheel scroll state, fling physics
│  │   ├─ hitTest.ts              # positionAtPoint, hitTestSticky, fold hits
│  │   └─ viewParts/              # scrollbars (overlayScrollbar), minimap, stickyScrollController, handleVisibility
│  ├─ render/
│  │   ├─ canvasRenderer.ts       # ≤150 lines: runs the pass pipeline
│  │   ├─ frameContext.ts         # metrics, theme, viewport, caches shared by passes
│  │   ├─ passes/                 # one file per pass (≤200 lines each):
│  │   │    background, currentLine, indentGuides, selection, findMatches, bracketMatch,
│  │   │    text (tokens), decorations/squiggles, colorBullets, gutter (numbers + fold chevrons),
│  │   │    sticky, caret, teardrops, composition
│  │   ├─ textLayout.ts           # grapheme-exact TextLayoutCache
│  │   └─ markdownDom.ts
│  ├─ input/
│  │   ├─ textAreaBridge.ts       # hidden textarea, focus/blur safety, applyFocus
│  │   ├─ compositionHandler.ts   # IME start/update/end
│  │   ├─ clipboardHandler.ts
│  │   ├─ keyboardHandler.ts      # keydown → keybinding service → command
│  │   └─ pointer/                # gestureRecognizer (tap/double/long-press), touchScroll+fling, teardropHandles, mouseSelection
│  └─ widgets/                    # generic DOM widget infra (themed, focus-safe, positioning)
│
├─ contrib/                       # each folder = controller + widget + model + tests; registers itself via registerEditorContribution
│  ├─ find/            ├─ suggest/ (controller, widget/{list,details,style}, model)
│  ├─ hover/           ├─ signatureHelp/   ├─ folding/       ├─ colorPicker/ (engine split: parse/format/names)
│  ├─ referencesPeek/  ├─ rename/          ├─ codeAction/    ├─ format/        ├─ definition/
│  ├─ markers/ (squiggles hover, lightbulb) ├─ contextMenu/  ├─ multiCursor/   ├─ snippets/
│  └─ comment/ lineOps/ (if kept as contributions instead of editOperations)
│
├─ platform/                      # services (singletons / DI-lite)
│  ├─ commands/ keybindings/ contextkey/ palette/ theme/ icons/ haptic/
│
└─ react/                         # optional React wrapper
```

### 2.1 Naming conventions (follow Monaco)
- `*Model` = data (no DOM) · `*Controller` = stateful orchestrator · `*Widget` = DOM UI · `*Service` = singleton in `platform/` · `*Provider` = language feature plug-in · `*Contribution` = optional editor feature · `*Pass` = canvas render step.
- **One exported class per file**, file name = class name in camelCase (`textModel.ts`, `findController.ts`). Keep the existing PascalCase if the team prefers — but be consistent; don't mix.
- No file named `utils.ts`/`helpers.ts`/`index.ts`-with-logic. `index.ts` = re-exports only.

### 2.2 Dependency rules (enforced in CI, §5)
```
common   →  (nothing; no DOM, no browser globals)
platform →  common
browser  →  common, platform
contrib  →  common, platform, browser/widgets (+ browser/editor public interfaces only)
api      →  everything (façade); nothing imports from api/ except index.ts and react/
```
- `contrib/*` must **not** import each other directly — communicate through services/events (e.g. suggest asks `languageFeaturesService`, not `contrib/hover`).
- `common/` must not reference `document`, `window`, `HTMLElement`, `Canvas*`. (Lets us later run model/tokenizer in a Worker — Phase 9.)

### 2.3 Size budgets
| Item | Soft | Hard (CI fails) |
|---|---|---|
| File (logic) | 400 lines | 600 |
| File (pure data: language configs, keybinding tables, colour names) | — | 900 |
| Function/method | 60 lines | 120 |
| `monoEditor.ts` (composition root) | 300 | 400 |
| `canvasRenderer.paint()` | 40 | 80 (it only runs passes) |

---

## 3. Where each current big file goes

| Current file (lines) | Split into |
|---|---|
| `api/MonoEditor.ts` (3,345) | **constructor/options** → `common/config/editorOptions.ts` + composition in `browser/editor/monoEditor.ts` · **model API & setModel/view-state** → `browser/editor/modelController.ts` · **position/selection/reveal/scroll API** → `browser/editor/cursorApi.ts` · **events** → `editorEvents.ts` · **registerDefaultKeybindings (≈400)** → `defaultKeybindings.ts` (data) · **multi-cursor helpers (≈110)** → `contrib/multiCursor/` · **context menu (≈110)** → `contrib/contextMenu/` · **colour decorators/picker glue (≈140)** → `contrib/colorPicker/colorDecoratorController.ts` · **diagnostics hover (≈30) + lightbulb** → `contrib/markers/` · **folding API (`foldAll`, `toggleFoldAtLine`…)** → `contrib/folding/foldingController.ts` · **Format / Definition / References / Rename / QuickFix (≈460)** → `contrib/format|definition|referencesPeek|rename|codeAction/` (one controller each) · **registerFindCommands** → `contrib/find/` · **applyAllWidgetThemes/setTheme** → `platform/theme/` |
| `render/CanvasRenderer.ts` (1,174) | `browser/render/canvasRenderer.ts` + `frameContext.ts` + `passes/*` (see tree). Teardrop/tip-caret drawing → `passes/teardrops.ts`. |
| `input/InputController.ts` (1,288) | `textAreaBridge.ts` (focus/blur, 286–357) · `compositionHandler.ts` (358–510) · `common/editOperations/typeOperations.ts` (auto-surround/overtype/pair-backspace 511–660) · `onInput` → `keyboardHandler`/`typeOperations` · indent/outdent/Enter (757–905) → `common/editOperations/{indent,onEnter}.ts` · multi-cursor delete → `common/cursor/` · `onKeyDown` (979–1288) → **table-driven** `keyboardHandler.ts` + `common/cursor/cursorMotion.ts` (word/page/home/end/goal column) |
| `input/PointerController.ts` (746) | `pointer/gestureRecognizer.ts` (tap/double/long-press) · `touchScroll.ts` (fling 318–405) · `teardropHandles.ts` (hitTeardrop, free-drag, edge pos) · `mouseSelection.ts` · `autoScroll.ts` |
| `view/ViewController.ts` (828) | `viewLayout.ts` (scroll sizes, viewZones, insets) · `hitTest.ts` · `stickyScrollController.ts` (layout, hit-test, reveal) · `viewController.ts` (rest) · option setters → driven by `editorOptions` diff |
| `language/LanguageConfiguration.ts` (924) | `languages/configurations/<lang>.ts` (12 files) + `languageConfigurationRegistry.ts` + `onEnterEngine.ts` |
| `language/features.ts` (526) | `languages/providers/<kind>.ts` + `languageFeaturesService.ts` |
| `core/monoTypes.ts` (680) | split into `common/core/{position,range,selection,uri,enums,keyCode}.ts` |
| `api/mono.ts` (396) | split into `api/editor.api.ts` + `api/languages.api.ts` |
| `contrib/suggest/SuggestWidget.ts` (828) | `widget/{suggestListView,suggestDetailsPane,suggestStyle,suggestPosition}.ts` |
| `contrib/color/colorEngine.ts` (815) | `colorParse.ts`, `colorFormat.ts`, `namedColors.ts` (data), `colorDecoratorRules.ts` |
| `contrib/lsp/LspWidgets.ts` (551), `ReferencesPeekView.ts` (542), `find/FindWidget.ts` (527) | one widget per file; peek view split header/list/embedded-editor |
| `api/types.ts` (317) | `api/types/*.ts` |
| tests (8 files, 4.4k lines) | mirror the new tree: `common/**/test/*.test.ts` (node), `browser/**/test/*.test.ts` (Chromium/Playwright); keep `phase*-mono` as **regression suites** until fully re-homed |

---

## 4. Phase 5 — Refactor, step by step (each step = its own commit/PR)

**Global rule for every step:** `tsc --noEmit` = 0 errors · all existing test suites pass · **API-surface snapshot unchanged** · playground smoke test OK · no behaviour change. If a step needs a behaviour change, stop and write it up separately.

### 5.0 Safety net (before moving anything)
1. Tag `pre-refactor` on `main`.
2. **API-surface snapshot test** (`tests/api-surface.test.mts`): dump (a) every export of `src/index.ts`, (b) all keys of `IMonoEditor`, `MonoEditorOptions`, `editor.*`, `languages.*`, (c) all registered command ids and default keybindings. Commit the JSON. Refactor PRs must not change it.
3. **Test hooks:** list every private member the tests/harness touch (`grep -nE "\(ed|editor\) as any|\['[a-z]+'\]"` in `tests/`), expose them through one explicit `@internal` object (`editor.__test`) so moving code doesn't silently break tests.
4. **Visual regression** (Playwright + Chromium, `deviceScaleFactor: 1`): screenshots of ~12 states (dark/light, selection, find open, sticky + find, folded block, suggest open, hover, references peek, minimap, word-wrap, color picker, 10-line vs 1000-line gutter). Pixel diff must be 0 (or ≤0.1% for AA) for pure-move steps.
5. **Perf baseline** script: paint ms for 10k/100k-line files, typing latency, scroll fling frame time, tokenization time. Save numbers; regressions >10% block the PR.
6. Regenerate a truthful **feature matrix** (`docs/FEATURES.md`) by auditing code; mark `docs/check.md` as archived.

### 5.1 Mechanical clean-up (no logic edits)
- Create folder skeleton + path aliases (`@common/*`, `@browser/*`, `@contrib/*`, `@platform/*`).
- `git mv` files to their new homes (keep history), fix imports only. **Fix the `core → api` import** (`monoTypes.ts` imports `../api/types`): move `IPosition/ISelection/IRange` to `common/core`.

### 5.2 Split pure data
- `LanguageConfiguration.ts` → 12 per-language files + registry + `onEnterEngine`. Behaviour identical (existing language tests prove it).
- `monoTypes.ts` → `common/core/*`. `colorEngine.ts` named-colour table → data file. `api/types.ts` → `api/types/*`.

### 5.3 Dismantle `MonoEditor.ts` (biggest win — do in this order, lowest risk first)
1. Keybinding table → `defaultKeybindings.ts`.
2. LSP commands (format/definition/references/rename/code action/lightbulb) → `contrib/*` controllers implementing `IEditorContribution`.
3. Colour decorators + picker glue → `contrib/colorPicker`.
4. Diagnostics hover + markers glue → `contrib/markers`.
5. Context menu → `contrib/contextMenu`. Folding API → `contrib/folding`. Find commands → `contrib/find`. Multi-cursor → `contrib/multiCursor`.
6. Events → `editorEvents.ts`. Model/view-state → `modelController.ts`. Cursor/reveal/scroll API → `cursorApi.ts`.
7. Options: `common/config/editorOptions.ts` = defaults + validation + **diff(oldOpts,newOpts) → changed keys**; `updateOptions` becomes "apply diff, notify subscribers" (each subsystem subscribes to the keys it cares about — kills the 100-line `if (options.x != null)` chain).
8. `monoEditor.ts` ends as composition root ≤ 400 lines. `IMonoEditor` public methods are thin delegators.

Pattern for contributions (Monaco-style):
```ts
export interface IEditorContribution { readonly id: string; dispose(): void; }
registerEditorContribution('mono.contrib.rename', RenameController);   // module side-effect-free: called from contrib/index.ts
// editor constructs: for (const [id, Ctor] of getContributions()) this.contribs.set(id, new Ctor(this, services))
editor.getContribution<RenameController>('mono.contrib.rename');
```
**Shared mutable state:** the old class shares fields between features. Before extracting a feature, move its fields into a small state object owned by that feature; if two features truly share state, expose it via a service or event — never via `editor as any`.

### 5.4 Renderer → pass pipeline
```ts
interface RenderPass { readonly name: string; paint(ctx: CanvasRenderingContext2D, f: FrameContext): void }
paint(f) { for (const p of this.passes) p.paint(this.ctx, f); }
```
Extract passes **in paint order**, one per commit, comparing screenshots after each. Per-frame allocations must not increase (check with perf baseline). Gutter metrics (`GUTTER_*`, `gutterNumberPad`) live in one `gutterLayout.ts` used by both renderer and `monoEditor.metrics()`.

### 5.5 Input/Pointer
- Extract `textAreaBridge` first (focus safety is subtle — see `InputController.applyFocus`/`onBlur`; keep behaviour byte-for-byte, add a test per scenario: suggest tap doesn't blur, find input keeps focus, Android synthetic blur).
- `onKeyDown` → table-driven (`Map<chord, handler>`) + `cursorMotion` pure functions on `(model, selection) → selection` (unit-testable in Node).
- Pointer: extract state machine `gestureRecognizer` with injected clock to test tap/double/long-press deterministically.

### 5.6 View + big widgets
`ViewController` → `viewLayout` + `hitTest` + `stickyScrollController`; `SuggestWidget`, `ReferencesPeekView`, `LspWidgets`, `FindWidget` split per sub-view.

### 5.7 Guard-rails in CI
- ESLint: `max-lines` (600) + `max-lines-per-function` (120) + `no-restricted-imports`/`import/no-restricted-paths` for the layering in §2.2 · `dependency-cruiser` (no cycles, forbidden edges) · `api-extractor` (or the snapshot test) · `tsc --noEmit` · test matrix: Node (common) + Chromium (browser) · bundle-size budget.
- Pre-commit: lint-staged + tests for touched area.

### 5.8 Docs
`docs/ARCHITECTURE.md` (layers, dependency rules, contribution pattern, render pipeline diagram), `docs/CONTRIBUTING.md` (naming, size budgets, how to add a language / provider / widget / contribution / render pass), `docs/FEATURES.md` (truthful matrix), `docs/ROADMAP.md` (this plan's Phases 6+), archive `check.md`. Each folder gets a 10-line `README.md` (what lives here, what may import it).

### Phase 5 Definition of Done
- [ ] No logic file > 600 lines; `monoEditor.ts` ≤ 400; `paint()` ≤ 80 lines.
- [ ] 0 import cycles; layering lint green; `common/` runs in Node with no DOM stub.
- [ ] API-surface snapshot, all existing test suites, visual-regression, perf baseline (±10%) all green.
- [ ] ARCHITECTURE/CONTRIBUTING/FEATURES docs written; new-feature "how to add" recipes tested by actually adding a toy contribution.

---

## 5. Prompt to give the developer (copy-paste)

```text
You are working on Mono Editor (packages/mono-editor in cranonic/mscode): a canvas-based,
from-scratch, Monaco-level code editor for Android/mobile-first IDEs.

TASK — Phase 5: structural refactor, ZERO behaviour change, ZERO public-API change.
Read first: packages/mono-editor/docs/PLAN.md (this plan), docs/MONO_WIRE_PLAN.md, and skim the
test suites in packages/mono-editor/tests.

Goal: split the oversized files into a Monaco-style layout (common / platform / browser / contrib / api)
so each file is ≤600 lines (monoEditor.ts ≤400, canvasRenderer.paint ≤80 lines) and layering is enforced:
common (no DOM) ← platform ← browser ← contrib ← api. Follow PLAN.md §2 (structure), §3 (file-by-file map),
§4 (ordered steps 5.0 → 5.8).

Hard rules
1. Work in tiny steps; one commit per step; after EVERY commit run: tsc --noEmit (0 errors), all tests,
   the API-surface snapshot test, the visual-regression suite and the perf baseline. Never commit red.
2. Pure moves first (git mv, fix imports only). Logic edits only when extracting; no "while I'm here" fixes —
   record bugs you find in docs/REFACTOR_NOTES.md instead.
3. Public API must not change: every export in src/index.ts, every IMonoEditor / MonoEditorOptions key,
   every command id and default keybinding stays identical (the snapshot test must pass untouched).
4. Replace god-class state sharing with small per-feature state objects / services / events. Do not use
   `editor as any` or reach into privates; tests use the explicit `editor.__test` hook.
5. Keep mobile behaviour byte-for-byte: focus/blur safety, IME composition, teardrop handles & fling,
   sticky scroll + Find inset math, gutter metrics, undo grouping, completion widget behaviour.
6. Add the CI guards from §5.7 (max-lines, layering lint, dependency-cruiser, API snapshot) BEFORE the big splits
   and keep them green.
7. If any step cannot be done without changing behaviour, STOP and report it with a proposal.

Deliverables: the refactor commits, docs/ARCHITECTURE.md, docs/CONTRIBUTING.md, docs/FEATURES.md (truthful),
updated docs/ROADMAP.md, and a short report: before/after file-size table, test results, perf numbers.
Do NOT start Phase 6+ features until Phase 5's Definition of Done is fully checked.
```

### Ideas to tell the developer verbally (the "why")
- "Think Monaco's `vs/editor/{common,browser,contrib,standalone}`: model & cursor logic has no DOM, so we can later run it in a Worker and test it in Node."
- "Features are **contributions**, not methods on one class. Adding a feature = new folder + `registerEditorContribution`, no edits to `monoEditor.ts`."
- "The renderer is a **pipeline of passes**; adding squiggles/whitespace/rulers = add a pass, don't touch other passes."
- "Options changes are **diffs** routed to the subsystems that subscribed — no giant `updateOptions` if-chain."
- "A refactor is only 'done' when screenshots are pixel-identical and the public API snapshot is unchanged."
- "Don't write new features during Phase 5. Write notes."

### Reviewer checklist per PR
- [ ] Diff is moves/extractions only (`git diff -M --stat` shows renames)  - [ ] no file > 600 lines  - [ ] layering lint green
- [ ] API snapshot + visual + perf unchanged  - [ ] no new `any`/private access  - [ ] touched folder has README

---

## 6. Remaining features — Phases 6 → 11

Legend: **[absent]** = no trace in `src/` (grep-verified on `7b3ce83`) · **[verify]** = may exist partially; Phase 5.0's audit must classify it before work starts. Items already ✅ in `MONO_WIRE_PLAN.md` (undo grouping, multi-cursor, folding, wrap, minimap, colour picker, suggest, hover, signature, references peek, rename, code actions, formatting, find/replace, sticky scroll, themes, CRLF, multi-model, IME) are not repeated.

### Phase 6 — Editing & cursor parity (daily-driver quality)
| Area | Features |
|---|---|
| Cursor & selection | Column/box selection (Alt+Shift+drag, touch two-finger) **[absent]** · Expand / shrink selection (`Shift+Alt+→/←`) + `registerSelectionRangeProvider` **[absent]** · `cursorSurroundingLines` **[absent]** · cursor style (line/block/underline/thin) + blinking (`blink/smooth/phase/expand/solid`) + smooth caret animation **[absent]** · `multiCursorModifier` option **[absent]** · Cursor-state undo (`Ctrl+U`) **[absent]** · `stickyTabStops` **[absent]** · Go to bracket / select to bracket **[verify]** |
| Text transforms | Join lines · Sort lines asc/desc · Transpose letters · Delete duplicate lines · Transform case (upper/lower/title/snake/camel/kebab) — all **[absent]** · Trim trailing whitespace + `trimAutoWhitespace` + insert final newline **[absent]** · Convert indentation (tabs↔spaces), `insertSpaces`, `detectIndentation` **[absent]** · Reindent lines · Delete word/line variants **[verify]** |
| Clipboard / DnD | `emptySelectionClipboard` (copy/cut whole line) · multi-cursor paste per line · `formatOnPaste` · text drag & drop (long-press-drag on mobile) · `dropIntoEditor` — **[absent]** |
| Smart editing | Auto-close & auto-rename HTML/JSX tags · Linked editing (`registerLinkedEditingRangeProvider`) · Emmet expand (logic exists in the app, no editor integration) · `tabCompletion` · `snippetSuggestions` ordering — **[absent]** |
| Navigation widgets | Go to Line (`Ctrl+G`) widget · Go to Symbol (`Ctrl+Shift+O`, needs Phase 8 symbols) · quick-open hook **[verify]** |
| Model API completeness | `getValueInRange`, `getLinesContent`, `getOffsetAt/getPositionAt`, `validatePosition/Range`, `getWordAtPosition/UntilPosition`, `getLineMaxColumn`, `findMatches/findNextMatch/findPreviousMatch`, `applyEdits` with undo-edits, `pushEditOperations(cursorStateComputer)`, model options (`getOptions/updateOptions`: tabSize, insertSpaces, defaultEOL, trimAutoWhitespace), `onWillDispose`, `onDidChangeContent` with granular `changes[]`, `onDidChangeLanguage/Options/Decorations`, `tokenization.getLineTokens/forceTokenization` **[verify each]** |
| Decorations | Full `IModelDecorationOptions`: `className`, `inlineClassName`, `isWholeLine`, `glyphMarginClassName`, `linesDecorationsClassName`, `hoverMessage`, `overviewRuler`, `minimap`, `before/after` inline content, `stickiness` (`TrackedRangeStickiness`), `createDecorationsCollection` **[verify — `decorations/` exists, completeness unknown]** |

### Phase 7 — Display, view API & widgets
| Area | Features |
|---|---|
| Rendering options | `renderWhitespace` (`none/boundary/selection/trailing/all`) · `renderControlCharacters` · `rulers` · `renderLineHighlight` (`none/gutter/line/all`) + `…OnlyWhenFocus` · line numbers `relative` / `interval` / function · `lineDecorationsWidth` · `padding.top/bottom` · font ligatures · `letterSpacing` · `fontWeight` / variations · Unicode highlight (ambiguous/invisible chars) · RTL/bidi lines — all **[absent]** |
| Guides & brackets | Bracket-pair colourisation · bracket-pair guides (vertical + horizontal) · `guides.*` option parity **[absent / verify]** |
| Gutter & rulers | Glyph margin + `glyphMarginClassName` decorations (breakpoints / run icons — needed by the debugger plugin) · full overview ruler (errors, warnings, find, selection, git) · minimap option parity (`renderCharacters`, `maxColumn`, `scale`, `showSlider`, `side`) **[verify]** |
| Scrolling | Smooth scrolling · `fastScrollSensitivity`, `mouseWheelScrollSensitivity`, `scrollPredominantAxis` · pinch-zoom / `mouseWheelZoom` · horizontal caret-follow + `scrollLeft` max clamp **[verify]** · `scrollbar.alwaysConsumeMouseWheel` |
| Sticky / folding options | Sticky: `maxLineCount`, `scrollWithEditor`, `defaultModel` · Folding: `foldingStrategy`, `showFoldingControls` (`always/mouseover/never`), `foldingHighlight`, `foldingImportsByDefault`, `unfoldOnClickAfterEndOfLine`, **fold-state persistence** **[verify]** |
| Public view API (Monaco parity) | `addContentWidget` / `addOverlayWidget` / `changeViewZones` · `onMouseDown/Move/Up/Leave`, `onKeyDown/Up` · `getTargetAtClientPoint` · `getScrolledVisiblePosition` · `getVisibleRanges` · `getLayoutInfo` · `getContentHeight/Width` · `getTopForLineNumber/Position` · `onDidLayoutChange`, `onDidContentSizeChange` · `automaticLayout` (ResizeObserver) · `remeasureFonts` · `createContextKey` — all **[absent]** |
| Inline UI | Inline decorations (before/after text) · **inlay hints** rendering · **code lens** rendering (view zones) · inline Error Lens · `MarkerTag` (unnecessary → fade, deprecated → strike-through) **[absent]** |
| Themes | Complete `editor.*` colour-key coverage · high-contrast themes · TextMate-scope → token colour mapping parity **[verify]** |

### Phase 8 — Language intelligence completion
| Area | Features |
|---|---|
| Providers | `registerDocumentSymbolProvider` + **Outline / Breadcrumbs / Go to Symbol** · `registerDocumentHighlightProvider` · `registerLinkProvider` (clickable URLs, `Ctrl/Tap`) · `registerSelectionRangeProvider` · `registerOnTypeFormattingEditProvider` + `formatOnType/Paste/Save` · `registerInlayHintsProvider` · `registerCodeLensProvider` · `registerDocumentSemanticTokensProvider` (+ range, legend) · `registerInlineCompletionsItemProvider` (ghost text, Tab accept, partial accept — for AI completion) · `registerLinkedEditingRangeProvider` · `registerTypeDefinition/Implementation/Declaration` providers · workspace symbols · inline values (debugger) — all **[absent]** |
| Suggest polish | `wordBasedSuggestions` · `suggestSelection` (`recentlyUsed`) · `acceptSuggestionOnEnter/CommitCharacter` · `filterGraceful` / fuzzy scoring parity · `preselect`, `sortText`, `filterText` · `insertTextRules` (`InsertAsSnippet`, `KeepWhitespace`) · status bar / inline details · typing-time filtering of the open list **[verify]** |
| Hover / peek | Merge multiple hover providers · hover with diagnostic quick-fix actions · sticky hover · `hover.delay/above` · `Ctrl+K Ctrl+I` · **Peek Definition** (`Alt+F12`, inline like references peek) · Ctrl-hover underline link · Go to Implementation |
| Rename / actions | `prepareRename`, rename preview · source actions (organize imports) · `codeActionsOnSave` · Refactor menu · auto-fix |
| Tokenization | **TextMate grammar** (vscode-textmate + Oniguruma-WASM) or **tree-sitter WASM** · embedded languages (HTML `<script>/<style>`, Markdown fenced code, template literals, JSX/Vue) · semantic-token overlay · more languages: Rust, Go, Kotlin, Swift, PHP, Ruby, C#, Dart, Lua, XML, TOML, Gradle, Dockerfile, `.properties`, **Smali / AndroidManifest / layout XML** (Android-IDE relevant) |
| LSP bridge | Separate package `@mono/lsp-client`: incremental `didChange` from `TextModel` changes, diagnostics → `setModelMarkers`, cancellation tokens, debounce, request queue, reconnection; keep it out of `common/`/`browser/` so the editor stays LSP-agnostic |
| Diagnostics | `MarkerSeverity`/related information, markers → overview ruler & minimap, Problems-panel event API, `onDidChangeMarkers` per owner **[verify]** |

### Phase 9 — Scale & performance
| Area | Features / targets |
|---|---|
| Text buffer | **Piece-tree / rope** `TextModel` (keep current API) — targets: open 50 MB / 1 M lines < 1.5 s on a mid-range Android, edit latency < 8 ms, bounded memory · undo stack compaction + byte limit |
| Tokenization | Move tokenizer to a **Web Worker** (viewport-first, then background by time-slice) · `maxTokenizationLineLength` · token-cache invalidation by line range |
| Long lines | Minified 1 MB single-line files: render clipping (`stopRenderingLineAfter`), chunked wrap cache, no O(n²) hit-testing |
| Rendering | Line-render cache / glyph (text-run) atlas · static text layer vs overlay layer (caret/selection) · dirty-rect repaint · optional `OffscreenCanvas` worker · zero per-frame allocation in hot paths · frame-budget instrumentation (`performance.measure`) |
| Incremental structures | Incremental indent-scope cache (currently full invalidate) · incremental folding model · incremental `ViewLineProjection` for word-wrap · async, cancellable **Find in huge files** (chunked) |
| Large-file mode | Auto-disable minimap / folding / occurrences / bracket colourisation / sticky above thresholds · streamed/chunked file open · read-only huge-log viewer |
| Persistence | Hot-exit snapshot (content + view state), dirty tracking via `getAlternativeVersionId` **[verify]** |
| CI | Perf benchmarks in CI with regression thresholds |

### Phase 10 — Diff editor
- `editor.createDiffEditor` + `IDiffEditor` (`getOriginalEditor/getModifiedEditor`, `onDidUpdateDiff`, `getLineChanges`, `getDiffComputationResult`) — currently **[absent]**.
- Line diff (Myers/histogram) + inline char-level diff, in a Worker · `ignoreTrimWhitespace`, `renderSideBySide`, **auto-inline on narrow phone widths** · synchronized scroll · revert-hunk gutter arrows · collapse unchanged regions · next/prev change (`F7`/`Shift+F7`) · overview ruler · moved-block detection (optional) · 3-way merge editor (stretch).

### Phase 11 — Mobile excellence, accessibility, packaging
| Area | Features |
|---|---|
| Mobile | Soft-keyboard resize / caret kept above keyboard (`visualViewport`) · **quick-keyboard bar** (Ctrl/Alt/Tab/arrows modifier bridge) · selection magnifier (loupe) · pinch-zoom · touch drag-and-drop text · tablet / DeX mouse + stylus polish · **IME matrix test**: Gboard, SwiftKey, Samsung, Bengali (Avro/Ridmik), Hindi, CJK, voice typing, predictive text, swipe typing · emoji/ZWJ/grapheme edge cases · clipboard permission handling |
| Accessibility | ARIA roles (`textbox`, `aria-multiline`, `aria-activedescendant` for suggest) · **screen-reader mode** (TalkBack) with `accessibilitySupport` / `accessibilityPageSize`, line/col announcements · `tabFocusMode` · high-contrast & reduced-motion · keyboard-only operation of every widget |
| Packaging | Split packages: `@mono/editor-core` (`common`), `@mono/editor` (`browser`+`contrib`), `@mono/editor-react`, lazy language chunks · ESM + CJS + `.d.ts` · tree-shaking (`sideEffects`) · generated API docs (typedoc) + `api-extractor` report · semver/changelog · CSP-safe (no `innerHTML`, audit) · i18n of widget strings · example playground & docs site |
| App integration (parallel track, Mono Studio repo) | Verify status of the Monaco-dependent hooks listed in `check.md §13` (`useLspSync`, `useEditorSave`, `useAutoSaveAndBackup`, `useViewStateSync`, `useDiagnosticPopup`, `useBreadcrumbs`, `EditorScrollbar`, `DiffEditor`, `snippetRegistry`, `formattersAPI`, `diagnosticsAPI`, `getActiveMonacoEditor`) and port each to the Mono API; remove Monaco shims. |

---

## 7. Suggested order & ownership

```
Phase 5  Refactor (blocking)            ──►  everything else
Phase 6  Editing parity                  ┐
Phase 7  Display + view API              ├─ can be parallel after 5 (different folders now!)
Phase 8  Language intelligence           ┘  (needs Phase 7 widgets/inlay/codelens + Phase 6 decorations API)
Phase 9  Scale/perf                      ──► start spike (piece tree) in parallel with 6–8 behind the same TextModel interface
Phase 10 Diff editor                     ──► after 7 (view API) and 9 (worker diff)
Phase 11 Mobile/a11y/packaging           ──► continuous; release hardening at the end
```
With the Phase-5 layout, two developers can work in parallel without merge conflicts: one in `common/`+`contrib/`, one in `browser/render`+`browser/input`.

## 8. Risks & mitigations
| Risk | Mitigation |
|---|---|
| Hidden coupling in the 3.3k-line class breaks subtle mobile behaviour | Visual-regression + API snapshot + per-scenario focus/IME/teardrop tests **before** splitting; small steps |
| Refactor stalls feature work | Time-box Phase 5 (suggested 2–3 weeks); features resume per phase, not all at once |
| Tests rely on privates | `editor.__test` hook (5.0.3) |
| Circular imports after splitting | dependency-cruiser from day 1 |
| Perf regressions from extra indirection | perf baseline gate; passes share a single `FrameContext`, no per-frame allocations |
| Stale docs mislead | Regenerate `FEATURES.md`; archive `check.md`; every PR updates docs it touches |
