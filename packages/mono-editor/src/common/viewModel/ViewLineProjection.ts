import type { TextModel } from '../model/TextModel';
import { nextGraphemeOffset } from '../util/grapheme';

import type { VirtualGhostRow } from '../virtualText/ghostTextTypes';

export type WordWrapMode = 'off' | 'on';
export type WrappingIndentMode = 'none' | 'same' | 'indent';

export interface VisualLine {
  /** 0-based visual row index in the viewport document */
  visualRow: number;
  /** 1-based model line number (for virtual ghost rows, the anchor line above it) */
  modelLine: number;
  /** 1-based inclusive start column in `modelLine` */
  startCol: number;
  /** 1-based exclusive end column in `modelLine` (equals `line.length + 1` on last segment) */
  endCol: number;
  /** True for the first visual row of `modelLine` (shows line number & fold chevron) */
  isFirstSegment: boolean;
  /** True for the last visual row of `modelLine` (shows fold `...` badge when collapsed) */
  isLastSegment: boolean;
  /** Pixel X indentation applied to wrapped continuation segments (0 on first segment) */
  wrapIndentPx: number;
  /** True when this visual row is a virtual multiline ghost-text continuation row (blank gutter). */
  isVirtualGhost?: boolean;
  /** Rendered text for a virtual ghost row. */
  ghostText?: string;
  /** Owning ghost item id for a virtual ghost row. */
  ghostItemId?: string;
  /** Optional italic flag for virtual ghost row. */
  ghostItalic?: boolean;
}

export interface ProjectionParams {
  model: TextModel;
  modelVersion: number;
  foldVersion: number;
  hasFolds: boolean;
  isLineHidden: (lineNumber: number) => boolean;
  wordWrap: WordWrapMode;
  wrappingIndent: WrappingIndentMode;
  /** Available content width in CSS px for text wrapping */
  wrapWidthPx: number;
  tabSize: number;
  charWidth: number;
  measureColumnX: (lineContent: string, col: number) => number;
  /** Monotonic version counter for active ghost text items (0 when none). */
  ghostVersion?: number;
  /** True when any multiline virtual ghost rows exist. */
  hasGhostRows?: boolean;
  /** Returns wrapped virtual continuation rows to insert immediately after `lineNumber`. */
  getLineGhostRows?: (
    lineNumber: number,
    wrapWidthPx: number,
    effectiveWrap: boolean,
  ) => readonly VirtualGhostRow[];
}

function leadingWhitespaceCols(line: string, tabSize: number): number {
  let cols = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === ' ') cols += 1;
    else if (ch === '\t') cols += tabSize;
    else break;
  }
  return cols;
}

/**
 * Unified model-line <-> visual-row projection layer powering both Code Folding
 * and Word Wrap simultaneously.
 *
 * - Fast O(1) identity path when `wordWrap === 'off'` and no folds are collapsed.
 * - Cached projection arrays invalidated only on model edit, fold toggle, resize, or option change.
 */
export class ViewLineProjection {
  private identity = true;
  private modelLineCount = 1;
  private lines: VisualLine[] = [];
  private modelToFirst = new Map<number, number>();
  private cacheKey = '';
  private lastModel: TextModel | null = null;

