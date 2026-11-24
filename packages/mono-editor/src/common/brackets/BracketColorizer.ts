import type { TextModel } from '../model/TextModel';
import type { MonoToken, MonoTokenType } from '../languages/tokenization/tokenTypes';
import { StateInterner } from '../languages/tokenization/stateInterner';
import {
  DEFAULT_BRACKET_COLORIZATION_OPTIONS,
  resolveBracketColorizationOptions,
  type BracketPairColorizationOptions,
  type LineBracketColor,
} from './bracketColorizerTypes';

/** Token types whose interior brackets are literal text, not code syntax. */
const SKIP_TOKEN_TYPES: ReadonlySet<MonoTokenType> = new Set<MonoTokenType>([
  'comment',
  'string',
  'stringEscape',
  'regexp',
]);

/** Max stack depth kept per line state to bound memory on pathological input. */
const MAX_STACK_DEPTH = 256;

interface StackState {
  /** Encoded stack entries: `(pairIdx << 16) | level`. */
  readonly stack: readonly number[];
  /** Per-pair-type open counts (used when `independentColorPoolPerBracketType` is true). */
  readonly counts: readonly number[];
}

const EMPTY_BRACKETS: readonly LineBracketColor[] = [];

function stateKey(stack: readonly number[], counts: readonly number[], independent: boolean): string {
  const s = stack.length === 0 ? '' : stack.join(',');
  if (!independent) return s;
  return `${s}|${counts.join(',')}`;
}

export type LineTokensLookup = (lineNumber: number) => readonly MonoToken[];

/**
 * Incremental, token-aware, 5-level Rainbow Bracket Pair Colorizer.
 *
 * - Uses hash-consed interned integer state IDs (`StateInterner`) for O(1)
 *   per-line convergence when editing.
 * - Skips brackets inside `comment`, `string`, `stringEscape`, and `regexp` tokens
 *   while colorizing brackets inside template literal `${...}` expressions.
 * - Enforces large-file cutoffs (`maxLines`, `maxLineLength`) to guarantee
 *   60fps responsiveness on 50k+ line files.
 */
export class BracketColorizer {
  private rawOptions: Partial<BracketPairColorizationOptions> = {};
  private resolved: BracketPairColorizationOptions = { ...DEFAULT_BRACKET_COLORIZATION_OPTIONS };
  private languageId = 'plaintext';
  private modelRef: TextModel | null = null;
  private modelVersion = -1;

  private readonly interner = new StateInterner<StackState>(16_384);
  private initialStateId = 0;

  private lineCache: (readonly LineBracketColor[] | undefined)[] = [];
  private endStates: (number | undefined)[] = [];
  private validUpTo = 0;

  private openMap = new Map<string, number>();
  private closeMap = new Map<string, number>();

  constructor(options?: Partial<BracketPairColorizationOptions>, languageId = 'plaintext') {
    this.languageId = languageId;
    this.setOptions(options);
  }

  getOptions(): BracketPairColorizationOptions {
    return this.resolved;
  }

  setOptions(options?: Partial<BracketPairColorizationOptions>): void {
    this.rawOptions = options ? { ...options } : {};
    this.rebuildConfig();
  }

  setLanguageId(languageId: string): void {
    if (this.languageId === languageId) return;
    this.languageId = languageId;
    this.rebuildConfig();
  }

  private rebuildConfig(): void {
    this.resolved = resolveBracketColorizationOptions(this.rawOptions, this.languageId);
    this.openMap.clear();
    this.closeMap.clear();
    this.resolved.pairs.forEach(([open, close], idx) => {
      if (open.length === 1 && close.length === 1 && open !== close) {
        this.openMap.set(open, idx);
        this.closeMap.set(close, idx);
      }
    });
    const zeroCounts = new Array<number>(this.resolved.pairs.length).fill(0);
    this.initialStateId = this.interner.intern(
      stateKey([], zeroCounts, this.resolved.independentColorPoolPerBracketType),
      () => ({ stack: [], counts: zeroCounts }),
    );
    this.invalidateAll();
  }

