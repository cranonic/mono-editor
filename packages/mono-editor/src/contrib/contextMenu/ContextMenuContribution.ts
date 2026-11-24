import {
  ContributionIds,
  type IContextMenuContribution,
  type IEditorContributionHost,
} from '../../browser/editor/editorTypes';
import type { InputChangeEvent } from '../../browser/input/InputController';
import type { PointerInteractKind } from '../../browser/input/pointer/PointerController';
import { TEARDROP, type ColorHit } from '../../browser/render/CanvasRenderer';
import type { MonoMenuItem, MonoMenuStyle } from '../../common/config/menuTypes';
import type { TextModel } from '../../common/model/TextModel';
import { ContextMenuController } from './ContextMenuController';

export class ContextMenuContribution implements IContextMenuContribution {
  readonly id = ContributionIds.ContextMenu;
  private readonly host: IEditorContributionHost;
  private readonly menu: ContextMenuController;
  private menuRestore = false;

  constructor(host: IEditorContributionHost) {
    this.host = host;
    this.menu = new ContextMenuController(
      host.root,
      host.getModel(),
      host.selection,
      () => {
        host.view.ensureCaretVisible();
        host.syncTextarea();
        host.view.paint();
        host.emitContent();
      },
      () => host.focus(),
    );
  }

  setItems(items: MonoMenuItem[]): void { this.menu.setItems(items); }
  addItem(item: MonoMenuItem): void { this.menu.addItem(item); }
  removeItem(id: string): void { this.menu.removeItem(id); }
  setStyle(style: MonoMenuStyle): void { this.menu.setStyle(style); }
  hide(): void { this.menu.hide(); }
  show(): void { this.showEditorMenu(); }

  onInputChange(_ev: InputChangeEvent): void {
    this.menuRestore = false;
    this.menu.hide();
  }

  onPointerInteract(kind: PointerInteractKind): void {
    if (kind === 'scroll') {
      if (this.menu.isOpen()) this.menuRestore = true;
      this.menu.hide();
      return;
    }
    if (kind === 'tap' || kind === 'handle') {
      this.menuRestore = false;
      this.menu.hide();
      return;
    }
    if (kind === 'handleTap') {
      requestAnimationFrame(() => this.showEditorMenu());
      return;
    }
    if (kind === 'select') {
      if (!this.host.selection.isEmpty) {
        requestAnimationFrame(() => this.showEditorMenu());
      } else {
        this.menuRestore = false;
        this.menu.hide();
      }
    }
  }

  onScrollEnd(): void {
    if (!this.menuRestore || this.host.isDisposed()) return;
    this.menuRestore = false;
    requestAnimationFrame(() => {
      if (!this.host.isDisposed()) this.showEditorMenu();
    });
  }

  onOutsidePointerDown(): void { this.menu.hide(); }
  onColorSwatchClick(_hit: ColorHit): void { this.menu.hide(); }

  onModelChange(model: TextModel): void {
    this.menuRestore = false;
    this.menu.setModel(model);
  }

  dispose(): void { this.menu.dispose(); }

  private showEditorMenu(): void {
    if (this.host.isDisposed()) return;
    this.menuRestore = false;
    const m = this.host.getMetrics();
    const contentLeft = this.host.showLineNumbers() ? m.gutterWidth : 0;
    const lh = m.lineHeight;
    const a = this.host.selection.anchor;
    const b = this.host.selection.active;
    const aBefore = a.lineNumber < b.lineNumber || (a.lineNumber === b.lineNumber && a.column <= b.column);
    const s = aBefore ? a : b;
    const e = aBefore ? b : a;
    const toLocal = (p: { lineNumber: number; column: number }) => {
      const sp = this.host.view.screenPosOf(p.lineNumber, p.column);
      return { x: sp.x, top: sp.y };
    };
    const sp = toLocal(s);
    const ep = toLocal(e);
    const sameLine = s.lineNumber === e.lineNumber;
    const drop = TEARDROP.h;
    const gap = 8;
    const pad = 8;
    const handlesShown = this.host.getHandlesShown();

    this.menu.showAt(sp.x, sp.top, {
      gap,
      placement: (size, hostRect) => {
        const minTop = Math.max(pad, this.host.view.lastStickyHeight + 4);
        const maxTop = Math.max(
          minTop,
          hostRect.height - size.height - (this.host.view.lastBottomSticky ? lh : 0) - pad,
        );
        const clampLeft = (cx: number) =>
          Math.max(pad, Math.min(cx - size.width / 2, hostRect.width - size.width - pad));

        const handleRects: { x1: number; x2: number; y1: number; y2: number }[] = [];
        if (handlesShown) {
          const pts = this.host.selection.isEmpty ? [sp] : [sp, ep];
          for (const p of pts) {
            const tip = p.top + lh - 1;
            handleRects.push({ x1: p.x - 22, x2: p.x + 22, y1: tip, y2: tip + drop + 8 });
          }
        }
        const overlapsHandle = (left: number, top: number) =>
          handleRects.some(
            (r) => left < r.x2 && left + size.width > r.x1 && top < r.y2 && top + size.height > r.y1,
          );

        const midX = (sp.x + ep.x) / 2;
        const candidates = [
          { top: sp.top - size.height - gap, cx: sameLine ? midX : sp.x },
          { top: sp.top + lh + drop + gap, cx: sameLine ? midX : sp.x },
          { top: ep.top - size.height - gap, cx: sameLine ? midX : ep.x },
          { top: ep.top + lh + drop + gap, cx: sameLine ? midX : ep.x },
        ];
        for (const c of candidates) {
          if (c.top < minTop || c.top > maxTop) continue;
          const left = clampLeft(c.cx);
          if (overlapsHandle(left, c.top)) continue;
          return { left, top: c.top };
        }

        if (ep.top + lh < minTop) return { left: clampLeft(ep.x), top: minTop };
        if (sp.top > hostRect.height) return { left: clampLeft(sp.x), top: maxTop };
        return { left: clampLeft((contentLeft + hostRect.width) / 2), top: minTop };
      },
    });
  }
}
