# Contributing to Mono Editor

This guide explains the architectural rules, coding constraints, and verification workflow for developing Mono Editor.

---

## 1. Architecture & Coding Rules

1. **Respect the 5-layer boundary**:
   - `src/common/` — **100% DOM-free**. Never reference `window`, `document`, `HTMLElement`, `CanvasRenderingContext2D`, `KeyboardEvent`, `MouseEvent`, etc. Must run directly in Node and Web Workers.
   - `src/platform/` — May import `common/` and `platform/` only.
   - `src/browser/` — May import `common/`, `platform/`, and `browser/` only. **Never import `src/contrib/` or `src/api/`**.
   - `src/contrib/<feature>/` — May import `common/`, `platform/`, `browser/`, and files inside its own `<feature>/` folder. **Never import another `contrib/` feature or `src/api/`**.
   - `src/api/` — Public façade. Only `src/index.ts` and `src/react/` may import `src/api/`.
2. **File size budgets**:
   - Regular logic files: **≤ 600 lines**.
   - Pure data tables (e.g., color dictionaries, codicon maps): **≤ 900 lines**.
   - `src/browser/editor/MonoEditor.ts`: **≤ 400 lines**.
   - `CanvasRenderer.paint()`: **≤ 80 lines** (add new visual layers as a pass under `src/browser/render/passes/`).
3. **Strict TypeScript (`erasableSyntaxOnly`)**:
   - Do **not** use TypeScript `enum`, `namespace`, or constructor parameter properties (`constructor(private x: number)`).
   - Use `export const Foo = { ... } as const; export type Foo = (typeof Foo)[keyof typeof Foo];` instead.
4. **CSP-safe DOM construction**:
   - Raw `innerHTML` is forbidden across `src/`. Build DOM nodes with `document.createElement`, `textContent`, `replaceChildren`, or `DOMParser` (`image/svg+xml`).
5. **Pure Mono naming**:
   - Never introduce `monaco*` filenames or `window.monaco` globals.

---

## 2. How to Add Common Extensions

### Adding a New Editor Feature (Contribution)
1. Create a folder `src/contrib/<myFeature>/` with `<MyFeatureController.ts>` implementing `IEditorContribution` (from `../../browser/editor/editorTypes`).
2. Interact with the editor solely through the narrow `IEditorContributionHost` capability object passed to your constructor.
3. Register commands via `host.commands.register(...)` and dispose all listeners/DOM nodes inside `dispose()`.
4. Register the factory in `src/contrib/index.ts` inside `registerBuiltInContributions()` at the appropriate Escape/keydown priority position.
5. Do **not** add feature methods to `src/browser/editor/MonoEditor.ts` unless adding a public `IMonoEditor` API method.

### Adding a New Render Layer
1. Create a pass function in `src/browser/render/passes/<myPass>.ts` taking `(ctx: CanvasRenderingContext2D, frame: FrameContext)`.
2. Invoke it in `CanvasRenderer.paint()` in the appropriate z-order without allocating per-frame arrays where avoidable.

### Adding a New Built-in Language
1. Add a tokenizer in `src/common/languages/defaults/<lang>.ts` using `createRegexTokensProvider`.
2. Add a language configuration (comments, brackets, auto-closing pairs, indent rules) in `src/common/languages/configurations/<lang>.ts`.
3. Register both in `src/common/languages/defaults/registerDefaults.ts` and `src/common/languages/languageConfigurationRegistry.ts`.

### Adding a New Built-in Theme
1. Create `src/platform/theme/builtins/<theme-id>.ts` exporting a `MonoThemeData` object.
2. Add the ID to `src/platform/theme/builtins/ids.ts` and register it in `src/platform/theme/builtins/registerBuiltins.ts`.

---

## 3. Verification Checklist (Run Before Merging)

```bash
# 1. Architecture guard (layering, cycles, DOM-in-common, sizes, zero innerHTML)
npm run check:arch

# 2. TypeScript checks (project + strict erasableSyntaxOnly)
npx tsc --noEmit
npx tsc --ignoreConfig --noEmit --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM --strict --erasableSyntaxOnly --skipLibCheck src/index.ts

# 3. Public API surface snapshot & all unit/integration tests
tsx tests/api-surface.test.mts
for t in tests/phase1-mono.test.mts tests/phase2-mono.test.mts tests/phase3-mono.test.mts tests/phase4-mono.test.mts tests/editor-fixes.test.mts tests/slice-d.test.mts tests/undo-group.test.mts; do tsx "$t" || exit 1; done

# 4. Core performance baseline
tsx scripts/perf-baseline.mjs

# 5. Production build
npm run build
```
