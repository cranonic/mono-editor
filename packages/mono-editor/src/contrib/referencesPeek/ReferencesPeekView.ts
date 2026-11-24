import type { TextModel } from '../../common/model/TextModel';
import type { Location } from '../../common/languages/providers/types';
import type { ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';
import { createIcon, ensureCodicons } from '../../platform/icons';

import type { MonoEditorTheme } from '../../common/config/themeTypes';
import type { IModelDeltaDecoration } from '../../common/decorations/types';

/** Minimal editor interface required by ReferencesPeekView (avoids contrib -> api import). */
export interface PeekCodeEditorLike {
  layout(): void;
  setTheme?(theme: Partial<MonoEditorTheme> | string): void;
  setSelection(sel: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  }): void;
  revealLineInCenter(lineNumber: number): void;
  focus(): void;
  dispose(): void;
  deltaDecorations(
    oldDecorations: string[],
    newDecorations: IModelDeltaDecoration[],
  ): string[];
}

export interface PeekReferenceItem {
  location: Location;
  lineNumber: number;
  startColumn: number;
  endColumn: number;
  lineText: string;
  fileName: string;
  dirPath: string;
  uriString?: string;
}

export interface ReferencesPeekCallbacks {
  /** Factory that mounts a real live MonoEditor sharing the exact backing TextModel. */
  createPeekEditor: (container: HTMLElement, model: TextModel) => PeekCodeEditorLike;
  /** Optional double-click handler to navigate the main editor to a reference. */
  onJumpMainEditor?: (loc: Location) => void;
  /** Called when the user closes the peek view via the × button or Escape. */
  onClose: () => void;
}

/**
 * VS Code-faithful Inline References Peek View:
 * - Embedded directly in the editor's inline view zone (scrolls naturally with the document)
 * - Top accent border with an upward triangle notch pointing directly at the selected keyword
 *   and tracking horizontal scroll (`scrollLeft`)
 * - Header: `<fileName>` `<dirPath> - References (<count>)` + `×` close button
 * - Left pane (~64%): Real live embedded MonoEditor sharing the exact backing TextModel
 *   (bi-directional live edits between main editor & peek editor)
 * - Right pane (~36%): Scrollable reference list with highlighted match spans; clicking a row
 *   jumps the left peek editor straight to that line
 * - Stays open during scrolling until `×` is clicked, Escape is pressed, or the file switches.
 */
export class ReferencesPeekView {
  private host: HTMLElement;
  private el: HTMLDivElement | null = null;
  private pointerEl: HTMLDivElement | null = null;
  private headerEl: HTMLDivElement | null = null;
  private fileEl: HTMLSpanElement | null = null;
  private pathCountEl: HTMLSpanElement | null = null;
  private editorWrap: HTMLDivElement | null = null;
  private listEl: HTMLDivElement | null = null;
  private peekEditor: PeekCodeEditorLike | null = null;
  private peekDecorations: string[] = [];
  private modelUnsub: (() => void) | null = null;

  private theme: ResolvedWidgetTheme | null = null;
  private items: PeekReferenceItem[] = [];
  private activeIndex = 0;
  private anchorLine = 1;
  private anchorColumn = 1;
  private anchorEndColumn = 1;
  private heightPx = 232;
  private sharedModel: TextModel | null = null;
  private cbs: ReferencesPeekCallbacks | null = null;
  private visible = false;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  isVisible(): boolean {
    return this.visible && this.el !== null;
  }

  getHeight(): number {
    return this.heightPx;
  }

  getAnchor(): { lineNumber: number; column: number; endColumn: number } {
    return {
      lineNumber: this.anchorLine,
      column: this.anchorColumn,
      endColumn: this.anchorEndColumn,
    };
  }

  getPeekEditor(): PeekCodeEditorLike | null {
    return this.peekEditor;
  }

  getElement(): HTMLDivElement | null {
    return this.el;
  }

  applyTheme(theme: ResolvedWidgetTheme): void {
    this.theme = theme;
    if (!this.el) return;
    const accent = theme.focusBorder;
    this.el.style.background = theme.background;
    this.el.style.borderTop = `2px solid ${accent}`;
    this.el.style.borderBottom = `1px solid ${accent}`;
    this.el.style.color = theme.foreground;
    if (this.pointerEl) {
      this.pointerEl.style.borderBottomColor = accent;
    }
    if (this.headerEl) {
      this.headerEl.style.background = theme.isDark ? '#1f2329' : '#e8eef5';
      this.headerEl.style.borderBottom = `1px solid ${theme.border}`;
    }
    if (this.fileEl) this.fileEl.style.color = theme.foreground;
    if (this.pathCountEl) this.pathCountEl.style.color = theme.mutedForeground;
    if (this.listEl) {
      this.listEl.style.background = theme.background;
      this.listEl.style.borderLeft = `1px solid ${theme.border}`;
    }
    this.renderList();
  }

