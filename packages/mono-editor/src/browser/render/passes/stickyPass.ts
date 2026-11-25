import { rgbaToCss } from '../../../common/color/colorFormat';
import {
  collectInlineVirtualElements,
  virtualAdvanceBeforeColumn,
  virtualElementStartX,
} from '../../../common/virtualText';
import {
  COLOR_SWATCH_ADVANCE,
  COLOR_SWATCH_SIZE,
  type FrameContext,
  type RenderPass,
} from '../frameContext';

/**
 * Paints a sticky line using the same swatch-only inline layout as the real line (Track F):
 * inlay hints and ghost text are intentionally excluded from sticky headers (VS Code behaviour),
 * while inline color swatches are drawn at identical X coordinates and recorded in `stickyColorHits`
 * so tapping a sticky swatch opens the color picker for that line.
 */
function paintStickyLineContent(
  ctx: CanvasRenderingContext2D,
  frame: FrameContext,
  line: number,
  content: string,
  textX0: number,
  y: number,
  textY: number,
  lineHeight: number,
): { swatchAdvanceAt: (col: number) => number } {
  const { opts, tokenColors, measureColumnX, measureText } = frame;
  const { theme, getLineTokens, cssWidth } = opts;
  const lineColors = frame.colorsForLine(line);
  const swatchEls = lineColors.length
    ? collectInlineVirtualElements({
        colors: lineColors,
        swatchAdvancePx: COLOR_SWATCH_ADVANCE,
        measureText,
      })
    : [];
  const swatchAdvanceAt = (col: number): number =>
    swatchEls.length ? virtualAdvanceBeforeColumn(swatchEls, col, false) : 0;

  const splitCols = lineColors.map((c) => c.startColumn);
  if (splitCols.length > 1) splitCols.sort((a, b) => a - b);

  const drawSlice = (from: number, to: number, color: string) => {
    if (to <= from) return;
    const emitRun = (a: number, b: number) => {
      const slice = content.slice(a - 1, b - 1);
      if (!slice) return;
      ctx.fillStyle = color;
      ctx.fillText(slice, textX0 + measureColumnX(content, a) + swatchAdvanceAt(a), textY);
    };
    if (!splitCols.length) {
      emitRun(from, to);
      return;
    }
    let cur = from;
    for (const sc of splitCols) {
      if (sc > cur && sc < to) {
        emitRun(cur, sc);
        cur = sc;
      }
    }
    if (cur < to) emitRun(cur, to);
  };

  const tokens = getLineTokens?.(line) ?? [];
  if (!tokens.length) {
    drawSlice(1, content.length + 1, theme.foreground);
  } else {
    let col = 1;
    for (const tok of tokens) {
      if (tok.startColumn > col) drawSlice(col, tok.startColumn, theme.foreground);
      drawSlice(tok.startColumn, tok.endColumn, tokenColors[tok.type] ?? theme.foreground);
      col = Math.max(col, tok.endColumn);
    }
    if (col <= content.length) drawSlice(col, content.length + 1, theme.foreground);
  }

  // Paint inline color swatches in sticky header (aligned identically with real line)
  if (lineColors.length) {
    const swatchY = Math.round(y + (lineHeight - COLOR_SWATCH_SIZE) / 2);
    for (const cm of lineColors) {
      const baseRealX = measureColumnX(content, cm.startColumn);
      const sx = Math.round(textX0 + virtualElementStartX(baseRealX, swatchEls, cm.startColumn, 0) + 1);
      if (sx + COLOR_SWATCH_SIZE < frame.contentLeft || sx > cssWidth) continue;

      if (cm.rgba.a < 0.999) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(sx, swatchY, COLOR_SWATCH_SIZE, COLOR_SWATCH_SIZE);
        ctx.fillStyle = '#b0b0b0';
        const half = Math.floor(COLOR_SWATCH_SIZE / 2);
        ctx.fillRect(sx, swatchY, half, half);
        ctx.fillRect(sx + half, swatchY + half, COLOR_SWATCH_SIZE - half, COLOR_SWATCH_SIZE - half);
      }

      ctx.fillStyle = rgbaToCss(cm.rgba);
      ctx.fillRect(sx, swatchY, COLOR_SWATCH_SIZE, COLOR_SWATCH_SIZE);
      ctx.strokeStyle = frame.dark ? 'rgba(255, 255, 255, 0.42)' : 'rgba(15, 23, 42, 0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 0.5, swatchY + 0.5, COLOR_SWATCH_SIZE - 1, COLOR_SWATCH_SIZE - 1);

      frame.stickyColorHits.push({
        match: cm,
        x: sx - 2,
        y,
        w: COLOR_SWATCH_ADVANCE + 2,
        h: lineHeight,
      });
    }
  }

  return { swatchAdvanceAt };
}

