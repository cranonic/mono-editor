import { createIcon, ensureCodicons } from '../../platform/icons';
import type { ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';

export interface RenameAnchorRect {
  x: number;
  y: number;
  h: number;
}

export interface RenameViewportRect {
  width: number;
  height: number;
  topInset: number;
}

/**
 * Focus-safe inline rename input widget (`F2`).
 * - Tracks its anchored symbol smoothly during editor scroll without closing.
 * - Preserves DOM & user draft text (`visibility: hidden`) when scrolled out of viewport.
 * - Immune to self-tap dismissal and soft-keyboard resize/scroll events.
 */
export class InlineRenameWidget {
  private host: HTMLElement;
  private el: HTMLDivElement | null = null;
  private input: HTMLInputElement | null = null;
  private theme: ResolvedWidgetTheme | null = null;
  private onSubmitCb: ((newName: string) => void) | null = null;
  private onCancelCb: (() => void) | null = null;
  private hiddenOutOfView = false;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  applyTheme(theme: ResolvedWidgetTheme): void {
    this.theme = theme;
    if (!this.el || !this.input) return;
    this.el.style.background = theme.background;
    this.el.style.border = `1px solid ${theme.border}`;
    this.el.style.boxShadow = theme.shadow;
    this.el.style.color = theme.foreground;
    this.input.style.background = theme.inputBackground;
    this.input.style.border = `1px solid ${theme.focusBorder}`;
    this.input.style.color = theme.inputForeground;
  }

  isOpen(): boolean {
    return !!this.el;
  }

  isHiddenOutOfView(): boolean {
    return this.isOpen() && this.hiddenOutOfView;
  }

  getElement(): HTMLDivElement | null {
    return this.el;
  }

  getInputElement(): HTMLInputElement | null {
    return this.input;
  }

  getInputValue(): string {
    return this.input?.value ?? '';
  }

  containsTarget(target: EventTarget | null): boolean {
    return Boolean(this.el && target instanceof Node && this.el.contains(target));
  }

  open(
    initialValue: string,
    anchor: RenameAnchorRect,
    handlers: { onSubmit: (newName: string) => void; onCancel: () => void },
    viewport?: RenameViewportRect,
  ): void {
    this.close(false);
    ensureCodicons();
    this.onSubmitCb = handlers.onSubmit;
    this.onCancelCb = handlers.onCancel;
    this.hiddenOutOfView = false;

    const bg = this.theme?.background ?? '#252526';
    const border = this.theme?.border ?? '#454545';
    const fg = this.theme?.foreground ?? '#cccccc';
    const muted = this.theme?.mutedForeground ?? '#9d9d9d';
    const inBg = this.theme?.inputBackground ?? '#3c3c3c';
    const inFg = this.theme?.inputForeground ?? '#ffffff';
    const accent = this.theme?.focusBorder ?? '#007fd4';
    const shadow = this.theme?.shadow ?? '0 4px 16px rgba(0,0,0,0.45)';

    const el = document.createElement('div');
    el.className = 'mono-rename-widget';
    el.setAttribute('data-mono-focusable', 'true');
    Object.assign(el.style, {
      position: 'absolute',
      zIndex: '48',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      padding: '6px 8px',
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: '4px',
      boxShadow: shadow,
      color: fg,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '12px',
      minWidth: '210px',
      pointerEvents: 'auto',
      userSelect: 'text',
      visibility: 'visible',
    } as CSSStyleDeclaration);

    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '4px' });

    const input = document.createElement('input');
    input.type = 'text';
    input.value = initialValue;
    input.setAttribute('aria-label', 'Rename symbol');
    input.setAttribute('data-mono-focusable', 'true');
    Object.assign(input.style, {
      flex: '1',
      minWidth: '160px',
      height: '24px',
      padding: '0 6px',
      background: inBg,
      color: inFg,
      border: `1px solid ${accent}`,
      borderRadius: '2px',
      outline: 'none',
      fontSize: '13px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      userSelect: 'text',
      cursor: 'text',
    } as CSSStyleDeclaration);

    const hint = document.createElement('div');
    hint.textContent = 'Enter to Rename, Esc to Cancel';
    hint.style.fontSize = '10px';
    hint.style.color = muted;

    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = input.value.trim();
        const cb = this.onSubmitCb;
        this.close(false);
        if (val) cb?.(val);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close(true);
      }
    });

    // Self-tap protection: never allow pointer/touch events inside the popup to bubble
    // to the editor canvas PointerController and dismiss the rename session.
    const stopBubble = (e: Event) => e.stopPropagation();
    el.addEventListener('pointerdown', stopBubble);
    el.addEventListener('pointerup', stopBubble);
    el.addEventListener('mousedown', stopBubble);
    el.addEventListener('touchstart', stopBubble, { passive: true });
    el.addEventListener('click', stopBubble);

    row.appendChild(createIcon('edit', 14));
    row.appendChild(input);
    el.appendChild(row);
    el.appendChild(hint);
    this.host.appendChild(el);
    this.el = el;
    this.input = input;

    this.updatePosition(
      anchor,
      viewport ?? {
        width: this.host.clientWidth || 600,
        height: this.host.clientHeight || 400,
        topInset: 0,
      },
    );

    input.focus();
    input.select();
  }

  /**
   * Repositions the popup to track its anchored symbol on scroll/layout.
   * When scrolled out of viewport, hides visually (`visibility: hidden`) WITHOUT
   * closing or losing the user's draft input text, and restores when scrolled back in view.
   */
  updatePosition(anchor: RenameAnchorRect, viewport: RenameViewportRect): void {
    if (!this.el) return;
    const hostW = viewport.width || this.host.clientWidth || 600;
    const hostH = viewport.height || this.host.clientHeight || 400;
    const topInset = Math.max(0, viewport.topInset || 0);

    const outOfView =
      anchor.y + anchor.h < topInset ||
      anchor.y > hostH ||
      anchor.x < -220 ||
      anchor.x > hostW + 40;

    if (outOfView) {
      this.hiddenOutOfView = true;
      this.el.style.visibility = 'hidden';
      this.el.style.pointerEvents = 'none';
      return;
    }

    this.hiddenOutOfView = false;
    const widgetW = this.el.offsetWidth || 230;
    const widgetH = this.el.offsetHeight || 60;
    let left = Math.max(6, anchor.x);
    let top = anchor.y + anchor.h + 4;
    if (left + widgetW > hostW - 6) left = Math.max(6, hostW - widgetW - 6);
    if (top + widgetH > hostH - 6) {
      top = Math.max(topInset + 4, anchor.y - widgetH - 4);
    }
    this.el.style.left = `${Math.round(left)}px`;
    this.el.style.top = `${Math.round(top)}px`;
    this.el.style.visibility = 'visible';
    this.el.style.pointerEvents = 'auto';
  }

  close(notifyCancel = true): void {
    const cancel = this.onCancelCb;
    this.onSubmitCb = null;
    this.onCancelCb = null;
    this.hiddenOutOfView = false;
    this.el?.remove();
    this.el = null;
    this.input = null;
    if (notifyCancel) cancel?.();
  }

  dispose(): void {
    this.close(false);
  }
}
