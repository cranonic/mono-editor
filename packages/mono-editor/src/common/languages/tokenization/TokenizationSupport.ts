import type { ModelChange, TextModel } from '../../model/TextModel';
import { findLanguageInSegments } from './monarchEngine';
import type { LanguageSegment, MonoToken } from './tokenTypes';
import {
  DEFAULT_MAX_TOKENIZATION_LINE_LENGTH,
  DEFAULT_MAX_TOKENIZATION_LINE_TIME_MS,
  languages,
  type MonoTokensProvider,
} from './TokensProvider';

/** "not computed yet" marker for end-states (distinct from any real state value) */
const UNSET = Symbol('unset');

/** Above this many inserted lines we drop the cache and rebuild lazily. */
const MAX_INCREMENTAL_LINES = 4096;

interface LineCache {
  model: TextModel;
  versionId: number;
  languageId: string;
  provider: MonoTokensProvider;
  /**
   * states[i] = tokenizer state BEFORE line i+1 (= end state of line i).
   * For Monarch/interned providers this is a compact integer ID (O(1) `===` check).
   */
  states: unknown[];
  /** tokens per line; null = this line needs (re)tokenizing */
  tokens: (MonoToken[] | null)[];
  /** optional compact embedded language segments per line (null = uniform root language) */
  languageSegments: (LanguageSegment[] | null)[];
  /** First 0-based line index that may be stale. Infinity = everything is up to date. */
  dirty: number;
  /** How many entries of `tokens` are null (lets us stop early without scanning) */
  nulls: number;
}