  invalidateAll(): void {
    this.lineCache.length = 0;
    this.endStates.length = 0;
    this.validUpTo = 0;
    this.modelRef = null;
    this.modelVersion = -1;
  }

  /**
   * Invalidate from `startLine` (1-based) onward. Existing end-states at lines
   * >= `startLine` are preserved in `endStates` only when line counts did not shift,
   * allowing O(1) convergence during same-line typing; structural line changes clear
   * the tail safely.
   */
  applyChange(startLine: number, lineDelta = 0, versionId?: number): void {
    const idx = Math.max(0, startLine - 1);
    if (lineDelta !== 0) {
      this.lineCache.length = Math.min(this.lineCache.length, idx);
      this.endStates.length = Math.min(this.endStates.length, idx);
    } else {
      for (let i = idx; i < this.lineCache.length; i++) {
        this.lineCache[i] = undefined;
      }
    }
    this.validUpTo = Math.min(this.validUpTo, idx);
    if (versionId !== undefined) this.modelVersion = versionId;
  }

  /**
   * Returns 0-based column bracket color entries for 1-based `lineNumber`.
   * Returns an empty array when disabled, cut off by large-file limits, or
   * when no brackets appear on the line.
   */
  getLineBrackets(
    model: TextModel,
    lineNumber: number,
    getLineTokens?: LineTokensLookup,
  ): readonly LineBracketColor[] {
    const cfg = this.resolved;
    if (!cfg.enabled || this.openMap.size === 0) return EMPTY_BRACKETS;

    const lineCount = model.getLineCount();
    if (lineCount > cfg.maxLines) return EMPTY_BRACKETS;
    if (lineNumber < 1 || lineNumber > lineCount) return EMPTY_BRACKETS;

    // Detect model switch or external edit if caller did not call applyChange.
    const ver = model.getVersionId();
    if (this.modelRef !== model) {
      this.invalidateAll();
      this.modelRef = model;
    } else if (this.modelVersion !== -1 && this.modelVersion !== ver && this.validUpTo >= lineNumber) {
      this.invalidateAll();
      this.modelRef = model;
    }
    this.modelVersion = ver;

    const targetIdx = lineNumber - 1;
    if (targetIdx < this.validUpTo && this.lineCache[targetIdx] !== undefined) {
      return this.lineCache[targetIdx]!;
    }

    this.ensureUpTo(model, lineNumber, getLineTokens);
    return this.lineCache[targetIdx] ?? EMPTY_BRACKETS;
  }

  /** Returns the resolved palette color for a given `LineBracketColor`. */
  resolveColor(
    entry: LineBracketColor,
    themeRainbowColors: readonly string[],
    themeUnexpectedColor: string,
  ): string {
    if (entry.unexpected) {
      return this.resolved.unexpectedColor ?? themeUnexpectedColor;
    }
    const palette =
      this.resolved.colors && this.resolved.colors.length > 0
        ? this.resolved.colors
        : themeRainbowColors;
    if (palette.length === 0) return themeUnexpectedColor;
    const clampedLevel = ((entry.level % this.resolved.maxLevels) + this.resolved.maxLevels) % this.resolved.maxLevels;
    return palette[clampedLevel % palette.length];
  }

  private ensureUpTo(
    model: TextModel,
    targetLine: number,
    getLineTokens?: LineTokensLookup,
  ): void {
    const lineCount = model.getLineCount();
    const limit = Math.min(targetLine, lineCount);
    const startIdx = Math.max(0, this.validUpTo);

    for (let i = startIdx; i < limit; i++) {
      const startStateId = i === 0 ? this.initialStateId : (this.endStates[i - 1] ?? this.initialStateId);
      const prevEndStateId = this.endStates[i];
      const lineText = model.getLineContent(i + 1);
      const tokens = getLineTokens ? getLineTokens(i + 1) : undefined;

      const { brackets, endStateId } = this.scanLine(lineText, startStateId, tokens);
      this.lineCache[i] = brackets;
      this.endStates[i] = endStateId;

      // O(1) integer convergence: if a same-line edit didn't change the end stack state
      // and subsequent cached lines already exist, stop early when past the edited line.
      if (
        prevEndStateId !== undefined &&
        prevEndStateId === endStateId &&
        i + 1 < this.lineCache.length &&
        this.lineCache[i + 1] !== undefined
      ) {
        // Fast-forward validUpTo across remaining intact cached lines.
        let next = i + 1;
        while (next < lineCount && this.lineCache[next] !== undefined && this.endStates[next] !== undefined) {
          next++;
        }
        this.validUpTo = next;
        if (this.validUpTo >= limit) return;
        i = next - 1;
        continue;
      }
    }

    if (limit > this.validUpTo) {
      this.validUpTo = limit;
    }
  }

