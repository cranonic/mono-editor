import { renderMarkdownToDom } from '../../browser/render/markdownDom';
import { DEFAULT_THEME } from '../../common/config/themeTypes';
import type { IMarker } from '../../common/decorations/types';
import { createIcon, ensureCodicons } from '../../platform/icons';
import { resolveWidgetTheme, type ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';

export interface HoverActionItem {
  readonly label: string;
  readonly title?: string;
  readonly run: () => void;
}

export interface HoverCardData {
  readonly diagnostics?: readonly IMarker[];
  readonly contents: readonly string[];
  readonly actions?: readonly HoverActionItem[];
}

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
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

const HOVER_STYLE_ID = 'mono-hover-vscode-style';

function ensureHoverStyle(): void {
  if (typeof document === 'undefined' || !document.head) return;
  if (document.getElementById(HOVER_STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = HOVER_STYLE_ID;
  s.textContent = `
.mono-hover-widget .mono-hover-scroll{scrollbar-width:thin;scrollbar-color:rgba(121,121,121,.4) transparent}
.mono-hover-widget .mono-hover-scroll::-webkit-scrollbar{width:8px;height:8px}
.mono-hover-widget .mono-hover-scroll::-webkit-scrollbar-track{background:transparent}
.mono-hover-widget .mono-hover-scroll::-webkit-scrollbar-thumb{background:rgba(121,121,121,.4)}
.mono-hover-widget .mono-hover-scroll::-webkit-scrollbar-thumb:hover{background:rgba(100,100,100,.7)}
.mono-hover-widget .mono-hover-action-btn:hover{text-decoration:underline}
`;
  document.head.appendChild(s);
}

/**
 * Exact VS Code / Monaco `.monaco-hover` unified Hover Docs & Diagnostics widget:
 *  1. Diagnostics row (VS Code severity icon + message + muted source/code)
 *  2. Stacked `.hover-row` Markdown/signature sections separated by crisp 1px borders
 *  3. VS Code `.status-bar` footer action links (Quick Fix..., Go to Definition, Peek References)
 */
export class HoverWidget {
  private host: HTMLElement;
  private el: HTMLDivElement | null = null;
  private opts: Required<Omit<HoverWidgetOptions, 'onMouseEnter' | 'onMouseLeave'>> &
    Pick<HoverWidgetOptions, 'onMouseEnter' | 'onMouseLeave'>;
  private resolvedTheme: ResolvedWidgetTheme;
  private lastData: HoverCardData | null = null;
  private lastAnchor: { x: number; y: number; top?: number } | null = null;
  private pointerInside = false;

  constructor(host: HTMLElement, options?: HoverWidgetOptions) {
    this.host = host;
    this.resolvedTheme = resolveWidgetTheme(DEFAULT_THEME);
    this.opts = {
      maxWidth: 460,
      background: this.resolvedTheme.background,
      border: `1px solid ${this.resolvedTheme.border}`,
      foreground: this.resolvedTheme.foreground,
      codeBackground: this.resolvedTheme.codeBackground,
      focusBorder: this.resolvedTheme.focusBorder,
      shadow: this.resolvedTheme.shadow,
      fontSize: 13,
      className: '',
      ...options,
    };
  }

  setOptions(o: HoverWidgetOptions): void {
    this.opts = { ...this.opts, ...o };
    if (this.el && this.lastData && this.lastAnchor) {
      this.showCard(this.lastData, this.lastAnchor);
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

  isPointerInside(): boolean {
    return this.pointerInside;
  }

  containsNode(node: Node | null): boolean {
    return Boolean(this.el && node && this.el.contains(node));
  }

  /** Backward-compatible overload accepting plain markdown strings. */
  show(contents: string[], anchor: { x: number; y: number; top?: number }): void {
    this.showCard({ contents }, anchor);
  }

  showCard(data: HoverCardData, anchor: { x: number; y: number; top?: number }): void {
    this.hide();
    const diagnostics = data.diagnostics ?? [];
    const contents = data.contents ?? [];
    const actions = data.actions ?? [];
    if (!diagnostics.length && !contents.length) return;

    ensureCodicons();
    ensureHoverStyle();
    this.lastData = data;
    this.lastAnchor = anchor;

    const isDark = this.resolvedTheme.isDark;
    const vsBg = this.opts.background || (isDark ? '#252526' : '#f3f3f3');
    const vsBorderColor = this.resolvedTheme.border || (isDark ? '#454545' : '#c8c8c8');
    const vsBorder = this.opts.border || `1px solid ${vsBorderColor}`;
    const vsShadow = isDark ? '0 2px 8px rgba(0, 0, 0, 0.36)' : '0 2px 8px rgba(0, 0, 0, 0.16)';
    const vsLinkColor = isDark ? '#3794ff' : '#006ab1';
    const vsStatusBarBg = isDark ? '#2c2c2d' : '#e7e7e7';

    const el = document.createElement('div');
    el.className = `mono-hover-widget ${this.opts.className}`.trim();
    el.setAttribute('role', 'tooltip');
    Object.assign(el.style, {
      position: 'absolute',
      left: `${Math.max(4, anchor.x)}px`,
      top: `${Math.max(4, anchor.y)}px`,
      zIndex: '47',
      maxWidth: `${Math.min(this.opts.maxWidth, Math.max(220, (this.host.clientWidth || 600) - 16))}px`,
      maxHeight: `${Math.min(340, Math.max(140, (this.host.clientHeight || 400) - 24))}px`,
      display: 'flex',
      flexDirection: 'column',
      background: vsBg,
      border: vsBorder,
      borderRadius: '3px',
      boxShadow: vsShadow,
      color: this.opts.foreground,
      fontSize: `${this.opts.fontSize}px`,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      lineHeight: '1.45',
      wordBreak: 'break-word',
      pointerEvents: 'auto',
      overflow: 'hidden',
      boxSizing: 'border-box',
    } as CSSStyleDeclaration);

    const scrollBody = document.createElement('div');
    scrollBody.className = 'mono-hover-scroll';
    Object.assign(scrollBody.style, {
      overflowY: 'auto',
      overflowX: 'hidden',
      flex: '1 1 auto',
      minHeight: '0',
    });

    let sectionCount = 0;
    const appendSection = (compactCode = false): HTMLDivElement => {
      const sec = document.createElement('div');
      sec.className = 'mono-hover-section';
      Object.assign(sec.style, {
        padding: compactCode ? '4px 8px' : '5px 8px',
        borderTop: sectionCount > 0 ? vsBorder : 'none',
      });
      sectionCount++;
      scrollBody.appendChild(sec);
      return sec;
    };

    // 1. Unified Diagnostics section (exact VS Code marker hover row)
    if (diagnostics.length > 0) {
      const diagSec = appendSection(false);
      diagSec.classList.add('mono-hover-diagnostics');
      diagnostics.forEach((mk, idx) => {
        const row = document.createElement('div');
        Object.assign(row.style, {
          display: 'flex',
          alignItems: 'flex-start',
          gap: '6px',
          marginTop: idx > 0 ? '4px' : '0',
        });

        const isErr = mk.severity >= 8;
        const isWarn = !isErr && mk.severity >= 4;
        const iconName = isErr ? 'error' : isWarn ? 'warning' : 'info';
        const sevLabel = isErr ? 'Error' : isWarn ? 'Warning' : mk.severity >= 2 ? 'Info' : 'Hint';
        const sevColor = isErr ? '#f14c4c' : isWarn ? '#cca700' : '#3794ff';

        const iconWrap = document.createElement('span');
        iconWrap.style.color = sevColor;
        iconWrap.style.flexShrink = '0';
        iconWrap.style.marginTop = '2px';
        iconWrap.style.display = 'inline-flex';
        iconWrap.setAttribute('aria-label', sevLabel);
        iconWrap.appendChild(createIcon(iconName, 14));
        row.appendChild(iconWrap);

        const textWrap = document.createElement('div');
        textWrap.style.flex = '1';
        textWrap.style.minWidth = '0';
        const msgSpan = document.createElement('span');
        msgSpan.textContent = mk.message;
        textWrap.appendChild(msgSpan);

        const metaParts: string[] = [];
        if (mk.source) metaParts.push(mk.source);
        if (mk.code !== undefined && mk.code !== '') metaParts.push(String(mk.code));
        if (metaParts.length > 0) {
          const metaSpan = document.createElement('span');
          metaSpan.textContent = ` (${metaParts.join(' ')})`;
          metaSpan.style.color = this.resolvedTheme.mutedForeground;
          metaSpan.style.fontVariantNumeric = 'tabular-nums';
          textWrap.appendChild(metaSpan);
        }

        row.appendChild(textWrap);
        diagSec.appendChild(row);
      });
    }

    // 2. Hover Docs Markdown sections (exact VS Code .hover-row stacked layout)
    for (const part of contents) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const isCodeOnly = trimmed.startsWith('```') && trimmed.endsWith('```') && trimmed.indexOf('```', 3) === trimmed.length - 3;
      const docSec = appendSection(isCodeOnly);
      renderMarkdownToDom(docSec, part, this.resolvedTheme, undefined, { flatCodeBlocks: isCodeOnly });
    }

    el.appendChild(scrollBody);

    // 3. Exact VS Code `.hover-row.status-bar` Action Footer Bar
    if (actions.length > 0) {
      const footer = document.createElement('div');
      footer.className = 'mono-hover-actions';
      Object.assign(footer.style, {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '12px',
        padding: '2px 8px',
        minHeight: '24px',
        borderTop: vsBorder,
        background: vsStatusBarBg,
        flexShrink: '0',
      });

      for (const act of actions) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mono-hover-action-btn';
        btn.textContent = act.label;
        if (act.title) btn.title = act.title;
        Object.assign(btn.style, {
          border: 'none',
          background: 'transparent',
          color: vsLinkColor,
          cursor: 'pointer',
          padding: '2px 0',
          minHeight: '22px',
          fontSize: '12px',
          fontWeight: '400',
          fontFamily: 'inherit',
          whiteSpace: 'nowrap',
          display: 'inline-flex',
          alignItems: 'center',
        });
        btn.addEventListener('pointerdown', (e) => e.stopPropagation());
        btn.addEventListener('mousedown', (e) => e.preventDefault());
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          act.run();
        });
        footer.appendChild(btn);
      }
      el.appendChild(footer);
    }

    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    el.addEventListener('mouseenter', () => {
      this.pointerInside = true;
      this.opts.onMouseEnter?.();
    });
    el.addEventListener('mouseleave', () => {
      this.pointerInside = false;
      this.opts.onMouseLeave?.();
    });

    this.host.appendChild(el);
    this.el = el;

    // Position above the target line by default (like VS Code/Monaco), flipping below if tight at top
    const hostW = this.host.clientWidth || 600;
    const hostH = this.host.clientHeight || 400;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const lineTop = anchor.top ?? Math.max(0, anchor.y - 22);
    let left = Math.max(6, anchor.x);
    if (left + w > hostW - 6) left = Math.max(6, hostW - w - 6);
    let top = lineTop - h - 4;
    if (top < 6) {
      top = Math.min(hostH - h - 6, anchor.y + 3);
    }
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(Math.max(4, top))}px`;
  }

  hide(): void {
    this.pointerInside = false;
    this.el?.remove();
    this.el = null;
    this.lastData = null;
    this.lastAnchor = null;
  }

  dispose(): void {
    this.hide();
  }
}
