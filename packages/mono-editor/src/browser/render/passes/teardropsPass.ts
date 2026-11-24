import { colorAdvanceBefore, TEARDROP, type FrameContext, type RenderPass } from '../frameContext';

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
): void {
  const { opts, colorsForLine, measureColumnX, teardrops } = frame;
  const {
    model,
    metrics,
    scrollTop,
    scrollLeft,
    showLineNumbers,
    projection,
    freeHandle = null,
    topInsetPx = 0,
    viewZone = null,
  } = opts;
  const { lineHeight, paddingTop, paddingLeft, gutterWidth } = metrics;
  const { w, h } = TEARDROP;

  let cx: number;
  let tipY: number;
  let lineTop: number;

  if (freeHandle && freeHandle.type === type) {
    cx = freeHandle.x;
    tipY = freeHandle.y;
    lineTop = tipY - lineHeight + 1;
  } else {
    const content = model.getLineContent(line);
    const textX0 = (showLineNumbers ? gutterWidth : 0) + paddingLeft - scrollLeft;
    const lineColors = colorsForLine(line);
    const colAdv = colorAdvanceBefore(lineColors, col);
    let visualRow = line - 1;
    if (projection && !projection.isIdentity()) {
      const mapped = projection.modelToVisual(line, col);
      const seg = mapped.visualLine;
      visualRow = mapped.visualRow;
      const originPx = seg.startCol === 1 ? 0 : measureColumnX(content, seg.startCol);
      const originAdv = seg.startCol === 1 ? 0 : colorAdvanceBefore(lineColors, seg.startCol);
      cx =
        textX0 +
        seg.wrapIndentPx +
        (measureColumnX(content, col) - originPx) +
        (colAdv - originAdv);
    } else {
      cx = textX0 + measureColumnX(content, col) + colAdv;
    }
    const zoneExtra = viewZone && visualRow > viewZone.afterVisualRow ? viewZone.heightPx : 0;
    lineTop = topInsetPx + paddingTop + visualRow * lineHeight + zoneExtra - scrollTop;
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
    if (hasSelection) {
      const startColor = tokenColorAt(primaryRange.startLine, primaryRange.startCol);
      const endColor = tokenColorAt(primaryRange.endLine, primaryRange.endCol);
      paintTeardropAt(ctx, frame, primaryRange.startLine, primaryRange.startCol, 'start', startColor);
      paintTeardropAt(ctx, frame, primaryRange.endLine, primaryRange.endCol, 'end', endColor);
    } else {
      const cursorColor = tokenColorAt(caretLine, caretCol);
      paintTeardropAt(ctx, frame, caretLine, caretCol, 'cursor', cursorColor);
    }
    ctx.globalAlpha = prevA;
  },
};
