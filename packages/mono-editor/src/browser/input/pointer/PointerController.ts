import type { RenderMetrics } from '../../../common/config/editorOptions';
import type { SelectionState } from '../../../common/core/SelectionState';
import type { TextModel } from '../../../common/model/TextModel';
import { graphemeRangeAt } from '../../../common/util/grapheme';
import type { ColorHit, TeardropHit } from '../../render/CanvasRenderer';
import type { ViewController } from '../../view/ViewController';
import { TeardropDragController } from './teardropHandles';
import { AXIS_LOCK_RATIO, TouchScrollPhysics, type ScrollAxis } from './touchScroll';

export type PointerInteractKind = 'tap' | 'scroll' | 'scrollEnd' | 'select' | 'handle' | 'handleTap';

const TAP_SLOP = 14;
const SCROLL_THRESH = 10;
const HANDLE_MOVE_THRESH = 3;
const LONG_MS = 450;
const DOUBLE_MS = 400;
const DOUBLE_DIST = 36;

/**
 * Unified touch + mouse pointer controller for the editor canvas.
 * Coordinates tap, double-tap, long-press, axis-locked touch scroll/fling, and teardrop handles.
 */
export class PointerController {
  private root: HTMLElement;
  private model: TextModel;
  private selection: SelectionState;
  private view: ViewController;
  private getMetrics: () => RenderMetrics;
  private getTeardrops: () => TeardropHit[];
  private onInteract: (kind: PointerInteractKind) => void;
  private onFoldToggle?: (lineNumber: number) => void;
  private onColorSwatchClick?: (hit: ColorHit) => void;
  private disposed = false;

  private scrollPhysics = new TouchScrollPhysics();
  private teardrops = new TeardropDragController();

  private active = false;
  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastY = 0;
  private scrollAnchorX = 0;
  private scrollAnchorY = 0;
  private startScrollTop = 0;
  private startScrollLeft = 0;
  private scrollAxis: ScrollAxis = 'none';
  private maxDist = 0;
  private scrolling = false;
  private selecting = false;

  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressFired = false;
  private longPressX = 0;
  private longPressY = 0;

