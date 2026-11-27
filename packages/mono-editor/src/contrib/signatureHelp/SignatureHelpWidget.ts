import type { WidgetBoxRect } from '../../browser/editor/editorTypes';
import { layoutPopupHorizontally } from '../../browser/view/popupLayout';
import { renderHighlightedCodeToDom, renderMarkdownToDom } from '../../browser/render/markdownDom';
import { DEFAULT_THEME } from '../../common/config/themeTypes';
import { capPopupMaxWidth } from '../../common/util/popupPlacement';
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

export interface SignatureHelpWidgetOptions {
  fontSize?: number;
  fontFamily?: string;
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

const SIG_STYLE_ID = 'mono-sig-vscode-style';

function ensureSigStyle(): void {
  if (typeof document === 'undefined' || !document.head) return;
  if (document.getElementById(SIG_STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = SIG_STYLE_ID;
  s.textContent = `
.mono-signature-help-widget .mono-sig-docs{scrollbar-width:thin;scrollbar-color:rgba(121,121,121,.4) transparent}
.mono-signature-help-widget .mono-sig-docs::-webkit-scrollbar{width:8px;height:8px}
.mono-signature-help-widget .mono-sig-docs::-webkit-scrollbar-track{background:transparent}
.mono-signature-help-widget .mono-sig-docs::-webkit-scrollbar-thumb{background:rgba(121,121,121,.4)}
.mono-signature-help-widget .mono-sig-nav-btn:hover{background:rgba(128,128,128,0.22)}
`;
  document.head.appendChild(s);
}

/**
 * Exact VS Code / Monaco `.parameter-hints-widget` floating Signature Help widget
 * with a slightly more compact max width (`340px`) for crisp readability on desktop & mobile:
 *  - Sharp 3px border-radius, 1px VS Code widget border & subtle shadow
 *  - Compact left overload switcher (`▲ 1/2 ▼`) with tabular-nums
 *  - Syntax-highlighted monospace signature with VS Code bold + blue active parameter highlight
 *  - Active parameter doc + signature overview doc separated by crisp 1px border
 */
export class SignatureHelpWidget {
  private host: HTMLElement;
  private el: HTMLDivElement | null = null;
  private theme: ResolvedWidgetTheme | null = null;
  private fontSize = 14;
  private fontFamily = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
  private lastHelp: SignatureHelp | null = null;
  private lastAnchor: SignatureHelpAnchor | null = null;
  private onPrev: () => void;
  private onNext: () => void;

  constructor(
    host: HTMLElement,
    handlers: { onPrev: () => void; onNext: () => void },
    options?: SignatureHelpWidgetOptions,
  ) {
    this.host = host;
    this.onPrev = handlers.onPrev;
    this.onNext = handlers.onNext;
    if (options?.fontSize != null) this.fontSize = options.fontSize;
    if (options?.fontFamily) this.fontFamily = options.fontFamily;
  }

  setOptions(options: SignatureHelpWidgetOptions): void {
    let changed = false;
    if (options.fontSize != null && options.fontSize !== this.fontSize) {
      this.fontSize = options.fontSize;
      changed = true;
    }
    if (options.fontFamily && options.fontFamily !== this.fontFamily) {
      this.fontFamily = options.fontFamily;
      changed = true;
    }
    if (changed && this.el && this.lastHelp && this.lastAnchor) {
      this.show(this.lastHelp, this.lastAnchor);
    }
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
    ensureSigStyle();
    this.lastHelp = help;
    this.lastAnchor = anchor;

    const sigIdx = Math.max(0, Math.min(help.activeSignature ?? 0, help.signatures.length - 1));
    const sig: SignatureInformation = help.signatures[sigIdx]!;
    const rawParamIdx = sig.activeParameter ?? help.activeParameter ?? 0;
    const paramCount = sig.parameters?.length ?? 0;
    const paramIdx = paramCount > 0 ? Math.max(0, Math.min(rawParamIdx, paramCount - 1)) : -1;
    const activeParam = paramIdx >= 0 ? sig.parameters?.[paramIdx] : undefined;

    const resolved = this.theme ?? resolveWidgetTheme(DEFAULT_THEME);
    const isDark = resolved.isDark;
    const bg = resolved.editorBackground || (isDark ? '#1e1e1e' : '#ffffff');
    const border = resolved.border || (isDark ? '#454545' : '#c8c8c8');
    const fg = resolved.foreground || (isDark ? '#cccccc' : '#616161');
    const muted = resolved.mutedForeground;
    const activeParamColor = isDark ? '#1a85ff' : '#0066bf';
    const vsShadow = isDark ? '0 2px 8px rgba(0, 0, 0, 0.36)' : '0 2px 8px rgba(0, 0, 0, 0.16)';

    const editorSize = Math.max(10, Math.round(this.fontSize || 14));
    const docFontSize = Math.max(10, Math.round(editorSize * 0.92));
    const codeFontSize = Math.max(10, Math.round(editorSize * 0.92));
    const navFontSize = Math.max(10, Math.round(editorSize * 0.82));
    const navIconSize = Math.max(11, Math.round(editorSize * 0.88));
    const compactMaxW = Math.round(340 * Math.max(1, editorSize / 14));

    const el = document.createElement('div');
    el.className = 'mono-signature-help-widget';
    Object.assign(el.style, {
      position: 'absolute',
      zIndex: '46',
      maxWidth: `${capPopupMaxWidth(compactMaxW, this.host.clientWidth)}px`,
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: '3px',
      boxShadow: vsShadow,
      color: fg,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: `${docFontSize}px`,
      lineHeight: '1.45',
      pointerEvents: 'auto',
      overflow: 'hidden',
      boxSizing: 'border-box',
    } as CSSStyleDeclaration);

    // Header row: VS Code `.signature` row (left overload switcher + syntax-highlighted monospace signature)
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'flex-start',
      gap: '6px',
      padding: '5px 8px',
      fontFamily: this.fontFamily,
      fontSize: `${codeFontSize}px`,
      wordBreak: 'normal',
      overflowWrap: 'break-word',
    });

    if (help.signatures.length > 1) {
      const nav = document.createElement('div');
      nav.className = 'mono-sig-overloads';
      Object.assign(nav.style, {
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0px',
        flexShrink: '0',
        color: muted,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: `${navFontSize}px`,
        lineHeight: '1.1',
        fontVariantNumeric: 'tabular-nums',
        userSelect: 'none',
        paddingRight: '6px',
        borderRight: `1px solid ${border}`,
      });
      const mkNavBtn = (iconId: 'chevron-up' | 'chevron-down', label: string, cb: () => void) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'mono-sig-nav-btn';
        b.title = label;
        b.setAttribute('aria-label', label);
        Object.assign(b.style, {
          border: 'none',
          background: 'transparent',
          color: fg,
          cursor: 'pointer',
          padding: '0',
          minWidth: '22px',
          minHeight: '16px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '3px',
        });
        b.appendChild(createIcon(iconId, navIconSize));
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
      count.style.minWidth = '22px';
      count.style.textAlign = 'center';
      nav.appendChild(mkNavBtn('chevron-up', 'Previous signature', this.onPrev));
      nav.appendChild(count);
      nav.appendChild(mkNavBtn('chevron-down', 'Next signature', this.onNext));
      header.appendChild(nav);
    }

    const sigEl = document.createElement('div');
    sigEl.className = 'mono-sig-label';
    sigEl.style.flex = '1';
    sigEl.style.minWidth = '0';
    sigEl.style.lineHeight = '1.45';
    sigEl.style.whiteSpace = 'pre-wrap';
    sigEl.style.wordBreak = 'normal';
    sigEl.style.overflowWrap = 'break-word';
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
      activeSpan.style.color = activeParamColor;
      activeSpan.style.textDecoration = 'underline';
      activeSpan.style.textDecorationThickness = '1.5px';
      activeSpan.style.textUnderlineOffset = '2px';
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
        padding: '5px 8px',
        maxHeight: '150px',
        overflowY: 'auto',
      });
      if (paramDoc) {
        const pWrap = document.createElement('div');
        pWrap.className = 'mono-sig-param-doc';
        pWrap.style.marginBottom = sigDoc ? '4px' : '0';
        renderMarkdownToDom(pWrap, paramDoc, resolved, undefined, {
          flatCodeBlocks: true,
          codeFontFamily: this.fontFamily,
        });
        body.appendChild(pWrap);
      }
      if (sigDoc) {
        const sWrap = document.createElement('div');
        sWrap.className = 'mono-sig-overview-doc';
        sWrap.style.color = muted;
        renderMarkdownToDom(sWrap, sigDoc, resolved, undefined, {
          flatCodeBlocks: true,
          codeFontFamily: this.fontFamily,
        });
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
    const hostH = this.getVisibleHostHeight();
    // Natural-width measure + shift-left-before-shrink (popupLayout.ts); width is then fixed in px.
    const fit = layoutPopupHorizontally(el, anchor.x, hostW);
    const pos = computeSignaturePlacement(
      anchor,
      { width: fit.width, height: fit.height },
      { width: hostW, height: hostH },
      anchor.avoidRect,
    );
    el.style.left = `${pos.left}px`;
    el.style.top = `${pos.top}px`;
  }

  private getVisibleHostHeight(): number {
    const rawH = this.host.clientHeight || 400;
    if (typeof window === 'undefined' || !window.visualViewport) return rawH;
    const vv = window.visualViewport;
    const rect = this.host.getBoundingClientRect();
    if (rect.height <= 0) return rawH;
    const visibleBottom = vv.offsetTop + vv.height;
    const overlap = Math.max(0, Math.round(rect.bottom - visibleBottom));
    return overlap > 40 ? Math.max(120, rawH - overlap) : rawH;
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
