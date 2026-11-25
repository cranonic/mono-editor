/**
 * Manages the hidden `<textarea>` bridge used for keyboard, mobile IME, ARIA/TalkBack, and focus safety.
 */
export class TextAreaBridge {
  readonly textarea: HTMLTextAreaElement;
  readonly liveRegion: HTMLDivElement;
  private host: HTMLElement;
  private wantFocus = false;
  private disposed = false;
  private refocusTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(host: HTMLElement, readOnly: boolean, ariaLabel = 'Code editor') {
    this.host = host;
    const ta = document.createElement('textarea');
    ta.setAttribute('role', 'textbox');
    ta.setAttribute('aria-multiline', 'true');
    ta.setAttribute('aria-roledescription', 'code editor');
    ta.setAttribute('aria-label', ariaLabel);
    ta.setAttribute('aria-readonly', readOnly ? 'true' : 'false');
    ta.setAttribute('autocomplete', 'off');
    ta.setAttribute('autocorrect', 'off');
    ta.setAttribute('autocapitalize', 'off');
    ta.setAttribute('spellcheck', 'false');
    ta.setAttribute('inputmode', 'text');
    ta.setAttribute('enterkeyhint', 'enter');
    ta.rows = 1;
    Object.assign(ta.style, {
      position: 'absolute',
      top: '0px',
      left: '0px',
      width: '1px',
      height: '24px',
      margin: '0',
      padding: '0',
      border: '0',
      outline: 'none',
      resize: 'none',
      overflow: 'hidden',
      opacity: '0',
      zIndex: '20',
      background: 'transparent',
      color: 'transparent',
      caretColor: 'transparent',
      pointerEvents: 'none',
      transform: 'translateZ(0)',
    });
    host.appendChild(ta);
    this.textarea = ta;

    const live = document.createElement('div');
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    Object.assign(live.style, {
      position: 'absolute',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
      clipPath: 'inset(50%)',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
    });
    host.appendChild(live);
    this.liveRegion = live;

    if (readOnly) ta.readOnly = true;
    ta.addEventListener('blur', this.onBlur);
  }

  setReadOnly(v: boolean): void {
    this.textarea.readOnly = v;
    this.textarea.setAttribute('aria-readonly', v ? 'true' : 'false');
  }

  setAriaLabel(label: string): void {
    this.textarea.setAttribute('aria-label', label || 'Code editor');
  }

  /** Announce a brief status string to TalkBack / VoiceOver / NVDA without stealing focus. */
  announce(message: string): void {
    if (this.disposed) return;
    this.liveRegion.textContent = '';
    // Re-assign next tick so identical consecutive messages are still announced
    queueMicrotask(() => {
      if (!this.disposed) this.liveRegion.textContent = message;
    });
  }

  moveTo(x: number, y: number, h: number): void {
    const ta = this.textarea;
    ta.style.left = `${Math.max(0, Math.floor(x))}px`;
    ta.style.top = `${Math.max(0, Math.floor(y))}px`;
    ta.style.height = `${Math.max(20, Math.floor(h))}px`;
  }

  focus(): void {
    this.wantFocus = true;
    if (document.activeElement === this.textarea) return;
    this.applyFocus(false);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => this.applyFocus(true));
    }
    if (this.refocusTimer) clearTimeout(this.refocusTimer);
    this.refocusTimer = setTimeout(() => this.applyFocus(true), 30);
  }

  blur(): void {
    this.wantFocus = false;
    if (this.refocusTimer) {
      clearTimeout(this.refocusTimer);
      this.refocusTimer = null;
    }
    this.textarea.blur();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.wantFocus = false;
    if (this.refocusTimer) clearTimeout(this.refocusTimer);
    this.textarea.removeEventListener('blur', this.onBlur);
    this.textarea.remove();
    this.liveRegion.remove();
  }

  private applyFocus(deferred = false): void {
    if (!this.wantFocus || this.disposed) return;
    const ta = this.textarea;
    const active = document.activeElement;
    if (active === ta) return;
    if (
      deferred &&
      active &&
      active !== document.body &&
      active !== document.documentElement &&
      (!this.host.contains(active) || this.isInteractiveDescendant(active))
    ) {
      this.wantFocus = false;
      return;
    }
    try {
      ta.focus({ preventScroll: true });
    } catch {
      ta.focus();
    }
  }

  private isInteractiveDescendant(node: Node | null): boolean {
    if (!node || node === this.textarea) return false;
    if (!this.host.contains(node)) return false;
    const candidate = node as unknown as {
      closest?: (s: string) => Element | null;
      parentElement?: Element | null;
    };
    const el = typeof candidate.closest === 'function' ? candidate : candidate.parentElement;
    if (!el || (el as unknown) === this.textarea || typeof el.closest !== 'function') return false;
    return Boolean(
      el.closest('input, textarea, select, [contenteditable="true"], [data-mono-focusable="true"]'),
    );
  }

  private onBlur = (e: FocusEvent): void => {
    if (!this.wantFocus || this.disposed) return;
    const next = e.relatedTarget as Node | null;
    if (next && (!this.host.contains(next) || this.isInteractiveDescendant(next))) {
      this.wantFocus = false;
      if (this.refocusTimer) {
        clearTimeout(this.refocusTimer);
        this.refocusTimer = null;
      }
      return;
    }
    if (this.refocusTimer) clearTimeout(this.refocusTimer);
    this.refocusTimer = setTimeout(() => {
      if (!this.wantFocus || this.disposed) return;
      const active = document.activeElement;
      if (
        active &&
        active !== this.textarea &&
        active !== document.body &&
        active !== document.documentElement &&
        (!this.host.contains(active) || this.isInteractiveDescendant(active))
      ) {
        this.wantFocus = false;
        return;
      }
      if (
        !active ||
        active === document.body ||
        active === document.documentElement ||
        active === this.textarea ||
        this.host.contains(active)
      ) {
        this.applyFocus(true);
      }
    }, 0);
  };
}
