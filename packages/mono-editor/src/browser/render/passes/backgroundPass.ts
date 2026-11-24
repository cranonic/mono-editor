import type { FrameContext, RenderPass } from '../frameContext';

/**
 * Paints editor background, gutter backdrop, active-line highlights, and indentation guides.
 */
export const backgroundPass: RenderPass = {
  name: 'background',
  paint(ctx: CanvasRenderingContext2D, f: FrameContext): void {
    const { cssWidth, cssHeight, metrics, theme, showLineNumbers, indentGuides } = f.opts;
    const { lineHeight, gutterWidth, charWidth } = metrics;

    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    if (showLineNumbers) {
      ctx.fillStyle = theme.gutterBackground;
      ctx.fillRect(0, 0, gutterWidth, cssHeight);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(f.contentLeft, 0, Math.max(0, cssWidth - f.contentLeft), cssHeight);
    ctx.clip();

    for (let row = f.firstRow; row <= f.lastRow; row++) {
      const y = f.rowTopY(row);
      if (y + lineHeight < 0 || y > cssHeight) continue;
      const seg = f.getVisualLine(row);
      const line = seg.modelLine;

      if (f.orderedSelections.some((os) => os.caretLine === line)) {
        ctx.fillStyle = theme.lineHighlight;
        ctx.fillRect(f.contentLeft, y, cssWidth - f.contentLeft, lineHeight);
      }

      if (indentGuides && indentGuides.show && seg.isFirstSegment) {
        const levelCount = indentGuides.info.levels.get(line) ?? 0;
        const unitPx = Math.max(1, indentGuides.tabSize) * charWidth;
        for (let lvl = 1; lvl <= levelCount; lvl++) {
          const gx = Math.floor(f.textX0 + (lvl - 1) * unitPx) + 0.5;
          if (gx < f.contentLeft || gx > cssWidth) continue;
          const isActive =
            indentGuides.highlightActive &&
            lvl === indentGuides.info.activeLevel &&
            line >= indentGuides.info.activeStartLine &&
            line <= indentGuides.info.activeEndLine;
          ctx.strokeStyle = isActive
            ? (f.dark ? 'rgba(203, 213, 225, 0.42)' : 'rgba(51, 65, 85, 0.40)')
            : (f.dark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(15, 23, 42, 0.11)');
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(gx, y);
          ctx.lineTo(gx, y + lineHeight);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  },
};
