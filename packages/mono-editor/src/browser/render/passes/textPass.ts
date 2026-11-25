import { rgbaToCss } from '../../../common/color/colorFormat';
import { MarkerSeverity, MarkerTag, type IMarker } from '../../../common/decorations/types';
import type { SemanticTokenSpan } from '../../../common/languages/semanticTokens';
import { INLAY_CHIP_PAD_X } from '../../../common/virtualText';
import {
  COLOR_SWATCH_ADVANCE,
  COLOR_SWATCH_SIZE,
  type FrameContext,
  type RenderPass,
} from '../frameContext';
import { paintInlayChip } from './inlayBubblePass';

interface StyledSpan {
  start: number;
  end: number;
  color: string;
  italic?: boolean;
  bold?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  dimmed?: boolean;
}

function buildFontString(size: number, family: string, italic?: boolean, bold?: boolean): string {
  const prefix = `${italic ? 'italic ' : ''}${bold ? '600 ' : ''}`;
  return `${prefix}${size}px ${family}`;
}

function resolveLineSpans(
  contentLen: number,
  tokens: readonly { startColumn: number; endColumn: number; type: string }[],
  semantics: readonly SemanticTokenSpan[],
  tokenColors: Record<string, string | undefined>,
  defaultFg: string,
): StyledSpan[] {
  const base: StyledSpan[] = [];
  if (!tokens.length) {
    if (contentLen > 0) base.push({ start: 1, end: contentLen + 1, color: defaultFg });
  } else {
    let col = 1;
    for (const tok of tokens) {
      if (tok.startColumn > col) base.push({ start: col, end: tok.startColumn, color: defaultFg });
      base.push({
        start: tok.startColumn,
        end: tok.endColumn,
        color: tokenColors[tok.type] ?? defaultFg,
      });
      col = Math.max(col, tok.endColumn);
    }
    if (col <= contentLen) base.push({ start: col, end: contentLen + 1, color: defaultFg });
  }
  if (!semantics.length) return base;

  let spans = base;
  for (const sem of semantics) {
    const semColor = tokenColors[sem.tokenType] ?? defaultFg;
    const next: StyledSpan[] = [];
    for (const sp of spans) {
      if (sem.endColumn <= sp.start || sem.startColumn >= sp.end) {
        next.push(sp);
        continue;
      }
      if (sem.startColumn > sp.start) next.push({ ...sp, end: sem.startColumn });
      const oStart = Math.max(sp.start, sem.startColumn);
      const oEnd = Math.min(sp.end, sem.endColumn);
      if (oEnd > oStart) {
        next.push({
          start: oStart,
          end: oEnd,
          color: semColor,
          italic: sem.italic,
          bold: sem.bold,
          strikethrough: sem.strikethrough,
          underline: sem.underline,
        });
      }
      if (sem.endColumn < sp.end) next.push({ ...sp, start: sem.endColumn });
    }
    spans = next;
  }
  return spans;
}

function applyMarkerTags(
  spans: StyledSpan[],
  line: number,
  contentLen: number,
  markers: readonly IMarker[],
): StyledSpan[] {
  let out = spans;
  for (const mk of markers) {
    if (!mk.tags?.length) continue;
    if (line < mk.startLineNumber || line > mk.endLineNumber) continue;
    const isUnnecessary = mk.tags.includes(MarkerTag.Unnecessary);
    const isDeprecated = mk.tags.includes(MarkerTag.Deprecated);
    if (!isUnnecessary && !isDeprecated) continue;
    const sCol = line === mk.startLineNumber ? mk.startColumn : 1;
    const eCol = line === mk.endLineNumber ? mk.endColumn : contentLen + 1;
    const next: StyledSpan[] = [];
    for (const sp of out) {
      if (eCol <= sp.start || sCol >= sp.end) {
        next.push(sp);
        continue;
      }
      if (sCol > sp.start) next.push({ ...sp, end: sCol });
      const oStart = Math.max(sp.start, sCol);
      const oEnd = Math.min(sp.end, eCol);
      if (oEnd > oStart) {
        next.push({
          ...sp,
          start: oStart,
          end: oEnd,
          dimmed: sp.dimmed || isUnnecessary,
          strikethrough: sp.strikethrough || isDeprecated,
        });
      }
      if (eCol < sp.end) next.push({ ...sp, start: eCol });
    }
    out = next;
  }
  return out;
}

