/**
 * Lazy dynamic `import()` loaders for KaTeX and Mermaid inside `@mono/editor/preview`.
 *
 * Guarantees:
 * - Neither `katex` nor `mermaid` is ever bundled into editor core.
 * - `katex` is imported ONLY when Markdown actually contains `$...$` or `$$...$$`.
 * - `mermaid` is imported ONLY when Markdown actually contains a `mermaid` code fence.
 * - Mermaid is ALWAYS initialized with `securityLevel: 'strict'`.
 */

export interface KatexModule {
  render(
    expression: string,
    baseNode: HTMLElement,
    options?: {
      displayMode?: boolean;
      throwOnError?: boolean;
      strict?: boolean | 'ignore' | 'warn' | 'error';
      trust?: boolean;
    },
  ): void;
}

export interface MermaidModule {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string }>;
}

export const MERMAID_STRICT_CONFIG = {
  startOnLoad: false,
  securityLevel: 'strict',
  suppressErrorRendering: true,
} as const;

let katexPromise: Promise<KatexModule> | null = null;
let mermaidPromise: Promise<MermaidModule> | null = null;
let lastMermaidTheme: 'dark' | 'default' | null = null;

let katexLoadCount = 0;
let mermaidLoadCount = 0;

/** Test-friendly telemetry for verifying lazy-loading behavior. */
export function getPreviewLoaderStats(): { katexLoads: number; mermaidLoads: number } {
  return { katexLoads: katexLoadCount, mermaidLoads: mermaidLoadCount };
}

export function resetPreviewLoaderState(): void {
  katexPromise = null;
  mermaidPromise = null;
  lastMermaidTheme = null;
  katexLoadCount = 0;
  mermaidLoadCount = 0;
}

/** Dynamically imports `katex` (and its stylesheet in browser environments) on first math block. */
export function loadKatex(): Promise<KatexModule> {
  if (!katexPromise) {
    katexLoadCount++;
    katexPromise = (async () => {
      if (typeof document !== 'undefined') {
        try {
          await import('katex/dist/katex.min.css');
        } catch {
          // Non-Vite test runners may not process CSS imports; KaTeX still renders MathML/DOM.
        }
      }
      const mod = await import('katex');
      const api = (mod.default ?? mod) as unknown as KatexModule;
      return api;
    })();
  }
  return katexPromise;
}

/** Dynamically imports `mermaid` on first ```mermaid block with `securityLevel: 'strict'`. */
export async function loadMermaid(isDark: boolean): Promise<MermaidModule> {
  if (!mermaidPromise) {
    mermaidLoadCount++;
    mermaidPromise = (async () => {
      const mod = await import('mermaid');
      const api = (mod.default ?? mod) as unknown as MermaidModule;
      return api;
    })();
  }
  const mermaid = await mermaidPromise;
  const targetTheme = isDark ? 'dark' : 'default';
  if (lastMermaidTheme !== targetTheme) {
    lastMermaidTheme = targetTheme;
    mermaid.initialize({
      ...MERMAID_STRICT_CONFIG,
      theme: targetTheme,
      fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
    });
  }
  return mermaid;
}
