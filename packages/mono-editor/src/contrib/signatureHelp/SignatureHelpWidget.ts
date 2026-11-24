import type { SignatureHelp, SignatureInformation, ParameterInformation } from '../../common/languages/providers/types';
import { renderMarkdownToDom } from '../../browser/render/markdownDom';
import { resolveWidgetTheme, type ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';
import { DEFAULT_THEME } from '../../common/config/themeTypes';
import { createIcon, ensureCodicons } from '../../platform/icons';

export interface SignatureHelpAnchor {
  x: number;
  y: number;
  top?: number;
}

function docStringOf(doc: string | { value: string } | undefined): string {
  if (!doc) return '';
  return typeof doc === 'string' ? doc : doc.value || '';
}

function parameterRange(sigLabel: string, param: ParameterInformation | undefined): [number, number] | null {
  if (!param) return null;
  if (Array.isArray(param.label)) {
    const [s, e] = param.label;
    if (s >= 0 && e > s && e <= sigLabel.length) return [s, e];
    return null;
  }
  const idx = sigLabel.indexOf(param.label);
  return idx >= 0 ? [idx, idx + param.label.length] : null;
}

/**
 * Floating parameter-hints / signature-help widget.
 * Highlights the active parameter, supports overload switching, and syncs live with editor theme.
 */
export class SignatureHelpWidget {
  private host: HTMLElement;
  private el: HTMLDivElement | null = null;
  private theme: ResolvedWidgetTheme | null = null;
  private lastHelp: SignatureHelp | null = null;
  private lastAnchor: SignatureHelpAnchor | null = null;
  private onPrev: () => void;
  private onNext: () => void;

  constructor(
    host: HTMLElement,
    handlers: { onPrev: () => void; onNext: () => void },
  ) {
    this.host = host;
    this.onPrev = handlers.onPrev;
    this.onNext = handlers.onNext;
  }

  applyTheme(theme: ResolvedWidgetTheme): void {
    this.theme = theme;
    if (this.el && this.lastHelp && this.lastAnchor) {
      this.show(this.lastHelp, this.lastAnchor);
    }
  }

  isVisible(): boolean {
    return !!this.el;
  }

  show(help: SignatureHelp, anchor: SignatureHelpAnchor): void {
    this.hide();
    if (!help.signatures.length) return;
    ensureCodicons();
    this.lastHelp = help;
    this.lastAnchor = anchor;

    const sigIdx = Math.max(0, Math.min(help.activeSignature ?? 0, help.signatures.length - 1));
    const sig: SignatureInformation = help.signatures[sigIdx]!;
    const paramIdx = Math.max(
      0,
      Math.min(
        sig.activeParameter ?? help.activeParameter ?? 0,
        Math.max(0, (sig.parameters?.length ?? 1) - 1),
      ),
    );
    const activeParam = sig.parameters?.[paramIdx];

    const resolved = this.theme ?? resolveWidgetTheme(DEFAULT_THEME);
    const bg = resolved.background;
    const border = resolved.border;
    const fg = resolved.foreground;
    const muted = resolved.mutedForeground;
    const accent = resolved.focusBorder;
    const shadow = resolved.shadow;

    const el = document.createElement('div');
    el.className = 'mono-signature-help-widget';
    Object.assign(el.style, {
      position: 'absolute',
      zIndex: '46',
      maxWidth: `${Math.min(460, Math.max(220, (this.host.clientWidth || 600) - 16))}px`,
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: '5px',
      boxShadow: shadow,
      color: fg,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '12px',
      lineHeight: '1.45',
      pointerEvents: 'auto',
      overflow: 'hidden',
      boxSizing: 'border-box',
    } as CSSStyleDeclaration);

    // Header row: overload switcher + signature label
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'flex-start',
      gap: '6px',
      padding: '6px 9px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: '12px',
      wordBreak: 'break-word',
    });

    if (help.signatures.length > 1) {
      const nav = document.createElement('div');
      Object.assign(nav.style, {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '2px',
        flexShrink: '0',
        color: muted,
        fontSize: '11px',
        userSelect: 'none',
      });
      const mkNavBtn = (iconId: 'chevron-up' | 'chevron-down', label: string, cb: () => void) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.title = label;
        b.setAttribute('aria-label', label);
        Object.assign(b.style, {
          border: 'none',
          background: 'transparent',
          color: fg,
          cursor: 'pointer',
          padding: '1px',
          display: 'inline-flex',
          alignItems: 'center',
          borderRadius: '3px',
        });
        b.appendChild(createIcon(iconId, 12));
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          cb();
        });
        return b;
      };
      const count = document.createElement('span');
      count.textContent = `${sigIdx + 1}/${help.signatures.length}`;
      nav.appendChild(mkNavBtn('chevron-up', 'Previous signature', this.onPrev));
      nav.appendChild(count);
      nav.appendChild(mkNavBtn('chevron-down', 'Next signature', this.onNext));
      header.appendChild(nav);
    }

    const sigEl = document.createElement('div');
    sigEl.style.flex = '1';
    const range = parameterRange(sig.label, activeParam);
    if (!range) {
      sigEl.textContent = sig.label;
    } else {
      const [s, e] = range;
      if (s > 0) sigEl.appendChild(document.createTextNode(sig.label.slice(0, s)));
      const activeSpan = document.createElement('span');
      activeSpan.className = 'mono-sig-active-param';
      activeSpan.textContent = sig.label.slice(s, e);
      activeSpan.style.fontWeight = '700';
      activeSpan.style.color = accent;
      activeSpan.style.textDecoration = 'underline';
      activeSpan.style.textUnderlineOffset = '2px';
      sigEl.appendChild(activeSpan);
      if (e < sig.label.length) sigEl.appendChild(document.createTextNode(sig.label.slice(e)));
    }
    header.appendChild(sigEl);
    el.appendChild(header);

    const paramDoc = docStringOf(activeParam?.documentation);
    const sigDoc = docStringOf(sig.documentation);
    if (paramDoc || sigDoc) {
      const body = document.createElement('div');
      Object.assign(body.style, {
        borderTop: `1px solid ${border}`,
        padding: '6px 9px',
        maxHeight: '160px',
        overflowY: 'auto',
      });
      if (paramDoc) {
        const pWrap = document.createElement('div');
        pWrap.style.marginBottom = sigDoc ? '5px' : '0';
        renderMarkdownToDom(pWrap, paramDoc, resolved);
        body.appendChild(pWrap);
      }
      if (sigDoc) {
        const sWrap = document.createElement('div');
        sWrap.style.color = muted;
        renderMarkdownToDom(sWrap, sigDoc, resolved);
        body.appendChild(sWrap);
      }
      el.appendChild(body);
    }

    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    this.host.appendChild(el);
    this.el = el;

    // Position above the caret line by default (VS Code places parameter hints above so Suggest can stay below)
    const hostW = this.host.clientWidth || 600;
    const hostH = this.host.clientHeight || 400;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const lineTop = anchor.top ?? Math.max(0, anchor.y - 22);
    let left = Math.max(6, anchor.x);
    if (left + w > hostW - 6) left = Math.max(6, hostW - w - 6);
    let top = lineTop - h - 4;
    if (top < 6) {
      top = Math.min(hostH - h - 6, anchor.y + 4);
    }
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(Math.max(4, top))}px`;
  }

  hide(): void {
    this.el?.remove();
    this.el = null;
    this.lastHelp = null;
    this.lastAnchor = null;
  }

  dispose(): void {
    this.hide();
  }
}
