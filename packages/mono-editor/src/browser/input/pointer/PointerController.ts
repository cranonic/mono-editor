import type { RenderMetrics } from '../../../common/config/editorOptions';
import type { SelectionState } from '../../../common/core/SelectionState';
import type { TextModel } from '../../../common/model/TextModel';
import { graphemeRangeAt } from '../../../common/util/grapheme';
import type { ColorHit, InlayHintHit, LinkHit, TeardropHit } from '../../render/CanvasRenderer';
import type { ViewController } from '../../view/ViewController';
import {
  handleDeferredTapOverlay,
  handleInlayHintTap,
  handlePointerDownOverlay,
  type InlayHintClickMeta,
} from './overlayHits';
import { TeardropDragController } from './teardropHandles';
import { AXIS_LOCK_RATIO, TouchScrollPhysics, type ScrollAxis } from './touchScroll';

export type PointerInteractKind = 'tap' | 'scroll' | 'scrollEnd' | 'select' | 'handle' | 'handleTap';
export type { InlayHintClickMeta };

export interface PointerExtraCallbacks {
  onMouseEvent?: (kind: 'down' | 'up' | 'move' | 'leave' | 'contextmenu', e: MouseEvent) => void;
  onPinchZoom?: (scaleRatio: number) => void;
  onTapMeta?: (info: { clientX: number; clientY: number; pointerType: string }) => void;
}

const TAP_SLOP = 14;
const SCROLL_THRESH = 10;
const HANDLE_MOVE_THRESH = 3;
const LONG_MS = 450;
const DOUBLE_MS = 400;
const DOUBLE_DIST = 36;