  private lastTapT = 0;
  private lastTapX = 0;
  private lastTapY = 0;
  private pendingDouble = false;
  private singleTapTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    root: HTMLElement,
    model: TextModel,
    selection: SelectionState,
    view: ViewController,
    getMetrics: () => RenderMetrics,
    getTeardrops: () => TeardropHit[],
    onInteract: (kind: PointerInteractKind) => void,
    onFoldToggle?: (lineNumber: number) => void,
    onColorSwatchClick?: (hit: ColorHit) => void,
  ) {
    this.root = root;
    this.model = model;
    this.selection = selection;
    this.view = view;
    this.getMetrics = getMetrics;
    this.getTeardrops = getTeardrops;
    this.onInteract = onInteract;
    this.onFoldToggle = onFoldToggle;
    this.onColorSwatchClick = onColorSwatchClick;

    root.style.touchAction = 'none';
    root.addEventListener('pointerdown', this.onDown, { passive: false });
    root.addEventListener('pointermove', this.onMove, { passive: false });
    root.addEventListener('pointerup', this.onUp);
    root.addEventListener('pointercancel', this.onUp);
    root.addEventListener('lostpointercapture', this.onUp);
  }

  setModel(model: TextModel): void {
    this.model = model;
    this.clearLongPress();
    this.clearSingleTap();
    this.scrollPhysics.stop();
    this.teardrops.reset();
    this.active = false;
    this.scrolling = false;
    this.selecting = false;
    this.view.freeHandle = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearLongPress();
    this.clearSingleTap();
    this.scrollPhysics.dispose();
    this.teardrops.dispose();
    this.view.freeHandle = null;
    this.root.removeEventListener('pointerdown', this.onDown);
    this.root.removeEventListener('pointermove', this.onMove);
    this.root.removeEventListener('pointerup', this.onUp);
    this.root.removeEventListener('pointercancel', this.onUp);
    this.root.removeEventListener('lostpointercapture', this.onUp);
  }

  hitTest(clientX: number, clientY: number, round = true): { lineNumber: number; column: number } {
    const rect = this.root.getBoundingClientRect();
    return this.view.positionAtPoint(clientX - rect.left, clientY - rect.top, round);
  }

  selectWordAt(clientX: number, clientY: number): void {
    const pos = this.hitTest(clientX, clientY, false);
    const line = this.model.getLineContent(pos.lineNumber);
    if (!line.length) {
      this.selection.setCaret(pos.lineNumber, 1);
      return;
    }
    const idx = Math.max(0, Math.min(line.length - 1, pos.column - 1));
    const isWord = (ch: string) => /[\p{L}\p{M}\p{N}_$]/u.test(ch);
    let start = idx;
    let end = idx;
    if (!isWord(line[idx]!)) {
      const g = graphemeRangeAt(line, idx);
      this.selection.anchor = { lineNumber: pos.lineNumber, column: g.start + 1 };
      this.selection.active = { lineNumber: pos.lineNumber, column: g.end + 1 };
      return;
    }
    while (start > 0 && isWord(line[start - 1]!)) start--;
    while (end < line.length - 1 && isWord(line[end + 1]!)) end++;
    this.selection.anchor = { lineNumber: pos.lineNumber, column: start + 1 };
    this.selection.active = { lineNumber: pos.lineNumber, column: end + 2 };
  }

  private isWithinDoubleWindow(x: number, y: number, t: number): boolean {
    if (this.lastTapT <= 0 || t - this.lastTapT > DOUBLE_MS) return false;
    return Math.hypot(x - this.lastTapX, y - this.lastTapY) <= DOUBLE_DIST;
  }

  private tryHandleOverlayClick(e: PointerEvent): boolean {
    const rect = this.root.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;

    const stickyHit = this.view.hitTestSticky(localX, localY);
    if (stickyHit) {
      e.preventDefault();
      this.view.revealStickyLine(stickyHit.lineNumber, stickyHit.index, localX);
      this.onInteract('tap');
      return true;
    }

    const bottomHit = this.teardrops.hitTest(this.root, this.getTeardrops(), e.clientX, e.clientY)
      ? null
      : this.view.hitTestBottomSticky(localX, localY);
    if (bottomHit) {
      e.preventDefault();
      this.scrollPhysics.stop();
      this.view.revealBottomStickyLine(bottomHit.lineNumber, localX);
      this.onInteract('tap');
      return true;
    }

    if (this.onFoldToggle) {
      for (const fh of this.view.getFoldHits()) {
        if (localX >= fh.x - 4 && localX <= fh.x + fh.w + 4 && localY >= fh.y && localY <= fh.y + fh.h) {
          e.preventDefault();
          this.onFoldToggle(fh.lineNumber);
          return true;
        }
      }
    }

    if (this.onColorSwatchClick) {
      for (const ch of this.view.getColorHits()) {
        if (localX >= ch.x - 3 && localX <= ch.x + ch.w + 3 && localY >= ch.y - 3 && localY <= ch.y + ch.h + 3) {
          e.preventDefault();
          e.stopPropagation();
          this.onColorSwatchClick(ch);
          return true;
        }
      }
    }
    return false;
  }

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    this.scrollPhysics.stop();
    this.teardrops.stopAutoScroll();

    const now = performance.now();
    this.active = true;
    this.pointerId = e.pointerId;
    this.startX = this.lastX = this.scrollAnchorX = e.clientX;
    this.startY = this.lastY = this.scrollAnchorY = e.clientY;
    this.startScrollTop = this.view.scrollTop;
    this.startScrollLeft = this.view.scrollLeft;
    this.scrollAxis = 'none';
    this.maxDist = 0;
    this.scrolling = false;
    this.selecting = e.shiftKey;
    this.teardrops.reset();
    this.longPressFired = false;
    this.scrollPhysics.resetSamples();
    this.scrollPhysics.pushSample(e.clientX, e.clientY, now);

    this.pendingDouble = this.isWithinDoubleWindow(e.clientX, e.clientY, now);
    if (this.pendingDouble) this.clearSingleTap();

    if (this.tryHandleOverlayClick(e)) {
      this.active = false;
      this.pointerId = null;
      return;
    }

    const hit = this.pendingDouble
      ? null
      : this.teardrops.hitTest(this.root, this.getTeardrops(), e.clientX, e.clientY);
    if (hit) {
      this.teardrops.beginDrag(hit, this.root, this.selection, e.clientY);
    }

    try { this.root.setPointerCapture(e.pointerId); } catch { /* */ }

    this.clearLongPress();
    if (!this.teardrops.handleDrag && !this.pendingDouble) {
      this.longPressX = e.clientX;
      this.longPressY = e.clientY;
      this.longPressTimer = setTimeout(() => {
        if (!this.active || this.scrolling || this.teardrops.handleDrag) return;
        if (this.maxDist > TAP_SLOP) return;
        this.longPressFired = true;
        this.selecting = true;
        this.selectWordAt(this.longPressX, this.longPressY);
        try { navigator.vibrate?.(12); } catch { /* */ }
        this.view.schedulePaint();
        this.onInteract('select');
      }, LONG_MS);
    }
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.active || e.pointerId !== this.pointerId) return;
    e.preventDefault();
    const now = performance.now();
    const totalDx = e.clientX - this.startX;
    const totalDy = e.clientY - this.startY;
    const dist = Math.hypot(totalDx, totalDy);
    if (dist > this.maxDist) this.maxDist = dist;

    if (!this.scrolling && !this.teardrops.handleDrag && !this.selecting && !this.longPressFired) {
      if (dist > SCROLL_THRESH) {
        this.scrolling = true;
        this.pendingDouble = false;
        this.clearLongPress();
        this.scrollAnchorX = e.clientX;
        this.scrollAnchorY = e.clientY;
        this.startScrollTop = this.view.scrollTop;
        this.startScrollLeft = this.view.scrollLeft;
        const ax = Math.abs(totalDx);
        const ay = Math.abs(totalDy);
        this.scrollAxis = ax > ay * AXIS_LOCK_RATIO ? 'x' : 'y';
      }
    }

    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.scrollPhysics.pushSample(e.clientX, e.clientY, now);

    if (this.teardrops.handleDrag) {
      if (!this.teardrops.handleMoved && dist < HANDLE_MOVE_THRESH) return;
      this.teardrops.handleMoved = true;
      this.teardrops.updateEdgeAutoScroll(this.root, e.clientY, () => {
        this.view.scrollTop = Math.max(0, this.view.scrollTop + this.teardrops.getAutoScrollDelta());
        this.view.clampScrollPublic();
        this.teardrops.updateDrag(
          this.root, this.model, this.selection, this.view, this.getMetrics(),
          this.lastX, this.lastY, () => this.onInteract('handle'),
        );
      });
      this.teardrops.updateDrag(
        this.root, this.model, this.selection, this.view, this.getMetrics(),
        e.clientX, e.clientY, () => this.onInteract('handle'),
      );
      return;
    }

    if (this.selecting || this.longPressFired) {
      const pos = this.hitTest(e.clientX, e.clientY);
      this.selection.moveActive(pos.lineNumber, pos.column, true);
      this.view.ensureCaretVisible();
      this.view.schedulePaint();
      return;
    }

    if (this.scrolling) {
      const dx = e.clientX - this.scrollAnchorX;
      const dy = e.clientY - this.scrollAnchorY;
      if (this.scrollAxis !== 'x') this.view.scrollTop = Math.max(0, this.startScrollTop - dy);
      if (this.scrollAxis !== 'y') this.view.scrollLeft = Math.max(0, this.startScrollLeft - dx);
      this.view.clampScrollPublic();
      this.view.schedulePaint();
      this.onInteract('scroll');
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (!this.active || (this.pointerId !== null && e.pointerId !== this.pointerId)) return;
    this.clearLongPress();
    this.teardrops.stopAutoScroll();

    const wasHandleDrag = Boolean(this.teardrops.handleDrag && this.teardrops.handleMoved);
    const wasHandleTap = Boolean(this.teardrops.handleDrag && !this.teardrops.handleMoved);
    const wasSelecting = (this.selecting && !this.teardrops.handleDrag) || this.longPressFired;
    const wasScrolling = this.scrolling;
    const axis = this.scrollAxis;
    const wasTap = !wasScrolling && this.maxDist <= TAP_SLOP;
    const pendingDouble = this.pendingDouble;

    this.active = false;
    this.pointerId = null;
    this.teardrops.reset();
    this.pendingDouble = false;
    this.scrolling = false;
    this.scrollAxis = 'none';

    if (wasHandleDrag) {
      this.view.freeHandle = null;
      this.view.ensureCaretVisible();
      this.view.schedulePaint();
      this.onInteract(!this.selection.isEmpty ? 'select' : 'handle');
      return;
    }
    if (wasHandleTap) {
      this.view.freeHandle = null;
      this.view.schedulePaint();
      this.onInteract('handleTap');
      return;
    }
    if (wasScrolling && !wasSelecting) {
      const { vx, vy } = this.scrollPhysics.computeVelocity(performance.now());
      this.scrollPhysics.startFling(
        vx, vy, axis, this.view,
        () => this.onInteract('scroll'),
        () => this.onInteract('scrollEnd'),
      );
      this.onInteract('scroll');
      if (!this.scrollPhysics.isFlinging) this.onInteract('scrollEnd');
      this.lastTapT = 0;
      this.clearSingleTap();
      return;
    }
    if (this.longPressFired) {
      this.onInteract('select');
      this.lastTapT = 0;
      this.clearSingleTap();
      return;
    }
    if (wasTap && !wasSelecting) {
      const now = performance.now();
      const nearLast = this.isWithinDoubleWindow(e.clientX, e.clientY, now);
      if (pendingDouble || nearLast) {
        this.clearSingleTap();
        this.selectWordAt(e.clientX, e.clientY);
        this.view.schedulePaint();
        this.onInteract('select');
        this.lastTapT = 0;
        try { navigator.vibrate?.(8); } catch { /* */ }
        return;
      }
      this.clearSingleTap();
      const pos = this.hitTest(e.clientX, e.clientY);
      if (e.altKey) this.selection.addSelection(pos, pos, true);
      else this.selection.setCaret(pos.lineNumber, pos.column);
      this.view.schedulePaint();
      this.onInteract('tap');
      this.lastTapT = now;
      this.lastTapX = e.clientX;
      this.lastTapY = e.clientY;
      return;
    }
    if (wasSelecting) this.onInteract('select');
  };

  private clearSingleTap(): void {
    if (this.singleTapTimer) {
      clearTimeout(this.singleTapTimer);
      this.singleTapTimer = null;
    }
  }

  private clearLongPress(): void {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }
}