export const stickyPass: RenderPass = {
  name: 'sticky',
  paint(ctx: CanvasRenderingContext2D, frame: FrameContext): void {
    const {
      opts,
      contentLeft,
      foldGutterWidth,
      gutterNumberPad,
      measureColumnX,
      tokenColorAt,
    } = frame;
    const {
      model,
      scrollLeft,
      cssWidth,
      cssHeight,
      metrics,
      theme,
      showLineNumbers,
      stickyLines = [],
      bottomSticky = null,
    } = opts;
    const { lineHeight, fontSize, gutterWidth, paddingLeft } = metrics;

    // Top sticky scroll overlay — always pinned to the real top of the editor (y = 0).
    // The Find widget is a DOM overlay and simply floats above it (VS Code behaviour).
    if (stickyLines.length) {
      const stackBottom = Math.max(
        ...stickyLines.map((s) => s.y + lineHeight),
        stickyLines.length * lineHeight,
      );
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, cssWidth, Math.max(0, stackBottom + 4));
      ctx.clip();

      for (let i = stickyLines.length - 1; i >= 0; i--) {
        const s = stickyLines[i]!;
        const line = s.lineNumber;
        const y = s.y;
        if (y + lineHeight < -2 || y > cssHeight) continue;
        const content = model.getLineContent(line);
        const textY = y + (lineHeight - fontSize) / 2;
        const alpha = s.visibility ?? 1;

        ctx.save();
        let topClip = y;
        if (i > 0) {
          const prevBottom = stickyLines[i - 1]!.y + lineHeight;
          topClip = Math.max(y, prevBottom);
        }
        if (topClip >= y + lineHeight) {
          ctx.restore();
          continue;
        }
        ctx.beginPath();
        ctx.rect(0, topClip, cssWidth, y + lineHeight - topClip);
        ctx.clip();

        ctx.globalAlpha = 1;
        ctx.fillStyle = theme.background;
        ctx.fillRect(0, y, cssWidth, lineHeight);

        ctx.save();
        ctx.beginPath();
        ctx.rect(contentLeft, y, Math.max(0, cssWidth - contentLeft), lineHeight);
        ctx.clip();

        const textX0s = contentLeft + paddingLeft - scrollLeft;
        ctx.globalAlpha = alpha;
        const { swatchAdvanceAt } = paintStickyLineContent(
          ctx, frame, line, content, textX0s, y, textY, lineHeight,
        );

        if (s.caretColumn != null && s.kind === 'active') {
          const cx = textX0s + measureColumnX(content, s.caretColumn) + swatchAdvanceAt(s.caretColumn);
          ctx.fillStyle = tokenColorAt(line, s.caretColumn);
          ctx.fillRect(cx, y + 2, 2, lineHeight - 4);
        }
        ctx.globalAlpha = 1;
        ctx.restore();

        if (showLineNumbers) {
          ctx.fillStyle = theme.gutterBackground;
          ctx.fillRect(0, y, gutterWidth, lineHeight);
          ctx.globalAlpha = alpha;
          ctx.fillStyle = theme.gutterForeground;
          ctx.textAlign = 'right';
          ctx.fillText(String(line), gutterWidth - foldGutterWidth - gutterNumberPad, textY);
          ctx.textAlign = 'left';
          ctx.globalAlpha = 1;
          ctx.strokeStyle = theme.gutterForeground;
          ctx.globalAlpha = 0.25;
          ctx.beginPath();
          ctx.moveTo(gutterWidth - 0.5, y);
          ctx.lineTo(gutterWidth - 0.5, y + lineHeight);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }

        ctx.restore();
      }

      const edgeY = Math.max(...stickyLines.map((s) => s.y + lineHeight));
      if (edgeY > 0) {
        const alphas = [0.55, 0.3, 0.14, 0.05];
        for (let i = 0; i < alphas.length; i++) {
          ctx.fillStyle = `rgba(0,0,0,${alphas[i]})`;
          ctx.fillRect(0, edgeY + i, cssWidth, 1);
        }
      }
      ctx.restore();
    }

    // Bottom active-line sticky
    if (bottomSticky && bottomSticky.lineNumber >= 1) {
      const bl = bottomSticky.lineNumber;
      const y = cssHeight - lineHeight;
      const content = model.getLineContent(bl);
      const textY = y + (lineHeight - fontSize) / 2;

      ctx.save();
      ctx.fillStyle = theme.background;
      ctx.fillRect(0, y, cssWidth, lineHeight);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, y, cssWidth, 1);

      if (showLineNumbers) {
        ctx.fillStyle = theme.gutterBackground;
        ctx.fillRect(0, y, gutterWidth, lineHeight);
        ctx.fillStyle = theme.gutterForeground;
        ctx.textAlign = 'right';
        ctx.fillText(String(bl), gutterWidth - foldGutterWidth - gutterNumberPad, textY);
        ctx.textAlign = 'left';
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(contentLeft, y, Math.max(0, cssWidth - contentLeft), lineHeight);
      ctx.clip();

      const textX0b = contentLeft + paddingLeft - scrollLeft;
      const { swatchAdvanceAt } = paintStickyLineContent(
        ctx, frame, bl, content, textX0b, y, textY, lineHeight,
      );

      const bCol = bottomSticky.caretColumn ?? 1;
      const cx = textX0b + measureColumnX(content, bCol) + swatchAdvanceAt(bCol);
      ctx.fillStyle = tokenColorAt(bl, bCol);
      ctx.fillRect(cx, y + 2, 2, lineHeight - 4);
      ctx.restore();
      ctx.restore();
    }
  },
};
