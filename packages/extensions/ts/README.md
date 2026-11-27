# TypeScript and JavaScript for MS Code

Full **TypeScript** & **JavaScript** language support powered by [`typescript-language-server`](https://github.com/typescript-language-server/typescript-language-server) (tsserver).

Works on **native bionic** (Termux-style `$PREFIX`) and **Alpine proot**.

---

## Features

| Feature | Status |
|--------|--------|
| Completions / auto-import | ✅ |
| Hover & signature help | ✅ |
| Go to definition / references | ✅ |
| Rename & code actions | ✅ |
| Diagnostics (validate) | ✅ |
| **Inlay hints** (types, params, enums) | ✅ |
| Format document | ✅ |
| JS / JSX / TS / TSX | ✅ |
| Project `tsconfig.json` / `jsconfig.json` | ✅ |

Inlay hints require:

1. Extension settings: `typescript.inlayHints.*` enabled  
2. Editor: `editor.inlayHints.enabled` = `on` (or equivalent)

---

## Install / first run

On first open of a `.ts` / `.js` file the host will:

1. Ensure `nodejs` + `npm` (`pkg` or `apk`)
2. `npm install -g typescript typescript-language-server`
3. Start `typescript-language-server --stdio`

---

## Commands

- **TypeScript: Restart TS Server** — `typescript.restartTsServer`
- **TypeScript: Select TypeScript Version** — shows current `typescript.tsdk`
- **TypeScript: Go to Project Configuration** — reminds you about `tsconfig.json`
- **TypeScript: Open TS Server Log** — how to enable `typescript.tsserver.log`
- **JavaScript: Reload Projects** — restarts the shared server

---

## Important settings

```json
{
  "editor.inlayHints.enabled": "on",
  "typescript.inlayHints.enabled": true,
  "typescript.inlayHints.parameterNames.enabled": "all",
  "typescript.inlayHints.variableTypes.enabled": true,
  "typescript.inlayHints.functionLikeReturnTypes.enabled": true,
  "typescript.suggest.autoImports": true,
  "typescript.validate.enable": true,
  "javascript.validate.enable": true
}
```

See **Settings → TypeScript / JavaScript** for the full list (suggest, format, preferences, tsserver memory/log, etc.).