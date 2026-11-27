import { createIcon, ensureCodicons } from '../../platform/icons';
import { attachPressFeedback } from '../../platform/haptic/haptic';
import type { ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';
import { DEFAULT_FIND_OPTIONS, type FindOptions, type FindState } from './types';

export interface FindWidgetCallbacks {
  onSearchChange: (value: string) => void;
  onReplaceChange: (value: string) => void;
  onToggleOption: (key: keyof FindOptions) => void;
  onFindNext: () => void;
  onFindPrevious: () => void;
  onReplace: () => void;
  onReplaceAll: () => void;
  onToggleReplace: () => void;
  onTogglePreserveCase?: () => void;
  onClose: () => void;
  /** Fired whenever the widget opens, closes, or expands/collapses Replace so the editor can adjust its top viewport gap. */
  onLayoutChange?: (heightPx: number) => void;
}

const DEFAULT_WIDGET_THEME: ResolvedWidgetTheme = {
  isDark: true,
  background: '#252526',
  editorBackground: '#1e1e1e',
  foreground: '#cccccc',
  mutedForeground: '#9d9d9d',
  border: '#454545',
  inputBackground: '#3c3c3c',
  inputForeground: '#cccccc',
  inputBorder: '#454545',
  focusBorder: '#007fd4',
  activeOptionBg: 'rgba(0, 127, 212, 0.36)',
  activeOptionFg: '#ffffff',
  activeOptionBorder: '#007fd4',
  hoverBackground: 'rgba(255, 255, 255, 0.08)',
  selectionBackground: '#094771',
  selectionForeground: '#ffffff',
  codeBackground: 'rgba(0, 0, 0, 0.28)',
  shadow: '0 4px 16px rgba(0, 0, 0, 0.42)',
};

/**
 * Authentic Monaco / VS Code Find & Replace widget:
 *  [>] [ Find input    | Aa ab .* ]  count  ↑ ↓ ✕
 *      [ Replace input | AB       ]  replace  replaceAll
 *
 * Uses bundled local `codicon.ttf` glyphs, follows the active Mono editor theme live,
 * and preserves native input focus & text selection cleanly.
 */
export class FindWidget {
  private root: HTMLElement;
  private el: HTMLDivElement | null = null;
  private findBox: HTMLDivElement | null = null;
  private replaceBox: HTMLDivElement | null = null;
  private findInput: HTMLInputElement | null = null;
  private replaceInput: HTMLInputElement | null = null;
  private countEl: HTMLSpanElement | null = null;
  private replaceRow: HTMLDivElement | null = null;
  private chevronBtn: HTMLButtonElement | null = null;
  private cbs: FindWidgetCallbacks;
  private preserveCase = false;
  private lastOptions: FindOptions = { ...DEFAULT_FIND_OPTIONS };
  private isReplaceShown = false;
  private widgetTheme: ResolvedWidgetTheme = DEFAULT_WIDGET_THEME;

  constructor(host: HTMLElement, callbacks: FindWidgetCallbacks) {
    this.root = host;
    this.cbs = callbacks;
  }

  isVisible(): boolean {
    return !!this.el;
  }

  getElement(): HTMLDivElement | null {
    return this.el;
  }

  getFindInput(): HTMLInputElement | null {
    return this.findInput;
  }

  getReplaceInput(): HTMLInputElement | null {
    return this.replaceInput;
  }

  getHeight(): number {
    if (!this.el) return 0;
    const h = this.el.offsetHeight || this.el.getBoundingClientRect().height;
    if (h > 0) return Math.ceil(h);
    return this.isReplaceShown ? 76 : 40;
  }

  private notifyLayout(): void {
    if (!this.cbs.onLayoutChange) return;
    if (!this.el) {
      this.cbs.onLayoutChange(0);
      return;
    }
    const h = this.getHeight();
    this.cbs.onLayoutChange(h);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        if (this.el) this.cbs.onLayoutChange?.(this.getHeight());
      });
    }
  }

  applyTheme(theme: ResolvedWidgetTheme): void {
    this.widgetTheme = theme;
    if (!this.el) return;

    this.el.style.background = theme.background;
    this.el.style.border = `1px solid ${theme.border}`;
    this.el.style.color = theme.foreground;
    this.el.style.boxShadow = theme.shadow;

    this.styleInputBox(this.findBox, document.activeElement === this.findInput);
    this.styleInputBox(this.replaceBox, document.activeElement === this.replaceInput);

    if (this.findInput) {
      this.findInput.style.color = theme.inputForeground;
      this.findInput.style.caretColor = theme.focusBorder;
    }
    if (this.replaceInput) {
      this.replaceInput.style.color = theme.inputForeground;
      this.replaceInput.style.caretColor = theme.focusBorder;
    }
    if (this.countEl) {
      this.countEl.style.color = theme.mutedForeground;
    }

    // Re-tint icon buttons & active option buttons
    this.el.querySelectorAll<HTMLButtonElement>('button:not([data-opt])').forEach((btn) => {
      btn.style.color = theme.foreground;
    });
    this.syncToggles(this.lastOptions);
  }

  /**
   * @param focusInput when true, focus find box (open gesture only — not on every keystroke)
   * @param selectAll when true, select all text (only on first open / Ctrl+F)
   */
  reveal(
    replace: boolean,
    focusInput = true,
    selectAll = false,
    values?: { search?: string; replace?: string },
  ): void {
    ensureCodicons();
    if (!this.el) this.build();
    this.setReplaceVisible(replace);
    // Seed the inputs BEFORE focusing / selecting. `update()` never rewrites a focused field (it would
    // reset the caret while typing), so a value applied after focus would never show up.
    if (values?.search !== undefined && this.findInput && this.findInput.value !== values.search) {
      this.findInput.value = values.search;
    }
    if (values?.replace !== undefined && this.replaceInput && this.replaceInput.value !== values.replace) {
      this.replaceInput.value = values.replace;
    }
    if (focusInput && this.findInput) {
      if (document.activeElement !== this.findInput) {
        this.findInput.focus();
        if (selectAll) this.findInput.select();
      } else if (selectAll) {
        this.findInput.select();
      }
    }
    this.notifyLayout();
  }

  hide(immediate = false): void {
    const wasVisible = !!this.el;
    if (this.el) {
      const leaving = this.el;
      // Logical state flips right away (isVisible() === false); only the DOM node lingers for the slide-up.
      if (immediate) leaving.remove();
      else this.slide(leaving, 'out', () => leaving.remove());
      this.el = null;
      this.findBox = null;
      this.replaceBox = null;
      this.findInput = null;
      this.replaceInput = null;
      this.countEl = null;
      this.replaceRow = null;
      this.chevronBtn = null;
    }
    if (wasVisible) this.notifyLayout();
  }

  update(state: FindState): void {
    if (!this.el) return;
    this.lastOptions = { ...state.options };
    // Never rewrite value while the user is typing in that field (preserves caret)
    if (
      this.findInput &&
      this.findInput.value !== state.searchString &&
      document.activeElement !== this.findInput
    ) {
      this.findInput.value = state.searchString;
    }
    if (
      this.replaceInput &&
      this.replaceInput.value !== state.replaceString &&
      document.activeElement !== this.replaceInput
    ) {
      this.replaceInput.value = state.replaceString;
    }
    this.setReplaceVisible(state.isReplaceRevealed);
    this.syncToggles(state.options);
    if (this.countEl) {
      if (!state.searchString) this.countEl.textContent = '';
      else if (state.matches.length === 0) this.countEl.textContent = 'No results';
      else this.countEl.textContent = `${state.currentIndex + 1} of ${state.matches.length}`;
    }
  }

  dispose(): void {
    this.hide(true);
  }

  /**
   * Slide down (open) / slide up (close) with a short fade. Uses transform + opacity only, so it never
   * changes the widget's layout height (`offsetHeight`) — the editor inset math stays exact mid-animation.
   * Skipped for `prefers-reduced-motion` and in environments without the Web Animations API.
   */
  private slide(el: HTMLElement, dir: 'in' | 'out', done?: () => void): void {
    const reduce =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || typeof el.animate !== 'function') {
      done?.();
      return;
    }
    const dist = -((el.offsetHeight || 40) + 12);
    const hidden = { transform: `translateY(${dist}px)`, opacity: 0 };
    const shown = { transform: 'translateY(0)', opacity: 1 };
    const anim = el.animate(dir === 'in' ? [hidden, shown] : [shown, hidden], {
      duration: dir === 'in' ? 170 : 130,
      easing: dir === 'in' ? 'cubic-bezier(0.2, 0.8, 0.2, 1)' : 'cubic-bezier(0.4, 0, 1, 1)',
      fill: dir === 'out' ? 'forwards' : 'none',
    });
    if (dir === 'out') {
      // The leaving node must not catch taps meant for the editor underneath.
      el.style.pointerEvents = 'none';
      const finish = () => done?.();
      anim.onfinish = finish;
      anim.oncancel = finish;
    }
  }

  private setReplaceVisible(on: boolean): void {
    const changed = this.isReplaceShown !== on;
    this.isReplaceShown = on;
    if (this.replaceRow) this.replaceRow.style.display = on ? 'flex' : 'none';
    if (this.chevronBtn) {
      this.setButtonCodicon(this.chevronBtn, on ? 'chevron-down' : 'chevron-right', 16);
      this.chevronBtn.title = on ? 'Hide Replace' : 'Toggle Replace';
      this.chevronBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
    }
    if (changed) this.notifyLayout();
  }

  private syncToggles(opts: FindOptions): void {
    if (!this.el) return;
    const t = this.widgetTheme;
    const map: Record<string, boolean> = {
      matchCase: opts.matchCase,
      wholeWord: opts.wholeWord,
      regex: opts.regex,
      preserveCase: this.preserveCase,
    };
    this.el.querySelectorAll<HTMLButtonElement>('[data-opt]').forEach((btn) => {
      const key = btn.dataset.opt!;
      const on = !!map[key];
      btn.classList.toggle('mono-find-toggle-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.style.background = on ? t.activeOptionBg : 'transparent';
      btn.style.color = on ? t.activeOptionFg : t.foreground;
      btn.style.border = on ? `1px solid ${t.activeOptionBorder}` : '1px solid transparent';
    });
  }

  private styleInputBox(box: HTMLDivElement | null, focused: boolean): void {
    if (!box) return;
    const t = this.widgetTheme;
    box.style.background = t.inputBackground;
    box.style.border = `1px solid ${focused ? t.focusBorder : t.inputBorder}`;
  }

  private build(): void {
    ensureCodicons();
    const t = this.widgetTheme;
    const el = document.createElement('div');
    el.className = 'mono-find-widget';
    el.setAttribute('data-mono-widget', 'find');
    Object.assign(el.style, {
      position: 'absolute',
      top: '8px',
      right: '12px',
      zIndex: '40',
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'flex-start',
      width: 'min(400px, calc(100% - 24px))',
      maxWidth: '400px',
      minWidth: '260px',
      boxSizing: 'border-box',
      background: t.background,
      border: `1px solid ${t.border}`,
      borderRadius: '6px',
      boxShadow: t.shadow,
      padding: '3px',
      gap: '3px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px',
      color: t.foreground,
      pointerEvents: 'auto',
      touchAction: 'manipulation',
      userSelect: 'none',
      WebkitUserSelect: 'none',
    } as unknown as CSSStyleDeclaration);

    // Chevron toggle replace (authentic Monaco chevron-right / chevron-down)
    const chevron = this.iconBtn('chevron-right', 'Toggle Replace', () => this.cbs.onToggleReplace());
    chevron.dataset.action = 'toggle-replace';
    chevron.setAttribute('aria-expanded', 'false');
    Object.assign(chevron.style, { marginTop: '2px' });
    this.chevronBtn = chevron;

    const col = document.createElement('div');
    Object.assign(col.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '3px',
      flex: '1',
      minWidth: '0',
    });

    // ── Find row: [bordered input + Aa ab .*]  count  ↑ ↓ ✕ ──
    const findRow = document.createElement('div');
    Object.assign(findRow.style, {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      gap: '3px',
      minWidth: '0',
    });

    const findBox = this.inputBox();
    this.findBox = findBox;
    const findInput = this.makeInput('Find', findBox);
    findInput.addEventListener('input', () => this.cbs.onSearchChange(findInput.value));
    findInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) this.cbs.onFindPrevious();
        else this.cbs.onFindNext();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.cbs.onClose();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        findInput.select();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        if (!this.isReplaceShown) this.cbs.onToggleReplace();
        this.replaceInput?.focus();
      } else if (e.key === 'F3') {
        e.preventDefault();
        if (e.shiftKey) this.cbs.onFindPrevious();
        else this.cbs.onFindNext();
      }
    });
    this.findInput = findInput;
    findBox.appendChild(findInput);
    findBox.appendChild(this.toggleBtn('matchCase', 'case-sensitive', 'Match Case'));
    findBox.appendChild(this.toggleBtn('wholeWord', 'whole-word', 'Match Whole Word'));
    findBox.appendChild(this.toggleBtn('regex', 'regex', 'Use Regular Expression'));

    const count = document.createElement('span');
    Object.assign(count.style, {
      fontSize: '12px',
      fontVariantNumeric: 'tabular-nums',
      color: t.mutedForeground,
      padding: '0 4px',
      minWidth: '58px',
      textAlign: 'right',
      whiteSpace: 'nowrap',
      flexShrink: '0',
    });
    this.countEl = count;

    findRow.appendChild(findBox);
    findRow.appendChild(count);
    findRow.appendChild(this.iconBtn('arrow-up', 'Previous Match (Shift+F3)', () => this.cbs.onFindPrevious()));
    findRow.appendChild(this.iconBtn('arrow-down', 'Next Match (F3)', () => this.cbs.onFindNext()));
    findRow.appendChild(this.iconBtn('close', 'Close (Escape)', () => this.cbs.onClose()));

    // ── Replace row: [bordered input + AB]  replace  replaceAll ──
    const replaceRow = document.createElement('div');
    Object.assign(replaceRow.style, {
      display: 'none',
      flexDirection: 'row',
      alignItems: 'center',
      gap: '3px',
      minWidth: '0',
    });
    this.replaceRow = replaceRow;

    const replaceBox = this.inputBox();
    this.replaceBox = replaceBox;
    const replaceInput = this.makeInput('Replace', replaceBox);
    replaceInput.addEventListener('input', () => this.cbs.onReplaceChange(replaceInput.value));
    replaceInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.cbs.onReplace();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.cbs.onClose();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        this.findInput?.focus();
        this.findInput?.select();
      } else if (e.key === 'F3') {
        e.preventDefault();
        if (e.shiftKey) this.cbs.onFindPrevious();
        else this.cbs.onFindNext();
      }
    });
    this.replaceInput = replaceInput;
    replaceBox.appendChild(replaceInput);
    replaceBox.appendChild(
      this.toggleBtn('preserveCase', 'preserve-case', 'Preserve Case', () => {
        this.preserveCase = !this.preserveCase;
        this.cbs.onTogglePreserveCase?.();
        this.syncToggles(this.lastOptions);
      }),
    );

    replaceRow.appendChild(replaceBox);
    replaceRow.appendChild(this.iconBtn('replace', 'Replace (Enter)', () => this.cbs.onReplace()));
    replaceRow.appendChild(this.iconBtn('replace-all', 'Replace All', () => this.cbs.onReplaceAll()));

    col.appendChild(findRow);
    col.appendChild(replaceRow);
    el.appendChild(chevron);
    el.appendChild(col);
    this.root.appendChild(el);
    this.el = el;
    this.slide(el, 'in');

    // Stop pointer/mouse/touch events from bubbling into PointerController on the editor canvas
    // without calling preventDefault() so native input focus & caret selection work seamlessly.
    const stopOnly = (e: Event) => e.stopPropagation();
    el.addEventListener('pointerdown', stopOnly);
    el.addEventListener('mousedown', stopOnly);
    el.addEventListener('touchstart', stopOnly, { passive: true });
    el.addEventListener('click', stopOnly);

    this.applyTheme(this.widgetTheme);
  }

  /** Bordered group: only inputs + option toggles */
  private inputBox(): HTMLDivElement {
    const t = this.widgetTheme;
    const box = document.createElement('div');
    Object.assign(box.style, {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      gap: '2px',
      flex: '1',
      minWidth: '0',
      background: t.inputBackground,
      borderRadius: '4px',
      padding: '2px 3px',
      border: `1px solid ${t.inputBorder}`,
      boxSizing: 'border-box',
      transition: 'border-color 120ms ease',
    });
    return box;
  }

  private makeInput(placeholder: string, box: HTMLDivElement): HTMLInputElement {
    const t = this.widgetTheme;
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.setAttribute('aria-label', placeholder);
    input.setAttribute('data-mono-focusable', 'true');
    input.autocomplete = 'off';
    input.spellcheck = false;
    Object.assign(input.style, {
      flex: '1 1 auto',
      minWidth: '60px',
      width: '0',
      maxWidth: '100%',
      background: 'transparent',
      border: 'none',
      outline: 'none',
      color: t.inputForeground,
      caretColor: t.focusBorder,
      fontSize: '13px',
      padding: '3px 3px',
      boxSizing: 'border-box',
      userSelect: 'text',
      WebkitUserSelect: 'text',
      cursor: 'text',
    } as unknown as CSSStyleDeclaration);
    input.addEventListener('focus', () => this.styleInputBox(box, true));
    input.addEventListener('blur', () => this.styleInputBox(box, false));
    return input;
  }

  private setButtonCodicon(btn: HTMLButtonElement, codiconId: string, size = 16): void {
    btn.textContent = '';
    btn.dataset.codicon = codiconId;
    btn.appendChild(createIcon(codiconId, size));
  }

  private iconBtn(codiconId: string, title: string, onClick: () => void): HTMLButtonElement {
    const t = this.widgetTheme;
    const b = document.createElement('button');
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    this.setButtonCodicon(b, codiconId, 16);
    Object.assign(b.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '26px',
      height: '26px',
      padding: '0',
      border: '1px solid transparent',
      borderRadius: '4px',
      background: 'transparent',
      color: t.foreground,
      cursor: 'pointer',
      flexShrink: '0',
      boxSizing: 'border-box',
      transform: 'scale(1)',
      touchAction: 'manipulation',
      WebkitTapHighlightColor: 'transparent',
    } as unknown as CSSStyleDeclaration);
    // Prevent button clicks from stealing caret out of Find/Replace input
    b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    attachPressFeedback(b);
    return b;
  }

  private toggleBtn(
    opt: string,
    codiconId: string,
    title: string,
    custom?: () => void,
  ): HTMLButtonElement {
    const b = this.iconBtn(codiconId, title, () => {
      if (custom) custom();
      else this.cbs.onToggleOption(opt as keyof FindOptions);
    });
    b.dataset.opt = opt;
    return b;
  }
}
