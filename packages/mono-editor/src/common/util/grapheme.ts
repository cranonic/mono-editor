/**
 * Pure DOM-free grapheme cluster utilities (runs in Node and Browser).
 * Handles printable ASCII O(1) fast path plus Indic conjuncts, combining marks,
 * CJK, and emoji ZWJ sequences via Intl.Segmenter with a safe fallback.
 */

type SegmenterLike = {
  segment(input: string): Iterable<{ index: number; segment: string }>;
};

let cachedSegmenter: SegmenterLike | null | undefined;

function getGraphemeSegmenter(): SegmenterLike | null {
  if (cachedSegmenter !== undefined) return cachedSegmenter;
  try {
    const IntlAny = Intl as unknown as {
      Segmenter?: new (
        locales?: string | string[],
        options?: { granularity: 'grapheme' | 'word' | 'sentence' },
      ) => SegmenterLike;
    };
    cachedSegmenter = IntlAny.Segmenter
      ? new IntlAny.Segmenter(undefined, { granularity: 'grapheme' })
      : null;
  } catch {
    cachedSegmenter = null;
  }
  return cachedSegmenter;
}

/** True when every code unit is printable ASCII (no tabs, no Unicode, no combining marks). */
export function isFastMonospaceLine(line: string): boolean {
  for (let i = 0; i < line.length; i++) {
    const code = line.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
}

function isSurrogatePairAt(line: string, i: number): boolean {
  if (i < 0 || i + 1 >= line.length) return false;
  const hi = line.charCodeAt(i);
  const lo = line.charCodeAt(i + 1);
  return hi >= 0xd800 && hi <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff;
}

function fallbackGraphemeBoundaries(line: string): number[] {
  const out: number[] = [0];
  let i = 0;
  while (i < line.length) {
    i += isSurrogatePairAt(line, i) ? 2 : 1;
    while (i < line.length) {
      const ch = line[i]!;
      const code = line.charCodeAt(i);
      if (
        /\p{M}/u.test(ch) ||
        code === 0x200d ||
        code === 0x200c ||
        (code >= 0xfe00 && code <= 0xfe0f)
      ) {
        const isVirama =
          code === 0x09cd ||
          code === 0x094d ||
          code === 0x0a4d ||
          code === 0x0acd ||
          code === 0x0b4d ||
          code === 0x0bcd ||
          code === 0x0c4d ||
          code === 0x0ccd ||
          code === 0x0d4d ||
          code === 0x200d;
        i += isSurrogatePairAt(line, i) ? 2 : 1;
        if (isVirama && i < line.length) {
          i += isSurrogatePairAt(line, i) ? 2 : 1;
        }
        continue;
      }
      break;
    }
    out.push(i);
  }
  return out;
}

/** Returns sorted UTF-16 grapheme cluster boundary offsets `[0, b1, ..., line.length]`. */
export function getGraphemeBoundaries(line: string): number[] {
  if (!line.length) return [0];
  if (isFastMonospaceLine(line)) {
    const out = new Array<number>(line.length + 1);
    for (let i = 0; i <= line.length; i++) out[i] = i;
    return out;
  }
  const seg = getGraphemeSegmenter();
  if (!seg) return fallbackGraphemeBoundaries(line);
  const out: number[] = [0];
  for (const part of seg.segment(line)) {
    out.push(part.index + part.segment.length);
  }
  return out;
}

/** Previous grapheme cluster boundary strictly before `offset` (0-based UTF-16 offset). */
export function prevGraphemeOffset(line: string, offset: number): number {
  const clamped = Math.max(0, Math.min(line.length, offset));
  if (clamped <= 0) return 0;
  if (isFastMonospaceLine(line)) return clamped - 1;
  const boundaries = getGraphemeBoundaries(line);
  let lo = 0;
  let hi = boundaries.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (boundaries[mid]! < clamped) lo = mid;
    else hi = mid - 1;
  }
  return boundaries[lo]!;
}

/** Next grapheme cluster boundary strictly after `offset` (0-based UTF-16 offset). */
export function nextGraphemeOffset(line: string, offset: number): number {
  const clamped = Math.max(0, Math.min(line.length, offset));
  if (clamped >= line.length) return line.length;
  if (isFastMonospaceLine(line)) return clamped + 1;
  const boundaries = getGraphemeBoundaries(line);
  let lo = 0;
  let hi = boundaries.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (boundaries[mid]! <= clamped) lo = mid + 1;
    else hi = mid;
  }
  return boundaries[lo]!;
}

/** Grapheme cluster `[start, end)` containing 0-based `offset`. */
export function graphemeRangeAt(line: string, offset: number): { start: number; end: number } {
  if (!line.length) return { start: 0, end: 0 };
  const idx = Math.max(0, Math.min(line.length - 1, offset));
  if (isFastMonospaceLine(line)) return { start: idx, end: idx + 1 };
  const boundaries = getGraphemeBoundaries(line);
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i]!;
    const end = boundaries[i + 1]!;
    if (idx >= start && idx < end) return { start, end };
  }
  return { start: idx, end: Math.min(line.length, idx + 1) };
}
