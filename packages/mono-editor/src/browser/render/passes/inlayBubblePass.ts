import { withEmojiFontFallback } from '../../../common/config/editorOptions';
import { INLAY_CHIP_PAD_X, type ResolvedInlayHint } from '../../../common/virtualText';
import type { FrameContext, RenderPass } from '../frameContext';

/**
 * Shared inlay hint chip painter so inline chips (`textPass`) and lifted bubbles (`inlayBubblePass`)
 * render with identical typography, padding, radius, and colors.
 */
export function paintInlayChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  hintTextY: number,
  bg: string,
  fg: string,
  border?: string,
): void {
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 3);
  ctx.fill();
  if (border) {
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.fillStyle = fg;
  ctx.fillText(text, x + INLAY_CHIP_PAD_X, hintTextY);
}

/**
 * Paints lifted inlay hints as floating canvas bubbles above the caret line (Track C).
 * Multiple hints anchored at the same `(line, column)` are drawn in one horizontal bubble row
 * in their original inline order, centered on `frame.xAt(line, col, 'caret')`.
 * Flips below the line (above the teardrop gap) when the caret sits on the first visible row
 * under the top inset or sticky scroll stack.
 */
export const inlayBubblePass: RenderPass = {
  name: 'inlayBubble',
  paint(ctx: CanvasRenderingContext2D, f: FrameContext): void {
    const { cssWidth, cssHeight, metrics, theme, topInsetPx = 0, stickyLines = [] } = f.opts;
    const { lineHeight, fontSize, fontFamily } = metrics;
    const resolvedFamily = withEmojiFontFallback(fontFamily);
    const baseFont = `${fontSize}px ${resolvedFamily}`;
    const hintFontSize = Math.max(10, Math.round(fontSize * 0.86));
    const hintFont = `${hintFontSize}px ${resolvedFamily}`;
    const chipH = Math.max(14, lineHeight - 4);
    const gap = 4;

    const inlayFg = theme.inlayHintForeground ?? (f.dark ? '#d4d4d4' : '#334155');
    const inlayBg =
      theme.inlayHintBackground ?? (f.dark ? 'rgba(56, 62, 74, 0.94)' : 'rgba(241, 245, 249, 0.96)');
    const inlayBorder = f.dark ? 'rgba(148, 163, 184, 0.32)' : 'rgba(100, 116, 139, 0.28)';

    const stickyBottom = stickyLines.length
      ? Math.max(...stickyLines.map((s) => s.y + lineHeight), 0)
      : 0;
    const topClearance = Math.max(topInsetPx, stickyBottom, f.opts.stickyStackBottom ?? 0) + 2;

    // Collect lifted hints across visible rows grouped by `line:col`
    const groups = new Map<string, { line: number; col: number; visualRow: number; hints: ResolvedInlayHint[] }>();
    const seenLines = new Set<number>();

    for (let row = f.firstRow; row <= f.lastRow; row++) {
      const seg = f.getVisualLine(row);
      if (seg.isVirtualGhost) continue;
      const line = seg.modelLine;
      if (seenLines.has(line)) continue;
      seenLines.add(line);
      const lineInlays = f.inlayHintsForLine(line);
      if (!lineInlays.length) continue;

      for (const h of lineInlays) {
        const p = h.liftProgress ?? 0;
        if (p <= 0.01) continue;
        const key = `${line}:${h.column}`;
        let g = groups.get(key);
        if (!g) {
          const visualRow =
            f.opts.projection && !f.opts.projection.isIdentity()
              ? f.opts.projection.modelToVisual(line, h.column).visualRow
              : line - 1;
          g = { line, col: h.column, visualRow, hints: [] };
          groups.set(key, g);
        }
        g.hints.push(h);
      }
    }

    if (!groups.size) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(f.contentLeft, 0, Math.max(0, cssWidth - f.contentLeft), cssHeight);
    ctx.clip();
    ctx.font = hintFont;

    for (const group of groups.values()) {
      const lineTop = f.rowTopY(group.visualRow);
      if (lineTop + lineHeight < -chipH || lineTop > cssHeight + chipH) continue;

      const anchorX = f.xAt(group.line, group.col, 'caret');
      const totalW =
        group.hints.reduce((acc, h) => acc + h.chipWidthPx, 0) +
        Math.max(0, group.hints.length - 1) * gap;
      const maxProgress = Math.max(...group.hints.map((h) => h.liftProgress ?? 0));

      const minX = f.contentLeft + 4;
      const maxX = Math.max(minX, cssWidth - totalW - 4);
      let cursorX = Math.max(minX, Math.min(maxX, Math.round(anchorX - totalW / 2)));

      const inlineChipY = lineTop + (lineHeight - chipH) / 2;
      const aboveTargetY = lineTop - chipH - 4;
      const flipBelow = aboveTargetY < topClearance;
      const targetY = flipBelow ? lineTop + lineHeight + 2 : aboveTargetY;
      const bubbleY = Math.round(inlineChipY + (targetY - inlineChipY) * maxProgress);
      const textY = Math.round(bubbleY + (chipH - hintFontSize) / 2);

      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = Math.max(0, Math.min(1, maxProgress * 1.15));
      ctx.save();
      ctx.shadowColor = f.dark ? 'rgba(0, 0, 0, 0.45)' : 'rgba(15, 23, 42, 0.16)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = flipBelow ? 2 : -1;

      for (const h of group.hints) {
        paintInlayChip(
          ctx,
          cursorX,
          bubbleY,
          h.chipWidthPx,
          chipH,
          h.text,
          textY,
          inlayBg,
          inlayFg,
          inlayBorder,
        );
        // Push lifted bubble rect into inlayHits so tapping the bubble runs the same click pipeline
        f.inlayHits.push({ hint: h, x: cursorX, y: bubbleY, w: h.chipWidthPx, h: chipH });
        cursorX += h.chipWidthPx + gap;
      }

      ctx.restore();
      ctx.globalAlpha = prevAlpha;
    }

    ctx.font = baseFont;
    ctx.restore();
  },
};
