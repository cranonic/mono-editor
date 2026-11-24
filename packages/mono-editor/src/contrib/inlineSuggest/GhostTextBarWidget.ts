import { DEFAULT_THEME } from '../../common/config/themeTypes';
import { resolveWidgetTheme, type ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';

export interface GhostTextBarHandlers {
  onAccept: () => void;
  onAcceptWord: () => void;
  onAcceptLine: () => void;
  onPrev: () => void;
  onNext: () => void;
  onDismiss: () => void;
}

export interface GhostTextBarState {
  candidateCount: number;
  activeIndex: number;
  hasMultiline: boolean;
  anchor: { x: number; y: number; top: number };
}

/**
 * Compact, non-focus-stealing touch/desktop action strip for active Ghost Text
 * (`Accept · Word · Line · 1/2 · Dismiss`). Theme-synced, single elevation, zero decorative dots.
 */
export class GhostTextBarWidget {
  private readonly host: HTMLElement;
  private readonly handlers: GhostTextBarHandlers;
  private el: HTMLDivElement | null = null;
  private theme: ResolvedWidgetTheme = resolveWidgetTheme(DEFAULT_THEME);
  private lastState: GhostTextBarState | null = null;

  constructor(host: HTMLElement, handlers: GhostTextBarHandlers) {
    this.host = host;
    this.handlers = handlers;
  }

  applyTheme(theme: ResolvedWidgetTheme): void {
    this.theme = theme;
    if (this.el && this.lastState) this.show(this.lastState);
  }

  isVisible(): boolean {
    return !!this.el;
  }

  containsNode(node: Node | null): boolean {
    return Boolean(this.el && node && this.el.contains(node));
  }

  show(state: GhostTextBarState): void {
    this.hide();
    this.lastState = state;
    const t = this.theme;

    const el = document.createElement('div');
    el.className = 'mono-ghost-text-bar';
    el.setAttribute('role', 'toolbar');
    el.setAttribute('aria-label', 'Inline suggestion actions');
    Object.assign(el.style, {
      position: 'absolute',
      zIndex: '44',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '2px',
      padding: '3px 6px',
      background: t.background,
      border: `1px solid ${t.border}`,
      borderRadius: '6px',
      boxShadow: t.shadow,
      color: t.foreground,
      fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
      fontSize: '11.5px',
      lineHeight: '1',
      pointerEvents: 'auto',
      userSelect: 'none',
      whiteSpace: 'nowrap',
      boxSizing: 'border-box',
    } as CSSStyleDeclaration);

    const mkBtn = (label: string, title: string, accent: boolean, onClick: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = title;
      Object.assign(b.style, {
        border: 'none',
        background: accent ? t.focusBorder : 'transparent',
        color: accent ? '#ffffff' : t.foreground,
        cursor: 'pointer',
        padding: '5px 8px',
        minHeight: '28px',
        borderRadius: '4px',
        fontSize: '11.5px',
        fontWeight: accent ? '600' : '500',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
      });
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      });
      return b;
    };

    const mkSep = () => {
      const s = document.createElement('span');
      s.setAttribute('aria-hidden', 'true');
      s.style.width = '1px';
      s.style.height = '14px';
      s.style.background = t.border;
      s.style.margin = '0 2px';
      return s;
    };

    el.appendChild(mkBtn('Accept', 'Accept suggestion (Tab)', true, this.handlers.onAccept));
    el.appendChild(mkBtn('Word', 'Accept next word (Ctrl+Right)', false, this.handlers.onAcceptWord));
    if (state.hasMultiline) {
      el.appendChild(mkBtn('Line', 'Accept next line', false, this.handlers.onAcceptLine));
    }

    if (state.candidateCount > 1) {
      el.appendChild(mkSep());
      el.appendChild(mkBtn('‹', 'Previous suggestion (Alt+[)', false, this.handlers.onPrev));
      const count = document.createElement('span');
      count.textContent = `${state.activeIndex + 1}/${state.candidateCount}`;
      count.style.color = t.mutedForeground;
      count.style.fontVariantNumeric = 'tabular-nums';
      count.style.padding = '0 3px';
      el.appendChild(count);
      el.appendChild(mkBtn('›', 'Next suggestion (Alt+])', false, this.handlers.onNext));
    }

    el.appendChild(mkSep());
    el.appendChild(mkBtn('Dismiss', 'Dismiss suggestion (Esc)', false, this.handlers.onDismiss));

    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('mousedown', (e) => e.preventDefault());
    this.host.appendChild(el);
    this.el = el;

    // Place compactly above the anchor line (or below if near top edge)
    const hostW = this.host.clientWidth || 600;
    const hostH = this.host.clientHeight || 400;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = Math.max(6, Math.min(state.anchor.x, hostW - w - 8));
    let top = state.anchor.top - h - 6;
    if (top < 6) {
      top = Math.min(hostH - h - 8, state.anchor.y + 6);
    }
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(Math.max(4, top))}px`;
  }

  hide(): void {
    this.el?.remove();
    this.el = null;
    this.lastState = null;
  }

  dispose(): void {
    this.hide();
  }
}
