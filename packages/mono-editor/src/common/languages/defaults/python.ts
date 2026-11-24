import { createRegexTokensProvider } from '../tokenization/createRegexTokensProvider';
import type { MonoTokensProvider } from '../tokenization/TokensProvider';

const CONTROL_KW = [
  'if', 'elif', 'else', 'for', 'while', 'break', 'continue', 'return', 'yield',
  'try', 'except', 'finally', 'raise', 'with', 'as', 'import', 'from', 'pass',
  'match', 'case', 'await', 'assert',
];

const STORAGE_KW = [
  'def', 'class', 'lambda', 'async', 'global', 'nonlocal', 'del', 'in', 'is',
  'not', 'and', 'or',
];

const BOOLEANS = ['True', 'False', 'None'];

/** State: 0 normal, 1 triple double-quote string, 2 triple single-quote string */
export function createPythonTokensProvider(languageId = 'python'): MonoTokensProvider {
  return createRegexTokensProvider({
    languageId,
    keywords: STORAGE_KW,
    controlKeywords: CONTROL_KW,
    booleans: BOOLEANS,
    highlightFunctionCalls: true,
    highlightTypes: true,
    initialState: 0,
    rules: [
      // multiline triple-quoted strings
      { pattern: /[\s\S]*?"""/, type: 'string', whenState: 1, nextState: 0 },
      { pattern: /[\s\S]+/, type: 'string', whenState: 1, nextState: 1 },
      { pattern: /[\s\S]*?'''/, type: 'string', whenState: 2, nextState: 0 },
      { pattern: /[\s\S]+/, type: 'string', whenState: 2, nextState: 2 },
      // comments
      { pattern: /#.*/, type: 'comment' },
      // decorators
      { pattern: /@[A-Za-z_][\w.]*/, type: 'decorator' },
      // triple-quoted strings (single-line or opening multiline)
      { pattern: /[furbFURB]{0,2}"""[\s\S]*?"""/, type: 'string' },
      { pattern: /[furbFURB]{0,2}'''[\s\S]*?'''/, type: 'string' },
      { pattern: /[furbFURB]{0,2}"""[\s\S]*/, type: 'string', nextState: 1 },
      { pattern: /[furbFURB]{0,2}'''[\s\S]*/, type: 'string', nextState: 2 },
      // regular & prefixed strings
      { pattern: /[furbFURB]{0,2}"(?:\\.|[^"\\])*"/, type: 'string' },
      { pattern: /[furbFURB]{0,2}'(?:\\.|[^'\\])*'/, type: 'string' },
      // numbers
      { pattern: /0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+/, type: 'number' },
      { pattern: /(?:\d[\d_]*\.?\d*|\.\d[\d_]*)(?:[eE][+-]?\d+)?j?/, type: 'number' },
      // operators
      { pattern: /==|!=|<=|>=|:=|->|\/\/|\*\*|[+\-*/%@<>=&|^~]/, type: 'operator' },
    ],
  });
}