/**
 * Unified touch + mouse pointer controller for the editor canvas.
 * Coordinates tap, double-tap, long-press, axis-locked touch scroll/fling,
 * two-finger pinch-to-zoom, teardrop handles, and public mouse event dispatch.
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
  private onInlayHintClick?: (hit: InlayHintHit, meta?: InlayHintClickMeta) => void;
  private onLinkClick?: (hit: LinkHit, e: PointerEvent) => void;
  private extra?: PointerExtraCallbacks;
  private disposed = false;

  private scrollPhysics = new TouchScrollPhysics();
  private teardrops = new TeardropDragController();

  // Two-finger pinch-to-zoom state
  private touchPointers = new Map<number, { x: number; y: number }>();
  private pinchStartDist = 0;
  private pinchActive = false;

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
    onInlayHintClick?: (hit: InlayHintHit, meta?: InlayHintClickMeta) => void,
    onLinkClick?: (hit: LinkHit, e: PointerEvent) => void,
    extra?: PointerExtraCallbacks,
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
    this.onInlayHintClick = onInlayHintClick;
    this.onLinkClick = onLinkClick;
    this.extra = extra;

    root.style.touchAction = 'none';
    root.addEventListener('pointerdown', this.onDown, { passive: false });
    root.addEventListener('pointermove', this.onMove, { passive: false });
    root.addEventListener('pointerup', this.onUp);
    root.addEventListener('pointercancel', this.onCancelOrLostCapture);
    root.addEventListener('lostpointercapture', this.onCancelOrLostCapture);
    root.addEventListener('pointerleave', this.onLeave);
    root.addEventListener('contextmenu', this.onContextMenu);
  }

  setModel(model: TextModel): void {
    this.model = model;
    this.clearLongPress();
    this.clearSingleTap();
    this.scrollPhysics.stop();
    this.teardrops.reset();
    this.touchPointers.clear();
    this.pinchActive = false;
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
    this.touchPointers.clear();
    this.view.freeHandle = null;
    this.root.removeEventListener('pointerdown', this.onDown);
    this.root.removeEventListener('pointermove', this.onMove);
    this.root.removeEventListener('pointerup', this.onUp);
    this.root.removeEventListener('pointercancel', this.onCancelOrLostCapture);
    this.root.removeEventListener('lostpointercapture', this.onCancelOrLostCapture);
    this.root.removeEventListener('pointerleave', this.onLeave);
    this.root.removeEventListener('contextmenu', this.onContextMenu);
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

  private onLeave = (e: PointerEvent): void => {
    this.extra?.onMouseEvent?.('leave', e);
  };

  private onContextMenu = (e: MouseEvent): void => {
    this.extra?.onMouseEvent?.('contextmenu', e);
  };

  private isWithinDoubleWindow(x: number, y: number, t: number): boolean {
    if (this.lastTapT <= 0 || t - this.lastTapT > DOUBLE_MS) return false;
    return Math.hypot(x - this.lastTapX, y - this.lastTapY) <= DOUBLE_DIST;
  }

  private tryHandleOverlayClick(e: PointerEvent): boolean {
    const rect = this.root.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    const hasTeardropHit = Boolean(
      this.teardrops.hitTest(this.root, this.getTeardrops(), e.clientX, e.clientY),
    );
    return handlePointerDownOverlay(this.view, localX, localY, e, hasTeardropHit, {
      onFoldToggle: this.onFoldToggle,
      onColorSwatchClick: this.onColorSwatchClick,
      onLinkClick: this.onLinkClick,
      onStickyTap: () => this.onInteract('tap'),
      onBottomStickyTap: () => this.scrollPhysics.stop(),
    });
  }

  private getPinchDistance(): number {
    const pts = Array.from(this.touchPointers.values());
    if (pts.length < 2) return 0;
    return Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y);
  }

  private onDown = (e: PointerEvent): void => {
    this.extra?.onMouseEvent?.('down', e);
    if (e.pointerType === 'touch') {
      this.touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touchPointers.size === 2 && this.extra?.onPinchZoom) {
        this.pinchActive = true;
        this.pinchStartDist = Math.max(10, this.getPinchDistance());
        this.active = false;
        this.clearLongPress();
        this.scrollPhysics.stop();
        return;
      }
    }

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
    this.extra?.onMouseEvent?.('move', e);
    if (e.pointerType === 'touch' && this.touchPointers.has(e.pointerId)) {
      this.touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pinchActive && this.touchPointers.size >= 2) {
        e.preventDefault();
        const curDist = this.getPinchDistance();
        if (this.pinchStartDist > 0 && Math.abs(curDist - this.pinchStartDist) > 12) {
          this.extra?.onPinchZoom?.(curDist / this.pinchStartDist);
          this.pinchStartDist = curDist;
        }
        return;
      }
    }

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
      this.teardrops.updateEdgeAutoScroll(
        this.root,
        e.clientY,
        () => {
          const dy = this.teardrops.getAutoScrollDelta();
          const dx = this.teardrops.getAutoScrollDeltaX();
          if (dy !== 0) this.view.scrollTop = Math.max(0, this.view.scrollTop + dy);
          if (dx !== 0) this.view.scrollLeft = Math.max(0, this.view.scrollLeft + dx);
          this.view.clampScrollPublic();
          this.teardrops.updateDrag(
            this.root, this.model, this.selection, this.view, this.getMetrics(),
            this.lastX, this.lastY, () => this.onInteract('handle'),
          );
        },
        {
          clientX: e.clientX,
          contentLeft: this.view.contentLeft,
          allowHorizontal: this.view.getWordWrap() === 'off',
        },
      );
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
    this.extra?.onMouseEvent?.('up', e);
    if (e.pointerType === 'touch') {
      this.touchPointers.delete(e.pointerId);
      if (this.pinchActive) {
        if (this.touchPointers.size < 2) {
          this.pinchActive = false;
          this.pinchStartDist = 0;
        }
        return;
      }
    }

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
      const isDouble = pendingDouble || nearLast;

      if (e.pointerType === 'touch' || e.pointerType === 'pen') {
        const rect = this.root.getBoundingClientRect();
        const localX = e.clientX - rect.left;
        const localY = e.clientY - rect.top;
        if (
          handleDeferredTapOverlay(this.view, localX, localY, e, {
            onFoldToggle: this.onFoldToggle,
            onColorSwatchClick: this.onColorSwatchClick,
          })
        ) {
          this.clearSingleTap();
          this.lastTapT = 0;
          return;
        }
      }

      if (this.onInlayHintClick) {
        const rect = this.root.getBoundingClientRect();
        const localX = e.clientX - rect.left;
        const localY = e.clientY - rect.top;
        if (handleInlayHintTap(this.view, localX, localY, e, isDouble, this.onInlayHintClick)) {
          this.clearSingleTap();
          if (isDouble) {
            this.lastTapT = 0;
          } else {
            this.lastTapT = now;
            this.lastTapX = e.clientX;
            this.lastTapY = e.clientY;
          }
          return;
        }
      }

      if (isDouble) {
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
      this.extra?.onTapMeta?.({ clientX: e.clientX, clientY: e.clientY, pointerType: e.pointerType || 'mouse' });
      this.onInteract('tap');
      this.lastTapT = now;
      this.lastTapX = e.clientX;
      this.lastTapY = e.clientY;
      return;
    }
    if (wasSelecting) this.onInteract('select');
  };

  private onCancelOrLostCapture = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      this.touchPointers.delete(e.pointerId);
      if (this.pinchActive && this.touchPointers.size < 2) {
        this.pinchActive = false;
        this.pinchStartDist = 0;
      }
    }
    if (!this.active || (this.pointerId !== null && e.pointerId !== this.pointerId)) return;
    const wasHandleDrag = Boolean(this.teardrops.handleDrag && this.teardrops.handleMoved);
    const wasScrolling = this.scrolling;
    this.clearLongPress();
    this.teardrops.stopAutoScroll();
    this.active = false;
    this.pointerId = null;
    this.teardrops.reset();
    this.pendingDouble = false;
    this.scrolling = false;
    this.selecting = false;
    this.scrollAxis = 'none';
    if (wasHandleDrag) {
      this.view.freeHandle = null;
      this.view.schedulePaint();
      this.onInteract(!this.selection.isEmpty ? 'select' : 'handle');
    } else if (wasScrolling) {
      this.onInteract('scrollEnd');
    }
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
