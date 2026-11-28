import { selectionSides } from '../virtualSides';
import type { FrameContext, RenderPass } from '../frameContext';

/**
 * Paints behind-text highlights: word occurrences, bracket match pair, find matches,
 * decoration backgrounds, and multi-cursor selection ranges.
 */
export const highlightsPass: RenderPass = {
  name: 'highlights',
  paint(ctx: CanvasRenderingContext2D, f: FrameContext): void {
    const {
      model,
      cssWidth,
      cssHeight,
      metrics,
      theme,
      occurrences = [],
      bracketMatch = null,
      findMatches = [],
      findCurrentIndex = -1,
      decorations = [],
      hoverRange = null,
      documentHighlights = [],
    } = f.opts;
    const { lineHeight } = metrics;

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

      if (hoverRange && line >= hoverRange.startLineNumber && line <= hoverRange.endLineNumber) {
        const fromCol = line === hoverRange.startLineNumber ? hoverRange.startColumn : 1;
        const toCol = line === hoverRange.endLineNumber ? hoverRange.endColumn : content.length + 1;
        const c1 = Math.max(seg.startCol, fromCol);
        const c2 = Math.min(seg.endCol, toCol);
        if (c2 > c1) {
          const x1 = f.segX(content, seg, c1);
          const x2 = f.segX(content, seg, c2);
          ctx.fillStyle = theme.hoverRangeBackground ?? (f.dark ? 'rgba(38, 79, 120, 0.34)' : 'rgba(37, 99, 235, 0.12)');
          ctx.fillRect(x1, y + 1, Math.max(2, x2 - x1), lineHeight - 2);
        }
      }

      if (documentHighlights.length) {
        const readFill = theme.documentHighlightRead ?? (f.dark ? 'rgba(87, 87, 87, 0.42)' : 'rgba(15, 23, 42, 0.08)');
        const writeFill = theme.documentHighlightWrite ?? (f.dark ? 'rgba(14, 99, 156, 0.40)' : 'rgba(14, 165, 233, 0.18)');
        for (const dh of documentHighlights) {
          if (line < dh.range.startLineNumber || line > dh.range.endLineNumber) continue;
          const fromCol = line === dh.range.startLineNumber ? dh.range.startColumn : 1;
          const toCol = line === dh.range.endLineNumber ? dh.range.endColumn : content.length + 1;
          const c1 = Math.max(seg.startCol, fromCol);
          const c2 = Math.min(seg.endCol, toCol);
          if (c2 <= c1) continue;
          const x1 = f.segX(content, seg, c1);
          const x2 = f.segX(content, seg, c2);
          ctx.fillStyle = dh.kind === 2 ? writeFill : readFill;
          ctx.fillRect(x1, y + 1, Math.max(2, x2 - x1), lineHeight - 2);
        }
      }

      if (occurrences.length) {
        const occFill = f.dark ? 'rgba(255, 255, 255, 0.11)' : 'rgba(15, 23, 42, 0.09)';
        for (const occ of occurrences) {
          if (occ.lineNumber !== line) continue;
          const c1 = Math.max(seg.startCol, occ.startColumn);
          const c2 = Math.min(seg.endCol, occ.endColumn);
          if (c2 <= c1) continue;
          const x1 = f.segX(content, seg, c1);
          const x2 = f.segX(content, seg, c2);
          ctx.fillStyle = occFill;
          ctx.fillRect(x1, y + 1, Math.max(2, x2 - x1), lineHeight - 2);
        }
      }

      if (findMatches.length) {
        const themeAny = theme as unknown as Record<string, string | undefined>;
        for (let mi = 0; mi < findMatches.length; mi++) {
          const fm = findMatches[mi]!;
          if (line < fm.startLineNumber || line > fm.endLineNumber) continue;
          let fromCol = 1;
          let toCol = content.length + 1;
          if (line === fm.startLineNumber) fromCol = fm.startColumn;
          if (line === fm.endLineNumber) toCol = fm.endColumn;
          const c1 = Math.max(seg.startCol, fromCol);
          const c2 = Math.min(seg.endCol, toCol);
          if (c2 <= c1) continue;
          const x1 = f.segX(content, seg, c1);
          const x2 = f.segX(content, seg, c2);
          ctx.fillStyle =
            mi === findCurrentIndex
              ? themeAny.findMatchHighlight || 'rgba(234, 92, 0, 0.55)'
              : themeAny.findMatch || 'rgba(234, 92, 0, 0.28)';
          ctx.fillRect(x1, y, Math.max(2, x2 - x1), lineHeight);
        }
      }

      if (decorations.length) {
        for (const d of decorations) {
          if (!d.background && !d.isWholeLine) continue;
          if (line < d.range.startLineNumber || line > d.range.endLineNumber) continue;
          if (d.isWholeLine && d.background) {
            ctx.fillStyle = d.background;
            ctx.fillRect(f.contentLeft, y, cssWidth - f.contentLeft, lineHeight);
            continue;
          }
          if (!d.background) continue;
          let fromCol = 1;
          let toCol = content.length + 1;
          if (line === d.range.startLineNumber) fromCol = d.range.startColumn;
          if (line === d.range.endLineNumber) toCol = d.range.endColumn;
          const c1 = Math.max(seg.startCol, fromCol);
          const c2 = Math.min(seg.endCol, toCol);
          if (c2 <= c1) continue;
          const x1 = f.segX(content, seg, c1);
          const x2 = f.segX(content, seg, c2);
          ctx.fillStyle = d.background;
          ctx.fillRect(x1, y, Math.max(2, x2 - x1), lineHeight);
        }
      }

      for (let osi = 0; osi < f.orderedSelections.length; osi++) {
        const os = f.orderedSelections[osi]!;
        if (os.isEmpty || line < os.startLine || line > os.endLine) continue;
        const sides = selectionSides(f.opts.selection.selections[osi]);
        let fromCol = 1;
        let toCol = content.length + 1;
        if (line === os.startLine) fromCol = os.startCol;
        if (line === os.endLine) toCol = os.endCol;
        const c1 = Math.max(seg.startCol, fromCol);
        const c2 = Math.min(seg.endCol, toCol);
        const extendsPastLine = line < os.endLine && seg.isLastSegment;
        if (c2 > c1 || (extendsPastLine && fromCol <= seg.endCol)) {
          const x1 = f.segX(content, seg, c1, line === os.startLine && c1 === fromCol ? sides.start : undefined);
          const x2 = f.segX(content, seg, Math.max(c1, c2), line === os.endLine && c2 === toCol ? sides.end : undefined);
          const w = Math.max(x2 - x1, extendsPastLine ? 6 : (line === os.endLine ? 2 : 0));
          ctx.fillStyle = theme.selection;
          ctx.fillRect(x1, y, w || 4, lineHeight);
        }
      }

      // Paint occurrence outlines & bracket match pair AFTER selection fill so they stay visible inside selections
      if (occurrences.length) {
        const occStroke = f.dark ? 'rgba(255, 255, 255, 0.28)' : 'rgba(15, 23, 42, 0.28)';
        for (const occ of occurrences) {
          if (occ.lineNumber !== line) continue;
          const c1 = Math.max(seg.startCol, occ.startColumn);
          const c2 = Math.min(seg.endCol, occ.endColumn);
          if (c2 <= c1) continue;
          const x1 = f.segX(content, seg, c1);
          const x2 = f.segX(content, seg, c2);
          ctx.strokeStyle = occStroke;
          ctx.lineWidth = 1;
          ctx.strokeRect(x1 + 0.5, y + 1.5, Math.max(1, x2 - x1 - 1), lineHeight - 3);
        }
      }

      if (bracketMatch) {
        const { open, close } = bracketMatch;
        const fill = f.dark ? 'rgba(56, 189, 248, 0.16)' : 'rgba(37, 99, 235, 0.12)';
        const stroke = f.dark ? 'rgba(125, 211, 252, 0.85)' : 'rgba(37, 99, 235, 0.78)';
        const paintBox = (x1: number, x2: number) => {
          ctx.fillStyle = fill;
          ctx.fillRect(x1, y + 1, Math.max(2, x2 - x1), lineHeight - 2);
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 1;
          ctx.strokeRect(x1 + 0.5, y + 1.5, Math.max(1, x2 - x1 - 1), lineHeight - 3);
        };
        const first = open.column <= close.column ? open : close;
        const second = first === open ? close : open;
        const sameSegContiguous =
          open.lineNumber === line &&
          close.lineNumber === line &&
          first.column + first.length === second.column &&
          first.column >= seg.startCol &&
          second.column + second.length <= seg.endCol;
        if (sameSegContiguous) {
          const seamGap =
            f.segX(content, seg, second.column) - f.segX(content, seg, first.column + first.length);
          if (Math.abs(seamGap) < 1.5) {
            paintBox(f.segX(content, seg, first.column), f.segX(content, seg, second.column + second.length));
            continue;
          }
        }
        for (const bp of [open, close]) {
          if (bp.lineNumber !== line) continue;
          const c1 = Math.max(seg.startCol, bp.column);
          const c2 = Math.min(seg.endCol, bp.column + bp.length);
          if (c2 <= c1) continue;
          paintBox(f.segX(content, seg, c1), f.segX(content, seg, c2));
        }
      }
    }
    ctx.restore();
  },
};
