import type { FrameContext, RenderPass } from '../frameContext';

export const gutterPass: RenderPass = {
  name: 'gutter',
  paint(ctx: CanvasRenderingContext2D, frame: FrameContext): void {
    const {
      opts,
      firstRow,
      lastRow,
      foldGutterWidth,
      gutterNumberPad,
      orderedSelections,
      rowTopY,
      getVisualLine,
      foldHits,
    } = frame;
    const { cssHeight, metrics, theme, showLineNumbers, folding } = opts;
    if (!showLineNumbers) return;

    const { lineHeight, fontSize, gutterWidth } = metrics;
    ctx.fillStyle = theme.gutterBackground;
    ctx.fillRect(0, 0, gutterWidth, cssHeight);
    const numRightX = gutterWidth - foldGutterWidth - gutterNumberPad;

    for (let row = firstRow; row <= lastRow; row++) {
      const y = rowTopY(row);
      if (y + lineHeight < 0 || y > cssHeight) continue;
      const seg = getVisualLine(row);
      if (seg.isVirtualGhost || !seg.isFirstSegment) continue;

      const line = seg.modelLine;
      const isActiveLine = orderedSelections.some((os) => os.caretLine === line);
      ctx.fillStyle = isActiveLine ? theme.foreground : theme.gutterForeground;
      ctx.globalAlpha = isActiveLine ? 0.9 : 1;
      ctx.textAlign = 'right';
      ctx.fillText(String(line), numRightX, y + (lineHeight - fontSize) / 2);
      ctx.globalAlpha = 1;

      if (folding?.enabled && folding.isFoldable(line)) {
        const collapsed = folding.isCollapsed(line);
        const cx = gutterWidth - foldGutterWidth / 2 - 1;
        const cy = y + lineHeight / 2;
        ctx.save();
        ctx.strokeStyle = collapsed ? theme.foreground : theme.gutterForeground;
        ctx.globalAlpha = collapsed ? 0.95 : 0.72;
        ctx.lineWidth = 1.4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        if (collapsed) {
          ctx.moveTo(cx - 2, cy - 3.5);
          ctx.lineTo(cx + 2, cy);
          ctx.lineTo(cx - 2, cy + 3.5);
        } else {
          ctx.moveTo(cx - 3.5, cy - 2);
          ctx.lineTo(cx, cy + 2);
          ctx.lineTo(cx + 3.5, cy - 2);
        }
        ctx.stroke();
        ctx.restore();

        // Touch target stays >= 18px wide even when the visible fold column is narrow
        const foldHitW = Math.max(18, foldGutterWidth + 2);
        foldHits.push({
          lineNumber: line,
          x: gutterWidth - foldHitW,
          y,
          w: foldHitW,
          h: lineHeight,
          kind: 'chevron',
        });
      }
    }

    ctx.textAlign = 'left';
    ctx.strokeStyle = theme.gutterForeground;
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.moveTo(gutterWidth - 0.5, 0);
    ctx.lineTo(gutterWidth - 0.5, cssHeight);
    ctx.stroke();
    ctx.globalAlpha = 1;
  },
};
