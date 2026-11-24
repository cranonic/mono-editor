import { renderMarkdownToDom } from '../../browser/render/markdownDom';
import { resolveWidgetTheme, type ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';
import { DEFAULT_THEME } from '../../common/config/themeTypes';

export interface HoverWidgetOptions {
  maxWidth?: number;
  background?: string;
  border?: string;
  foreground?: string;
  codeBackground?: string;
  focusBorder?: string;
  shadow?: string;
  fontSize?: number;
  className?: string;
}

/**
 * Theme-aware Markdown hover card (safe DOM rendering, zero innerHTML).
 */
export class HoverWidget {
  private host: HTMLElement;
  private el: HTMLDivElement | null = null;
  private opts: Required<HoverWidgetOptions>;
  private resolvedTheme: ResolvedWidgetTheme;
  private lastContents: string[] = [];
  private lastAnchor: { x: number; y: number } | null = null;

  constructor(host: HTMLElement, options?: HoverWidgetOptions) {
    this.host = host;
    this.resolvedTheme = resolveWidgetTheme(DEFAULT_THEME);
    this.opts = {
      maxWidth: 420,
      background: this.resolvedTheme.background,
      border: `1px solid ${this.resolvedTheme.border}`,
      foreground: this.resolvedTheme.foreground,
      codeBackground: this.resolvedTheme.codeBackground,
      focusBorder: this.resolvedTheme.focusBorder,
      shadow: this.resolvedTheme.shadow,
      fontSize: 12,
      className: '',
      ...options,
    };
  }

  setOptions(o: HoverWidgetOptions): void {
    this.opts = { ...this.opts, ...o };
    if (this.el && this.lastAnchor) {
      this.show(this.lastContents, this.lastAnchor);
    }
  }

  applyTheme(theme: ResolvedWidgetTheme): void {
    this.resolvedTheme = theme;
    this.setOptions({
      background: theme.background,
      border: `1px solid ${theme.border}`,
      foreground: theme.foreground,
      codeBackground: theme.codeBackground,
      focusBorder: theme.focusBorder,
      shadow: theme.shadow,
    });
  }

  isVisible(): boolean {
    return !!this.el;
  }

  show(contents: string[], anchor: { x: number; y: number }): void {
    this.hide();
    this.lastContents = contents;
    this.lastAnchor = anchor;

    const el = document.createElement('div');
    el.className = `mono-hover-widget ${this.opts.className}`.trim();
    Object.assign(el.style, {
      position: 'absolute',
      left: `${Math.max(4, anchor.x)}px`,
      top: `${Math.max(4, anchor.y)}px`,
      zIndex: '46',
      maxWidth: `${Math.min(this.opts.maxWidth, Math.max(200, (this.host.clientWidth || 600) - 16))}px`,
      maxHeight: `${Math.min(280, Math.max(120, (this.host.clientHeight || 400) - 24))}px`,
      overflowY: 'auto',
      background: this.opts.background,
      border: this.opts.border,
      borderRadius: '6px',
      boxShadow: this.opts.shadow,
      padding: '8px 10px',
      color: this.opts.foreground,
      fontSize: `${this.opts.fontSize}px`,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      lineHeight: '1.45',
      wordBreak: 'break-word',
      pointerEvents: 'auto',
      boxSizing: 'border-box',
    } as CSSStyleDeclaration);

    contents.forEach((part, idx) => {
      if (idx > 0) {
        const sep = document.createElement('div');
        sep.style.borderTop = this.opts.border;
        sep.style.margin = '6px 0';
        sep.style.opacity = '0.5';
        el.appendChild(sep);
      }
      renderMarkdownToDom(el, part, this.resolvedTheme);
    });

    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    this.host.appendChild(el);
    this.el = el;

    // Viewport edge clamping
    const hostW = this.host.clientWidth || 600;
    const hostH = this.host.clientHeight || 400;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = Math.max(6, anchor.x);
    let top = Math.max(6, anchor.y);
    if (left + w > hostW - 6) left = Math.max(6, hostW - w - 6);
    if (top + h > hostH - 6) {
      top = Math.max(6, anchor.y - h - 24);
    }
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }

  hide(): void {
    this.el?.remove();
    this.el = null;
    this.lastContents = [];
    this.lastAnchor = null;
  }

  dispose(): void {
    this.hide();
  }
}
