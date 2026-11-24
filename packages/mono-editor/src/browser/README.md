# `src/browser/` — DOM & Canvas Editor Engine

Houses the core interactive editor shell, Canvas 2D renderer, viewport controller, and input/pointer pipeline:

- `editor/` — Thin `MonoEditor` composition root (`≤ 400` lines), lifecycle/bootstrap, contribution registry (`IEditorContribution`), model/cursor/event adapters.
- `render/` — `CanvasRenderer` (`FrameContext` + 7 composable render passes in `passes/`), grapheme-aware `textLayout`, CSP-safe `markdownDom`.
- `view/` — `ViewController` (scroll state, dirty-frame rAF loop, top-inset coordination), hit-testing, sticky scroll UI, and `viewParts/` (`OverlayScrollbar`, `MinimapController`, `HandleVisibility`).
- `input/` — Hidden `<textarea>` IME/keyboard bridge (`InputController`, `keyboardHandler`, `compositionHandler`) and `pointer/` (`PointerController`, teardrop handles, momentum touch scroll).

**Layer rule:** May import from `src/common/`, `src/platform/`, and `src/browser/` only. **Never** imports `src/contrib/` or `src/api/`.
