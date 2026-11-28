import type { LanguageSegment, MonoToken, MonoTokenType } from './tokenTypes';
import {
  DEFAULT_MAX_TOKENIZATION_LINE_LENGTH,
  DEFAULT_MAX_TOKENIZATION_LINE_TIME_MS,
  languages,
  type TokenizeLineOptions,
} from './TokensProvider';

/** Monotonic DOM-free millisecond clock. */
export function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/**
 * Checks whether a per-line tokenization loop has exceeded its wall-clock time budget.
 * Samples the clock every 32 iterations so normal lines pay near-zero overhead.
 */
export function isOverTimeBudget(
  startMs: number,
  budgetMs: number,
  stepCount: number,
): boolean {
  if (budgetMs <= 0 || !Number.isFinite(budgetMs)) return false;
  if ((stepCount & 31) !== 0) return false;
  return nowMs() - startMs >= budgetMs;
}

export function resolveLineBudget(options?: TokenizeLineOptions): {
  maxLineLength: number;
  timeBudgetMs: number;
} {
  return {
    maxLineLength: options?.maxLineLength ?? DEFAULT_MAX_TOKENIZATION_LINE_LENGTH,
    timeBudgetMs: options?.timeBudgetMs ?? DEFAULT_MAX_TOKENIZATION_LINE_TIME_MS,
  };
}

/** Coalesce adjacent same-language segments into a minimal sorted list. */
export function coalesceLanguageSegments(
  segments: LanguageSegment[],
  rootLanguageId: string,
): LanguageSegment[] | undefined {
  if (!segments.length) return undefined;
  const merged: LanguageSegment[] = [];
  for (const seg of segments) {
    if (seg.endColumn <= seg.startColumn) continue;
    const prev = merged[merged.length - 1];
    if (prev && prev.languageId === seg.languageId && prev.endColumn === seg.startColumn) {
      prev.endColumn = seg.endColumn;
    } else {
      merged.push({ ...seg });
    }
  }
  if (!merged.length) return undefined;
  // If every segment matches rootLanguageId, omit to keep single-language memory at 0.
  if (merged.every((s) => s.languageId === rootLanguageId)) return undefined;
  return merged;
}

/**
 * Resolve the effective languageId at a 1-based column using O(log k) binary search
 * over a line's compact LanguageSegment array.
 */
export function findLanguageInSegments(
  segments: readonly LanguageSegment[] | null | undefined,
  column: number,
  rootLanguageId: string,
): string {
  if (!segments || segments.length === 0) return rootLanguageId;
  if (segments.length === 1) {
    const s = segments[0]!;
    if (column >= s.startColumn && column <= s.endColumn) return s.languageId;
    return rootLanguageId;
  }
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const seg = segments[mid]!;
    if (column < seg.startColumn) {
      hi = mid - 1;
    } else if (column >= seg.endColumn) {
      lo = mid + 1;
    } else {
      return seg.languageId;
    }
  }
  // Caret sitting right at the exclusive end of an embedded segment (e.g. end of line inside <script>)
  if (hi >= 0) {
    const prev = segments[hi]!;
    if (column === prev.endColumn) return prev.languageId;
  }
  return rootLanguageId;
}

/**
 * Delegate a slice of a line (`text`, starting at 0-based offset `offset0`) to a registered
 * embedded language tokenizer, shifting all returned token columns cleanly.
 */
export function delegateEmbeddedSlice(
  embeddedLangId: string,
  text: string,
  offset0: number,
  innerState: unknown,
  tokensOut: MonoToken[],
  options?: TokenizeLineOptions,
): unknown {
  if (!text.length) return innerState;
  const provider = languages.getTokensProvider(embeddedLangId);
  if (!provider) {
    tokensOut.push({
      startColumn: offset0 + 1,
      endColumn: offset0 + text.length + 1,
      type: 'plain',
    });
    return innerState;
  }
  const initState = innerState === undefined ? provider.getInitialState() : innerState;
  const res = provider.tokenizeLine(text, initState, options);
  for (const tok of res.tokens) {
    tokensOut.push({
      startColumn: tok.startColumn + offset0,
      endColumn: tok.endColumn + offset0,
      type: tok.type,
    });
  }
  return res.endState;
}

/** Emit a string range while highlighting escape sequences (`\n`, `\uXXXX`, `\\`, etc.). */
export function emitStringWithEscapes(
  line: string,
  start0: number,
  end0: number,
  tokensOut: MonoToken[],
  baseType: MonoTokenType = 'string',
): void {
  let segStart = start0;
  let i = start0;
  while (i < end0) {
    if (line[i] === '\\' && i + 1 < end0) {
      if (i > segStart) {
        tokensOut.push({ startColumn: segStart + 1, endColumn: i + 1, type: baseType });
      }
      let escEnd = i + 2;
      const next = line[i + 1];
      if (next === 'u') {
        if (line[i + 2] === '{') {
          const close = line.indexOf('}', i + 3);
          if (close > i + 2 && close < end0) escEnd = close + 1;
        } else if (i + 6 <= end0 && /^[0-9a-fA-F]{4}$/.test(line.slice(i + 2, i + 6))) {
          escEnd = i + 6;
        }
      } else if (next === 'x' && i + 4 <= end0 && /^[0-9a-fA-F]{2}$/.test(line.slice(i + 2, i + 4))) {
        escEnd = i + 4;
      }
      tokensOut.push({ startColumn: i + 1, endColumn: escEnd + 1, type: 'stringEscape' });
      i = escEnd;
      segStart = i;
      continue;
    }
    i++;
  }
  if (segStart < end0) {
    tokensOut.push({ startColumn: segStart + 1, endColumn: end0 + 1, type: baseType });
  }
}

/**
 * Advances across a contiguous non-ASCII / Unicode run (Indic conjuncts, Arabic/Urdu,
 * combining marks, surrogate pairs, ZWJ/emoji sequences) so tokenizers never split
 * complex scripts or surrogate pairs across single-UTF-16-code-unit tokens.
 */
export function scanNonAsciiRun(line: string, start: number, len: number): number {
  let j = start;
  while (j < len && line.charCodeAt(j) > 0x7f) j++;
  return j;
}

/**
 * Detects an emoji keycap sequence (`[0-9#*]\uFE0F?\u20E3`) starting at `i`
 * and returns its exclusive end offset, or `-1` otherwise.
 */
export function scanKeycapEmojiEnd(line: string, i: number, len: number): number {
  const ch = line.charCodeAt(i);
  if (!((ch >= 48 && ch <= 57) || ch === 35 || ch === 42)) return -1;
  let k = i + 1;
  if (k < len && line.charCodeAt(k) === 0xfe0f) k++;
  if (k < len && line.charCodeAt(k) === 0x20e3) return k + 1;
  return -1;
}