function sameState(a: unknown, b: unknown): boolean {
  // Fast O(1) path for interned integer state IDs & primitives
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export interface TokenizationLimits {
  maxTokenizationLineLength?: number;
  maxTokenizationLineTimeMs?: number;
}

/**
 * Per-line token cache with multiline interned state (block comments, nested template
 * strings, HTML embedded <style>/<script>, Markdown fenced code blocks).
 *
 *  - Lazy: only lines up to the requested line are tokenized.
 *  - Incremental: edits mark touched lines dirty; re-tokenization halts in O(1) the
 *    moment a line produces the same interned state ID it had before.
 *  - Safe: enforces `maxTokenizationLineLength` and a per-line regex time budget.
 */
export class TokenizationSupport {
  private cache: LineCache | null = null;
  private maxLineLength = DEFAULT_MAX_TOKENIZATION_LINE_LENGTH;
  private timeBudgetMs = DEFAULT_MAX_TOKENIZATION_LINE_TIME_MS;

  /** Configure safety limits (clears cache if changed). */
  setLimits(limits: TokenizationLimits): void {
    const nextLen =
      limits.maxTokenizationLineLength !== undefined
        ? Math.max(256, Math.floor(limits.maxTokenizationLineLength))
        : this.maxLineLength;
    const nextMs =
      limits.maxTokenizationLineTimeMs !== undefined
        ? Math.max(1, limits.maxTokenizationLineTimeMs)
        : this.timeBudgetMs;
    if (nextLen !== this.maxLineLength || nextMs !== this.timeBudgetMs) {
      this.maxLineLength = nextLen;
      this.timeBudgetMs = nextMs;
      this.cache = null;
    }
  }

  getLimits(): { maxTokenizationLineLength: number; maxTokenizationLineTimeMs: number } {
    return {
      maxTokenizationLineLength: this.maxLineLength,
      maxTokenizationLineTimeMs: this.timeBudgetMs,
    };
  }

  /** Drop everything (language change, provider change, unknown edit). */
  invalidate(): void {
    this.cache = null;
  }

  /**
   * Feed a model edit. Cheap: splices the cache arrays and marks the first
   * touched line dirty; no tokenizing happens here.
   */
  applyChange(change: ModelChange | undefined, versionId: number): void {
    const c = this.cache;
    if (!c) return;
    if (c.versionId >= versionId) return;
    if (c.versionId !== versionId - 1) {
      this.cache = null;
      return;
    }
    if (
      !change ||
      change.full ||
      change.newLineCount > MAX_INCREMENTAL_LINES ||
      change.oldLineCount > MAX_INCREMENTAL_LINES
    ) {
      this.cache = null;
      return;
    }
    const s = change.startLine - 1;
    const removed = c.tokens.splice(
      s,
      change.oldLineCount,
      ...new Array<MonoToken[] | null>(change.newLineCount).fill(null),
    );
    for (const r of removed) if (r === null) c.nulls--;
    c.nulls += change.newLineCount;
    c.languageSegments.splice(
      s,
      change.oldLineCount,
      ...new Array<LanguageSegment[] | null>(change.newLineCount).fill(null),
    );
    c.states.splice(
      s + 1,
      change.oldLineCount,
      ...new Array<unknown>(change.newLineCount).fill(UNSET),
    );
    if (c.dirty > s) c.dirty = s;
    c.versionId = versionId;
  }

  getLineTokens(model: TextModel, lineNumber: number): MonoToken[] {
    const provider = languages.getTokensProvider(model.getLanguageId());
    if (!provider) return [];
    const c = this.ensureCache(model, provider);
    this.pump(model, c, lineNumber);
    return c.tokens[lineNumber - 1] ?? [];
  }

  /** Compact per-line embedded language segments (null when entire line is root language). */
  getLineLanguageSegments(
    model: TextModel,
    lineNumber: number,
  ): readonly LanguageSegment[] | null {
    const provider = languages.getTokensProvider(model.getLanguageId());
    if (!provider) return null;
    const c = this.ensureCache(model, provider);
    this.pump(model, c, lineNumber);
    return c.languageSegments[lineNumber - 1] ?? null;
  }

  /**
   * Resolves the effective languageId at `(lineNumber, column)` using O(log k) binary search
   * over the line's compact LanguageSegment array (e.g. 'css' inside HTML `<style>`,
   * 'javascript'/'typescript' inside `<script>`, or fenced language inside Markdown).
   */
  getLanguageIdAtPosition(model: TextModel, lineNumber: number, column: number): string {
    const rootLang = model.getLanguageId();
    const clampedLine = Math.max(1, Math.min(model.getLineCount(), lineNumber));
    const segments = this.getLineLanguageSegments(model, clampedLine);
    return findLanguageInSegments(segments, column, rootLang);
  }

  /** Expose interned end-state for lineNumber (used in fuzz & incremental equivalence tests). */
  getLineEndState(model: TextModel, lineNumber: number): unknown {
    const provider = languages.getTokensProvider(model.getLanguageId());
    if (!provider) return undefined;
    const c = this.ensureCache(model, provider);
    this.pump(model, c, lineNumber);
    return c.states[lineNumber];
  }

  private ensureCache(model: TextModel, provider: MonoTokensProvider): LineCache {
    const c = this.cache;
    const lineCount = model.getLineCount();
    if (
      c &&
      c.model === model &&
      c.versionId === model.getVersionId() &&
      c.languageId === model.getLanguageId() &&
      c.provider === provider &&
      c.tokens.length === lineCount
    ) {
      return c;
    }
    const states: unknown[] = new Array(lineCount + 1).fill(UNSET);
    states[0] = provider.getInitialState();
    const fresh: LineCache = {
      model,
      versionId: model.getVersionId(),
      languageId: model.getLanguageId(),
      provider,
      states,
      tokens: new Array<MonoToken[] | null>(lineCount).fill(null),
      languageSegments: new Array<LanguageSegment[] | null>(lineCount).fill(null),
      dirty: 0,
      nulls: lineCount,
    };
    this.cache = fresh;
    return fresh;
  }

  private pump(model: TextModel, c: LineCache, upToLine: number): void {
    const n = c.tokens.length;
    const limit = Math.min(Math.max(1, upToLine), n);
    const opts = {
      maxLineLength: this.maxLineLength,
      timeBudgetMs: this.timeBudgetMs,
    };

    while (c.dirty < limit) {
      const i = c.dirty;
      const lineText = model.getLineContent(i + 1);
      let tokens: MonoToken[];
      let endState: unknown;
      let segs: LanguageSegment[] | null = null;

      if (lineText.length > this.maxLineLength) {
        // Safety cap: skip expensive tokenization on minified / ultra-long lines
        tokens = lineText.length
          ? [{ startColumn: 1, endColumn: lineText.length + 1, type: 'plain' }]
          : [];
        endState = c.states[i];
      } else {
        const res = c.provider.tokenizeLine(lineText, c.states[i], opts);
        tokens = res.tokens;
        endState = res.endState;
        segs = res.languageSegments && res.languageSegments.length ? res.languageSegments : null;
      }

      const oldEnd = c.states[i + 1];
      if (c.tokens[i] === null) c.nulls--;
      c.tokens[i] = tokens;
      c.languageSegments[i] = segs;
      c.states[i + 1] = endState;

      if (i + 1 >= n) {
        c.dirty = Infinity;
        break;
      }
      if (c.tokens[i + 1] !== null && (oldEnd === UNSET || !sameState(oldEnd, endState))) {
        c.tokens[i + 1] = null;
        c.languageSegments[i + 1] = null;
        c.nulls++;
      }
      c.dirty =
        c.tokens[i + 1] === null ? i + 1 : c.nulls === 0 ? Infinity : this.nextNull(c, i + 1);
    }
  }

  private nextNull(c: LineCache, from: number): number {
    const t = c.tokens;
    for (let j = from; j < t.length; j++) if (t[j] === null) return j;
    return Infinity;
  }
}
