import type { TextModel } from '../../../common/model/TextModel';
import type { SelectionState } from '../../../common/core/SelectionState';
import type { MonoEditorTheme } from '../../../common/config/themeTypes';
import type { TokenizationSupport } from '../../../common/languages/tokenization/TokenizationSupport';
import { DEFAULT_TOKEN_COLORS } from '../../../common/languages/tokenization/tokenTypes';
import type { ViewController } from '../ViewController';
import type { ResolvedWidgetTheme } from '../../../platform/theme/widgetTheme';

export interface MonoMinimapOptions {
  /** Show or hide the right/left code minimap. Default `false`. */
  enabled?: boolean;
  /** Dock side (`'right'` | `'left'`). Default `'right'`. */
  side?: 'right' | 'left';
  /** Maximum characters rendered horizontally per line. Default `100`. */
  maxColumn?: number;
  /** Render crisp micro-character blocks vs solid line bars. Default `true`. */
  renderCharacters?: boolean;
  /** Viewport slider visibility (`'always'` | `'mouseover'`). Default `'always'`. */
  showSlider?: 'always' | 'mouseover';
  /** Vertical pixel density scale (1..2). Default `1`. */
  scale?: number;
}

export const DEFAULT_MINIMAP_OPTIONS: Required<MonoMinimapOptions> = {
  enabled: false,
  side: 'right',
  maxColumn: 100,
  renderCharacters: true,
  showSlider: 'always',
  scale: 1,
};

export interface MinimapDecorations {
  findMatches?: readonly { startLineNumber: number; endLineNumber: number }[];
  diagnostics?: readonly { startLineNumber: number; color: string }[];
}

/**
 * High-DPI Canvas Minimap with token-colored code preview, selection & match markers,
 * and focus-safe click/drag viewport slider scrolling.
 */
export class MinimapController {
  private host: HTMLElement;
  private model: TextModel;
  private selection: SelectionState;
  private view: ViewController;
  private tokenization: TokenizationSupport;
  private getTheme: () => MonoEditorTheme;
  private getDecorations: () => MinimapDecorations;
  private opts: Required<MonoMinimapOptions>;
  private widgetTheme: ResolvedWidgetTheme | null = null;

  private wrap: HTMLDivElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private hovered = false;
  private dragging = false;
  private dragOffsetY = 0;
  private lastSliderTop = 0;
  private lastSliderH = 30;
  private lastMinimapScrollRatio = 0;
  private lastContentRows = 1;
  private lastRowH = 3;
  private onScrollCb: (() => void) | null = null;
  private disposed = false;

  constructor(
    host: HTMLElement,
    model: TextModel,
    selection: SelectionState,
    view: ViewController,
    tokenization: TokenizationSupport,
    getTheme: () => MonoEditorTheme,
    getDecorations: () => MinimapDecorations,
    options?: MonoMinimapOptions,
    onScroll?: () => void,
  ) {
    this.host = host;
    this.model = model;
    this.selection = selection;
    this.view = view;
    this.tokenization = tokenization;
    this.getTheme = getTheme;
    this.getDecorations = getDecorations;
    this.opts = { ...DEFAULT_MINIMAP_OPTIONS, ...options };
    this.onScrollCb = onScroll ?? null;

    if (this.opts.enabled) this.mount();
  }

  getWidth(): number {
    if (!this.opts.enabled) return 0;
    const scale = Math.max(1, Math.min(2, this.opts.scale));
    return Math.min(112, Math.max(64, Math.round(Math.min(this.opts.maxColumn, 96) * 0.85 * scale) + 12));
  }

  getOptions(): Required<MonoMinimapOptions> {
    return { ...this.opts };
  }

  setOptions(options: Partial<MonoMinimapOptions>): void {
    const wasEnabled = this.opts.enabled;
    this.opts = { ...this.opts, ...options };
    if (this.opts.enabled && !wasEnabled) {
      this.mount();
    } else if (!this.opts.enabled && wasEnabled) {
      this.unmount();
    } else if (this.opts.enabled) {
      this.syncLayout();
      this.paint();
    }
  }

  setModel(model: TextModel): void {
    this.model = model;
    this.paint();
  }

  applyTheme(theme: ResolvedWidgetTheme): void {
    this.widgetTheme = theme;
    if (this.wrap) {
      this.wrap.style.borderLeft =
        this.opts.side === 'right' ? `1px solid ${theme.border}` : 'none';
      this.wrap.style.borderRight =
        this.opts.side === 'left' ? `1px solid ${theme.border}` : 'none';
    }
    this.paint();
  }

