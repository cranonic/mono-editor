import type { MonoEditorTheme } from '../common/config/themeTypes';
import { DEFAULT_THEME } from '../common/config/themeTypes';
import { registerDefaultLanguages } from '../common/languages/defaults/registerDefaults';
import { TokenizationSupport } from '../common/languages/tokenization/TokenizationSupport';
import { DEFAULT_TOKEN_COLORS } from '../common/languages/tokenization/tokenTypes';
import { TextModel } from '../common/model/TextModel';
import { loadKatex, loadMermaid, type KatexModule } from './lazyLoaders';
import {
  parseMarkdownBlocks,
  scanMarkdownFeatures,
  type MarkdownBlock,
  type MarkdownInline,
} from './markdownParser';

export interface MarkdownPreviewOptions {
  /** Initial editor theme to harmonize preview surface & code syntax colors. */
  theme?: Partial<MonoEditorTheme>;
  /** Debounce delay in ms for `setMarkdown()`. Default `120`. */
  debounceMs?: number;
  /** Optional custom font stack for prose. */
  fontFamily?: string;
  /** Optional monospace font stack for code blocks. */
  monoFontFamily?: string;
}

function isDarkColor(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return true;
  const n = parseInt(m[1]!, 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum < 0.5;
}

let mermaidRenderCounter = 0;

/**
 * Reusable, CSP-safe Rich Markdown Preview renderer (`@mono/editor/preview`).
 *
 * - Zero raw `.innerHTML =` — uses DOM builders, `katex.render()`, and `DOMParser('image/svg+xml')`.
 * - Dynamically lazy-loads `katex` ONLY when math (`$...$`/`$$...$$`) is present.
 * - Dynamically lazy-loads `mermaid` (with `securityLevel: 'strict'`) ONLY when ` ```mermaid ` is present.
 * - Syntax-highlights fenced code blocks using Mono's own `TokenizationSupport` + active theme.
 */
export class MarkdownPreview {
  private readonly host: HTMLElement;
  private readonly root: HTMLDivElement;
  private readonly tokenization = new TokenizationSupport();
  private readonly debounceMs: number;
  private readonly fontFamily: string;
  private readonly monoFontFamily: string;
  private theme: MonoEditorTheme;
  private currentMarkdown = '';
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private renderSeq = 0;
  private disposed = false;

  constructor(host: HTMLElement, options: MarkdownPreviewOptions = {}) {
    registerDefaultLanguages();
    this.host = host;
    this.debounceMs = options.debounceMs ?? 120;
    this.fontFamily =
      options.fontFamily ?? "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";
    this.monoFontFamily =
      options.monoFontFamily ?? "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
    this.theme = { ...DEFAULT_THEME, ...(options.theme ?? {}) };

    const root = document.createElement('div');
    root.className = 'mono-md-preview';
    Object.assign(root.style, {
      width: '100%',
      height: '100%',
      overflowY: 'auto',
      overflowX: 'hidden',
      boxSizing: 'border-box',
      padding: '20px 24px 48px',
      fontFamily: this.fontFamily,
      fontSize: '14px',
      lineHeight: '1.65',
      wordBreak: 'break-word',
    });
    this.root = root;
    this.applySurfaceTheme();
    this.host.appendChild(root);
  }

  getElement(): HTMLDivElement {
    return this.root;
  }

  setTheme(theme: Partial<MonoEditorTheme>): void {
    this.theme = { ...DEFAULT_THEME, ...this.theme, ...theme };
    this.applySurfaceTheme();
    if (this.currentMarkdown) {
      void this.renderNow(this.currentMarkdown);
    }
  }

  setMarkdown(markdown: string): void {
    this.currentMarkdown = markdown;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.debounceMs <= 0) {
      void this.renderNow(markdown);
      return;
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (!this.disposed) void this.renderNow(this.currentMarkdown);
    }, this.debounceMs);
  }

  async renderNow(markdown: string): Promise<void> {
    if (this.disposed) return;
    this.currentMarkdown = markdown;
    const seq = ++this.renderSeq;
    const features = scanMarkdownFeatures(markdown);
    const blocks = parseMarkdownBlocks(markdown);

    let katexMod: KatexModule | null = null;
    if (features.hasMath) {
      try {
        katexMod = await loadKatex();
      } catch {
        katexMod = null;
      }
      if (this.disposed || seq !== this.renderSeq) return;
    }

    const dark = isDarkColor(this.theme.background);
    const borderCol = dark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(15, 23, 42, 0.12)';
    const surfaceAlt = dark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(15, 23, 42, 0.04)';
    const mutedCol = dark ? '#9ca3af' : '#64748b';
    const accentCol = dark ? '#38bdf8' : '#0284c7';

    const frag = document.createDocumentFragment();
    const mermaidJobs: Array<{ host: HTMLDivElement; code: string }> = [];

    for (const block of blocks) {
      frag.appendChild(
        this.renderBlock(block, {
          dark,
          borderCol,
          surfaceAlt,
          mutedCol,
          accentCol,
          katexMod,
          mermaidJobs,
        }),
      );
    }

    this.root.replaceChildren(frag);

    if (features.hasMermaid && mermaidJobs.length > 0) {
      await this.renderMermaidJobs(mermaidJobs, dark, borderCol, seq);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.renderSeq++;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.root.remove();
  }

  private applySurfaceTheme(): void {
    this.root.style.background = this.theme.background;
    this.root.style.color = this.theme.foreground;
  }

  private renderBlock(
    block: MarkdownBlock,
    ctx: {
      dark: boolean;
      borderCol: string;
      surfaceAlt: string;
      mutedCol: string;
      accentCol: string;
      katexMod: KatexModule | null;
      mermaidJobs: Array<{ host: HTMLDivElement; code: string }>;
    },
  ): HTMLElement {
    switch (block.type) {
      case 'heading': {
        const el = document.createElement(`h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6');
        const sizes = ['', '1.65em', '1.35em', '1.15em', '1.02em', '0.95em', '0.88em'];
        Object.assign(el.style, {
          fontSize: sizes[block.level], fontWeight: '600', lineHeight: '1.3', letterSpacing: '-0.01em',
          margin: block.level <= 2 ? '20px 0 10px' : '16px 0 8px',
          paddingBottom: block.level <= 2 ? '6px' : '0',
          borderBottom: block.level <= 2 ? `1px solid ${ctx.borderCol}` : 'none',
        });
        this.appendInlines(el, block.inlines, ctx);
        return el;
      }

      case 'paragraph': {
        const p = document.createElement('p');
        p.style.margin = '0 0 12px';
        this.appendInlines(p, block.inlines, ctx);
        return p;
      }

      case 'hr': {
        const hr = document.createElement('hr');
        Object.assign(hr.style, { border: 'none', borderTop: `1px solid ${ctx.borderCol}`, margin: '18px 0' });
        return hr;
      }

      case 'blockquote': {
        const bq = document.createElement('blockquote');
        Object.assign(bq.style, {
          margin: '12px 0', padding: '6px 14px',
          borderLeft: `1px solid ${ctx.accentCol}`, background: ctx.surfaceAlt, color: ctx.mutedCol,
        });
        for (const inner of block.blocks) bq.appendChild(this.renderBlock(inner, ctx));
        return bq;
      }

      case 'list': {
        const list = document.createElement(block.ordered ? 'ol' : 'ul');
        Object.assign(list.style, { margin: '0 0 12px', paddingLeft: '22px' });
        for (const item of block.items) {
          const li = document.createElement('li');
          li.style.margin = '4px 0';
          if (item.checked !== undefined) {
            li.style.listStyle = 'none';
            const cb = document.createElement('input');
            cb.type = 'checkbox'; cb.checked = item.checked; cb.disabled = true;
            cb.style.marginRight = '8px'; cb.style.verticalAlign = 'middle';
            li.appendChild(cb);
          }
          this.appendInlines(li, item.inlines, ctx);
          list.appendChild(li);
        }
        return list;
      }

      case 'table': {
        const wrap = document.createElement('div');
        Object.assign(wrap.style, { overflowX: 'auto', margin: '14px 0', border: `1px solid ${ctx.borderCol}`, borderRadius: '4px' });
        const table = document.createElement('table');
        Object.assign(table.style, { width: '100%', borderCollapse: 'collapse', fontSize: '13px', fontVariantNumeric: 'tabular-nums' });
        const thead = document.createElement('thead');
        const htr = document.createElement('tr');
        htr.style.background = ctx.surfaceAlt;
        block.headers.forEach((cell, idx) => {
          const th = document.createElement('th');
          Object.assign(th.style, {
            padding: '7px 10px', borderBottom: `1px solid ${ctx.borderCol}`,
            borderRight: idx < block.headers.length - 1 ? `1px solid ${ctx.borderCol}` : 'none',
            textAlign: block.alignments[idx] ?? 'left', fontWeight: '600',
          });
          this.appendInlines(th, cell, ctx);
          htr.appendChild(th);
        });
        thead.appendChild(htr);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        block.rows.forEach((row, rIdx) => {
          const tr = document.createElement('tr');
          row.forEach((cell, cIdx) => {
            const td = document.createElement('td');
            Object.assign(td.style, {
              padding: '6px 10px',
              borderBottom: rIdx < block.rows.length - 1 ? `1px solid ${ctx.borderCol}` : 'none',
              borderRight: cIdx < row.length - 1 ? `1px solid ${ctx.borderCol}` : 'none',
              textAlign: block.alignments[cIdx] ?? 'left',
            });
            this.appendInlines(td, cell, ctx);
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        wrap.appendChild(table);
        return wrap;
      }

      case 'mathBlock': {
        const box = document.createElement('div');
        box.className = 'mono-md-math-block';
        Object.assign(box.style, {
          margin: '14px 0', padding: '12px 14px', overflowX: 'auto', textAlign: 'center',
          background: ctx.surfaceAlt, border: `1px solid ${ctx.borderCol}`, borderRadius: '4px',
        });
        this.renderMathNode(box, block.expression, true, ctx.katexMod);
        return box;
      }

      case 'code': {
        if (block.language === 'mermaid') {
          const host = document.createElement('div');
          host.className = 'mono-md-mermaid';
          Object.assign(host.style, {
            margin: '14px 0',
            padding: '14px',
            overflowX: 'auto',
            background: ctx.surfaceAlt,
            border: `1px solid ${ctx.borderCol}`,
            borderRadius: '4px',
            textAlign: 'center',
          });
          const loading = document.createElement('span');
          loading.textContent = 'Rendering Mermaid diagram...';
          loading.style.fontSize = '12px';
          loading.style.color = ctx.mutedCol;
          host.appendChild(loading);
          ctx.mermaidJobs.push({ host, code: block.code });
          return host;
        }
        return this.renderHighlightedCodeBlock(block.language, block.code, ctx.borderCol, ctx.surfaceAlt, ctx.mutedCol);
      }
    }
  }

  private renderHighlightedCodeBlock(
    language: string,
    code: string,
    borderCol: string,
    surfaceAlt: string,
    mutedCol: string,
  ): HTMLElement {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
      margin: '14px 0',
      background: surfaceAlt,
      border: `1px solid ${borderCol}`,
      borderRadius: '4px',
      overflow: 'hidden',
    });

    if (language) {
      const bar = document.createElement('div');
      bar.textContent = language;
      Object.assign(bar.style, {
        padding: '4px 10px',
        fontSize: '11px',
        fontFamily: this.monoFontFamily,
        color: mutedCol,
        borderBottom: `1px solid ${borderCol}`,
        textTransform: 'lowercase',
      });
      wrap.appendChild(bar);
    }

    const pre = document.createElement('pre');
    Object.assign(pre.style, {
      margin: '0',
      padding: '12px 14px',
      overflowX: 'auto',
      fontFamily: this.monoFontFamily,
      fontSize: '12.5px',
      lineHeight: '1.55',
    });
    const codeEl = document.createElement('code');

    const langAlias: Record<string, string> = {
      js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
      py: 'python', sh: 'shell', bash: 'shell', yml: 'yaml', md: 'markdown',
    };
    const resolvedLang = langAlias[language] ?? (language || 'plaintext');
    const model = new TextModel(code, resolvedLang);
    const palette: Record<string, string | undefined> = {
      ...DEFAULT_TOKEN_COLORS,
      ...(this.theme.tokenColors ?? {}),
    };

    const lineCount = model.getLineCount();
    for (let ln = 1; ln <= lineCount; ln++) {
      const lineText = model.getLineContent(ln);
      const tokens = this.tokenization.getLineTokens(model, ln);
      if (tokens.length === 0) {
        codeEl.appendChild(document.createTextNode(lineText));
      } else {
        let col = 1;
        for (const tok of tokens) {
          if (tok.startColumn > col) {
            codeEl.appendChild(document.createTextNode(lineText.slice(col - 1, tok.startColumn - 1)));
          }
          const span = document.createElement('span');
          span.textContent = lineText.slice(tok.startColumn - 1, tok.endColumn - 1);
          span.style.color = palette[tok.type] ?? this.theme.foreground;
          codeEl.appendChild(span);
          col = Math.max(col, tok.endColumn);
        }
        if (col <= lineText.length) {
          codeEl.appendChild(document.createTextNode(lineText.slice(col - 1)));
        }
      }
      if (ln < lineCount) codeEl.appendChild(document.createTextNode('\n'));
    }

    pre.appendChild(codeEl);
    wrap.appendChild(pre);
    return wrap;
  }

  private appendInlines(
    parent: HTMLElement,
    inlines: MarkdownInline[],
    ctx: {
      dark: boolean;
      borderCol: string;
      surfaceAlt: string;
      mutedCol: string;
      accentCol: string;
      katexMod: KatexModule | null;
    },
  ): void {
    for (const node of inlines) {
      switch (node.type) {
        case 'text':
          parent.appendChild(document.createTextNode(node.value));
          break;
        case 'code': {
          const code = document.createElement('code');
          code.textContent = node.value;
          Object.assign(code.style, {
            fontFamily: this.monoFontFamily,
            fontSize: '0.88em',
            padding: '1px 5px',
            borderRadius: '3px',
            background: ctx.surfaceAlt,
            border: `1px solid ${ctx.borderCol}`,
          });
          parent.appendChild(code);
          break;
        }
        case 'math': {
          const span = document.createElement('span');
          span.className = 'mono-md-math-inline';
          this.renderMathNode(span, node.value, false, ctx.katexMod);
          parent.appendChild(span);
          break;
        }
        case 'strong': {
          const el = document.createElement('strong');
          el.style.fontWeight = '600';
          this.appendInlines(el, node.children, ctx);
          parent.appendChild(el);
          break;
        }
        case 'emphasis': {
          const el = document.createElement('em');
          this.appendInlines(el, node.children, ctx);
          parent.appendChild(el);
          break;
        }
        case 'strike': {
          const el = document.createElement('del');
          this.appendInlines(el, node.children, ctx);
          parent.appendChild(el);
          break;
        }
        case 'link': {
          const a = document.createElement('a');
          a.href = node.href;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.style.color = ctx.accentCol;
          a.style.textDecoration = 'underline';
          this.appendInlines(a, node.label, ctx);
          parent.appendChild(a);
          break;
        }
        case 'image': {
          const img = document.createElement('img');
          img.src = node.src;
          img.alt = node.alt;
          Object.assign(img.style, {
            maxWidth: '100%',
            height: 'auto',
            borderRadius: '4px',
            border: `1px solid ${ctx.borderCol}`,
          });
          parent.appendChild(img);
          break;
        }
      }
    }
  }

  private renderMathNode(
    target: HTMLElement,
    expression: string,
    displayMode: boolean,
    katexMod: KatexModule | null,
  ): void {
    if (!katexMod) {
      const code = document.createElement('code');
      code.textContent = displayMode ? `$$${expression}$$` : `$${expression}$`;
      code.style.fontFamily = this.monoFontFamily;
      target.appendChild(code);
      return;
    }
    try {
      katexMod.render(expression, target, {
        displayMode,
        throwOnError: false,
        strict: 'ignore',
        trust: false,
      });
    } catch (err) {
      const errEl = document.createElement('span');
      errEl.textContent = `Math error: ${err instanceof Error ? err.message : String(err)}`;
      errEl.style.color = '#f44747';
      errEl.style.fontSize = '12px';
      target.replaceChildren(errEl);
    }
  }

  private async renderMermaidJobs(
    jobs: Array<{ host: HTMLDivElement; code: string }>,
    dark: boolean,
    borderCol: string,
    seq: number,
  ): Promise<void> {
    let mermaid;
    try {
      mermaid = await loadMermaid(dark);
    } catch (err) {
      if (this.disposed || seq !== this.renderSeq) return;
      for (const job of jobs) {
        this.renderMermaidError(job.host, err instanceof Error ? err.message : String(err), borderCol);
      }
      return;
    }
    if (this.disposed || seq !== this.renderSeq) return;

    for (const job of jobs) {
      if (this.disposed || seq !== this.renderSeq) return;
      const diagramId = `mono-mmd-${++mermaidRenderCounter}`;
      try {
        const { svg } = await mermaid.render(diagramId, job.code);
        if (this.disposed || seq !== this.renderSeq) return;
        if (typeof DOMParser !== 'undefined') {
          const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
          const svgEl = parsed.querySelector('svg');
          if (svgEl && !parsed.querySelector('parsererror')) {
            const imported = document.importNode(svgEl, true);
            imported.style.maxWidth = '100%';
            imported.style.height = 'auto';
            job.host.replaceChildren(imported);
            continue;
          }
        }
        this.renderMermaidError(job.host, 'Unable to parse SVG diagram output.', borderCol);
      } catch (err) {
        if (this.disposed || seq !== this.renderSeq) return;
        this.renderMermaidError(job.host, err instanceof Error ? err.message : String(err), borderCol);
      }
    }
  }

  private renderMermaidError(host: HTMLDivElement, message: string, borderCol: string): void {
    const box = document.createElement('div');
    Object.assign(box.style, {
      textAlign: 'left',
      fontSize: '12px',
      fontFamily: this.monoFontFamily,
      color: '#f48771',
      border: `1px solid ${borderCol}`,
      padding: '8px 10px',
      borderRadius: '3px',
      whiteSpace: 'pre-wrap',
    });
    box.textContent = `Mermaid syntax warning:\n${message}`;
    host.replaceChildren(box);
  }
}

export function createMarkdownPreview(
  host: HTMLElement,
  options?: MarkdownPreviewOptions,
): MarkdownPreview {
  return new MarkdownPreview(host, options);
}
