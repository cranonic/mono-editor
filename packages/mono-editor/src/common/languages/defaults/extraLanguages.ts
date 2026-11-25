import { createRegexTokensProvider } from '../tokenization/createRegexTokensProvider';
import type { MonoTokensProvider } from '../tokenization/TokensProvider';

/**
 * Phase 8 Extra Built-in Languages — all linear-time, ReDoS-safe regex tokenizers:
 * Rust, Go, Kotlin, Swift, PHP, Ruby, XML, TOML, Dockerfile.
 */

export function createRustTokensProvider(languageId = 'rust'): MonoTokensProvider {
  return createRegexTokensProvider({
    languageId,
    keywords: [
      'as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn', 'else',
      'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop',
      'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return', 'self', 'Self', 'static',
      'struct', 'super', 'trait', 'true', 'type', 'unsafe', 'use', 'where', 'while',
    ],
    initialState: 0,
    rules: [
      { pattern: /[\s\S]*?\*\//, type: 'comment', whenState: 1, nextState: 0 },
      { pattern: /[\s\S]+/, type: 'comment', whenState: 1, nextState: 1 },
      { pattern: /\/\/.*/, type: 'comment' },
      { pattern: /\/\*[\s\S]*?\*\//, type: 'comment' },
      { pattern: /\/\*[\s\S]*/, type: 'comment', nextState: 1 },
      { pattern: /#!?\[[^\]]*\]/, type: 'decorator' },
      { pattern: /b?"(?:\\.|[^"\\])*"/, type: 'string' },
      { pattern: /b?'(?:\\.|[^'\\])'/, type: 'string' },
      { pattern: /'[a-zA-Z_][a-zA-Z0-9_]*/, type: 'type' },
      { pattern: /\b[a-z_][a-z0-9_]*!/, type: 'macro' },
      { pattern: /0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?(?:u8|u16|u32|u64|u128|usize|i8|i16|i32|i64|i128|isize|f32|f64)?/, type: 'number' },
      { pattern: /\b(?:bool|char|str|u8|u16|u32|u64|u128|usize|i8|i16|i32|i64|i128|isize|f32|f64|String|Vec|Option|Result|Box|Rc|Arc|Some|None|Ok|Err|[A-Z][A-Za-z0-9_]*)\b/, type: 'type' },
      { pattern: /=>|->|::|\.\.=?|==|!=|<=|>=|&&|\|\||[+\-*/%&|^!<>]=?/, type: 'operator' },
    ],
  });
}

export function createGoTokensProvider(languageId = 'go'): MonoTokensProvider {
  return createRegexTokensProvider({
    languageId,
    keywords: [
      'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else',
      'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface',
      'map', 'package', 'range', 'return', 'select', 'struct', 'switch', 'type',
      'var', 'true', 'false', 'nil', 'iota',
    ],
    initialState: 0,
    rules: [
      { pattern: /[\s\S]*?\*\//, type: 'comment', whenState: 1, nextState: 0 },
      { pattern: /[\s\S]+/, type: 'comment', whenState: 1, nextState: 1 },
      { pattern: /\/\/.*/, type: 'comment' },
      { pattern: /\/\*[\s\S]*?\*\//, type: 'comment' },
      { pattern: /\/\*[\s\S]*/, type: 'comment', nextState: 1 },
      { pattern: /`[^`]*`/, type: 'string' },
      { pattern: /"(?:\\.|[^"\\])*"/, type: 'string' },
      { pattern: /'(?:\\.|[^'\\])'/, type: 'string' },
      { pattern: /0[xX][0-9a-fA-F_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?i?/, type: 'number' },
      { pattern: /\b(?:any|bool|byte|comparable|complex64|complex128|error|float32|float64|int|int8|int16|int32|int64|rune|string|uint|uint8|uint16|uint32|uint64|uintptr)\b/, type: 'type' },
      { pattern: /\b(?:append|cap|clear|close|complex|copy|delete|imag|len|make|max|min|new|panic|print|println|real|recover)\b/, type: 'function' },
      { pattern: /:=|<-|\.\.\.|==|!=|<=|>=|&&|\|\||[+\-*/%&|^!<>]=?/, type: 'operator' },
    ],
  });
}

export function createKotlinTokensProvider(languageId = 'kotlin'): MonoTokensProvider {
  return createRegexTokensProvider({
    languageId,
    keywords: [
      'abstract', 'actual', 'annotation', 'as', 'break', 'by', 'catch', 'class',
      'companion', 'const', 'constructor', 'continue', 'crossinline', 'data', 'do',
      'else', 'enum', 'expect', 'external', 'false', 'final', 'finally', 'for', 'fun',
      'get', 'if', 'import', 'in', 'infix', 'init', 'inline', 'inner', 'interface',
      'internal', 'is', 'lateinit', 'noinline', 'null', 'object', 'open', 'operator',
      'out', 'override', 'package', 'private', 'protected', 'public', 'reified',
      'return', 'sealed', 'set', 'super', 'suspend', 'tailrec', 'this', 'throw',
      'true', 'try', 'typealias', 'val', 'var', 'vararg', 'when', 'where', 'while',
    ],
    initialState: 0,
    rules: [
      { pattern: /[\s\S]*?\*\//, type: 'comment', whenState: 1, nextState: 0 },
      { pattern: /[\s\S]+/, type: 'comment', whenState: 1, nextState: 1 },
      { pattern: /\/\/.*/, type: 'comment' },
      { pattern: /\/\*[\s\S]*?\*\//, type: 'comment' },
      { pattern: /\/\*[\s\S]*/, type: 'comment', nextState: 1 },
      { pattern: /@[A-Za-z_][A-Za-z0-9_]*/, type: 'decorator' },
      { pattern: /"(?:\\.|[^"\\])*"/, type: 'string' },
      { pattern: /'(?:\\.|[^'\\])'/, type: 'string' },
      { pattern: /0[xX][0-9a-fA-F_]+[uUlL]*|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?[fFdDlLuU]*/, type: 'number' },
      { pattern: /\b(?:Any|Unit|Nothing|Boolean|Byte|Short|Int|Long|Float|Double|Char|String|List|MutableList|Map|Set|Pair|Triple|[A-Z][A-Za-z0-9_]*)\b/, type: 'type' },
      { pattern: /\?:|\?\.|->|::|\.\.|===|!==|==|!=|<=|>=|&&|\|\||[+\-*/%<>!=]=?/, type: 'operator' },
    ],
  });
}

export function createSwiftTokensProvider(languageId = 'swift'): MonoTokensProvider {
  return createRegexTokensProvider({
    languageId,
    keywords: [
      'actor', 'as', 'associatedtype', 'async', 'await', 'break', 'case', 'catch',
      'class', 'continue', 'default', 'defer', 'deinit', 'do', 'else', 'enum',
      'extension', 'fallthrough', 'false', 'fileprivate', 'for', 'func', 'guard',
      'if', 'import', 'in', 'init', 'inout', 'internal', 'is', 'let', 'nil', 'open',
      'operator', 'override', 'private', 'protocol', 'public', 'repeat', 'rethrows',
      'return', 'self', 'Self', 'some', 'static', 'struct', 'subscript', 'super',
      'switch', 'throw', 'throws', 'true', 'try', 'typealias', 'var', 'where', 'while',
    ],
    initialState: 0,
    rules: [
      { pattern: /[\s\S]*?\*\//, type: 'comment', whenState: 1, nextState: 0 },
      { pattern: /[\s\S]+/, type: 'comment', whenState: 1, nextState: 1 },
      { pattern: /\/\/.*/, type: 'comment' },
      { pattern: /\/\*[\s\S]*?\*\//, type: 'comment' },
      { pattern: /\/\*[\s\S]*/, type: 'comment', nextState: 1 },
      { pattern: /@[A-Za-z_][A-Za-z0-9_]*/, type: 'decorator' },
      { pattern: /#[A-Za-z_][A-Za-z0-9_]*/, type: 'macro' },
      { pattern: /"(?:\\.|[^"\\])*"/, type: 'string' },
      { pattern: /0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?/, type: 'number' },
      { pattern: /\b(?:Any|AnyObject|Bool|Character|Double|Float|Int|Int8|Int16|Int32|Int64|UInt|String|Void|Array|Dictionary|Set|Optional|Result|[A-Z][A-Za-z0-9_]*)\b/, type: 'type' },
      { pattern: /->|\?\?|\.\.\.|\.\.<|===|!==|==|!=|<=|>=|&&|\|\||[+\-*/%&|^!<>]=?/, type: 'operator' },
    ],
  });
}

export function createPhpTokensProvider(languageId = 'php'): MonoTokensProvider {
  return createRegexTokensProvider({
    languageId,
    keywords: [
      'abstract', 'and', 'array', 'as', 'break', 'callable', 'case', 'catch', 'class',
      'clone', 'const', 'continue', 'declare', 'default', 'do', 'echo', 'else', 'elseif',
      'empty', 'enum', 'extends', 'false', 'final', 'finally', 'fn', 'for', 'foreach',
      'function', 'global', 'goto', 'if', 'implements', 'include', 'include_once',
      'instanceof', 'interface', 'isset', 'list', 'match', 'namespace', 'new', 'null',
      'or', 'print', 'private', 'protected', 'public', 'readonly', 'require',
      'require_once', 'return', 'static', 'switch', 'throw', 'trait', 'true', 'try',
      'unset', 'use', 'var', 'while', 'xor', 'yield',
    ],
    initialState: 0,
    rules: [
      { pattern: /[\s\S]*?\*\//, type: 'comment', whenState: 1, nextState: 0 },
      { pattern: /[\s\S]+/, type: 'comment', whenState: 1, nextState: 1 },
      { pattern: /<\?(?:php|=)?|\?>/, type: 'tag' },
      { pattern: /\/\/.*|#[^\n]*/, type: 'comment' },
      { pattern: /\/\*[\s\S]*?\*\//, type: 'comment' },
      { pattern: /\/\*[\s\S]*/, type: 'comment', nextState: 1 },
      { pattern: /"(?:\\.|[^"\\])*"/, type: 'string' },
      { pattern: /'(?:\\.|[^'\\])*'/, type: 'string' },
      { pattern: /\$[A-Za-z_][A-Za-z0-9_]*/, type: 'variable' },
      { pattern: /0[xX][0-9a-fA-F_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?/, type: 'number' },
      { pattern: /\b(?:int|float|string|bool|void|never|mixed|object|iterable|self|parent|[A-Z][A-Za-z0-9_]*)\b/, type: 'type' },
      { pattern: /->|=>|::|\?\?=?|<=>|===|!==|==|!=|<=|>=|&&|\|\||[+\-*/%.&|^!<>]=?/, type: 'operator' },
    ],
  });
}

export function createRubyTokensProvider(languageId = 'ruby'): MonoTokensProvider {
  return createRegexTokensProvider({
    languageId,
    keywords: [
      'alias', 'and', 'begin', 'break', 'case', 'class', 'def', 'defined?', 'do',
      'else', 'elsif', 'end', 'ensure', 'false', 'for', 'if', 'in', 'module', 'next',
      'nil', 'not', 'or', 'redo', 'rescue', 'retry', 'return', 'self', 'super', 'then',
      'true', 'undef', 'unless', 'until', 'when', 'while', 'yield', 'require',
      'require_relative', 'include', 'extend', 'attr_reader', 'attr_writer', 'attr_accessor',
      'private', 'protected', 'public', 'raise', 'puts', 'print',
    ],
    initialState: 0,
    rules: [
      { pattern: /#.*/, type: 'comment' },
      { pattern: /"(?:\\.|[^"\\])*"/, type: 'string' },
      { pattern: /'(?:\\.|[^'\\])*'/, type: 'string' },
      { pattern: /:[A-Za-z_][A-Za-z0-9_]*[!?]?/, type: 'constant' },
      { pattern: /@@?[A-Za-z_][A-Za-z0-9_]*/, type: 'variable' },
      { pattern: /\$[A-Za-z0-9_]+/, type: 'variable' },
      { pattern: /0[xX][0-9a-fA-F_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?/, type: 'number' },
      { pattern: /\b[A-Z][A-Za-z0-9_]*\b/, type: 'type' },
      { pattern: /=>|<=>|\.\.\.?|===|==|!=|<=|>=|=~|!~|&&|\|\||[+\-*/%&|^!<>]=?/, type: 'operator' },
    ],
  });
}

export function createXmlTokensProvider(languageId = 'xml'): MonoTokensProvider {
  return createRegexTokensProvider({
    languageId,
    initialState: 0,
    rules: [
      { pattern: /[\s\S]*?-->/, type: 'comment', whenState: 1, nextState: 0 },
      { pattern: /[\s\S]+/, type: 'comment', whenState: 1, nextState: 1 },
      { pattern: /<!--[\s\S]*?-->/, type: 'comment' },
      { pattern: /<!--[\s\S]*/, type: 'comment', nextState: 1 },
      { pattern: /<\?[\s\S]*?\?>/, type: 'macro' },
      { pattern: /<!\[CDATA\[[\s\S]*?\]\]>/, type: 'string' },
      { pattern: /<!DOCTYPE[^>]*>/, type: 'keyword' },
      { pattern: /<\/?[A-Za-z_][A-Za-z0-9_.:-]*/, type: 'tag' },
      { pattern: /\/?>/, type: 'tag' },
      { pattern: /"(?:[^"\\]|\\.)*"/, type: 'string' },
      { pattern: /'(?:[^'\\]|\\.)*'/, type: 'string' },
      { pattern: /&[A-Za-z0-9#]+;/, type: 'constant' },
      { pattern: /[A-Za-z_][A-Za-z0-9_.:-]*(?=\s*=)/, type: 'attribute' },
    ],
  });
}

export function createTomlTokensProvider(languageId = 'toml'): MonoTokensProvider {
  return createRegexTokensProvider({
    languageId,
    keywords: ['true', 'false'],
    initialState: 0,
    rules: [
      { pattern: /#.*/, type: 'comment' },
      { pattern: /\[\[[^\]]+\]\]|\[[^\]]+\]/, type: 'heading' },
      { pattern: /"(?:\\.|[^"\\])*"/, type: 'string' },
      { pattern: /'[^']*'/, type: 'string' },
      { pattern: /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?/, type: 'constant' },
      { pattern: /0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|[+-]?\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?/, type: 'number' },
      { pattern: /[A-Za-z0-9_-]+(?=\s*=)/, type: 'property' },
      { pattern: /[=.,[\]{}]/, type: 'punctuation' },
    ],
  });
}

export function createDockerfileTokensProvider(languageId = 'dockerfile'): MonoTokensProvider {
  return createRegexTokensProvider({
    languageId,
    keywords: [
      'FROM', 'AS', 'RUN', 'CMD', 'LABEL', 'MAINTAINER', 'EXPOSE', 'ENV', 'ADD',
      'COPY', 'ENTRYPOINT', 'VOLUME', 'USER', 'WORKDIR', 'ARG', 'ONBUILD',
      'STOPSIGNAL', 'HEALTHCHECK', 'SHELL', 'from', 'as', 'run', 'cmd', 'label',
      'expose', 'env', 'add', 'copy', 'entrypoint', 'volume', 'user', 'workdir', 'arg',
    ],
    initialState: 0,
    rules: [
      { pattern: /#.*/, type: 'comment' },
      { pattern: /"(?:\\.|[^"\\])*"/, type: 'string' },
      { pattern: /'[^']*'/, type: 'string' },
      { pattern: /\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*/, type: 'variable' },
      { pattern: /--[a-zA-Z0-9-]+=?/, type: 'attribute' },
      { pattern: /\b\d+\b/, type: 'number' },
      { pattern: /&&|\|\||\\|[=|;]/, type: 'operator' },
    ],
  });
}
