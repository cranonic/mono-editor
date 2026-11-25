import type { WidgetBoxRect } from '../../browser/editor/editorTypes';
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
  avoidRect?: WidgetBoxRect | null;
}

export function computeSignaturePlacement(
  anchor: { x: number; y: number; top?: number },
  widgetSize: { width: number; height: number },
  hostSize: { width: number; height: number },
  avoidRect?: WidgetBoxRect | null,
): { left: number; top: number } {
  const hostW = Math.max(100, hostSize.width || 600);
  const hostH = Math.max(100, hostSize.height || 400);
  const w = Math.max(0, widgetSize.width);
  const h = Math.max(0, widgetSize.height);
  const lineTop = anchor.top ?? Math.max(0, anchor.y - 22);
  const margin = 6;

  let left = Math.max(margin, anchor.x);
  if (left + w > hostW - margin) left = Math.max(margin, hostW - w - margin);

  const aboveTop = lineTop - h - 5;
  const belowTop = anchor.y + 4;

  const overlapsAvoid = (l: number, t: number): boolean => {
    if (!avoidRect) return false;
    return (
      l < avoidRect.left + avoidRect.width &&
      l + w > avoidRect.left &&
      t < avoidRect.top + avoidRect.height &&
      t + h > avoidRect.top
    );
  };

  if (avoidRect) {
    const avoidIsBelow = avoidRect.top >= lineTop;
    // Prefer the opposite side of the caret line from the completion list
    if (avoidIsBelow) {
      if (aboveTop >= 4 && !overlapsAvoid(left, aboveTop)) {
        return { left: Math.round(left), top: Math.round(aboveTop) };
      }
      // Try clamped above if it still avoids the completion list
      const clampedAbove = Math.max(4, Math.min(aboveTop, avoidRect.top - h - 4));
      if (!overlapsAvoid(left, clampedAbove)) {
        return { left: Math.round(left), top: Math.round(clampedAbove) };
      }
      // Fallback: below the avoidRect
      const underAvoid = avoidRect.top + avoidRect.height + 4;
      if (underAvoid + h <= hostH - 4) {
        return { left: Math.round(left), top: Math.round(underAvoid) };
      }
    } else {
      if (belowTop + h <= hostH - 4 && !overlapsAvoid(left, belowTop)) {
        return { left: Math.round(left), top: Math.round(belowTop) };
      }
      const clampedBelow = Math.min(hostH - h - 4, Math.max(belowTop, avoidRect.top + avoidRect.height + 4));
      if (!overlapsAvoid(left, clampedBelow)) {
        return { left: Math.round(left), top: Math.round(clampedBelow) };
      }
      const overAvoid = Math.max(4, avoidRect.top - h - 4);
      if (!overlapsAvoid(left, overAvoid)) {
        return { left: Math.round(left), top: Math.round(overAvoid) };
      }
    }
    // Try beside the avoidRect horizontally if vertical sides are tight
    const rightOfAvoid = avoidRect.left + avoidRect.width + 6;
    if (rightOfAvoid + w <= hostW - 4) {
      return { left: Math.round(rightOfAvoid), top: Math.round(Math.max(4, Math.min(lineTop, hostH - h - 4))) };
    }
    const leftOfAvoid = avoidRect.left - w - 6;
    if (leftOfAvoid >= 4) {
      return { left: Math.round(leftOfAvoid), top: Math.round(Math.max(4, Math.min(lineTop, hostH - h - 4))) };
    }
  }

  let top = aboveTop;
  if (top < margin) {
    top = Math.min(hostH - h - margin, belowTop);
  }
  return { left: Math.round(left), top: Math.round(Math.max(4, top)) };
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

    const hostW = this.host.clientWidth || 600;
    const hostH = this.host.clientHeight || 400;
    const pos = computeSignaturePlacement(
      anchor,
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: hostW, height: hostH },
      anchor.avoidRect,
    );
    el.style.left = `${pos.left}px`;
    el.style.top = `${pos.top}px`;
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
