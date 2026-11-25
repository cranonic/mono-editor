import type { MonoLineNumbers } from '../../../common/config/editorOptions';
import type { FrameContext, PaintDecorationSpec, RenderPass } from '../frameContext';

function formatLineNumber(
  mode: MonoLineNumbers,
  line: number,
  caretLine: number,
): string | null {
  if (mode === 'off') return null;
  if (typeof mode === 'function') return mode(line);
  if (mode === 'relative') {
    return line === caretLine ? String(line) : String(Math.abs(line - caretLine));
  }
  if (mode === 'interval') {
    if (line === caretLine || line === 1 || line % 10 === 0) return String(line);
    return '';
  }
  return String(line);
}

export const gutterPass: RenderPass = {
  name: 'gutter',
  paint(ctx: CanvasRenderingContext2D, frame: FrameContext): void {
    const {
      opts,
      firstRow,
      lastRow,
      glyphMarginWidth,
      foldGutterWidth,
      gutterNumberPad,
      orderedSelections,
      caretLine,
      rowTopY,
      getVisualLine,
      foldHits,
    } = frame;
    const {
      cssHeight,
      metrics,
      theme,
      showLineNumbers,
      lineNumbersMode = showLineNumbers ? 'on' : 'off',
      glyphMargin = false,
      renderLineHighlight = 'line',
      decorations = [],
      folding,
    } = opts;
    if (!showLineNumbers && !glyphMargin) return;

    const { lineHeight, fontSize, gutterWidth } = metrics;
    ctx.fillStyle = theme.gutterBackground;
    ctx.fillRect(0, 0, gutterWidth, cssHeight);
    const numRightX = gutterWidth - foldGutterWidth - gutterNumberPad;
    const highlightGutter = renderLineHighlight === 'gutter' || renderLineHighlight === 'all';

    // Pre-index glyph margin decorations by start line for O(1) lookup
    let glyphByLine: Map<number, PaintDecorationSpec> | null = null;
    if (glyphMargin && decorations.length) {
      for (const d of decorations) {
        if (d.glyphMarginColor || d.glyphMarginSymbol || d.glyphMarginClassName) {
          if (!glyphByLine) glyphByLine = new Map();
          glyphByLine.set(d.range.startLineNumber, d);
        }
      }
    }

    for (let row = firstRow; row <= lastRow; row++) {
      const y = rowTopY(row);
      if (y + lineHeight < 0 || y > cssHeight) continue;
      const seg = getVisualLine(row);
      if (seg.isVirtualGhost || !seg.isFirstSegment) continue;

      const line = seg.modelLine;
      const isActiveLine = orderedSelections.some((os) => os.caretLine === line);

      if (highlightGutter && isActiveLine) {
        ctx.fillStyle = theme.lineHighlight;
        ctx.fillRect(0, y, gutterWidth, lineHeight);
      }

      // Glyph margin column (breakpoints, bookmarks, custom icons)
      if (glyphMargin && glyphByLine) {
        const gd = glyphByLine.get(line);
        if (gd) {
          const gcx = Math.round(glyphMarginWidth / 2);
          const gcy = Math.round(y + lineHeight / 2);
          const color = gd.glyphMarginColor ?? '#e51400';
          if (gd.glyphMarginSymbol) {
            ctx.fillStyle = color;
            ctx.textAlign = 'center';
            ctx.fillText(gd.glyphMarginSymbol, gcx, y + (lineHeight - fontSize) / 2);
          } else {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(gcx, gcy, Math.min(5, Math.max(3.5, lineHeight * 0.24)), 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      if (showLineNumbers) {
        const label = formatLineNumber(lineNumbersMode, line, caretLine);
        if (label) {
          ctx.fillStyle = isActiveLine ? theme.foreground : theme.gutterForeground;
          ctx.globalAlpha = isActiveLine ? 0.92 : 1;
          ctx.textAlign = 'right';
          ctx.fillText(label, numRightX, y + (lineHeight - fontSize) / 2);
          ctx.globalAlpha = 1;
        }
      }

      if (showLineNumbers && folding?.enabled && folding.isFoldable(line)) {
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