  sync(params: ProjectionParams): void {
    const {
      model,
      modelVersion,
      foldVersion,
      hasFolds,
      isLineHidden,
      wordWrap,
      wrappingIndent,
      wrapWidthPx,
      tabSize,
      charWidth,
      measureColumnX,
      ghostVersion = 0,
      hasGhostRows = false,
      getLineGhostRows,
    } = params;

    this.lastModel = model;
    this.modelLineCount = model.getLineCount();

    const effectiveWrap = wordWrap === 'on' && wrapWidthPx > Math.max(charWidth * 6, 48);
    const key = `${modelVersion}|${foldVersion}|${hasFolds ? 1 : 0}|${effectiveWrap ? 1 : 0}|${wrappingIndent}|${Math.floor(wrapWidthPx)}|${tabSize}|${Math.round(charWidth * 10)}|${ghostVersion}|${hasGhostRows ? 1 : 0}`;
    if (key === this.cacheKey) return;
    this.cacheKey = key;

    // Fast identity path: zero per-line allocation when neither wrap, fold, nor multiline ghost rows are active
    if (!hasFolds && !effectiveWrap && !hasGhostRows) {
      this.identity = true;
      this.lines = [];
      this.modelToFirst.clear();
      return;
    }

    this.identity = false;
    const out: VisualLine[] = [];
    const firstMap = new Map<number, number>();
    const total = model.getLineCount();
    const maxWrapIndent = Math.floor(wrapWidthPx * 0.45);
    const appendGhostRows = (ln: number) => {
      if (!hasGhostRows || !getLineGhostRows) return;
      const gRows = getLineGhostRows(ln, wrapWidthPx, effectiveWrap);
      for (const gr of gRows) {
        out.push({
          visualRow: out.length,
          modelLine: ln,
          startCol: 1,
          endCol: 1,
          isFirstSegment: false,
          isLastSegment: false,
          wrapIndentPx: gr.indentPx,
          isVirtualGhost: true,
          ghostText: gr.text,
          ghostItemId: gr.itemId,
          ghostItalic: gr.italic,
        });
      }
    };

    for (let ln = 1; ln <= total; ln++) {
      if (hasFolds && isLineHidden(ln)) continue;

      const text = model.getLineContent(ln);
      const len = text.length;
      firstMap.set(ln, out.length);

      if (!effectiveWrap || len === 0) {
        out.push({
          visualRow: out.length,
          modelLine: ln,
          startCol: 1,
          endCol: len + 1,
          isFirstSegment: true,
          isLastSegment: true,
          wrapIndentPx: 0,
        });
        appendGhostRows(ln);
        continue;
      }

      // Quick ASCII width check: if entire line fits in wrapWidthPx, 1 segment!
      const totalPx = measureColumnX(text, len + 1);
      if (totalPx <= wrapWidthPx) {
        out.push({
          visualRow: out.length,
          modelLine: ln,
          startCol: 1,
          endCol: len + 1,
          isFirstSegment: true,
          isLastSegment: true,
          wrapIndentPx: 0,
        });
        appendGhostRows(ln);
        continue;
      }

      // Compute continuation wrap indent
      let contIndentPx = 0;
      if (wrappingIndent !== 'none') {
        const baseCols = leadingWhitespaceCols(text, tabSize);
        const extraCols = wrappingIndent === 'indent' ? tabSize : 0;
        contIndentPx = Math.min(maxWrapIndent, (baseCols + extraCols) * charWidth);
      }

      let segStartOff = 0;
      let segIndex = 0;
      while (segStartOff < len) {
        const isFirst = segIndex === 0;
        const indentPx = isFirst ? 0 : contIndentPx;
        const availW = Math.max(charWidth * 2, wrapWidthPx - indentPx);
        const startX = measureColumnX(text, segStartOff + 1);

        // Find largest grapheme-aligned offset whose width fits in availW
        let lo = segStartOff;
        let hi = len;
        let bestBreak = -1;

        // Binary search on character offset first for speed on long lines
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          const segW = measureColumnX(text, mid + 1) - startX;
          if (segW <= availW) lo = mid;
          else hi = mid - 1;
        }

        let segEndOff = lo;
        if (segEndOff <= segStartOff) {
          // Ensure forward progress by at least one grapheme cluster
          segEndOff = nextGraphemeOffset(text, segStartOff);
        } else if (segEndOff < len) {
          // Snap backward off a combining mark / surrogate pair if needed
          let probe = segStartOff;
          let lastGrapheme = segStartOff;
          while (probe < segEndOff) {
            lastGrapheme = probe;
            const next = nextGraphemeOffset(text, probe);
            if (next > segEndOff) break;
            probe = next;
          }
          segEndOff = probe > segStartOff ? probe : nextGraphemeOffset(text, lastGrapheme);

          // Prefer clean word/punctuation break within the trailing 45% of the segment
          const minWordBreak = segStartOff + Math.floor((segEndOff - segStartOff) * 0.55);
          for (let k = segEndOff; k > minWordBreak; k--) {
            const ch = text[k - 1]!;
            if (ch === ' ' || ch === '\t' || ch === '-' || ch === '/' || ch === ',' || ch === ';') {
              bestBreak = k;
              break;
            }
          }
          if (bestBreak > segStartOff) {
            segEndOff = bestBreak;
          }
        }

        const isLast = segEndOff >= len;
        out.push({
          visualRow: out.length,
          modelLine: ln,
          startCol: segStartOff + 1,
          endCol: segEndOff + 1,
          isFirstSegment: isFirst,
          isLastSegment: isLast,
          wrapIndentPx: indentPx,
        });
        segStartOff = segEndOff;
        segIndex++;
      }
      appendGhostRows(ln);
    }