  syncLayout(): void {
    if (!this.wrap || !this.canvas || !this.opts.enabled) return;
    const w = this.getWidth();
    const h = Math.max(0, this.host.clientHeight || this.view.cssHeight);
    this.wrap.style.width = `${w}px`;
    this.wrap.style.left = this.opts.side === 'left' ? '0px' : 'auto';
    this.wrap.style.right = this.opts.side === 'right' ? '0px' : 'auto';
    const borderCol = this.widgetTheme?.border ?? 'rgba(128,128,128,0.22)';
    this.wrap.style.borderLeft = this.opts.side === 'right' ? `1px solid ${borderCol}` : 'none';
    this.wrap.style.borderRight = this.opts.side === 'left' ? `1px solid ${borderCol}` : 'none';

    const dpr = Math.max(1, (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1);
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  paint(): void {
    if (this.disposed || !this.opts.enabled || !this.canvas || !this.wrap) return;
    this.syncLayout();
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.max(1, (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1);
    const w = this.getWidth();
    const h = Math.max(1, this.host.clientHeight || this.view.cssHeight);
    const theme = this.getTheme();
    const tokenColors = { ...DEFAULT_TOKEN_COLORS, ...theme.tokenColors };

    ctx.save();
    ctx.scale(dpr, dpr);

    // Background matching editor canvas
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, w, h);

    const totalLines = Math.max(1, this.model.getLineCount());
    const scale = Math.max(1, Math.min(2, this.opts.scale));
    const rowH = Math.max(2, Math.round(2.5 * scale));
    const charW = this.opts.renderCharacters ? 1.15 * scale : 1.0 * scale;
    const totalMiniH = totalLines * rowH;
    const maxScrollTop = Math.max(1, this.view.getMaxScrollTop());
    const scrollRatio = Math.max(0, Math.min(1, this.view.scrollTop / maxScrollTop));

    // When file is taller than minimap viewport, scroll the minimap window proportionally
    const miniScrollTop = totalMiniH > h ? scrollRatio * (totalMiniH - h) : 0;
    const firstLine = Math.max(1, Math.floor(miniScrollTop / rowH) + 1);
    const lastLine = Math.min(totalLines, Math.ceil((miniScrollTop + h) / rowH) + 1);

    this.lastContentRows = totalLines;
    this.lastRowH = rowH;
    this.lastMinimapScrollRatio = miniScrollTop;

    const padX = 6;
    const maxDrawW = Math.max(8, w - padX * 2);
    const maxCol = Math.max(20, this.opts.maxColumn);

    // Render token-colored micro lines
    ctx.globalAlpha = 0.72;
    for (let ln = firstLine; ln <= lastLine; ln++) {
      const y = Math.floor((ln - 1) * rowH - miniScrollTop);
      if (y + rowH < 0 || y > h) continue;
      const lineText = this.model.getLineContent(ln);
      if (!lineText.trim()) continue;

      const tokens = this.tokenization.getLineTokens(this.model, ln);
      const drawH = Math.max(1, rowH - 1);

      if (tokens && tokens.length > 0) {
        for (const tok of tokens) {
          const s0 = Math.max(0, tok.startColumn - 1);
          const e0 = Math.min(lineText.length, tok.endColumn - 1, maxCol);
          if (e0 <= s0) continue;
          const slice = lineText.slice(s0, e0);
          if (!slice.trim()) continue;
          const leadSpaces = slice.length - slice.trimStart().length;
          const trimmedLen = slice.trim().length;
          const x = padX + (s0 + leadSpaces) * charW;
          if (x >= padX + maxDrawW) break;
          const segW = Math.min(padX + maxDrawW - x, Math.max(1.5, trimmedLen * charW));
          const col =
            tok.type === 'plain'
              ? theme.foreground
              : (tokenColors as Record<string, string | undefined>)[tok.type] ?? theme.foreground;
          ctx.fillStyle = col;
          ctx.fillRect(x, y, segW, drawH);
        }
      } else {
        const leadSpaces = lineText.length - lineText.trimStart().length;
        const trimmedLen = Math.min(maxCol - leadSpaces, lineText.trim().length);
        if (trimmedLen > 0) {
          const x = padX + leadSpaces * charW;
          const segW = Math.min(padX + maxDrawW - x, Math.max(2, trimmedLen * charW));
          ctx.fillStyle = theme.foreground;
          ctx.fillRect(x, y, segW, drawH);
        }
      }
    }
    ctx.globalAlpha = 1;

    // Selection highlights
    ctx.fillStyle = theme.selection;
    ctx.globalAlpha = 0.55;
    for (const sel of this.selection.selections) {
      const sLine = Math.min(sel.anchor.lineNumber, sel.active.lineNumber);
      const eLine = Math.max(sel.anchor.lineNumber, sel.active.lineNumber);
      const y1 = (sLine - 1) * rowH - miniScrollTop;
      const y2 = eLine * rowH - miniScrollTop;
      if (y2 >= 0 && y1 <= h) {
        ctx.fillRect(0, Math.max(0, y1), w, Math.max(rowH, y2 - y1));
      }
    }
    ctx.globalAlpha = 1;

    // Find & Diagnostic ticks on right edge of minimap
    const decs = this.getDecorations();
    if (decs.findMatches?.length) {
      ctx.fillStyle = '#eab308';
      for (const fm of decs.findMatches) {
        const y = (fm.startLineNumber - 1) * rowH - miniScrollTop;
        if (y >= -2 && y <= h + 2) {
          ctx.fillRect(w - 5, y, 4, Math.max(2, rowH));
        }
      }
    }
    if (decs.diagnostics?.length) {
      for (const d of decs.diagnostics) {
        const y = (d.startLineNumber - 1) * rowH - miniScrollTop;
        if (y >= -2 && y <= h + 2) {
          ctx.fillStyle = d.color;
          ctx.fillRect(w - 6, y, 5, Math.max(2, rowH));
        }
      }
    }

    // Viewport slider lens
    const scrollH = Math.max(h, this.view.getScrollHeight());
    const visibleFrac = Math.min(1, h / scrollH);
    const sliderH = Math.max(22, Math.min(h, Math.round(Math.min(totalMiniH, h) * visibleFrac)));
    const sliderTrackH = Math.max(0, Math.min(totalMiniH, h) - sliderH);
    const sliderTop = Math.round(scrollRatio * sliderTrackH);
    this.lastSliderTop = sliderTop;
    this.lastSliderH = sliderH;

    const showSlider = this.opts.showSlider === 'always' || this.hovered || this.dragging;
    if (showSlider) {
      const isDark = this.widgetTheme?.isDark ?? true;
      ctx.fillStyle = this.dragging
        ? isDark
          ? 'rgba(180, 195, 220, 0.24)'
          : 'rgba(60, 80, 110, 0.22)'
        : this.hovered
          ? isDark
            ? 'rgba(180, 195, 220, 0.17)'
            : 'rgba(60, 80, 110, 0.15)'
          : isDark
            ? 'rgba(160, 175, 200, 0.11)'
            : 'rgba(60, 80, 110, 0.10)';
      ctx.fillRect(0, sliderTop, w, sliderH);

      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, sliderTop + 0.5, w - 1, Math.max(1, sliderH - 1));
    }

    ctx.restore();
  }

  dispose(): void {
    this.disposed = true;
    this.unmount();
  }

  private mount(): void {
    if (this.wrap) return;
    const wrap = document.createElement('div');
    wrap.className = 'mono-minimap';
    Object.assign(wrap.style, {
      position: 'absolute',
      top: '0',
      bottom: '0',
      zIndex: '18',
      pointerEvents: 'auto',
      userSelect: 'none',
      touchAction: 'none',
      cursor: 'pointer',
      overflow: 'hidden',
    });
    wrap.style.setProperty('-webkit-user-select', 'none');

    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    wrap.appendChild(canvas);

    wrap.addEventListener('pointerenter', () => {
      this.hovered = true;
      this.paint();
    });
    wrap.addEventListener('pointerleave', () => {
      this.hovered = false;
      this.paint();
    });

    const scrollToMiniY = (localY: number) => {
      const h = Math.max(1, this.host.clientHeight || this.view.cssHeight);
      const totalMiniH = this.lastContentRows * this.lastRowH;
      const trackSpan = Math.max(1, Math.min(totalMiniH, h) - this.lastSliderH);
      const targetSliderTop = Math.max(0, Math.min(trackSpan, localY - this.dragOffsetY));
      const ratio = targetSliderTop / trackSpan;
      this.view.scrollTop = ratio * this.view.getMaxScrollTop();
      this.view.clampScrollPublic();
      this.view.paint();
      this.onScrollCb?.();
    };

    wrap.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const r = wrap.getBoundingClientRect();
      const y = e.clientY - r.top;
      this.dragging = true;
      if (y >= this.lastSliderTop && y <= this.lastSliderTop + this.lastSliderH) {
        this.dragOffsetY = y - this.lastSliderTop;
      } else {
        this.dragOffsetY = this.lastSliderH / 2;
        scrollToMiniY(y);
      }
      try {
        wrap.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      this.paint();
    });

    wrap.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      e.preventDefault();
      const r = wrap.getBoundingClientRect();
      scrollToMiniY(e.clientY - r.top);
    });

    const endDrag = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      try {
        wrap.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      this.paint();
    };
    wrap.addEventListener('pointerup', endDrag);
    wrap.addEventListener('pointercancel', endDrag);

    this.host.appendChild(wrap);
    this.wrap = wrap;
    this.canvas = canvas;
    this.syncLayout();
    this.paint();
  }

  private unmount(): void {
    this.wrap?.remove();
    this.wrap = null;
    this.canvas = null;
    this.dragging = false;
    this.hovered = false;
  }
}
