import type { MonoEditorOptions, MonoMobileQuickKeysOptions } from '../../common/config/editorOptions';
import { MonoCommands } from '../../platform/keybindings/KeybindingService';
import type { ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';
import {
  ContributionIds,
  type IEditorContribution,
  type IEditorContributionHost,
} from '../../browser/editor/editorTypes';

interface QuickKeyDef {
  label: string;
  aria: string;
  insert?: string;
  command?: string;
  action?: 'tab' | 'left' | 'right' | 'undo' | 'redo' | 'goto';
}

const DEFAULT_QUICK_KEYS: QuickKeyDef[] = [
  { label: 'Tab', aria: 'Indent', action: 'tab' },
  { label: '{', aria: 'Insert left brace', insert: '{' },
  { label: '}', aria: 'Insert right brace', insert: '}' },
  { label: '(', aria: 'Insert left parenthesis', insert: '(' },
  { label: ')', aria: 'Insert right parenthesis', insert: ')' },
  { label: '[', aria: 'Insert left bracket', insert: '[' },
  { label: ']', aria: 'Insert right bracket', insert: ']' },
  { label: ';', aria: 'Insert semicolon', insert: ';' },
  { label: '=', aria: 'Insert equals', insert: '=' },
  { label: '"', aria: 'Insert double quote', insert: '"' },
  { label: "'", aria: 'Insert single quote', insert: "'" },
  { label: '/', aria: 'Insert slash', insert: '/' },
  { label: '<', aria: 'Insert less than', insert: '<' },
  { label: '>', aria: 'Insert greater than', insert: '>' },
  { label: '←', aria: 'Move cursor left', action: 'left' },
  { label: '→', aria: 'Move cursor right', action: 'right' },
  { label: 'Undo', aria: 'Undo', action: 'undo' },
  { label: 'Redo', aria: 'Redo', action: 'redo' },
  { label: 'GoTo', aria: 'Go to line', action: 'goto' },
];

const BAR_HEIGHT_PX = 42;

function isCoarseTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(window.matchMedia?.('(pointer: coarse)').matches);
  } catch {
    return false;
  }
}

/**
 * Mobile & Touch Accessibility Controller:
 * 1) Tracks `window.visualViewport` soft-keyboard overlap and updates `view.setBottomInset`
 *    so the active caret is never hidden behind Android/iOS soft keyboards.
 * 2) Renders a non-focus-stealing Mobile Quick-Keys Accessory Bar (`pointerdown` `preventDefault()`)
 *    with 40px touch targets for symbols, indent, arrows, undo/redo, and Go to Line.
 * 3) Announces diagnostics & cursor lines politely for TalkBack / VoiceOver users.
 */
export class MobileController implements IEditorContribution {
  readonly id = ContributionIds.MobileAccessory;
  private readonly host: IEditorContributionHost;
  private readonly bar: HTMLDivElement;
  private barEnabled: boolean;
  private customKeys?: readonly { label: string; insert?: string; command?: string }[];
  private keyboardInsetPx = 0;
  private lastAnnouncedLine = -1;
  private vvHandler: (() => void) | null = null;
  private theme: ResolvedWidgetTheme | null = null;

  constructor(host: IEditorContributionHost) {
    this.host = host;
    const resolved = this.resolveQuickKeysConfig(host.initialOptions.mobileQuickKeys);
    this.barEnabled = !host.isPeekEditor && resolved.enabled;
    this.customKeys = resolved.keys;

    this.bar = document.createElement('div');
    this.bar.setAttribute('role', 'toolbar');
    this.bar.setAttribute('aria-label', 'Mobile coding quick keys');
    this.bar.dataset.monoQuickKeys = 'true';
    Object.assign(this.bar.style, {
      position: 'absolute',
      left: '0',
      right: '0',
      bottom: '0',
      height: `${BAR_HEIGHT_PX}px`,
      display: 'none',
      alignItems: 'center',
      gap: '4px',
      padding: '0 6px',
      overflowX: 'auto',
      overflowY: 'hidden',
      whiteSpace: 'nowrap',
      zIndex: '36',
      boxSizing: 'border-box',
      WebkitOverflowScrolling: 'touch',
      scrollbarWidth: 'none',
    });

    this.bar.addEventListener('pointerdown', (e) => {
      // Prevent focus loss so the mobile soft keyboard never collapses on tap
      e.preventDefault();
    });

    host.root.appendChild(this.bar);
    this.rebuildButtons();
    this.syncVisibilityAndInsets();
    this.attachVisualViewport();
  }

  private resolveQuickKeysConfig(
    opt?: boolean | MonoMobileQuickKeysOptions,
  ): { enabled: boolean; keys?: readonly { label: string; insert?: string; command?: string }[] } {
    if (opt === true) return { enabled: true };
    if (opt === false) return { enabled: false };
    if (opt && typeof opt === 'object') return { enabled: opt.enabled !== false, keys: opt.keys };
    return { enabled: isCoarseTouchDevice() };
  }

  private attachVisualViewport(): void {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;
    this.vvHandler = () => {
      if (this.host.isDisposed()) return;
      const rootRect = this.host.root.getBoundingClientRect();
      const visibleBottom = vv.offsetTop + vv.height;
      const overlap = Math.max(0, Math.round(rootRect.bottom - visibleBottom));
      const nextKb = overlap > 60 ? overlap : 0;
      if (nextKb !== this.keyboardInsetPx) {
        this.keyboardInsetPx = nextKb;
        this.syncVisibilityAndInsets();
        if (nextKb > 0) {
          this.host.view.ensureCaretVisible();
          this.host.view.paint();
        }
      }
    };
    vv.addEventListener('resize', this.vvHandler);
    vv.addEventListener('scroll', this.vvHandler);
  }

