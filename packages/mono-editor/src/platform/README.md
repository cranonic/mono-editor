# `src/platform/` — Cross-Cutting Editor Services

Reusable platform services shared across the browser engine and feature contributions:

- `commands/` — `CommandsRegistry`, `CommandService`, `ContextKeyService`, and `MonoCommands`.
- `keybindings/` — `KeybindingService` (shortcut & chord matching with context evaluation).
- `palette/` — `PaletteService` for command palette filtering and dispatch.
- `theme/` — `MonoThemeService`, `widgetTheme` CSS variable resolution, token mapping, and 5 built-in themes.
- `icons/`, `haptic/` — Bundled local Codicons + extra SVG registry and touch haptic feedback.

**Layer rule:** May import from `src/common/` and `src/platform/` only. Never imports `browser/`, `contrib/`, or `api/`.