function paintWhitespaceChars(
  ctx: CanvasRenderingContext2D,
  f: FrameContext,
  content: string,
  seg: ReturnType<FrameContext['getVisualLine']>,
  y: number,
  lineHeight: number,
): void {
  const mode = f.opts.renderWhitespace ?? 'none';
  if (mode === 'none' || !content.length) return;
  const line = seg.modelLine;
  const trailingStart = content.replace(/[ \t]+$/, '').length;
  let leadingEnd = 0;
  while (leadingEnd < content.length && (content[leadingEnd] === ' ' || content[leadingEnd] === '\t')) {
    leadingEnd++;
  }

  ctx.fillStyle = f.dark ? 'rgba(255, 255, 255, 0.24)' : 'rgba(15, 23, 42, 0.24)';
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = 1;
  const midY = Math.round(y + lineHeight / 2) + 0.5;

  for (let i = seg.startCol - 1; i < Math.min(content.length, seg.endCol - 1); i++) {
    const ch = content[i]!;
    if (ch !== ' ' && ch !== '\t') continue;
    const col = i + 1;
    let draw = false;
    if (mode === 'all') {
      draw = true;
    } else if (mode === 'trailing') {
      draw = i >= trailingStart;
    } else if (mode === 'boundary') {
      const isLeadOrTrail = i < leadingEnd || i >= trailingStart;
      const isDoubleSpace = ch === ' ' && (content[i - 1] === ' ' || content[i + 1] === ' ');
      draw = isLeadOrTrail || ch === '\t' || isDoubleSpace;
    } else if (mode === 'selection') {
      draw = f.orderedSelections.some((os) => {
        if (os.isEmpty) return false;
        if (line < os.startLine || line > os.endLine) return false;
        if (line === os.startLine && col < os.startCol) return false;
        if (line === os.endLine && col >= os.endCol) return false;
        return true;
      });
    }
    if (!draw) continue;

    const x1 = f.segX(content, seg, col);
    const x2 = f.segX(content, seg, col + 1);
    if (ch === ' ') {
      ctx.beginPath();
      ctx.arc((x1 + x2) / 2, midY, 1.2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const arrowEnd = Math.max(x1 + 4, x2 - 3);
      ctx.beginPath();
      ctx.moveTo(x1 + 2, midY);
      ctx.lineTo(arrowEnd, midY);
      ctx.moveTo(arrowEnd - 3, midY - 2.5);
      ctx.lineTo(arrowEnd, midY);
      ctx.lineTo(arrowEnd - 3, midY + 2.5);
      ctx.stroke();
    }
  }
}

/**
 * Paints syntax-highlighted text runs (Monarch + Semantic Token overlay + MarkerTags),
 * whitespace glyphs, inline & multiline Ghost Text, Inlay Hints, Color Swatches,
 * Error Lens suffixes, clickable Link underlines, and collapsed fold badges.
 */
export const textPass: RenderPass = {
  name: 'text',
  paint(ctx: CanvasRenderingContext2D, f: FrameContext): void {
    const {
      model,
      cssWidth,
      cssHeight,
      metrics,
      theme,
      getLineTokens,
      folding,
      ghostTextItalic,
      markers = [],
      errorLens,
    } = f.opts;
    const { lineHeight, fontSize, fontFamily } = metrics;
    const baseFont = `${fontSize}px ${fontFamily}`;
    const ghostFg =
      theme.ghostTextForeground ??
      (f.dark ? 'rgba(156, 163, 175, 0.56)' : 'rgba(100, 116, 139, 0.62)');
    const inlayFg = theme.inlayHintForeground ?? (f.dark ? '#969696' : '#64748b');
    const inlayBg =
      theme.inlayHintBackground ?? (f.dark ? 'rgba(128,128,128,0.15)' : 'rgba(100,116,139,0.10)');
    const linkFg = theme.linkForeground ?? (f.dark ? '#3794ff' : '#006ab1');

    // Index strongest marker per line for Error Lens when enabled
    let lensByLine: Map<number, IMarker> | null = null;
    if (errorLens?.enabled && markers.length) {
      lensByLine = new Map();
      for (const mk of markers) {
        const cur = lensByLine.get(mk.startLineNumber);
        if (!cur || mk.severity > cur.severity) lensByLine.set(mk.startLineNumber, mk);
      }
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(f.contentLeft, 0, Math.max(0, cssWidth - f.contentLeft), cssHeight);
    ctx.clip();

    for (let row = f.firstRow; row <= f.lastRow; row++) {
      const y = f.rowTopY(row);
      if (y + lineHeight < 0 || y > cssHeight) continue;
      const seg = f.getVisualLine(row);
      const textY = y + (lineHeight - fontSize) / 2;

      if (seg.isVirtualGhost) {
        const gText = seg.ghostText ?? '';
        if (gText) {
          const useItalic = seg.ghostItalic ?? ghostTextItalic ?? false;
          ctx.font = buildFontString(fontSize, fontFamily, useItalic, false);
          ctx.fillStyle = ghostFg;
          ctx.fillText(gText, f.textX0 + seg.wrapIndentPx, textY);
          if (useItalic) ctx.font = baseFont;
        }
        continue;
      }

      const line = seg.modelLine;
      const content = model.getLineContent(line);
      const tokens = getLineTokens?.(line) ?? [];
      const semantics = f.semanticTokensForLine(line);
      const lineColors = f.colorsForLine(line);
      const segColors = lineColors.filter(
        (cm) => cm.startColumn >= seg.startCol && cm.startColumn < seg.endCol,
      );
      const lineInlays = f.inlayHintsForLine(line);
      const segInlays = lineInlays.filter(
        (h) => h.column >= seg.startCol && (h.column < seg.endCol || (seg.isLastSegment && h.column <= seg.endCol)),
      );
      const lineGhosts = f.ghostInlineForLine(line);
      const segGhosts = lineGhosts.filter(
        (g) => g.column >= seg.startCol && (g.column < seg.endCol || (seg.isLastSegment && g.column <= seg.endCol)),
      );
      const lineBrackets = f.bracketsForLine(line);
      const segBrackets = lineBrackets.length
        ? lineBrackets.filter((b) => b.column + 1 >= seg.startCol && b.column + 1 < seg.endCol)
        : [];

      const splitCols: number[] = [];
      for (const cm of segColors) splitCols.push(cm.startColumn);
      for (const h of segInlays) splitCols.push(h.column);
      for (const g of segGhosts) splitCols.push(g.column);
      if (splitCols.length > 1) splitCols.sort((a, b) => a - b);

      const paintPlainSlice = (
        a0: number,
        b0: number,
        colorStyle: string,
        styleFlags?: {
          italic?: boolean;
          bold?: boolean;
          strikethrough?: boolean;
          underline?: boolean;
          dimmed?: boolean;
        },
      ) => {
        if (b0 <= a0) return;
        const customFont = styleFlags?.italic || styleFlags?.bold;
        if (customFont) ctx.font = buildFontString(fontSize, fontFamily, styleFlags?.italic, styleFlags?.bold);
        if (styleFlags?.dimmed) ctx.globalAlpha = 0.5;

        const drawRun = (fromCol: number, toCol: number) => {
          const slice = content.slice(fromCol - 1, toCol - 1);
          if (!slice) return;
          const sx = f.segX(content, seg, fromCol);
          ctx.fillStyle = colorStyle;
          ctx.fillText(slice, sx, textY);
          if (styleFlags?.strikethrough || styleFlags?.underline) {
            const ex = f.segX(content, seg, toCol);
            ctx.strokeStyle = colorStyle;
            ctx.lineWidth = 1;
            ctx.beginPath();
            if (styleFlags.strikethrough) {
              const midY = Math.round(y + lineHeight * 0.54) + 0.5;
              ctx.moveTo(sx, midY);
              ctx.lineTo(Math.max(sx + 2, ex), midY);
            }
            if (styleFlags.underline) {
              const ulY = Math.round(y + lineHeight - 3) + 0.5;
              ctx.moveTo(sx, ulY);
              ctx.lineTo(Math.max(sx + 2, ex), ulY);
            }
            ctx.stroke();
          }
        };

        if (!splitCols.length) {
          drawRun(a0, b0);
        } else {
          let cur = a0;
          for (const sc of splitCols) {
            if (sc > cur && sc < b0) {
              drawRun(cur, sc);
              cur = sc;
            }
          }
          if (cur < b0) drawRun(cur, b0);
        }

        if (styleFlags?.dimmed) ctx.globalAlpha = 1;
        if (customFont) ctx.font = baseFont;
      };

      const emitSpan = (sp: StyledSpan) => {
        const a0 = Math.max(sp.start, seg.startCol);
        const b0 = Math.min(sp.end, seg.endCol);
        if (b0 <= a0) return;
        const flags =
          sp.italic || sp.bold || sp.strikethrough || sp.underline || sp.dimmed
            ? {
                italic: sp.italic,
                bold: sp.bold,
                strikethrough: sp.strikethrough,
                underline: sp.underline,
                dimmed: sp.dimmed,
              }
            : undefined;
        if (!segBrackets.length) {
          paintPlainSlice(a0, b0, sp.color, flags);
          return;
        }
        let cur = a0;
        for (const b of segBrackets) {
          const bCol = b.column + 1;
          if (bCol < cur) continue;
          if (bCol >= b0) break;
          if (bCol > cur) paintPlainSlice(cur, bCol, sp.color, flags);
          paintPlainSlice(bCol, bCol + 1, f.bracketColorOf(b));
          cur = bCol + 1;
        }
        if (cur < b0) paintPlainSlice(cur, b0, sp.color, flags);
      };

      let spans = resolveLineSpans(content.length, tokens, semantics, f.tokenColors, theme.foreground);
      if (markers.length) spans = applyMarkerTags(spans, line, content.length, markers);
      for (const sp of spans) emitSpan(sp);

      // Whitespace rendering (dots & tab arrows)
      paintWhitespaceChars(ctx, f, content, seg, y, lineHeight);

      // Inline Color Swatches
      if (segColors.length) {
        const swatchY = Math.round(y + (lineHeight - COLOR_SWATCH_SIZE) / 2);
        for (const cm of segColors) {
          const sx = Math.round(f.segVirtualX(content, seg, cm.startColumn, 0) + 1);
          if (sx + COLOR_SWATCH_SIZE < f.contentLeft || sx > cssWidth) continue;

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
          ctx.strokeStyle = f.dark ? 'rgba(255, 255, 255, 0.42)' : 'rgba(15, 23, 42, 0.35)';
          ctx.lineWidth = 1;
          ctx.strokeRect(sx + 0.5, swatchY + 0.5, COLOR_SWATCH_SIZE - 1, COLOR_SWATCH_SIZE - 1);

          f.colorHits.push({
            match: cm,
            x: sx - 2,
            y,
            w: COLOR_SWATCH_ADVANCE + 2,
            h: lineHeight,
          });
        }
      }

      // Inline Inlay Hint Chips
      if (segInlays.length) {
        const hintFontSize = Math.max(10, Math.round(fontSize * 0.86));
        const hintFont = `${hintFontSize}px ${fontFamily}`;
        const chipH = Math.max(14, lineHeight - 4);
        const chipY = Math.round(y + (lineHeight - chipH) / 2);
        const hintTextY = Math.round(y + (lineHeight - hintFontSize) / 2);
        ctx.font = hintFont;

        const sameColCount = new Map<number, number>();
        for (const hint of segInlays) {
          const idx = sameColCount.get(hint.column) ?? 0;
          sameColCount.set(hint.column, idx + 1);
          const lift = hint.liftProgress ?? 0;
          if (lift >= 0.99) continue; // Fully lifted into inlayBubblePass
          const startX = f.segVirtualX(content, seg, hint.column, 1, idx) + hint.marginLeftPx;
          if (startX + hint.chipWidthPx < f.contentLeft || startX > cssWidth) continue;

          const prevAlpha = ctx.globalAlpha;
          if (lift > 0.01) ctx.globalAlpha = prevAlpha * Math.max(0, 1 - lift);
          paintInlayChip(ctx, startX, chipY, hint.chipWidthPx, chipH, hint.text, hintTextY, inlayBg, inlayFg);
          if (lift > 0.01) ctx.globalAlpha = prevAlpha;

          if (lift < 0.5) {
            f.inlayHits.push({ hint, x: startX, y: chipY, w: hint.chipWidthPx, h: chipH });
          }
        }
        ctx.font = baseFont;
      }

      // Inline Ghost Text Runs
      if (segGhosts.length) {
        const sameColCount = new Map<number, number>();
        for (const g of segGhosts) {
          const idx = sameColCount.get(g.column) ?? 0;
          sameColCount.set(g.column, idx + 1);
          const gx = f.segVirtualX(content, seg, g.column, 2, idx);
          const useItalic = g.italic ?? ghostTextItalic ?? false;
          if (useItalic) ctx.font = buildFontString(fontSize, fontFamily, true, false);
          ctx.fillStyle = ghostFg;
          ctx.fillText(g.text, gx, textY);
          if (useItalic) ctx.font = baseFont;
        }
      }

      // Inline Error Lens diagnostic suffix at end of line
      if (lensByLine && seg.isLastSegment) {
        const mk = lensByLine.get(line);
        if (mk) {
          const maxLen = errorLens?.maxLength ?? 90;
          const msg =
            mk.message.length > maxLen ? mk.message.slice(0, maxLen - 1) + '…' : mk.message;
          const endX = f.segX(content, seg, seg.endCol) + 18;
          if (endX < cssWidth - 20) {
            const lensColor =
              mk.severity >= MarkerSeverity.Error
                ? (f.dark ? 'rgba(248, 113, 113, 0.84)' : 'rgba(220, 38, 38, 0.84)')
                : mk.severity >= MarkerSeverity.Warning
                  ? (f.dark ? 'rgba(251, 191, 36, 0.84)' : 'rgba(180, 83, 9, 0.84)')
                  : (f.dark ? 'rgba(96, 165, 250, 0.82)' : 'rgba(37, 99, 235, 0.82)');
            const lensFontSize = Math.max(11, fontSize - 1);
            ctx.font = `italic ${lensFontSize}px ${fontFamily}`;
            ctx.fillStyle = lensColor;
            ctx.fillText(`  ${msg}`, endX, y + (lineHeight - lensFontSize) / 2);
            ctx.font = baseFont;
          }
        }
      }

      // Document Links
      const lineLinks = f.linksForLine(line);
      if (lineLinks.length) {
        const ulY = Math.round(y + lineHeight - 2.5) + 0.5;
        ctx.strokeStyle = linkFg;
        ctx.lineWidth = 1;
        for (const lk of lineLinks) {
          const c1 = Math.max(seg.startCol, lk.range.startLineNumber === line ? lk.range.startColumn : 1);
          const c2 = Math.min(seg.endCol, lk.range.endLineNumber === line ? lk.range.endColumn : content.length + 1);
          if (c2 <= c1) continue;
          const x1 = f.segX(content, seg, c1);
          const x2 = f.segX(content, seg, c2);
          ctx.beginPath();
          ctx.moveTo(x1, ulY);
          ctx.lineTo(Math.max(x1 + 2, x2), ulY);
          ctx.stroke();
          f.linkHits.push({
            range: lk.range,
            url: lk.url != null ? String(lk.url) : undefined,
            tooltip: lk.tooltip,
            x: x1,
            y,
            w: Math.max(4, x2 - x1),
            h: lineHeight,
          });
        }
      }

      // Collapsed Fold Placeholder Badge
      if (folding?.enabled && seg.isLastSegment && folding.isCollapsed(line)) {
        const badgeX = f.segX(content, seg, seg.endCol) + 6;
        const badgeW = 24;
        const badgeH = Math.max(13, lineHeight - 6);
        const badgeY = y + (lineHeight - badgeH) / 2;
        ctx.fillStyle = f.dark ? 'rgba(148, 163, 184, 0.22)' : 'rgba(100, 116, 139, 0.16)';
        ctx.strokeStyle = f.dark ? 'rgba(148, 163, 184, 0.42)' : 'rgba(100, 116, 139, 0.36)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 3);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = theme.foreground;
        const dotY = badgeY + badgeH / 2;
        for (let di = -1; di <= 1; di++) {
          ctx.beginPath();
          ctx.arc(badgeX + badgeW / 2 + di * 5, dotY, 1.25, 0, Math.PI * 2);
          ctx.fill();
        }
        f.foldHits.push({
          lineNumber: line,
          x: badgeX - 2,
          y,
          w: badgeW + 4,
          h: lineHeight,
          kind: 'badge',
        });
      }
    }
    ctx.restore();
  },
};
