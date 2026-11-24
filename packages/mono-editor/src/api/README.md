# `src/api/` — Public Façade & Stable Types

Exposes the public Monaco-compatible Mono Editor API consumed via `src/index.ts` and `src/react/MonoEditor.tsx`:

- `editor.api.ts` — `editor.*` namespace (`create`, `createModel`, `getModel`, `getModels`, `defineTheme`, `setTheme`, `setModelMarkers`, `getModelMarkers`, `onDidChangeMarkers`, `setModelLanguage`, `getEditors`) and `createMonoEditor` (which registers built-in contributions).
- `languages.api.ts` — `languages.*` namespace for language, configuration, tokenizer, and LSP provider registration.
- `types/` — Public type definitions split cleanly across `theme.ts`, `options.ts`, `model.ts`, `events.ts`, and `editor.ts`.

**Layer rule:** May compose `common/`, `platform/`, `browser/`, and `contrib/`. No internal layer may import `src/api/` (only `src/index.ts` and `src/react/`).
