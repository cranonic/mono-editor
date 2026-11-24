import type { FrameContext, RenderPass } from '../frameContext';

function paintTokenizedLine(
  ctx: CanvasRenderingContext2D,
  frame: FrameContext,
  line: number,
  content: string,
  textX0: number,
  textY: number,
): void {
  const { opts, tokenColors, measureColumnX } = frame;
  const { theme, getLineTokens } = opts;
  const tokens = getLineTokens?.(line) ?? [];
  if (!tokens.length) {
    ctx.fillStyle = theme.foreground;
    ctx.fillText(content, textX0, textY);
    return;
  }
  let col = 1;
  const emit = (from: number, to: number, type: string) => {
    if (to <= from) return;
    const slice = content.slice(from - 1, to - 1);
    if (!slice) return;
    ctx.fillStyle = tokenColors[type] ?? theme.foreground;
    ctx.fillText(slice, textX0 + measureColumnX(content, from), textY);
  };
  for (const tok of tokens) {
    if (tok.startColumn > col) emit(col, tok.startColumn, 'plain');
    emit(tok.startColumn, tok.endColumn, tok.type);
    col = Math.max(col, tok.endColumn);
  }
  if (col <= content.length) emit(col, content.length + 1, 'plain');
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
        paintTokenizedLine(ctx, frame, line, content, textX0s, textY);

        if (s.caretColumn != null && s.kind === 'active') {
          const cx = textX0s + measureColumnX(content, s.caretColumn);
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
      paintTokenizedLine(ctx, frame, bl, content, textX0b, textY);

      const cx =
        contentLeft +
        paddingLeft -
        scrollLeft +
        measureColumnX(content, bottomSticky.caretColumn ?? 1);
      ctx.fillStyle = tokenColorAt(bl, bottomSticky.caretColumn ?? 1);
      ctx.fillRect(cx, y + 2, 2, lineHeight - 4);
      ctx.restore();
      ctx.restore();
    }
  },
};
