/**
 * Optional Rich Markdown Preview package entry (`@mono/editor/preview`).
 *
 * Intentionally separated from `@mono/editor` core so KaTeX and Mermaid are
 * never bundled into the core editor and are dynamically loaded via `import()`
 * only when Markdown content contains math (`$...$`/`$$...$$`) or Mermaid fences.
 */

export { MarkdownPreview, createMarkdownPreview } from './MarkdownPreview';
export type { MarkdownPreviewOptions } from './MarkdownPreview';
export {
  parseMarkdownBlocks,
  parseMarkdownInlines,
  scanMarkdownFeatures,
  sanitizePreviewUrl,
} from './markdownParser';
export type {
  MarkdownBlock,
  MarkdownInline,
  MarkdownFeatureScan,
  TableAlign,
} from './markdownParser';
export {
  MERMAID_STRICT_CONFIG,
  loadKatex,
  loadMermaid,
  getPreviewLoaderStats,
  resetPreviewLoaderState,
} from './lazyLoaders';
export type { KatexModule, MermaidModule } from './lazyLoaders';