  private syncVisibilityAndInsets(): void {
    const barH = this.barEnabled ? BAR_HEIGHT_PX : 0;
    this.bar.style.display = this.barEnabled ? 'flex' : 'none';
    this.bar.style.bottom = `${this.keyboardInsetPx}px`;
    this.host.view.setBottomInset(this.keyboardInsetPx + barH);
  }

  private rebuildButtons(): void {
    const keys: QuickKeyDef[] = this.customKeys?.length
      ? this.customKeys.map((k) => ({
          label: k.label,
          aria: k.command ? `Run ${k.label}` : `Insert ${k.insert ?? k.label}`,
          insert: k.command ? undefined : (k.insert ?? k.label),
          command: k.command,
        }))
      : DEFAULT_QUICK_KEYS;

    const frag = document.createDocumentFragment();
    const bg = this.theme?.inputBackground ?? 'rgba(255,255,255,0.08)';
    const fg = this.theme?.foreground ?? '#e5e7eb';
    const border = this.theme?.border ?? 'rgba(255,255,255,0.14)';

    for (const def of keys) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = def.label;
      btn.setAttribute('aria-label', def.aria);
      Object.assign(btn.style, {
        minWidth: '38px',
        height: '32px',
        padding: '0 8px',
        borderRadius: '6px',
        border: `1px solid ${border}`,
        background: bg,
        color: fg,
        fontSize: '13px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontWeight: '600',
        flexShrink: '0',
        cursor: 'pointer',
        touchAction: 'manipulation',
      });
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.triggerKey(def);
      });
      frag.appendChild(btn);
    }
    this.bar.replaceChildren(frag);
  }

  private triggerKey(def: QuickKeyDef): void {
    if (this.host.isDisposed()) return;
    if (def.command) {
      void this.host.executeCommand(def.command);
      return;
    }
    if (def.insert != null) {
      if (this.host.isReadOnly()) return;
      const sel = this.host.getSelection();
      this.host.executeEdits('mobileQuickKey', [
        {
          range: {
            startLineNumber: sel.startLineNumber,
            startColumn: sel.startColumn,
            endLineNumber: sel.endLineNumber,
            endColumn: sel.endColumn,
          },
          text: def.insert,
        },
      ]);
      this.host.focus();
      return;
    }
    const pos = this.host.getPosition();
    if (def.action === 'tab') {
      if (this.host.isReadOnly()) return;
      const spaces = ' '.repeat(this.host.getTabSize());
      const sel = this.host.getSelection();
      this.host.executeEdits('mobileQuickKey', [{ range: sel, text: spaces }]);
    } else if (def.action === 'left') {
      if (pos.column > 1) this.host.setPosition(pos.lineNumber, pos.column - 1);
      else if (pos.lineNumber > 1) {
        const prevLen = this.host.getModel().getLineContent(pos.lineNumber - 1).length;
        this.host.setPosition(pos.lineNumber - 1, prevLen + 1);
      }
    } else if (def.action === 'right') {
      const lineLen = this.host.getModel().getLineContent(pos.lineNumber).length;
      if (pos.column <= lineLen) this.host.setPosition(pos.lineNumber, pos.column + 1);
      else if (pos.lineNumber < this.host.getModel().getLineCount()) this.host.setPosition(pos.lineNumber + 1, 1);
    } else if (def.action === 'undo') {
      void this.host.executeCommand(MonoCommands.Undo);
    } else if (def.action === 'redo') {
      void this.host.executeCommand(MonoCommands.Redo);
    } else if (def.action === 'goto') {
      void this.host.executeCommand(MonoCommands.GoToLine);
    }
  }

  onOptionsChange(patch: Partial<MonoEditorOptions>): void {
    if (patch.mobileQuickKeys !== undefined) {
      const resolved = this.resolveQuickKeysConfig(patch.mobileQuickKeys);
      this.barEnabled = !this.host.isPeekEditor && resolved.enabled;
      this.customKeys = resolved.keys;
      this.rebuildButtons();
      this.syncVisibilityAndInsets();
    }
  }

  onThemeChange(wt: ResolvedWidgetTheme): void {
    this.theme = wt;
    this.bar.style.background = wt.background;
    this.bar.style.borderTop = `1px solid ${wt.border}`;
    this.rebuildButtons();
  }

  onCursorChange(_source: string): void {
    const pos = this.host.getPosition();
    if (pos.lineNumber === this.lastAnnouncedLine) return;
    this.lastAnnouncedLine = pos.lineNumber;
    const lineMarkers = this.host.getMarkers().filter((m) => m.startLineNumber === pos.lineNumber);
    if (lineMarkers.length > 0) {
      this.host.announce(`Line ${pos.lineNumber}: ${lineMarkers[0]!.message}`);
    }
  }

  shouldAllowWheelTarget(target: Node): boolean {
    return this.bar.contains(target);
  }

  dispose(): void {
    if (this.vvHandler && typeof window !== 'undefined' && window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this.vvHandler);
      window.visualViewport.removeEventListener('scroll', this.vvHandler);
    }
    this.host.view.setBottomInset(0);
    this.bar.remove();
  }
}