  private scanLine(
    line: string,
    startStateId: number,
    tokens?: readonly MonoToken[],
  ): { brackets: readonly LineBracketColor[]; endStateId: number } {
    const cfg = this.resolved;
    if (line.length === 0 || line.length > cfg.maxLineLength) {
      return { brackets: EMPTY_BRACKETS, endStateId: startStateId };
    }

    const startState = this.interner.get(startStateId);
    const stack = startState ? startState.stack.slice() : [];
    const counts = startState
      ? startState.counts.slice()
      : new Array<number>(cfg.pairs.length).fill(0);

    const independent = cfg.independentColorPoolPerBracketType;
    const maxLevels = cfg.maxLevels;
    const result: LineBracketColor[] = [];

    let tokIdx = 0;
    const tokLen = tokens ? tokens.length : 0;

    for (let col = 0; col < line.length; col++) {
      const ch = line[col];
      const openIdx = this.openMap.get(ch);
      const closeIdx = openIdx === undefined ? this.closeMap.get(ch) : undefined;
      if (openIdx === undefined && closeIdx === undefined) continue;

      // Token-aware filter: skip brackets inside comment, string, stringEscape, regexp.
      if (tokens && tokLen > 0) {
        const col1 = col + 1;
        while (tokIdx < tokLen && tokens[tokIdx].endColumn <= col1) {
          tokIdx++;
        }
        if (tokIdx < tokLen) {
          const tok = tokens[tokIdx];
          if (col1 >= tok.startColumn && col1 < tok.endColumn && SKIP_TOKEN_TYPES.has(tok.type)) {
            continue;
          }
        }
      }

      if (openIdx !== undefined) {
        const depth = independent ? counts[openIdx] : stack.length;
        const level = depth % maxLevels;
        if (stack.length < MAX_STACK_DEPTH) {
          stack.push((openIdx << 16) | level);
        }
        counts[openIdx] = (counts[openIdx] ?? 0) + 1;
        result.push({ column: col, level, unexpected: false });
      } else if (closeIdx !== undefined) {
        // Look for matching open on top of stack (or small recovery window for single unclosed typo).
        let matchPos = -1;
        const searchFloor = Math.max(0, stack.length - 4);
        for (let s = stack.length - 1; s >= searchFloor; s--) {
          if ((stack[s] >>> 16) === closeIdx) {
            matchPos = s;
            break;
          }
        }

        if (matchPos === -1) {
          result.push({ column: col, level: -1, unexpected: true });
        } else {
          // Pop any intervening unclosed brackets in the recovery window + the matched opener.
          let matchedLevel = 0;
          for (let s = stack.length - 1; s >= matchPos; s--) {
            const entry = stack.pop()!;
            const pIdx = entry >>> 16;
            const lvl = entry & 0xffff;
            if (counts[pIdx] > 0) counts[pIdx]--;
            if (s === matchPos) matchedLevel = lvl;
          }
          result.push({ column: col, level: matchedLevel, unexpected: false });
        }
      }
    }

    const endStateId =
      result.length === 0
        ? startStateId
        : this.interner.intern(stateKey(stack, counts, independent), () => ({
            stack,
            counts,
          }));

    return {
      brackets: result.length > 0 ? result : EMPTY_BRACKETS,
      endStateId,
    };
  }
}
