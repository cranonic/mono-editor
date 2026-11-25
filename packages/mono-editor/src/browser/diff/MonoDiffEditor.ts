import type { IMonoTextModel, MonoDisposable } from '../../common/core/types';
import { computeLineDiff, type DiffHunk, type LineDiffResult } from '../../common/diff/myersDiff';
import { monoThemeService, registerBuiltinThemes, resolveWidgetTheme } from '../../platform/theme';
import { DEFAULT_THEME } from '../../common/config/themeTypes';

export interface IDiffEditorModel {
  original: IMonoTextModel;
  modified: IMonoTextModel;
}

export interface MonoDiffEditorOptions {
  /** Force side-by-side (`true`) or inline unified (`false`). Default: auto-responsive (`width >= 720`). */
  renderSideBySide?: boolean;
  /** Viewport width breakpoint (px) below which auto mode switches to unified inline diff. Default `720`. */
  inlineBreakpointPx?: number;
  fontSize?: number;
  fontFamily?: string;
  readOnly?: boolean;
}

export interface IMonoDiffEditor {
  setModel(model: IDiffEditorModel | null): void;
  getModel(): IDiffEditorModel | null;
  getLineChanges(): DiffHunk[];
  updateOptions(options: Partial<MonoDiffEditorOptions>): void;
  layout(): void;
  onDidUpdateDiff(listener: (result: LineDiffResult) => void): MonoDisposable;
  dispose(): void;
}

/**
 * Mobile-responsive Diff Editor (`editor.createDiffEditor`).
 * Automatically renders unified inline diff on narrow/mobile screens (< 720px)
 * and side-by-side diff on wider viewports, with 40px touch-friendly hunk navigation.
 */
export class MonoDiffEditor implements IMonoDiffEditor {
  private readonly root: HTMLDivElement;
  private readonly header: HTMLDivElement;
  private readonly summaryEl: HTMLSpanElement;
  private readonly modeBtn: HTMLButtonElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly body: HTMLDivElement;

  private model: IDiffEditorModel | null = null;
  private options: MonoDiffEditorOptions;
  private diffResult: LineDiffResult = { hunks: [], inlineRows: [], sideBySideRows: [], addedCount: 0, removedCount: 0 };
  private activeHunkIdx = -1;
  private updateListeners = new Set<(r: LineDiffResult) => void>();
  private ro: ResizeObserver | null = null;
  private themeUnsub: MonoDisposable | null = null;
  private disposed = false;

