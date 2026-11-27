import type { MonoEditorOptions } from '../../common/config/editorOptions';
import type { DocumentSymbol } from '../../common/languages/providers/types';
import { MonoCommands } from '../../platform/keybindings/KeybindingService';
import type { ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';
import {
  ContributionIds,
  type IEditorContribution,
  type IEditorContributionHost,
} from '../../browser/editor/editorTypes';

interface FlatSymbol {
  name: string;
  container: string;
  lineNumber: number;
  column: number;
  kindLabel: string;
}

const KIND_LABELS: Record<number, string> = {
  0: 'file', 1: 'mod', 2: 'ns', 4: 'class', 5: 'method', 6: 'prop',
  7: 'field', 8: 'ctor', 9: 'enum', 10: 'iface', 11: 'fn', 12: 'var', 13: 'const',
};

function flattenSymbols(list: readonly DocumentSymbol[], container = '', out: FlatSymbol[] = []): FlatSymbol[] {
  for (const s of list) {
    out.push({
      name: s.name,
      container,
      lineNumber: s.selectionRange?.startLineNumber ?? s.range.startLineNumber,
      column: s.selectionRange?.startColumn ?? s.range.startColumn,
      kindLabel: KIND_LABELS[s.kind] ?? 'sym',
    });
    if (s.children?.length) flattenSymbols(s.children, container ? `${container}.${s.name}` : s.name, out);
  }
  return out;
}

/**
 * Touch-friendly Quick Navigation contribution:
 * - Go to Line (`Ctrl+G`, supports `line` or `line:col`)
 * - Go to Symbol (`Ctrl+Shift+O`, flattens DocumentSymbol tree with live filter)
 */
export class QuickNavController implements IEditorContribution {
  readonly id = ContributionIds.QuickNav;
  private readonly host: IEditorContributionHost;
  private readonly overlay: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly hint: HTMLDivElement;
  private readonly listEl: HTMLDivElement;

  private mode: 'line' | 'symbol' | null = null;
  private symbols: FlatSymbol[] = [];
  private filtered: FlatSymbol[] = [];
  private selectedIdx = 0;
  private theme: ResolvedWidgetTheme | null = null;
  private gotoLineMode: 'builtin' | 'external';
  private gotoSymbolMode: 'builtin' | 'external';

  constructor(host: IEditorContributionHost) {
    this.host = host;
    const navOpts = host.initialOptions?.quickNav ?? (host as { getQuickNavOptions?: () => { gotoLine?: 'builtin' | 'external'; gotoSymbol?: 'builtin' | 'external' } }).getQuickNavOptions?.();
    this.gotoLineMode = navOpts?.gotoLine ?? 'builtin';
    this.gotoSymbolMode = navOpts?.gotoSymbol ?? 'builtin';

    this.overlay = document.createElement('div');
    this.overlay.dataset.monoFocus = 'quicknav';
    Object.assign(this.overlay.style, {
      position: 'absolute',
      top: '8px',
      left: '50%',
      transform: 'translateX(-50%)',
      width: 'min(440px, calc(100% - 20px))',
      zIndex: '48',
      display: 'none',
      flexDirection: 'column',
      borderRadius: '8px',
      overflow: 'hidden',
      boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    });

    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.dataset.monoFocusable = 'true';
    Object.assign(this.input.style, {
      width: '100%',
      boxSizing: 'border-box',
      height: '42px',
      padding: '0 12px',
      border: 'none',
      outline: 'none',
      fontSize: '14px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    });

    this.hint = document.createElement('div');
    Object.assign(this.hint.style, {
      padding: '6px 12px',
      fontSize: '12px',
      opacity: '0.8',
      fontVariantNumeric: 'tabular-nums',
    });

    this.listEl = document.createElement('div');
    Object.assign(this.listEl.style, {
      maxHeight: '260px',
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
    });

    this.overlay.append(this.input, this.hint, this.listEl);
    host.root.appendChild(this.overlay);

    this.input.addEventListener('input', () => this.onInputChangeValue());
    this.input.addEventListener('keydown', (e) => this.onInputKeyDown(e));

    host.keybindings.addMany([
      { id: MonoCommands.GoToLine, primary: 'ctrl+g', weight: 6, handler: () => this.openGoToLine() },
      { id: MonoCommands.GoToSymbol, primary: 'ctrl+shift+o', weight: 6, handler: () => { void this.openGoToSymbol(); } },
    ]);
    host.commands.registerCommand(MonoCommands.GoToLine, () => this.openGoToLine(), { title: 'Go to Line/Column...', category: 'Go' });
    host.commands.registerCommand(MonoCommands.GoToSymbol, () => this.openGoToSymbol(), { title: 'Go to Symbol in Editor...', category: 'Go' });
  }

  openGoToLine(): void {
    const maxLine = this.host.getModel().getLineCount();
    const pos = this.host.getPosition();
    if (this.gotoLineMode === 'external') {
      this.close(false);
      this.host.emitRequestGoToLine({
        lineNumber: pos.lineNumber,
        column: pos.column,
        lineCount: maxLine,
      });
      return;
    }
    this.mode = 'line';
    this.symbols = [];
    this.filtered = [];
    this.listEl.replaceChildren();
    this.listEl.style.display = 'none';
    this.input.placeholder = `Line[:Column] (1–${maxLine})`;
    this.input.value = `${pos.lineNumber}:${pos.column}`;
    this.hint.textContent = `Current: Ln ${pos.lineNumber}, Col ${pos.column} · Total ${maxLine} lines`;
    this.overlay.style.display = 'flex';
    this.input.focus();
    this.input.select();
  }

  async openGoToSymbol(): Promise<void> {
    if (this.gotoSymbolMode === 'external') {
      this.close(false);
      this.host.emitRequestGoToSymbol();
      return;
    }
    this.mode = 'symbol';
    this.listEl.style.display = 'block';
    this.input.placeholder = 'Filter symbols...';
    this.input.value = '';
    this.hint.textContent = 'Loading symbols...';
    this.overlay.style.display = 'flex';
    this.input.focus();

    const raw = await this.host.getDocumentSymbols();
    if (this.mode !== 'symbol') return;
    this.symbols = flattenSymbols(raw);
    this.selectedIdx = 0;
    this.renderSymbols('');
  }

  close(restoreFocus = true): void {
    if (!this.mode) return;
    this.mode = null;
    this.overlay.style.display = 'none';
    if (restoreFocus) this.host.focus();
  }

  isOpen(): boolean { return this.mode !== null; }

  onKeyDown(e: KeyboardEvent): boolean {
    if (this.mode && e.key === 'Escape') {
      this.close(true);
      return true;
    }
    return false;
  }

  onOutsidePointerDown(): void { this.close(false); }
  onOptionsChange(patch: Partial<MonoEditorOptions>): void {
    if (patch.quickNav?.gotoLine !== undefined) this.gotoLineMode = patch.quickNav.gotoLine;
    if (patch.quickNav?.gotoSymbol !== undefined) this.gotoSymbolMode = patch.quickNav.gotoSymbol;
  }

  onThemeChange(wt: ResolvedWidgetTheme): void {
    this.theme = wt;
    this.overlay.style.background = wt.background;
    this.overlay.style.color = wt.foreground;
    this.overlay.style.border = `1px solid ${wt.border}`;
    this.input.style.background = wt.inputBackground;
    this.input.style.color = wt.foreground;
    this.input.style.borderBottom = `1px solid ${wt.border}`;
    this.hint.style.color = wt.mutedForeground;
    if (this.mode === 'symbol') this.renderSymbols(this.input.value);
  }

  shouldAllowWheelTarget(target: Node): boolean {
    return this.overlay.contains(target);
  }

  dispose(): void {
    this.overlay.remove();
  }

  private parseLineCol(raw: string): { lineNumber: number; column: number } | null {
    const cleaned = raw.trim().replace(/^:/, '');
    const m = /^(\d+)(?::(\d+))?$/.exec(cleaned);
    if (!m) return null;
    const maxLine = this.host.getModel().getLineCount();
    const lineNumber = Math.max(1, Math.min(maxLine, parseInt(m[1]!, 10)));
    const maxCol = this.host.getModel().getLineContent(lineNumber).length + 1;
    const column = m[2] ? Math.max(1, Math.min(maxCol, parseInt(m[2], 10))) : 1;
    return { lineNumber, column };
  }

  private onInputChangeValue(): void {
    if (this.mode === 'line') {
      const parsed = this.parseLineCol(this.input.value);
      const maxLine = this.host.getModel().getLineCount();
      this.hint.textContent = parsed
        ? `Press Enter to go to Ln ${parsed.lineNumber}, Col ${parsed.column}`
        : `Type a line number between 1 and ${maxLine} (optional :column)`;
    } else if (this.mode === 'symbol') {
      this.selectedIdx = 0;
      this.renderSymbols(this.input.value);
    }
  }

  private onInputKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close(true);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (this.mode === 'line') {
        const target = this.parseLineCol(this.input.value);
        if (target) {
          this.host.setPosition(target);
          this.host.revealPositionInCenter(target);
          this.host.announce(`Line ${target.lineNumber}, column ${target.column}`);
        }
        this.close(true);
      } else if (this.mode === 'symbol') {
        const sym = this.filtered[this.selectedIdx];
        if (sym) this.jumpToSymbol(sym);
      }
      return;
    }
    if (this.mode === 'symbol' && this.filtered.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.selectedIdx = (this.selectedIdx + 1) % this.filtered.length;
        this.renderSymbols(this.input.value);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.selectedIdx = (this.selectedIdx - 1 + this.filtered.length) % this.filtered.length;
        this.renderSymbols(this.input.value);
      }
    }
  }

  private jumpToSymbol(sym: FlatSymbol): void {
    const pos = { lineNumber: sym.lineNumber, column: sym.column };
    this.host.setPosition(pos);
    this.host.revealPositionInCenter(pos);
    this.host.announce(`Symbol ${sym.name} at line ${sym.lineNumber}`);
    this.close(true);
  }

  private renderSymbols(query: string): void {
    const q = query.trim().toLowerCase();
    this.filtered = q
      ? this.symbols.filter((s) => s.name.toLowerCase().includes(q) || s.container.toLowerCase().includes(q))
      : this.symbols;

    this.hint.textContent = this.filtered.length
      ? `${this.filtered.length} symbol${this.filtered.length === 1 ? '' : 's'}`
      : 'No matching symbols';

    const frag = document.createDocumentFragment();
    const activeBg = this.theme?.selectionBackground ?? 'rgba(56, 139, 253, 0.22)';
    const muted = this.theme?.mutedForeground ?? '#9ca3af';

    this.filtered.forEach((sym, i) => {
      const row = document.createElement('button');
      row.type = 'button';
      Object.assign(row.style, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        width: '100%',
        minHeight: '42px',
        padding: '0 12px',
        border: 'none',
        textAlign: 'left',
        cursor: 'pointer',
        color: 'inherit',
        background: i === this.selectedIdx ? activeBg : 'transparent',
        fontSize: '13px',
      });

      const left = document.createElement('span');
      left.style.overflow = 'hidden';
      left.style.textOverflow = 'ellipsis';
      left.style.whiteSpace = 'nowrap';

      const kind = document.createElement('span');
      kind.textContent = sym.kindLabel;
      Object.assign(kind.style, {
        display: 'inline-block',
        minWidth: '42px',
        fontSize: '11px',
        fontFamily: 'ui-monospace, monospace',
        color: muted,
        marginRight: '6px',
      });

      const name = document.createElement('span');
      name.textContent = sym.name;
      name.style.fontWeight = '600';
      left.append(kind, name);

      if (sym.container) {
        const cont = document.createElement('span');
        cont.textContent = ` · ${sym.container}`;
        cont.style.color = muted;
        cont.style.fontSize = '12px';
        left.appendChild(cont);
      }

      const ln = document.createElement('span');
      ln.textContent = `:${sym.lineNumber}`;
      Object.assign(ln.style, {
        fontFamily: 'ui-monospace, monospace',
        fontVariantNumeric: 'tabular-nums',
        fontSize: '12px',
        color: muted,
        flexShrink: '0',
      });

      row.append(left, ln);
      row.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.jumpToSymbol(sym);
      });
      frag.appendChild(row);
    });

    this.listEl.replaceChildren(frag);
  }
}