    this.lines = out;
    this.modelToFirst = firstMap;
  }

  invalidate(): void {
    this.cacheKey = '';
  }

  isIdentity(): boolean {
    return this.identity;
  }

  getVisualLineCount(): number {
    return this.identity ? this.modelLineCount : Math.max(1, this.lines.length);
  }

  getVisualLine(visualRow: number): VisualLine {
    if (this.identity) {
      const clampedRow = Math.max(0, Math.min(this.modelLineCount - 1, visualRow));
      const ln = clampedRow + 1;
      const len = this.lastModel ? this.lastModel.getLineContent(ln).length : 0;
      return {
        visualRow: clampedRow,
        modelLine: ln,
        startCol: 1,
        endCol: len + 1,
        isFirstSegment: true,
        isLastSegment: true,
        wrapIndentPx: 0,
      };
    }
    const clamped = Math.max(0, Math.min(this.lines.length - 1, visualRow));
    return this.lines[clamped]!;
  }

  /** Returns the first visible visual row for `modelLine` (or nearest preceding visible line if folded). */
  modelLineToFirstVisualRow(modelLine: number): number {
    if (this.identity) {
      return Math.max(0, Math.min(this.modelLineCount - 1, modelLine - 1));
    }
    const exact = this.modelToFirst.get(modelLine);
    if (exact != null) return exact;
    // Line is inside a collapsed fold — walk back to its visible header
    for (let ln = modelLine - 1; ln >= 1; ln--) {
      const hit = this.modelToFirst.get(ln);
      if (hit != null) return hit;
    }
    return 0;
  }

  /** Maps a 1-based `(modelLine, column)` to its exact visual row & segment. */
  modelToVisual(modelLine: number, column: number): { visualRow: number; visualLine: VisualLine } {
    if (this.identity) {
      const row = Math.max(0, Math.min(this.modelLineCount - 1, modelLine - 1));
      return { visualRow: row, visualLine: this.getVisualLine(row) };
    }
    const firstRow = this.modelLineToFirstVisualRow(modelLine);
    let r = firstRow;
    let lastSeg = this.lines[r]!;
    while (r < this.lines.length && this.lines[r]!.modelLine === modelLine) {
      const seg = this.lines[r]!;
      if (seg.isVirtualGhost) {
        r++;
        continue;
      }
      lastSeg = seg;
      if (column >= seg.startCol && (column < seg.endCol || seg.isLastSegment)) {
        return { visualRow: r, visualLine: seg };
      }
      r++;
    }
    return { visualRow: lastSeg.visualRow, visualLine: lastSeg };
  }

  /** Returns all non-virtual visual rows belonging to `modelLine` (empty if line is folded/hidden). */
  getVisualLinesForModelLine(modelLine: number): VisualLine[] {
    if (this.identity) {
      if (modelLine < 1 || modelLine > this.modelLineCount) return [];
      return [this.getVisualLine(modelLine - 1)];
    }
    const first = this.modelToFirst.get(modelLine);
    if (first == null) return [];
    const out: VisualLine[] = [];
    for (let r = first; r < this.lines.length && this.lines[r]!.modelLine === modelLine; r++) {
      if (!this.lines[r]!.isVirtualGhost) out.push(this.lines[r]!);
    }
    return out;
  }
}
