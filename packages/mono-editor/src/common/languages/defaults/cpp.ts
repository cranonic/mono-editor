import { createRegexTokensProvider } from '../tokenization/createRegexTokensProvider';
import type { MonoTokensProvider } from '../tokenization/TokensProvider';

const CPP_KEYWORDS = [
  'alignas', 'alignof', 'and', 'asm', 'auto', 'bool', 'break', 'case', 'catch',
  'char', 'char8_t', 'char16_t', 'char32_t', 'class', 'concept', 'const',
  'consteval', 'constexpr', 'constinit', 'const_cast', 'continue', 'co_await',
  'co_return', 'co_yield', 'decltype', 'default', 'delete', 'do', 'double',
  'dynamic_cast', 'else', 'enum', 'explicit', 'export', 'extern', 'false',
  'float', 'for', 'friend', 'goto', 'if', 'inline', 'int', 'long', 'mutable',
  'namespace', 'new', 'noexcept', 'not', 'nullptr', 'operator', 'or', 'private',
  'protected', 'public', 'register', 'reinterpret_cast', 'requires', 'return',
  'short', 'signed', 'sizeof', 'static', 'static_assert', 'static_cast',
  'struct', 'switch', 'template', 'this', 'thread_local', 'throw', 'true',
  'try', 'typedef', 'typeid', 'typename', 'union', 'unsigned', 'using',
  'virtual', 'void', 'volatile', 'wchar_t', 'while', 'override', 'final',
];

/** State: 0 normal, 1 block comment */
export function createCppTokensProvider(languageId = 'cpp'): MonoTokensProvider {
  return createRegexTokensProvider({
    languageId,
    keywords: CPP_KEYWORDS,
    initialState: 0,
    rules: [
      // block comment continue
      { pattern: /[\s\S]*?\*\//, type: 'comment', whenState: 1, nextState: 0 },
      { pattern: /[\s\S]+/, type: 'comment', whenState: 1, nextState: 1 },
      // line comment
      { pattern: /\/\/.*/, type: 'comment' },
      // block comment
      { pattern: /\/\*[\s\S]*?\*\//, type: 'comment' },
      { pattern: /\/\*[\s\S]*/, type: 'comment', nextState: 1 },
      // preprocessor directives
      { pattern: /#\s*(?:include|define|undef|ifdef|ifndef|if|elif|else|endif|pragma|error|warning|line)\b/, type: 'keyword' },
      // angle-bracket include path
      { pattern: /<[A-Za-z0-9_./+-]+>/, type: 'string' },
      // strings and chars
      { pattern: /(?:u8|u|U|L)?"(?:\\.|[^"\\])*"/, type: 'string' },
      { pattern: /(?:u8|u|U|L)?'(?:\\.|[^'\\])*'/, type: 'string' },
      // numbers
      { pattern: /0[xX][0-9a-fA-F']+[uUlL]*/, type: 'number' },
      { pattern: /0[bB][01']+[uUlL]*/, type: 'number' },
      { pattern: /(?:\d[\d']*\.?[\d']*|\.\d[\d']*)(?:[eE][+-]?\d+)?[fFlLuU]*/, type: 'number' },
      // standard library & fixed-width types / PascalCase types
      { pattern: /\b(?:size_t|ptrdiff_t|intptr_t|uintptr_t|u?int(?:8|16|32|64)_t|string|string_view|vector|map|unordered_map|set|unordered_set|pair|tuple|optional|variant|shared_ptr|unique_ptr|weak_ptr|array|span|ostream|istream|FILE|[A-Z][A-Za-z0-9_]*)\b/, type: 'type' },
      // operators
      { pattern: /->\*?|::|<<=|>>=|<<|>>|<=>|==|!=|<=|>=|&&|\|\||\+\+|--|[+\-*/%&|^~<>!?]=?/, type: 'operator' },
    ],
  });
}
