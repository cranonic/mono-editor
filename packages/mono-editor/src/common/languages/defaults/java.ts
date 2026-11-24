import { createRegexTokensProvider } from '../tokenization/createRegexTokensProvider';
import type { MonoTokensProvider } from '../tokenization/TokensProvider';

const JAVA_KEYWORDS = [
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char',
  'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum',
  'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements',
  'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'null',
  'package', 'private', 'protected', 'public', 'record', 'return', 'sealed',
  'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this',
  'throw', 'throws', 'transient', 'true', 'false', 'try', 'var', 'void',
  'volatile', 'while', 'yield', 'permits', 'non-sealed',
];

/** State: 0 normal, 1 block comment */
export function createJavaTokensProvider(languageId = 'java'): MonoTokensProvider {
  return createRegexTokensProvider({
    languageId,
    keywords: JAVA_KEYWORDS,
    initialState: 0,
    rules: [
      // block comment continue
      { pattern: /[\s\S]*?\*\//, type: 'comment', whenState: 1, nextState: 0 },
      { pattern: /[\s\S]+/, type: 'comment', whenState: 1, nextState: 1 },
      // line comment
      { pattern: /\/\/.*/, type: 'comment' },
      // block / javadoc comment
      { pattern: /\/\*[\s\S]*?\*\//, type: 'comment' },
      { pattern: /\/\*[\s\S]*/, type: 'comment', nextState: 1 },
      // annotations
      { pattern: /@[A-Za-z_]\w*/, type: 'attribute' },
      // text blocks / strings / chars
      { pattern: /"""[\s\S]*?"""/, type: 'string' },
      { pattern: /"(?:\\.|[^"\\])*"/, type: 'string' },
      { pattern: /'(?:\\.|[^'\\])*'/, type: 'string' },
      // numbers
      { pattern: /0[xX][0-9a-fA-F_]+[lL]?/, type: 'number' },
      { pattern: /0[bB][01_]+[lL]?/, type: 'number' },
      { pattern: /(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?[fFdDlL]?/, type: 'number' },
      // PascalCase class/interface/type identifiers
      { pattern: /\b[A-Z][A-Za-z0-9_]*\b/, type: 'type' },
      // operators
      { pattern: /->|::|==|!=|<=|>=|&&|\|\||\+\+|--|[+\-*/%&|^~<>!?]=?/, type: 'operator' },
    ],
  });
}
