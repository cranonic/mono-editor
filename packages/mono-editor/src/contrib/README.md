# `src/contrib/` — Isolated Optional Feature Contributions

Every optional IDE feature lives in its own subfolder and implements `IEditorContribution` against the narrow `IEditorContributionHost` interface:

- **13 built-in contributions**: `contextMenu`, `suggest`, `signatureHelp`, `rename`, `referencesPeek`, `colorPicker`, `hover`, `find`, `folding`, `multiCursor`, `format`, `definition`, `codeAction`.
- `index.ts` exports `registerBuiltInContributions()` in deterministic Escape/keydown priority order.

**Layer rule:** Each feature folder `src/contrib/<feat>/` may import from `common/`, `platform/`, `browser/`, and itself only. **Zero cross-contrib imports** and **zero `contrib → api` imports** are permitted.
