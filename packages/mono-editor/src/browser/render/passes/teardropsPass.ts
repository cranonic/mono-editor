import type { VirtualSide } from '../../../common/core/SelectionState';
import { TEARDROP, type FrameContext, type RenderPass } from '../frameContext';
import { selectionSides } from '../virtualSides';

const CARET_H = 18;
const CARET_W = 2;

function drawTeardropShape(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  type: 'cursor' | 'start' | 'end',
): void {
  const sx = w / 24;
  const sy = h / 32;

  ctx.save();
  ctx.translate(x + w / 2, y);
  if (type === 'start') {
    ctx.rotate((28 * Math.PI) / 180);
  } else if (type === 'end') {
    ctx.rotate((-28 * Math.PI) / 180);
  }
  ctx.scale(sx, sy);
  ctx.translate(-12, 0);

  ctx.beginPath();
  ctx.moveTo(12, 0);
  ctx.bezierCurveTo(18, 6, 24, 12, 24, 18);
  ctx.arc(12, 18, 12, 0, Math.PI, false);
  ctx.bezierCurveTo(0, 12, 6, 6, 12, 0);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath();
  ctx.arc(9, 16, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawTipCaret(
  ctx: CanvasRenderingContext2D,
  x: number,
  w: number,
  type: 'cursor' | 'start' | 'end',
  lineTop: number,
  lineHeight: number,
  color: string,
): void {
  let cx = x + w / 2;
  if (type === 'start') cx = x + w * 0.58 - 3;
  else if (type === 'end') cx = x + w * 0.42 + 3;
  const caretTop = lineTop + Math.max(0, (lineHeight - CARET_H) / 2 - 3);
  ctx.fillStyle = color;
  ctx.fillRect(cx - CARET_W / 2, caretTop, CARET_W, CARET_H);
}

function paintTeardropAt(
  ctx: CanvasRenderingContext2D,
  frame: FrameContext,
  line: number,
  col: number,
  type: 'cursor' | 'start' | 'end',
  color: string,
  side?: VirtualSide,
): void {
  const { opts, teardrops } = frame;
  const { metrics, projection, freeHandle = null } = opts;
  const { lineHeight } = metrics;
  const { w, h } = TEARDROP;

  let cx: number;
  let tipY: number;
  let lineTop: number;

  if (freeHandle && freeHandle.type === type) {
    cx = freeHandle.x;
    tipY = freeHandle.y;
    lineTop = tipY - lineHeight + 1;
  } else {
    const role = type === 'cursor' ? 'caret' : type === 'start' ? 'selStart' : 'selEnd';
    cx = frame.xAt(line, col, role, side);
    const visualRow =
      projection && !projection.isIdentity()
        ? projection.modelToVisual(line, col).visualRow
        : line - 1;
    lineTop = frame.rowTopY(visualRow);
    tipY = lineTop + lineHeight - 1;
  }

  let left = cx - w / 2;
  if (type === 'start') left = cx - w * 0.42;
  else if (type === 'end') left = cx - w * 0.58;

  drawTeardropShape(ctx, left, tipY, w, h, color, type);
  drawTipCaret(ctx, left, w, type, lineTop, lineHeight, color);
  teardrops.push({ type, x: left, y: tipY, w, h: h + 12 });
}

export const teardropsPass: RenderPass = {
  name: 'teardrops',
  paint(ctx: CanvasRenderingContext2D, frame: FrameContext): void {
    const { opts, hasSelection, primaryRange, caretLine, caretCol, tokenColorAt } = frame;
    const {
      selection,
      showTeardrops = true,
      handlesVisible = true,
      handleAlpha = 1,
    } = opts;
    if (!showTeardrops || !handlesVisible || handleAlpha <= 0.01 || selection.hasMultipleCursors) {
      return;
    }
    const prevA = ctx.globalAlpha;
    ctx.globalAlpha = handleAlpha;
    const sides = selectionSides(selection.selections[0]);
    if (hasSelection) {
      const startColor = tokenColorAt(primaryRange.startLine, primaryRange.startCol);
      const endColor = tokenColorAt(primaryRange.endLine, primaryRange.endCol);
      paintTeardropAt(ctx, frame, primaryRange.startLine, primaryRange.startCol, 'start', startColor, sides.start);
      paintTeardropAt(ctx, frame, primaryRange.endLine, primaryRange.endCol, 'end', endColor, sides.end);
    } else {
      const cursorColor = tokenColorAt(caretLine, caretCol);
      paintTeardropAt(ctx, frame, caretLine, caretCol, 'cursor', cursorColor, sides.caret);
    }
    ctx.globalAlpha = prevA;
  },
};
