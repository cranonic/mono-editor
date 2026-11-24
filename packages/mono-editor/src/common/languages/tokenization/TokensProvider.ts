import type { LanguageSegment, MonoToken } from './tokenTypes';

export const DEFAULT_MAX_TOKENIZATION_LINE_LENGTH = 20_000;
export const DEFAULT_MAX_TOKENIZATION_LINE_TIME_MS = 16;

export interface TokenizeLineOptions {
  /** Skip regex tokenization on lines longer than this length (fallback to 'plain'). */
  maxLineLength?: number;
  /** Soft wall-clock budget per line (ms) to guard against catastrophic backtracking. */
  timeBudgetMs?: number;
}

export interface LineTokenizeResult {
  tokens: MonoToken[];
  endState: unknown;
  /** Optional compact embedded language spans for mixed-language documents (HTML, Markdown). */
  languageSegments?: LanguageSegment[];
}

/**
 * Expandable tokenization API (Monaco/VS Code style).
 *
 * Implement for any language and register via `languages.registerTokensProvider`.
 * `state` carries multiline context (interned integer state ID recommended for O(1) equality).
 */
export interface MonoTokensProvider {
  /** Language id, e.g. 'javascript', 'python' */
  languageId: string;
  getInitialState(): unknown;
  /**
   * Tokenize one line.
   * @param line full line text (no trailing \\n)
   * @param state end-state from previous line
   * @param options safety caps (line length, regex time budget)
   */
  tokenizeLine(
    line: string,
    state: unknown,
    options?: TokenizeLineOptions,
  ): LineTokenizeResult;
}

type ProviderMap = Map<string, MonoTokensProvider>;

const providers: ProviderMap = new Map();

export const languages = {
  registerTokensProvider(provider: MonoTokensProvider): { dispose: () => void } {
    const id = provider.languageId;
    providers.set(id, provider);
    return {
      dispose: () => {
        if (providers.get(id) === provider) providers.delete(id);
      },
    };
  },

  getTokensProvider(languageId: string): MonoTokensProvider | undefined {
    return providers.get(languageId);
  },

  getRegisteredLanguageIds(): string[] {
    return [...providers.keys()];
  },

  /** Replace all providers (tests / host reset). */
  clearTokensProviders(): void {
    providers.clear();
  },
};
