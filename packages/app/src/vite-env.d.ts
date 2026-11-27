/// <reference types="vite/client" />

declare module 'virtual:ts-lsp-libs' {
  const libs: Record<string, string>;
  export default libs;
}

declare module 'virtual:optional-builtin-extensions' {
  export interface OptionalTsBuiltinBundle {
    manifest: Record<string, any>;
    settings: Record<string, any>;
    tsSnippets: Record<string, any>;
    jsSnippets: Record<string, any>;
    readme: string;
    changelog: string;
    iconUrl: string;
    TS_JS_LANGS: string[];
    buildServerConfig: () => Record<string, any>;
  }
  export const OPTIONAL_TS_BUILTIN: OptionalTsBuiltinBundle | null;
}
