import type { RenderMetrics } from '../../../common/config/editorOptions';
import type { SelectionState } from '../../../common/core/SelectionState';
import type { TextModel } from '../../../common/model/TextModel';
import type { TeardropHit } from '../../render/CanvasRenderer';
import type { ViewController } from '../../view/ViewController';

const LINE_SWITCH_DOWN = 0.42;
const LINE_SWITCH_UP = 0.51;
const AUTO_SCROLL_EDGE = 56;
const AUTO_SCROLL_SPEED = 12;

/**
 * Manages directional teardrop hitbox tests, free teardrop dragging with sticky-line
 * hysteresis, and edge auto-scrolling.
 */
export class TeardropDragController {
  handleDrag: TeardropHit['type'] | null = null;
  handleMoved = false;
  private handleLift = 26;
  private stickyLine: number | null = null;
  private dragAnchor: { lineNumber: number; column: number } | null = null;
  private autoScrollRaf = 0;
  private autoScrollDelta = 0;
  private disposed = false;

  reset(): void {
    this.stopAutoScroll();
    this.handleDrag = null;
    this.handleMoved = false;
    this.stickyLine = null;
    this.dragAnchor = null;
  }

  dispose(): void {
    this.disposed = true;
    this.reset();
  }

  hitTest(root: HTMLElement, teardrops: TeardropHit[], clientX: number, clientY: number): TeardropHit | null {
    const rect = root.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const padX = 18;
    const padTop = 4;
    const padBottom = 22;
    let best: TeardropHit | null = null;
    let bestD = Infinity;
    for (const t of teardrops) {
      const cx = t.x + t.w / 2;
      const cy = t.y + t.h / 2;
      if (x >= t.x - padX && x <= t.x + t.w + padX && y >= t.y - padTop && y <= t.y + t.h + padBottom) {
        const d = (x - cx) ** 2 + (y - cy) ** 2;
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
    }
    return best;
  }

  beginDrag(hit: TeardropHit, root: HTMLElement, selection: SelectionState, clientY: number): void {
    this.handleDrag = hit.type;
    this.handleMoved = false;
    const edge = this.edgePosForHandle(selection, hit.type);
    this.stickyLine = edge.lineNumber;
    if (hit.type === 'start') this.dragAnchor = this.edgePosForHandle(selection, 'end');
    else if (hit.type === 'end') this.dragAnchor = this.edgePosForHandle(selection, 'start');
    else this.dragAnchor = null;

    const rect = root.getBoundingClientRect();
    const rawLift = clientY - rect.top - hit.y;
    this.handleLift = Math.max(14, Math.min(38, rawLift));
  }

  updateEdgeAutoScroll(
    root: HTMLElement,
    clientY: number,
    onTick: () => void,
  ): void {
    const rect = root.getBoundingClientRect();
    let delta = 0;
    if (clientY < rect.top + AUTO_SCROLL_EDGE) delta = -AUTO_SCROLL_SPEED;
    else if (clientY > rect.bottom - AUTO_SCROLL_EDGE) delta = AUTO_SCROLL_SPEED;
    this.autoScrollDelta = delta;
    if (delta !== 0) {
      if (!this.autoScrollRaf) {
        const loop = () => {
          if (this.disposed || !this.handleDrag || this.autoScrollDelta === 0) {
            this.autoScrollRaf = 0;
            return;
          }
          onTick();
          this.autoScrollRaf = requestAnimationFrame(loop);
        };
        this.autoScrollRaf = requestAnimationFrame(loop);
      }
    } else {
      this.stopAutoScroll();
    }
  }

  getAutoScrollDelta(): number {
    return this.autoScrollDelta;
  }

  stopAutoScroll(): void {
    this.autoScrollDelta = 0;
    if (this.autoScrollRaf) {
      cancelAnimationFrame(this.autoScrollRaf);
      this.autoScrollRaf = 0;
    }
  }

  updateDrag(
    root: HTMLElement,
    model: TextModel,
    selection: SelectionState,
    view: ViewController,
    metrics: RenderMetrics,
    clientX: number,
    clientY: number,
    onHandle: () => void,
  ): void {
    if (!this.handleDrag) return;
    const rect = root.getBoundingClientRect();
    const pos = this.posFromHandleFree(rect, model, view, metrics, clientX, clientY);

    let visualType: TeardropHit['type'] = this.handleDrag;
    if (this.handleDrag === 'cursor') {
      selection.setCaret(pos.lineNumber, pos.column);
    } else if (this.dragAnchor) {
      const anchor = this.dragAnchor;
      if (pos.lineNumber !== anchor.lineNumber || pos.column !== anchor.column) {
        selection.anchor = { ...anchor };
        selection.active = pos;
      }
      const posBeforeAnchor =
        pos.lineNumber < anchor.lineNumber ||
        (pos.lineNumber === anchor.lineNumber && pos.column <= anchor.column);
      visualType = posBeforeAnchor ? 'start' : 'end';
    }

    view.freeHandle = {
      type: visualType,
      x: clientX - rect.left,
      y: clientY - rect.top - this.handleLift,
    };
    view.schedulePaint();
    onHandle();
  }

  private posFromHandleFree(
    rect: DOMRect,
    model: TextModel,
    view: ViewController,
    m: RenderMetrics,
    clientX: number,
    clientY: number,
  ): { lineNumber: number; column: number } {
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;

    if (!view.projection.isIdentity() || view.getTopInset() > 0 || view.hasViewZones()) {
      const targetY = localY - this.handleLift - m.lineHeight * 0.45;
      return view.positionAtPoint(localX, targetY, true);
    }

    const caretMidY = localY - this.handleLift - m.lineHeight * 0.45;
    const sticky = this.stickyLine ?? view.positionAtPoint(localX, localY, true).lineNumber;
    const lineMidY = view.getRowGeometry().topOfRow(sticky - 1) - view.scrollTop + m.lineHeight / 2;
    const dy = caretMidY - lineMidY;

    let nextLine = sticky;
    if (dy > m.lineHeight * LINE_SWITCH_DOWN) nextLine = Math.min(model.getLineCount(), sticky + 1);
    else if (dy < -m.lineHeight * LINE_SWITCH_UP) nextLine = Math.max(1, sticky - 1);
    this.stickyLine = nextLine;

    const textX = localX + view.scrollLeft - view.contentLeft - m.paddingLeft;
    const column = view.columnAtX(nextLine, textX, true);
    return { lineNumber: nextLine, column };
  }

  private edgePosForHandle(selection: SelectionState, type: TeardropHit['type']): { lineNumber: number; column: number } {
    if (type === 'cursor') return { lineNumber: selection.active.lineNumber, column: selection.active.column };
    const a = selection.anchor;
    const b = selection.active;
    const aBefore = a.lineNumber < b.lineNumber || (a.lineNumber === b.lineNumber && a.column <= b.column);
    if (type === 'start') {
      return aBefore ? { lineNumber: a.lineNumber, column: a.column } : { lineNumber: b.lineNumber, column: b.column };
    }
    return aBefore ? { lineNumber: b.lineNumber, column: b.column } : { lineNumber: a.lineNumber, column: a.column };
  }
}
