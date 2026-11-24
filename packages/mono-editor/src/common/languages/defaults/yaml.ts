import { createRegexTokensProvider } from '../tokenization/createRegexTokensProvider';
import type { MonoTokensProvider } from '../tokenization/TokensProvider';

const YAML_KEYWORDS = ['true', 'false', 'null', 'yes', 'no', 'on', 'off', 'True', 'False', 'Null', 'NULL', 'TRUE', 'FALSE'];

export function createYamlTokensProvider(languageId = 'yaml'): MonoTokensProvider {
  return createRegexTokensProvider({
    languageId,
    keywords: YAML_KEYWORDS,
    initialState: 0,
    rules: [
      // comments
      { pattern: /#.*/, type: 'comment' },
      // document markers
      { pattern: /^(?:---|\.\.\.)(?=\s|$)/, type: 'keyword' },
      // anchors & aliases
      { pattern: /[&*][A-Za-z0-9_-]+/, type: 'type' },
      // tags (e.g. !!str)
      { pattern: /!!?[A-Za-z0-9_/-]+/, type: 'attribute' },
      // strings
      { pattern: /"(?:\\.|[^"\\])*"/, type: 'string' },
      { pattern: /'(?:''|[^'])*'/, type: 'string' },
      // mapping keys before colon
      { pattern: /[A-Za-z0-9_.-]+(?=\s*:(?:\s|$))/, type: 'property' },
      // numbers / ISO dates
      { pattern: /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/, type: 'number' },
      { pattern: /0[xX][0-9a-fA-F]+/, type: 'number' },
      { pattern: /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/, type: 'number' },
      // list dash, block scalar indicators, colon
      { pattern: /[:?|>-]/, type: 'operator' },
    ],
  });
}