  open(opts: {
    anchorLine: number;
    anchorColumn: number;
    anchorEndColumn?: number;
    items: PeekReferenceItem[];
    model: TextModel;
    callbacks: ReferencesPeekCallbacks;
    heightPx?: number;
  }): void {
    this.close(false);
    ensureCodicons();

    this.anchorLine = opts.anchorLine;
    this.anchorColumn = opts.anchorColumn;
    this.anchorEndColumn = opts.anchorEndColumn ?? opts.anchorColumn;
    this.items = opts.items;
    this.sharedModel = opts.model;
    this.cbs = opts.callbacks;
    this.heightPx = opts.heightPx ?? 232;
    this.visible = true;

    // Default active index to the reference closest to anchorLine
    const exactIdx = opts.items.findIndex((it) => it.lineNumber === opts.anchorLine);
    this.activeIndex = exactIdx >= 0 ? exactIdx : 0;

    const isDark = this.theme?.isDark ?? true;
    const bg = this.theme?.background ?? '#1e1e1e';
    const border = this.theme?.border ?? '#3c3c3c';
    const fg = this.theme?.foreground ?? '#d4d4d4';
    const muted = this.theme?.mutedForeground ?? '#9d9d9d';
    const accent = this.theme?.focusBorder ?? '#007fd4';
    const headerBg = isDark ? '#20242a' : '#e8eef5';

    const el = document.createElement('div');
    el.className = 'mono-references-peek';
    el.setAttribute('data-mono-focusable', 'true');
    el.setAttribute('data-mono-widget', 'references-peek');
    Object.assign(el.style, {
      position: 'absolute',
      left: '0px',
      right: '0px',
      top: '0px',
      height: `${this.heightPx}px`,
      zIndex: '32',
      display: 'flex',
      flexDirection: 'column',
      background: bg,
      borderTop: `2px solid ${accent}`,
      borderBottom: `1px solid ${accent}`,
      color: fg,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '12px',
      boxSizing: 'border-box',
      pointerEvents: 'auto',
      overflow: 'visible',
      boxShadow: isDark ? '0 8px 20px rgba(0,0,0,0.45)' : '0 6px 16px rgba(15,23,42,0.12)',
    } as CSSStyleDeclaration);

    // Prevent clicks inside peek view from moving the parent editor's caret or bubbling to PointerController
    const stopBubble = (e: Event) => e.stopPropagation();
    el.addEventListener('pointerdown', stopBubble);
    el.addEventListener('mousedown', stopBubble);
    el.addEventListener('click', stopBubble);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close(true);
      }
    });

    // ── Upward accent triangle pointer pointing to the selected keyword ───
    const pointer = document.createElement('div');
    pointer.className = 'mono-references-peek-pointer';
    Object.assign(pointer.style, {
      position: 'absolute',
      top: '-8px',
      left: '80px',
      width: '0px',
      height: '0px',
      borderLeft: '6px solid transparent',
      borderRight: '6px solid transparent',
      borderBottom: `6px solid ${accent}`,
      pointerEvents: 'none',
      transform: 'translateX(-6px)',
    });
    el.appendChild(pointer);
    this.pointerEl = pointer;

    // ── Header bar: <fileName> <dirPath> - References (<count>)   [×] ─────
    const header = document.createElement('div');
    header.className = 'mono-references-peek-header';
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: '28px',
      minHeight: '28px',
      padding: '0 8px 0 12px',
      background: headerBg,
      borderBottom: `1px solid ${border}`,
      userSelect: 'none',
      gap: '8px',
      flexShrink: '0',
    });
    header.style.setProperty('-webkit-user-select', 'none');

    const titleGroup = document.createElement('div');
    Object.assign(titleGroup.style, {
      display: 'flex',
      alignItems: 'baseline',
      gap: '6px',
      minWidth: '0',
      overflow: 'hidden',
      whiteSpace: 'nowrap',
      textOverflow: 'ellipsis',
    });

    const fileEl = document.createElement('span');
    Object.assign(fileEl.style, {
      color: fg,
      fontWeight: '600',
      fontSize: '12px',
      whiteSpace: 'nowrap',
    });

    const pathCountEl = document.createElement('span');
    Object.assign(pathCountEl.style, {
      color: muted,
      fontSize: '12px',
      fontVariantNumeric: 'tabular-nums',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    });

    titleGroup.appendChild(fileEl);
    titleGroup.appendChild(pathCountEl);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.title = 'Close References (Escape)';
    closeBtn.setAttribute('aria-label', 'Close References');
    closeBtn.setAttribute('data-mono-focusable', 'true');
    Object.assign(closeBtn.style, {
      width: '22px',
      height: '22px',
      border: 'none',
      background: 'transparent',
      color: fg,
      borderRadius: '3px',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: '0',
      padding: '0',
    });
    closeBtn.appendChild(createIcon('close', 15));
    closeBtn.addEventListener('pointerenter', () => {
      closeBtn.style.background = this.theme?.hoverBackground ?? 'rgba(255,255,255,0.1)';
    });
    closeBtn.addEventListener('pointerleave', () => {
      closeBtn.style.background = 'transparent';
    });
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.close(true);
    });

    header.appendChild(titleGroup);
    header.appendChild(closeBtn);
    el.appendChild(header);
    this.headerEl = header;
    this.fileEl = fileEl;
    this.pathCountEl = pathCountEl;

    // ── Split Body: Left live MonoEditor (~64%) | Right reference list (~36%) ──
    const body = document.createElement('div');
    Object.assign(body.style, {
      display: 'flex',
      flex: '1',
      minHeight: '0',
      overflow: 'hidden',
    });

    const editorWrap = document.createElement('div');
    editorWrap.className = 'mono-references-peek-editor';
    editorWrap.setAttribute('data-mono-focusable', 'true');
    Object.assign(editorWrap.style, {
      flex: '1 1 64%',
      minWidth: '0',
      height: '100%',
      position: 'relative',
      overflow: 'hidden',
    });

    const listEl = document.createElement('div');
    listEl.className = 'mono-references-peek-list';
    Object.assign(listEl.style, {
      flex: '0 0 36%',
      minWidth: '140px',
      maxWidth: '340px',
      height: '100%',
      overflowY: 'auto',
      overflowX: 'hidden',
      background: bg,
      borderLeft: `1px solid ${border}`,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: '12px',
      padding: '2px 0',
      boxSizing: 'border-box',
    });

    body.appendChild(editorWrap);
    body.appendChild(listEl);
    el.appendChild(body);

    this.host.appendChild(el);
    this.el = el;
    this.editorWrap = editorWrap;
    this.listEl = listEl;

    // Mount real embedded MonoEditor sharing the exact same backing TextModel
    try {
      const peekEd = opts.callbacks.createPeekEditor(editorWrap, opts.model);
      this.peekEditor = peekEd;
      this.syncPeekDecorations();
    } catch (err) {
      console.warn('[mono references peek] failed to mount embedded editor', err);
    }

    // Live-refresh reference previews & embedded editor whenever the shared model edits
    this.modelUnsub = opts.model.onDidChange(() => {
      if (!this.visible || !this.sharedModel) return;
      for (const item of this.items) {
        if (item.lineNumber >= 1 && item.lineNumber <= this.sharedModel.getLineCount()) {
          item.lineText = this.sharedModel.getLineContent(item.lineNumber);
        }
      }
      this.renderList();
      this.syncPeekDecorations();
      this.peekEditor?.layout();
    });

    this.updateHeader();
    this.renderList();
    this.selectIndex(this.activeIndex, false);
  }

  /**
   * Syncs the peek view's vertical position with the inline view zone and moves the
   * top triangle notch horizontally with `scrollLeft` so it always points to the symbol.
   */
  syncPosition(rect: { top: number; height: number; pointerX: number; rightInset?: number; viewportHeight: number; topInset?: number }): void {
    if (!this.el || !this.visible) return;
    const topClip = rect.topInset ?? 0;
    const completelyOut =
      rect.top + rect.height < topClip - 20 || rect.top > rect.viewportHeight + 20;
    this.el.style.display = completelyOut ? 'none' : 'flex';
    this.el.style.top = `${Math.round(rect.top)}px`;
    this.el.style.height = `${Math.round(rect.height)}px`;
    this.el.style.right = `${Math.max(0, Math.round(rect.rightInset ?? 0))}px`;

    if (this.pointerEl) {
      const hostW = Math.max(80, (this.host.clientWidth || 600) - (rect.rightInset ?? 0));
      const clampedX = Math.max(18, Math.min(hostW - 24, Math.round(rect.pointerX)));
      this.pointerEl.style.left = `${clampedX}px`;
    }
  }

  selectIndex(idx: number, focusPeek = false): void {
    if (!this.items.length) return;
    this.activeIndex = Math.max(0, Math.min(this.items.length - 1, idx));
    const item = this.items[this.activeIndex]!;
    this.updateHeader();
    this.renderList();
    if (this.peekEditor) {
      this.peekEditor.setSelection({
        startLineNumber: item.lineNumber,
        startColumn: item.startColumn,
        endLineNumber: item.lineNumber,
        endColumn: item.endColumn,
      });
      this.peekEditor.revealLineInCenter(item.lineNumber);
      if (focusPeek) this.peekEditor.focus();
    }
  }

  close(notify = true): void {
    const cb = this.cbs?.onClose;
    this.visible = false;
    this.cbs = null;
    this.modelUnsub?.();
    this.modelUnsub = null;
    if (this.peekEditor) {
      try {
        this.peekEditor.dispose();
      } catch {
        /* ignore */
      }
      this.peekEditor = null;
    }
    this.peekDecorations = [];
    this.el?.remove();
    this.el = null;
    this.pointerEl = null;
    this.headerEl = null;
    this.fileEl = null;
    this.pathCountEl = null;
    this.editorWrap = null;
    this.listEl = null;
    this.sharedModel = null;
    if (notify) cb?.();
  }

  dispose(): void {
    this.close(false);
  }

  private updateHeader(): void {
    const active = this.items[this.activeIndex];
    const fileName = active?.fileName || 'untitled';
    const dirPath = active?.dirPath || '';
    const count = this.items.length;
    if (this.fileEl) this.fileEl.textContent = fileName;
    if (this.pathCountEl) {
      const pathPart = dirPath ? `${dirPath} - ` : '- ';
      this.pathCountEl.textContent = `${pathPart}References (${count})`;
    }
  }

  private syncPeekDecorations(): void {
    if (!this.peekEditor) return;
    const isDark = this.theme?.isDark ?? true;
    const bg = isDark ? 'rgba(217, 155, 38, 0.28)' : 'rgba(217, 119, 6, 0.22)';
    const nextDecs = this.items.map((it) => ({
      range: {
        startLineNumber: it.lineNumber,
        startColumn: it.startColumn,
        endLineNumber: it.lineNumber,
        endColumn: it.endColumn,
      },
      options: {
        monoBackgroundColor: bg,
      },
    }));
    this.peekDecorations = this.peekEditor.deltaDecorations(this.peekDecorations, nextDecs);
  }

  private renderList(): void {
    if (!this.listEl) return;
    const list = this.listEl;
    list.textContent = '';

    const isDark = this.theme?.isDark ?? true;
    const fg = this.theme?.foreground ?? '#d4d4d4';
    const hoverBg = this.theme?.hoverBackground ?? (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)');
    const activeBg = isDark ? 'rgba(120, 128, 140, 0.32)' : 'rgba(0, 127, 212, 0.16)';
    const matchBg = isDark ? 'rgba(217, 155, 38, 0.36)' : 'rgba(217, 119, 6, 0.28)';
    const matchFg = isDark ? '#fde68a' : '#78350f';

    this.items.forEach((item, i) => {
      const row = document.createElement('div');
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', i === this.activeIndex ? 'true' : 'false');
      Object.assign(row.style, {
        display: 'flex',
        alignItems: 'center',
        padding: '3px 10px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        lineHeight: '1.5',
        color: fg,
        background: i === this.activeIndex ? activeBg : 'transparent',
        borderRadius: '3px',
        margin: '0 4px',
      });

      // Render trimmed code preview with highlighted match span (safe DOM nodes, zero innerHTML)
      const rawLine = item.lineText;
      const leadTrim = rawLine.length - rawLine.trimStart().length;
      const trimmed = rawLine.trimStart();
      const s0 = Math.max(0, item.startColumn - 1 - leadTrim);
      const e0 = Math.max(s0, Math.min(trimmed.length, item.endColumn - 1 - leadTrim));

      const before = trimmed.slice(0, s0);
      const hit = trimmed.slice(s0, e0);
      const after = trimmed.slice(e0);

      if (before) row.appendChild(document.createTextNode(before));
      if (hit) {
        const mark = document.createElement('span');
        mark.textContent = hit;
        Object.assign(mark.style, {
          background: matchBg,
          color: matchFg,
          borderRadius: '2px',
          padding: '0 1px',
        });
        row.appendChild(mark);
      }
      if (after) row.appendChild(document.createTextNode(after));

      row.addEventListener('pointerenter', () => {
        if (i !== this.activeIndex) row.style.background = hoverBg;
      });
      row.addEventListener('pointerleave', () => {
        if (i !== this.activeIndex) row.style.background = 'transparent';
      });
      row.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.selectIndex(i, false);
      });
      row.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.cbs?.onJumpMainEditor?.(item.location);
      });

      list.appendChild(row);
    });
  }
}
