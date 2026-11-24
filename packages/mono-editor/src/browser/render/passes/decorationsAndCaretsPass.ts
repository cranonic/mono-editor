import type { FrameContext, RenderPass } from '../frameContext';

/**
 * Paints diagnostic squiggles/underlines, IME composition underline, and primary/secondary carets.
 */
export const decorationsAndCaretsPass: RenderPass = {
  name: 'decorationsAndCarets',
  paint(ctx: CanvasRenderingContext2D, f: FrameContext): void {
    const {
      model,
      cssWidth,
      cssHeight,
      metrics,
      theme,
      decorations = [],
      compositionRange = null,
    } = f.opts;
    const { lineHeight, charWidth } = metrics;

    ctx.save();
    ctx.beginPath();
    ctx.rect(f.contentLeft, 0, Math.max(0, cssWidth - f.contentLeft), cssHeight);
    ctx.clip();

    for (let row = f.firstRow; row <= f.lastRow; row++) {
      const y = f.rowTopY(row);
      if (y + lineHeight < 0 || y > cssHeight) continue;
      const seg = f.getVisualLine(row);
      if (seg.isVirtualGhost) continue;
      const line = seg.modelLine;
      const content = model.getLineContent(line);

      if (decorations.length) {
        for (const d of decorations) {
          if (!d.underline || d.underline === 'none') continue;
          if (line < d.range.startLineNumber || line > d.range.endLineNumber) continue;
          let fromCol = 1;
          let toCol = content.length + 1;
          if (line === d.range.startLineNumber) fromCol = d.range.startColumn;
          if (line === d.range.endLineNumber) toCol = d.range.endColumn;
          const c1 = Math.max(seg.startCol, fromCol);
          const c2 = Math.min(seg.endCol, toCol);
          if (c2 < c1) continue;
          if (c2 === c1 && !seg.isLastSegment) continue;
          const x1 = f.segX(content, seg, c1);
          const x2 = c2 > c1 ? f.segX(content, seg, c2) : x1 + charWidth;
          const baseY = y + lineHeight - 3;
          ctx.strokeStyle = d.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          if (d.underline === 'solid') {
            ctx.moveTo(x1, baseY);
            ctx.lineTo(Math.max(x1 + 2, x2), baseY);
          } else if (d.underline === 'dots') {
            for (let x = x1; x < x2; x += 4) {
              ctx.moveTo(x, baseY);
              ctx.lineTo(Math.min(x + 2, x2), baseY);
            }
          } else {
            const amp = 2.4;
            const step = 4;
            let up = true;
            ctx.moveTo(x1, baseY);
            for (let x = x1 + step; x <= x2; x += step) {
              ctx.lineTo(x, baseY + (up ? -amp : amp));
              up = !up;
            }
          }
          ctx.stroke();
        }
      }

      if (
        compositionRange &&
        line >= compositionRange.startLineNumber &&
        line <= compositionRange.endLineNumber
      ) {
        const fromCol = line === compositionRange.startLineNumber ? compositionRange.startColumn : 1;
        const toCol =
          line === compositionRange.endLineNumber
            ? compositionRange.endColumn
            : content.length + 1;
        const c1 = Math.max(seg.startCol, fromCol);
        const c2 = Math.min(seg.endCol, toCol);
        if (c2 > c1) {
          const x1 = f.segX(content, seg, c1);
          const x2 = f.segX(content, seg, c2);
          const baseY = y + lineHeight - 2;
          ctx.save();
          ctx.strokeStyle = theme.foreground || '#d4d4d4';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x1, baseY);
          ctx.lineTo(Math.max(x1 + 2, x2), baseY);
          ctx.stroke();
          ctx.restore();
        }
      }

      for (let si = 0; si < f.orderedSelections.length; si++) {
        const os = f.orderedSelections[si]!;
        const showCaretForSel = si === 0 ? os.isEmpty : true;
        if (
          showCaretForSel &&
          line === os.caretLine &&
          os.caretCol >= seg.startCol &&
          (os.caretCol < seg.endCol || seg.isLastSegment)
        ) {
          const cx = f.segCaretX(content, seg, os.caretCol);
          ctx.fillStyle = f.tokenColorAt(os.caretLine, os.caretCol);
          ctx.fillRect(cx, y + 2, 2, lineHeight - 4);
        }
      }
    }
    ctx.restore();
  },
};
