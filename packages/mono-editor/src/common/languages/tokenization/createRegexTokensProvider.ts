import { isOverTimeBudget, nowMs, resolveLineBudget } from './monarchEngine';
import type { MonoToken, MonoTokenType } from './tokenTypes';
import type { LineTokenizeResult, MonoTokensProvider, TokenizeLineOptions } from './TokensProvider';

export interface RegexRule {
  /** JS regex; we advance manually with lastIndex */
  pattern: RegExp;
  type: MonoTokenType;
  /** if set, transitions state after match */
  nextState?: unknown;
  /** only active when state equals this (default: any) */
  whenState?: unknown;
}

export interface RegexProviderOptions {
  languageId: string;
  rules: RegexRule[];
  /** keywords matched as whole words after other rules miss */
  keywords?: string[];
  /** optional control-flow keywords (colored with 'keywordControl') */
  controlKeywords?: string[];
  /** optional boolean/nullish literals (colored with 'boolean') */
  booleans?: string[];
  /** if true, identifiers immediately followed by '(' emit 'function' */
  highlightFunctionCalls?: boolean;
  /** if true, PascalCase identifiers emit 'type' */
  highlightTypes?: boolean;
  keywordType?: MonoTokenType;
  initialState?: unknown;
}

/**
 * Helper for host apps and built-in languages without needing a custom state stack.
 * Enforces `maxLineLength` and a per-line regex wall-clock time budget.
 */
export function createRegexTokensProvider(opts: RegexProviderOptions): MonoTokensProvider {
  const keywordSet = new Set(opts.keywords ?? []);
  const controlSet = new Set(opts.controlKeywords ?? []);
  const booleanSet = new Set(opts.booleans ?? []);
  const keywordType = opts.keywordType ?? 'keyword';
  const initial = opts.initialState ?? 0;

  const rules = opts.rules.map((r) => ({
    ...r,
    pattern: new RegExp(
      r.pattern.source,
      r.pattern.flags.includes('g') ? r.pattern.flags : r.pattern.flags + 'g',
    ),
  }));

  return {
    languageId: opts.languageId,
    getInitialState: () => initial,
    tokenizeLine(
      line: string,
      state: unknown,
      options?: TokenizeLineOptions,
    ): LineTokenizeResult {
      const { maxLineLength, timeBudgetMs } = resolveLineBudget(options);
      const len = line.length;
      let cur: unknown = state ?? initial;
      if (len === 0) return { tokens: [], endState: cur };
      if (len > maxLineLength) {
        return {
          tokens: [{ startColumn: 1, endColumn: len + 1, type: 'plain' }],
          endState: cur,
        };
      }

      const tokens: MonoToken[] = [];
      const startMs = nowMs();
      let i = 0;
      let steps = 0;

      while (i < len) {
        if (isOverTimeBudget(startMs, timeBudgetMs, ++steps)) {
          tokens.push({ startColumn: i + 1, endColumn: len + 1, type: 'plain' });
          break;
        }

        if (cur === initial && /\s/.test(line[i]!)) {
          i++;
          continue;
        }

        let matched = false;
        for (const rule of rules) {
          if (rule.whenState !== undefined && rule.whenState !== cur) continue;
          rule.pattern.lastIndex = i;
          const m = rule.pattern.exec(line);
          if (!m || m.index !== i || m[0].length === 0) continue;
          const start = i;
          const end = i + m[0].length;
          tokens.push({
            startColumn: start + 1,
            endColumn: end + 1,
            type: rule.type,
          });
          i = end;
          if (rule.nextState !== undefined) cur = rule.nextState;
          matched = true;
          break;
        }
        if (matched) continue;

        if (/\s/.test(line[i]!)) {
          i++;
          continue;
        }

        if (/[A-Za-z_$]/.test(line[i]!)) {
          let j = i + 1;
          while (j < len && /[A-Za-z0-9_$]/.test(line[j]!)) j++;
          const word = line.slice(i, j);
          let type: MonoTokenType = 'variable';
          if (controlSet.has(word)) {
            type = 'keywordControl';
          } else if (booleanSet.has(word)) {
            type = 'boolean';
          } else if (keywordSet.has(word)) {
            type = keywordType;
          } else if (opts.highlightFunctionCalls && line[j] === '(') {
            type = 'function';
          } else if (
            opts.highlightTypes &&
            word.length > 1 &&
            word[0]! >= 'A' &&
            word[0]! <= 'Z' &&
            /[a-z]/.test(word)
          ) {
            type = 'type';
          }
          tokens.push({ startColumn: i + 1, endColumn: j + 1, type });
          i = j;
          continue;
        }

        tokens.push({ startColumn: i + 1, endColumn: i + 2, type: 'punctuation' });
        i++;
      }

      return { tokens, endState: cur };
    },
  };
}
