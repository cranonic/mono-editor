import { renderHighlightedCodeToDom, renderMarkdownToDom } from '../../browser/render/markdownDom';
import { DEFAULT_THEME } from '../../common/config/themeTypes';
import { resolveParameterLabelRange } from '../../common/languages/callContext';
import type { SignatureHelp, SignatureInformation } from '../../common/languages/providers/types';
import { createIcon, ensureCodicons } from '../../platform/icons';
import { resolveWidgetTheme, type ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';

export interface SignatureHelpAnchor {
  x: number;
  y: number;
  top?: number;
  languageId?: string;
}

function docStringOf(doc: string | { value: string } | undefined): string {
  if (!doc) return '';
  return typeof doc === 'string' ? doc : doc.value || '';
}

/**
 * Exact VS Code / Monaco-faithful floating Parameter Hints / Signature Help widget:
 *  - Syntax-highlighted signature line with bold + accent + underlined active parameter
 *  - Safe `[start, end]` and comma-aware substring parameter range matching
 *  - Tabular-nums overload switcher (`▲ 1/2 ▼`) with touch-friendly hit targets
 *  - Active parameter doc + muted function overview doc separated by crisp 1px hairline
 */
export class SignatureHelpWidget {
  private host: HTMLElement;
  private el: HTMLDivElement | null = null;
  private theme: ResolvedWidgetTheme | null = null;
  private lastHelp: SignatureHelp | null = null;
  private lastAnchor: SignatureHelpAnchor | null = null;
  private onPrev: () => void;
  private onNext: () => void;

  constructor(host: HTMLElement, handlers: { onPrev: () => void; onNext: () => void }) {
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

  containsNode(node: Node | null): boolean {
    return Boolean(this.el && node && this.el.contains(node));
  }

  show(help: SignatureHelp, anchor: SignatureHelpAnchor): void {
    this.hide();
    if (!help.signatures.length) return;
    ensureCodicons();
    this.lastHelp = help;
    this.lastAnchor = anchor;

    const sigIdx = Math.max(0, Math.min(help.activeSignature ?? 0, help.signatures.length - 1));
    const sig: SignatureInformation = help.signatures[sigIdx]!;
    const rawParamIdx = sig.activeParameter ?? help.activeParameter ?? 0;
    const paramCount = sig.parameters?.length ?? 0;
    const paramIdx = paramCount > 0 ? Math.max(0, Math.min(rawParamIdx, paramCount - 1)) : -1;
    const activeParam = paramIdx >= 0 ? sig.parameters?.[paramIdx] : undefined;

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
      maxWidth: `${Math.min(480, Math.max(220, (this.host.clientWidth || 600) - 16))}px`,
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: '6px',
      boxShadow: shadow,
      color: fg,
      fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
      fontSize: '12px',
      lineHeight: '1.45',
      pointerEvents: 'auto',
      overflow: 'hidden',
      boxSizing: 'border-box',
    } as CSSStyleDeclaration);

    // Header row: overload switcher + syntax-highlighted signature label
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '6px 10px',
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: '12px',
      wordBreak: 'break-word',
    });

    if (help.signatures.length > 1) {
      const nav = document.createElement('div');
      nav.className = 'mono-sig-overloads';
      Object.assign(nav.style, {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '2px',
        flexShrink: '0',
        color: muted,
        fontSize: '11px',
        fontVariantNumeric: 'tabular-nums',
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
          padding: '4px',
          minWidth: '24px',
          minHeight: '24px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '4px',
        });
        b.appendChild(createIcon(iconId, 12));
        b.addEventListener('pointerdown', (e) => e.stopPropagation());
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          cb();
        });
        return b;
      };
      const count = document.createElement('span');
      count.className = 'mono-sig-overload-count';
      count.textContent = `${sigIdx + 1}/${help.signatures.length}`;
      count.style.minWidth = '24px';
      count.style.textAlign = 'center';
      nav.appendChild(mkNavBtn('chevron-up', 'Previous signature', this.onPrev));
      nav.appendChild(count);
      nav.appendChild(mkNavBtn('chevron-down', 'Next signature', this.onNext));
      header.appendChild(nav);
    }

    const sigEl = document.createElement('div');
    sigEl.className = 'mono-sig-label';
    sigEl.style.flex = '1';
    sigEl.style.lineHeight = '1.45';
    const range = resolveParameterLabelRange(
      sig.label,
      activeParam?.label,
      Math.max(0, paramIdx),
      sig.parameters,
    );
    const langHint = anchor.languageId || 'typescript';
    if (!range) {
      renderHighlightedCodeToDom(sigEl, sig.label, langHint, fg);
    } else {
      const [s, e] = range;
      if (s > 0) {
        const beforeSpan = document.createElement('span');
        renderHighlightedCodeToDom(beforeSpan, sig.label.slice(0, s), langHint, fg);
        sigEl.appendChild(beforeSpan);
      }
      const activeSpan = document.createElement('span');
      activeSpan.className = 'mono-sig-active-param';
      activeSpan.textContent = sig.label.slice(s, e);
      activeSpan.style.fontWeight = '700';
      activeSpan.style.color = accent;
      activeSpan.style.textDecoration = 'underline';
      activeSpan.style.textDecorationThickness = '1.5px';
      activeSpan.style.textUnderlineOffset = '3px';
      sigEl.appendChild(activeSpan);
      if (e < sig.label.length) {
        const afterSpan = document.createElement('span');
        renderHighlightedCodeToDom(afterSpan, sig.label.slice(e), langHint, fg);
        sigEl.appendChild(afterSpan);
      }
    }
    header.appendChild(sigEl);
    el.appendChild(header);

    const paramDoc = docStringOf(activeParam?.documentation);
    const sigDoc = docStringOf(sig.documentation);
    if (paramDoc || sigDoc) {
      const body = document.createElement('div');
      body.className = 'mono-sig-docs';
      Object.assign(body.style, {
        borderTop: `1px solid ${border}`,
        padding: '7px 10px',
        maxHeight: '170px',
        overflowY: 'auto',
      });
      if (paramDoc) {
        const pWrap = document.createElement('div');
        pWrap.className = 'mono-sig-param-doc';
        pWrap.style.marginBottom = sigDoc ? '6px' : '0';
        renderMarkdownToDom(pWrap, paramDoc, resolved);
        body.appendChild(pWrap);
      }
      if (sigDoc) {
        const sWrap = document.createElement('div');
        sWrap.className = 'mono-sig-overview-doc';
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

    // Position above the caret line by default (preventing overlap with autocomplete below)
    const hostW = this.host.clientWidth || 600;
    const hostH = this.host.clientHeight || 400;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const lineTop = anchor.top ?? Math.max(0, anchor.y - 22);
    let left = Math.max(6, anchor.x);
    if (left + w > hostW - 6) left = Math.max(6, hostW - w - 6);
    let top = lineTop - h - 5;
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
