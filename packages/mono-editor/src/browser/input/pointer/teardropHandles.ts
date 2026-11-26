import type { RenderMetrics } from '../../../common/config/editorOptions';
import type { MonoPosition, SelectionState, VirtualSide } from '../../../common/core/SelectionState';
import type { TextModel } from '../../../common/model/TextModel';
import type { TeardropHit } from '../../render/CanvasRenderer';
import type { ViewController } from '../../view/ViewController';

const LINE_SWITCH_DOWN = 0.42;
const LINE_SWITCH_UP = 0.51;
const AUTO_SCROLL_EDGE = 56;
const AUTO_SCROLL_EDGE_X = 48;
const AUTO_SCROLL_SPEED = 12;
const AUTO_SCROLL_SPEED_X = 14;

/**
 * Manages directional teardrop hitbox tests, free teardrop dragging with sticky-line
 * hysteresis, and vertical + horizontal (no-wrap) edge auto-scrolling.
 */
export class TeardropDragController {
  handleDrag: TeardropHit['type'] | null = null;
  handleMoved = false;
  private handleLift = 26;
  private stickyLine: number | null = null;
  private dragAnchor: MonoPosition | null = null;
  private autoScrollRaf = 0;
  private autoScrollDeltaY = 0;
  private autoScrollDeltaX = 0;
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
    horizontal?: { clientX: number; contentLeft: number; allowHorizontal: boolean },
  ): void {
    const rect = root.getBoundingClientRect();
    let dy = 0;
    if (clientY < rect.top + AUTO_SCROLL_EDGE) {
      const ratio = Math.min(1, Math.max(0.25, (rect.top + AUTO_SCROLL_EDGE - clientY) / AUTO_SCROLL_EDGE));
      dy = -Math.round(AUTO_SCROLL_SPEED * ratio);
    } else if (clientY > rect.bottom - AUTO_SCROLL_EDGE) {
      const ratio = Math.min(1, Math.max(0.25, (clientY - (rect.bottom - AUTO_SCROLL_EDGE)) / AUTO_SCROLL_EDGE));
      dy = Math.round(AUTO_SCROLL_SPEED * ratio);
    }

    let dx = 0;
    if (horizontal?.allowHorizontal) {
      const leftBound = rect.left + Math.max(0, horizontal.contentLeft);
      const rightBound = rect.right;
      if (horizontal.clientX < leftBound + AUTO_SCROLL_EDGE_X) {
        const ratio = Math.min(1, Math.max(0.3, (leftBound + AUTO_SCROLL_EDGE_X - horizontal.clientX) / AUTO_SCROLL_EDGE_X));
        dx = -Math.round(AUTO_SCROLL_SPEED_X * ratio);
      } else if (horizontal.clientX > rightBound - AUTO_SCROLL_EDGE_X) {
        const ratio = Math.min(1, Math.max(0.3, (horizontal.clientX - (rightBound - AUTO_SCROLL_EDGE_X)) / AUTO_SCROLL_EDGE_X));
        dx = Math.round(AUTO_SCROLL_SPEED_X * ratio);
      }
    }

    this.autoScrollDeltaY = dy;
    this.autoScrollDeltaX = dx;
    if (dy !== 0 || dx !== 0) {
      if (!this.autoScrollRaf) {
        const loop = () => {
          if (this.disposed || !this.handleDrag || (this.autoScrollDeltaY === 0 && this.autoScrollDeltaX === 0)) {
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
    return this.autoScrollDeltaY;
  }

  getAutoScrollDeltaX(): number {
    return this.autoScrollDeltaX;
  }

  stopAutoScroll(): void {
    this.autoScrollDeltaY = 0;
    this.autoScrollDeltaX = 0;
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
    const hit = this.posFromHandleFree(rect, model, view, metrics, clientX, clientY);
    const pos = { lineNumber: hit.lineNumber, column: hit.column };
    // Inlay hint / ghost text / swatch block at this column: the edge goes on the side of the block
    // the finger is on (left half -> `|name:`, right half -> `name:|`). Display-only; see VirtualSide.
    const side = hit.side;

    let visualType: TeardropHit['type'] = this.handleDrag;
    if (this.handleDrag === 'cursor') {
      selection.setCaret(pos.lineNumber, pos.column);
      if (side) {
        selection.anchor.virtualSide = side;
        selection.active.virtualSide = side;
      }
    } else if (this.dragAnchor) {
      const anchor = this.dragAnchor;
      if (pos.lineNumber !== anchor.lineNumber || pos.column !== anchor.column) {
        selection.anchor = { ...anchor };
        selection.active = side ? { ...pos, virtualSide: side } : pos;
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
  ): { lineNumber: number; column: number; side?: VirtualSide } {
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;

    if (!view.projection.isIdentity() || view.getTopInset() > 0 || view.hasViewZones()) {
      const targetY = localY - this.handleLift - m.lineHeight * 0.45;
      return { ...view.positionAtPoint(localX, targetY, true), side: view.virtualSideAtPoint(localX, targetY) };
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
    const rowMidY = view.getRowGeometry().topOfRow(nextLine - 1) - view.scrollTop + m.lineHeight / 2;
    return { lineNumber: nextLine, column, side: view.virtualSideAtPoint(localX, rowMidY) };
  }

  private edgePosForHandle(selection: SelectionState, type: TeardropHit['type']): MonoPosition {
    // Copies keep `virtualSide`, so the fixed edge stays on its side of an inlay/ghost block while dragging.
    if (type === 'cursor') return { ...selection.active };
    const a = selection.anchor;
    const b = selection.active;
    const aBefore = a.lineNumber < b.lineNumber || (a.lineNumber === b.lineNumber && a.column <= b.column);
    if (type === 'start') return aBefore ? { ...a } : { ...b };
    return aBefore ? { ...b } : { ...a };
  }
}
