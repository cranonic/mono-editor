/**
 * Unified text layout & grapheme cluster utilities for Canvas rendering,
 * pointer hit-testing, teardrop placement, and caret navigation.
 *
 * Fast path: printable ASCII lines (0x20..0x7E) use O(1) monospace math.
 * Complex path: lines with Indic conjuncts (Bengali, Devanagari/Hindi, etc.),
 * combining marks, CJK, emoji, or tabs use Intl.Segmenter grapheme clusters
 * plus cached Canvas measureText prefix widths so text, selection highlights,
 * carets, and teardrop handles stay pixel-locked with zero jump.
 */

import {
  isFastMonospaceLine,
  getGraphemeBoundaries,
  prevGraphemeOffset,
  nextGraphemeOffset,
  graphemeRangeAt,
} from '../../common/util/grapheme';

export {
  isFastMonospaceLine,
  getGraphemeBoundaries,
  prevGraphemeOffset,
  nextGraphemeOffset,
  graphemeRangeAt,
};

export interface LineLayout {
  /** UTF-16 code unit offsets of grapheme cluster boundaries: [0, b1, ..., line.length] */
  boundaries: number[];
  /** Monotonic pixel x-offset from line start at each boundary: [0, w1, ..., wN] */
  widths: number[];
}

/** Build monotonic grapheme-aligned cumulative widths using the supplied measure function. */
export function computeLineLayout(
  line: string,
  measureText: (prefix: string) => number,
): LineLayout {
  const boundaries = getGraphemeBoundaries(line);
  const widths = new Array<number>(boundaries.length);
  widths[0] = 0;
  for (let i = 1; i < boundaries.length; i++) {
    const b = boundaries[i]!;
    const raw = measureText(line.slice(0, b));
    widths[i] = Math.max(widths[i - 1]!, Number.isFinite(raw) ? raw : widths[i - 1]!);
  }
  return { boundaries, widths };
}

/** Map a 0-based UTF-16 offset into a pixel x-offset using a precomputed `LineLayout`. */
export function measureOffsetXFromLayout(layout: LineLayout, offset: number): number {
  const { boundaries, widths } = layout;
  const last = boundaries.length - 1;
  if (offset <= 0 || last <= 0) return 0;
  const maxOffset = boundaries[last]!;
  if (offset >= maxOffset) return widths[last]!;

  // Binary search for largest i where boundaries[i] <= offset
  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (boundaries[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }

  const b0 = boundaries[lo]!;
  const w0 = widths[lo]!;
  if (b0 === offset || lo >= last) return w0;

  // Offset falls inside a multi-code-unit cluster: linearly interpolate so positions stay monotonic.
  const b1 = boundaries[lo + 1]!;
  const w1 = widths[lo + 1]!;
  const span = Math.max(1, b1 - b0);
  return w0 + ((offset - b0) / span) * (w1 - w0);
}

/**
 * Map a line-local pixel `textX` to a 1-based column using `LineLayout`.
 * - `round = true`: snaps to nearest grapheme cluster boundary (caret / teardrop drag / tap).
 * - `round = false`: returns the start column of the grapheme cluster containing `textX` (word hit-test).
 */
export function columnAtXFromLayout(
  layout: LineLayout,
  textX: number,
  round: boolean,
): number {
  const { boundaries, widths } = layout;
  const last = boundaries.length - 1;
  if (last <= 0 || textX <= 0) return 1;
  if (textX >= widths[last]!) return boundaries[last]! + 1;

  // Binary search for cluster i where widths[i] <= textX < widths[i + 1]
  let lo = 0;
  let hi = last - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (widths[mid]! <= textX) lo = mid;
    else hi = mid - 1;
  }

  if (!round) return boundaries[lo]! + 1;
  const w0 = widths[lo]!;
  const w1 = widths[lo + 1]!;
  const midX = (w0 + w1) * 0.5;
  return textX >= midX ? boundaries[lo + 1]! + 1 : boundaries[lo]! + 1;
}

/** Bounded per-(font, line) cache for complex/non-ASCII line layouts. */
export class TextLayoutCache {
  private cache = new Map<string, LineLayout>();
  private maxEntries: number;
  private measure: (font: string, text: string) => number;

  constructor(
    measure: (font: string, text: string) => number,
    maxEntries = 512,
  ) {
    this.measure = measure;
    this.maxEntries = maxEntries;
  }

  getLayout(font: string, line: string): LineLayout {
    const key = `${font}\0${line}`;
    let layout = this.cache.get(key);
    if (layout) return layout;
    layout = computeLineLayout(line, (prefix) => this.measure(font, prefix));
    if (this.cache.size >= this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, layout);
    return layout;
  }

  measureColumnX(line: string, col: number, font: string, charWidth: number): number {
    const offset = Math.max(0, Math.min(line.length, (col | 0) - 1));
    if (offset === 0) return 0;
    if (isFastMonospaceLine(line)) return offset * charWidth;
    return measureOffsetXFromLayout(this.getLayout(font, line), offset);
  }

  columnAtX(
    line: string,
    textX: number,
    font: string,
    charWidth: number,
    round = true,
  ): number {
    if (!line.length || textX <= 0) return 1;
    if (isFastMonospaceLine(line)) {
      const cw = Math.max(1, charWidth);
      const raw = round ? Math.round(textX / cw) + 1 : Math.floor(textX / cw) + 1;
      return Math.max(1, Math.min(line.length + 1, raw));
    }
    return columnAtXFromLayout(this.getLayout(font, line), textX, round);
  }

  clear(): void {
    this.cache.clear();
  }
}