  constructor(host: HTMLElement, options: MonoDiffEditorOptions = {}) {
    registerBuiltinThemes();
    this.options = {
      fontSize: options.fontSize ?? 13,
      fontFamily: options.fontFamily ?? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      inlineBreakpointPx: options.inlineBreakpointPx ?? 720,
      renderSideBySide: options.renderSideBySide,
      readOnly: options.readOnly ?? true,
    };

    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'relative',
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    });

    this.header = document.createElement('div');
    Object.assign(this.header.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
      padding: '4px 10px',
      minHeight: '42px',
      flexShrink: '0',
      fontSize: '12px',
    });

    this.summaryEl = document.createElement('span');
    this.summaryEl.style.fontVariantNumeric = 'tabular-nums';
    this.summaryEl.style.fontWeight = '600';

    const controls = document.createElement('div');
    Object.assign(controls.style, { display: 'flex', alignItems: 'center', gap: '6px' });

    this.prevBtn = this.makeButton('Prev', 'Previous change', () => this.jumpHunk(-1));
    this.nextBtn = this.makeButton('Next', 'Next change', () => this.jumpHunk(1));
    this.modeBtn = this.makeButton('Auto', 'Toggle inline / side-by-side diff', () => {
      const currentlySplit = this.isSideBySide();
      this.options.renderSideBySide = !currentlySplit;
      this.render();
    });

    controls.append(this.prevBtn, this.nextBtn, this.modeBtn);
    this.header.append(this.summaryEl, controls);

    this.body = document.createElement('div');
    Object.assign(this.body.style, {
      flex: '1',
      overflow: 'auto',
      WebkitOverflowScrolling: 'touch',
      fontFamily: this.options.fontFamily!,
      fontSize: `${this.options.fontSize}px`,
      lineHeight: '1.5',
    });

    this.root.append(this.header, this.body);
    host.appendChild(this.root);

    this.applyTheme();
    this.themeUnsub = monoThemeService.onDidChangeColorTheme(() => {
      if (!this.disposed) {
        this.applyTheme();
        this.render();
      }
    });
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.layout());
      this.ro.observe(this.root);
    }
  }

  private makeButton(label: string, ariaLabel: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.setAttribute('aria-label', ariaLabel);
    Object.assign(btn.style, {
      minHeight: '34px',
      minWidth: '40px',
      padding: '0 10px',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '12px',
      fontWeight: '500',
    });
    btn.addEventListener('click', onClick);
    return btn;
  }

  private resolveColors() {
    const editorTheme = { ...DEFAULT_THEME, ...monoThemeService.toPartialEditorTheme() };
    let colors: Record<string, string> = {};
    try { colors = monoThemeService.resolve().colors; } catch { /* */ }
    const wt = resolveWidgetTheme(editorTheme, colors);
    return { editorTheme, wt };
  }

  private applyTheme(): void {
    const { editorTheme, wt } = this.resolveColors();
    this.root.style.background = editorTheme.background;
    this.root.style.color = editorTheme.foreground;
    this.header.style.background = wt.background;
    this.header.style.borderBottom = `1px solid ${wt.border}`;
    this.header.style.color = wt.foreground;
    for (const btn of [this.prevBtn, this.nextBtn, this.modeBtn]) {
      btn.style.background = wt.inputBackground;
      btn.style.color = wt.foreground;
      btn.style.border = `1px solid ${wt.border}`;
    }
  }

  setModel(model: IDiffEditorModel | null): void {
    this.model = model;
    this.activeHunkIdx = -1;
    this.recompute();
  }

  getModel(): IDiffEditorModel | null { return this.model; }
  getLineChanges(): DiffHunk[] { return this.diffResult.hunks.map((h) => ({ ...h })); }

  updateOptions(options: Partial<MonoDiffEditorOptions>): void {
    this.options = { ...this.options, ...options };
    this.body.style.fontFamily = this.options.fontFamily!;
    this.body.style.fontSize = `${this.options.fontSize}px`;
    this.render();
  }

  layout(): void {
    if (!this.disposed) this.render();
  }

  onDidUpdateDiff(listener: (result: LineDiffResult) => void): MonoDisposable {
    this.updateListeners.add(listener);
    return { dispose: () => this.updateListeners.delete(listener) };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ro?.disconnect();
    this.themeUnsub?.dispose();
    this.updateListeners.clear();
    this.root.remove();
  }

  private isSideBySide(): boolean {
    if (this.options.renderSideBySide !== undefined) return this.options.renderSideBySide;
    const width = this.root.getBoundingClientRect().width || 800;
    return width >= (this.options.inlineBreakpointPx ?? 720);
  }

  private recompute(): void {
    if (!this.model) {
      this.diffResult = { hunks: [], inlineRows: [], sideBySideRows: [], addedCount: 0, removedCount: 0 };
    } else {
      this.diffResult = computeLineDiff(this.model.original.getValue(), this.model.modified.getValue());
    }
    this.render();
    for (const l of this.updateListeners) {
      try { l(this.diffResult); } catch { /* */ }
    }
  }

  private jumpHunk(delta: number): void {
    const count = this.diffResult.hunks.length;
    if (count === 0) return;
    this.activeHunkIdx = (this.activeHunkIdx + delta + count) % count;
    const target = this.body.querySelector<HTMLElement>(`[data-diff-hunk="${this.activeHunkIdx}"]`);
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  private render(): void {
    const split = this.isSideBySide();
    this.modeBtn.textContent = split ? 'Inline' : 'Split';
    const { addedCount, removedCount, hunks } = this.diffResult;
    this.summaryEl.textContent = `${hunks.length} change${hunks.length === 1 ? '' : 's'}  +${addedCount}  -${removedCount}`;

    const { editorTheme, wt } = this.resolveColors();
    const frag = document.createDocumentFragment();
    const table = document.createElement('div');
    table.style.minWidth = '100%';

    const addBg = 'rgba(34, 197, 94, 0.16)';
    const remBg = 'rgba(239, 68, 68, 0.16)';
    const emptyBg = 'rgba(128, 128, 128, 0.08)';
    const gutterCol = editorTheme.gutterForeground;

    const findHunkIndex = (origLn: number | null, modLn: number | null): number => {
      return hunks.findIndex((h) => {
        const matchOrig = origLn != null && h.originalStartLineNumber === origLn;
        const matchMod = modLn != null && h.modifiedStartLineNumber === modLn;
        return matchOrig || matchMod;
      });
    };

    if (split) {
      for (const row of this.diffResult.sideBySideRows) {
        const el = document.createElement('div');
        Object.assign(el.style, {
          display: 'grid',
          gridTemplateColumns: '44px minmax(0, 1fr) 44px minmax(0, 1fr)',
          whiteSpace: 'pre',
        });
        const hIdx = findHunkIndex(row.originalLineNumber, row.modifiedLineNumber);
        if (hIdx >= 0) el.dataset.diffHunk = String(hIdx);

        const leftBg =
          row.originalLineNumber == null ? emptyBg : row.kind === 'delete' || row.kind === 'modify' ? remBg : 'transparent';
        const rightBg =
          row.modifiedLineNumber == null ? emptyBg : row.kind === 'insert' || row.kind === 'modify' ? addBg : 'transparent';

        const lNum = this.makeGutterCell(row.originalLineNumber, gutterCol, leftBg);
        const lTxt = this.makeCodeCell(row.originalText ?? '', leftBg, wt.border);
        const rNum = this.makeGutterCell(row.modifiedLineNumber, gutterCol, rightBg);
        const rTxt = this.makeCodeCell(row.modifiedText ?? '', rightBg, 'transparent');
        el.append(lNum, lTxt, rNum, rTxt);
        table.appendChild(el);
      }
    } else {
      for (const row of this.diffResult.inlineRows) {
        const el = document.createElement('div');
        const bg = row.kind === 'insert' ? addBg : row.kind === 'delete' ? remBg : 'transparent';
        Object.assign(el.style, {
          display: 'grid',
          gridTemplateColumns: '38px 38px 18px minmax(0, 1fr)',
          background: bg,
          whiteSpace: 'pre',
        });
        const hIdx = findHunkIndex(row.originalLineNumber, row.modifiedLineNumber);
        if (hIdx >= 0) el.dataset.diffHunk = String(hIdx);

        const oNum = this.makeGutterCell(row.originalLineNumber, gutterCol, 'transparent');
        const mNum = this.makeGutterCell(row.modifiedLineNumber, gutterCol, 'transparent');
        const sign = document.createElement('span');
        sign.textContent = row.kind === 'insert' ? '+' : row.kind === 'delete' ? '-' : ' ';
        Object.assign(sign.style, {
          textAlign: 'center',
          userSelect: 'none',
          color: row.kind === 'insert' ? '#22c55e' : row.kind === 'delete' ? '#ef4444' : gutterCol,
          fontWeight: '700',
        });
        const code = this.makeCodeCell(row.text, 'transparent', 'transparent');
        el.append(oNum, mNum, sign, code);
        table.appendChild(el);
      }
    }

    frag.appendChild(table);
    this.body.replaceChildren(frag);
  }

  private makeGutterCell(ln: number | null, color: string, bg: string): HTMLSpanElement {
    const cell = document.createElement('span');
    cell.textContent = ln != null ? String(ln) : '';
    Object.assign(cell.style, {
      textAlign: 'right',
      padding: '0 6px',
      color,
      background: bg,
      userSelect: 'none',
      fontVariantNumeric: 'tabular-nums',
      opacity: '0.8',
    });
    return cell;
  }

  private makeCodeCell(text: string, bg: string, borderRight: string): HTMLSpanElement {
    const cell = document.createElement('span');
    cell.textContent = text;
    Object.assign(cell.style, {
      padding: '0 8px',
      background: bg,
      borderRight: borderRight === 'transparent' ? 'none' : `1px solid ${borderRight}`,
      overflowX: 'visible',
    });
    return cell;
  }
}
