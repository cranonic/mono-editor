# `src/common/` — Pure DOM-Free Editor Core

Contains all platform- and DOM-independent editor logic that runs identically in browsers, Node.js tests, and Web Workers:

- `core/`, `model/`, `decorations/`, `config/`, `util/` — `TextModel`, `EditStack`, `Position`/`Range`/`Selection`/`Uri`, decorations & markers, options, grapheme segmentation.
- `cursor/`, `editOperations/` — Cursor motion, line/comment/auto-close/indent operations, bracket matching, occurrences, indent guides, snippets.
- `languages/`, `color/`, `viewModel/` — Tokenization, 12 built-in languages & configs, LSP provider registries, color detection/formatting, `FoldingModel`, `ViewLineProjection`, `StickyScroll`.

**Layer rule:** May import **only** from `src/common/`. Zero DOM globals (`window`, `document`, `HTMLElement`, `CanvasRenderingContext2D`, etc.) are allowed.
