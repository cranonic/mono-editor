import {
  emitStringWithEscapes,
  isOverTimeBudget,
  nowMs,
  resolveLineBudget,
  scanKeycapEmojiEnd,
  scanNonAsciiRun,
} from '../tokenization/monarchEngine';
import { StateInterner } from '../tokenization/stateInterner';
import type { MonoToken, MonoTokenType } from '../tokenization/tokenTypes';
import type { LineTokenizeResult, MonoTokensProvider, TokenizeLineOptions } from '../tokenization/TokensProvider';

const CONTROL_KW = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue',
  'return', 'try', 'catch', 'finally', 'throw', 'await', 'yield', 'import', 'export',
  'from', 'as', 'of', 'in', 'with',
]);

const STORAGE_KW = new Set([
  'const', 'let', 'var', 'function', 'class', 'extends', 'implements', 'interface',
  'type', 'enum', 'namespace', 'module', 'declare', 'abstract', 'async', 'new',
  'this', 'super', 'typeof', 'instanceof', 'void', 'delete', 'debugger', 'static',
  'readonly', 'private', 'public', 'protected', 'override', 'satisfies', 'infer',
  'keyof', 'asserts', 'is', 'package', 'get', 'set',
]);

const BOOLEAN_KW = new Set(['true', 'false', 'null', 'undefined']);
const CONST_KW = new Set(['NaN', 'Infinity', 'globalThis', 'arguments']);

/**
 * Stack frame for JS/TS Monarch tokenization:
 * - 'root': normal code
 * - 'blockComment': inside /* ... *\/
 * - 'template': inside `...` template literal
 * - 'tplExpr': inside `${ ... }` with nested `braceDepth`
 */
type JsFrame =
  | { kind: 'root' }
  | { kind: 'blockComment' }
  | { kind: 'template' }
  | { kind: 'tplExpr'; braceDepth: number };

const jsInterner = new StateInterner<readonly JsFrame[]>();
const ROOT_STATE_ID = jsInterner.intern('root', () => [{ kind: 'root' }]);

function internJsStack(stack: readonly JsFrame[]): number {
  let key = '';
  for (let i = 0; i < stack.length; i++) {
    const f = stack[i]!;
    if (i > 0) key += '|';
    if (f.kind === 'tplExpr') key += `e:${f.braceDepth}`;
    else key += f.kind;
  }
  return jsInterner.intern(key || 'root', () =>
    stack.map((f) => (f.kind === 'tplExpr' ? { kind: 'tplExpr', braceDepth: f.braceDepth } : { kind: f.kind })),
  );
}

function isIdentStart(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36;
}

function isIdentPart(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (
    (c >= 65 && c <= 90) ||
    (c >= 97 && c <= 122) ||
    (c >= 48 && c <= 57) ||
    c === 95 ||
    c === 36
  );
}

function isDigit(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return c >= 48 && c <= 57;
}

function skipWs(line: string, idx: number): number {
  while (idx < line.length && (line[idx] === ' ' || line[idx] === '\t')) idx++;
  return idx;
}

/**
 * Prism/Monaco-grade stateful JS/TS/JSX/TSX tokenizer.
 * - Hash-consed interned integer state IDs (O(1) equality)
 * - Full multiline template strings (`...`) with arbitrarily nested `${ expr }` interpolation
 * - Control vs storage keywords, function calls/defs, properties, types, decorators, escapes, regexes
 */
export function createJavaScriptTokensProvider(
  languageId: string = 'javascript',
): MonoTokensProvider {
  return {
    languageId,
    getInitialState: () => ROOT_STATE_ID,
    tokenizeLine(
      line: string,
      state: unknown,
      options?: TokenizeLineOptions,
    ): LineTokenizeResult {
      const { maxLineLength, timeBudgetMs } = resolveLineBudget(options);
      const len = line.length;
      const incomingId = typeof state === 'number' ? state : ROOT_STATE_ID;
      if (len === 0) return { tokens: [], endState: incomingId };
      if (len > maxLineLength) {
        return {
          tokens: [{ startColumn: 1, endColumn: len + 1, type: 'plain' }],
          endState: incomingId,
        };
      }

      const baseStack = jsInterner.get(incomingId) ?? [{ kind: 'root' as const }];
      const stack: JsFrame[] = baseStack.map((f) =>
        f.kind === 'tplExpr' ? { kind: 'tplExpr', braceDepth: f.braceDepth } : { kind: f.kind },
      );

      const tokens: MonoToken[] = [];
      const startMs = nowMs();
      let i = 0;
      let steps = 0;
      let regexAllowed = true;
      let prevWord = '';
      let afterDot = false;

      const top = (): JsFrame => stack[stack.length - 1] ?? { kind: 'root' };

      while (i < len) {
        if (isOverTimeBudget(startMs, timeBudgetMs, ++steps)) {
          tokens.push({ startColumn: i + 1, endColumn: len + 1, type: 'plain' });
          break;
        }

        const frame = top();

        // 1. Inside multiline block comment
        if (frame.kind === 'blockComment') {
          const endIdx = line.indexOf('*/', i);
          if (endIdx < 0) {
            tokens.push({ startColumn: i + 1, endColumn: len + 1, type: 'comment' });
            i = len;
          } else {
            tokens.push({ startColumn: i + 1, endColumn: endIdx + 3, type: 'comment' });
            i = endIdx + 2;
            stack.pop();
            if (!stack.length) stack.push({ kind: 'root' });
          }
          continue;
        }

        // 2. Inside multiline template literal (`...${expr}...`)
        if (frame.kind === 'template') {
          let j = i;
          while (j < len) {
            const ch = line[j]!;
            if (ch === '\\') {
              j = Math.min(len, j + 2);
              continue;
            }
            if (ch === '`') break;
            if (ch === '$' && line[j + 1] === '{') break;
            j++;
          }
          if (j > i) {
            emitStringWithEscapes(line, i, j, tokens, 'string');
            i = j;
            continue;
          }
          if (line[i] === '`') {
            tokens.push({ startColumn: i + 1, endColumn: i + 2, type: 'string' });
            i++;
            stack.pop();
            if (!stack.length) stack.push({ kind: 'root' });
            regexAllowed = false;
            prevWord = '';
            afterDot = false;
            continue;
          }
          if (line[i] === '$' && line[i + 1] === '{') {
            tokens.push({ startColumn: i + 1, endColumn: i + 3, type: 'templateDelimiter' });
            i += 2;
            stack.push({ kind: 'tplExpr', braceDepth: 0 });
            regexAllowed = true;
            prevWord = '';
            afterDot = false;
            continue;
          }
        }

        // 3. Code mode ('root' or 'tplExpr')
        const ch = line[i]!;
        if (ch === ' ' || ch === '\t' || ch === '\r') {
          i++;
          continue;
        }

        // Line comment
        if (ch === '/' && line[i + 1] === '/') {
          tokens.push({ startColumn: i + 1, endColumn: len + 1, type: 'comment' });
          i = len;
          break;
        }

        // Block comment start
        if (ch === '/' && line[i + 1] === '*') {
          const close = line.indexOf('*/', i + 2);
          if (close >= 0) {
            tokens.push({ startColumn: i + 1, endColumn: close + 3, type: 'comment' });
            i = close + 2;
          } else {
            tokens.push({ startColumn: i + 1, endColumn: len + 1, type: 'comment' });
            stack.push({ kind: 'blockComment' });
            i = len;
          }
          continue;
        }

        // Template string start
        if (ch === '`') {
          tokens.push({ startColumn: i + 1, endColumn: i + 2, type: 'string' });
          i++;
          stack.push({ kind: 'template' });
          regexAllowed = false;
          prevWord = '';
          afterDot = false;
          continue;
        }

        // Single / double quoted strings (with escape sequences)
        if (ch === '"' || ch === "'") {
          const quote = ch;
          let j = i + 1;
          while (j < len) {
            if (line[j] === '\\') {
              j = Math.min(len, j + 2);
              continue;
            }
            if (line[j] === quote) {
              j++;
              break;
            }
            j++;
          }
          emitStringWithEscapes(line, i, j, tokens, 'string');
          i = j;
          regexAllowed = false;
          prevWord = '';
          afterDot = false;
          continue;
        }

        // Regexp literal (only where expression is valid)
        if (ch === '/' && regexAllowed && line[i + 1] !== '/' && line[i + 1] !== '*') {
          let j = i + 1;
          let inClass = false;
          let closed = false;
          while (j < len) {
            const c = line[j]!;
            if (c === '\\') {
              j += 2;
              continue;
            }
            if (c === '[') inClass = true;
            else if (c === ']') inClass = false;
            else if (c === '/' && !inClass) {
              j++;
              closed = true;
              break;
            }
            j++;
          }
          if (closed) {
            while (j < len && /[dgimsuvy]/.test(line[j]!)) j++;
            tokens.push({ startColumn: i + 1, endColumn: j + 1, type: 'regexp' });
            i = j;
            regexAllowed = false;
            prevWord = '';
            afterDot = false;
            continue;
          }
        }

        // Braces inside `${ ... }`
        if (ch === '{') {
          if (frame.kind === 'tplExpr') frame.braceDepth++;
          tokens.push({ startColumn: i + 1, endColumn: i + 2, type: 'punctuation' });
          i++;
          regexAllowed = true;
          prevWord = '';
          afterDot = false;
          continue;
        }
        if (ch === '}') {
          if (frame.kind === 'tplExpr') {
            if (frame.braceDepth === 0) {
              tokens.push({ startColumn: i + 1, endColumn: i + 2, type: 'templateDelimiter' });
              i++;
              stack.pop();
              if (!stack.length) stack.push({ kind: 'root' });
              continue;
            }
            frame.braceDepth--;
          }
          tokens.push({ startColumn: i + 1, endColumn: i + 2, type: 'punctuation' });
          i++;
          regexAllowed = false;
          prevWord = '';
          afterDot = false;
          continue;
        }

        // Decorator (@Component)
        if (ch === '@' && i + 1 < len && isIdentStart(line[i + 1]!)) {
          let j = i + 2;
          while (j < len && isIdentPart(line[j]!)) j++;
          tokens.push({ startColumn: i + 1, endColumn: j + 1, type: 'decorator' });
          i = j;
          regexAllowed = false;
          prevWord = '';
          afterDot = false;
          continue;
        }

        // Emoji keycap sequence ([0-9#*]\uFE0F?\u20E3)
        const keycapEnd = scanKeycapEmojiEnd(line, i, len);
        if (keycapEnd > i) {
          tokens.push({ startColumn: i + 1, endColumn: keycapEnd + 1, type: 'plain' });
          i = keycapEnd;
          regexAllowed = false;
          prevWord = '';
          afterDot = false;
          continue;
        }

        // Numbers (hex, binary, octal, decimal, bigint, separators)
        if (isDigit(ch) || (ch === '.' && i + 1 < len && isDigit(line[i + 1]!))) {
          let j = i;
          if (ch === '0' && (line[i + 1] === 'x' || line[i + 1] === 'X')) {
            j += 2;
            while (j < len && /[0-9a-fA-F_]/.test(line[j]!)) j++;
          } else if (ch === '0' && (line[i + 1] === 'b' || line[i + 1] === 'B')) {
            j += 2;
            while (j < len && /[01_]/.test(line[j]!)) j++;
          } else if (ch === '0' && (line[i + 1] === 'o' || line[i + 1] === 'O')) {
            j += 2;
            while (j < len && /[0-7_]/.test(line[j]!)) j++;
          } else {
            while (j < len && /[0-9_]/.test(line[j]!)) j++;
            if (line[j] === '.' && j + 1 < len && isDigit(line[j + 1]!)) {
              j++;
              while (j < len && /[0-9_]/.test(line[j]!)) j++;
            }
            if (line[j] === 'e' || line[j] === 'E') {
              let k = j + 1;
              if (line[k] === '+' || line[k] === '-') k++;
              if (k < len && isDigit(line[k]!)) {
                j = k + 1;
                while (j < len && /[0-9_]/.test(line[j]!)) j++;
              }
            }
          }
          if (line[j] === 'n') j++;
          tokens.push({ startColumn: i + 1, endColumn: j + 1, type: 'number' });
          i = j;
          regexAllowed = false;
          prevWord = '';
          afterDot = false;
          continue;
        }

        // Identifiers, keywords, functions, properties, types, constants
        if (isIdentStart(ch)) {
          let j = i + 1;
          while (j < len && isIdentPart(line[j]!)) j++;
          const word = line.slice(i, j);
          const nextNonWs = skipWs(line, j);
          const nextChar = line[nextNonWs];

          let type: MonoTokenType = 'variable';
          if (afterDot) {
            type = nextChar === '(' ? 'function' : 'property';
          } else if (CONTROL_KW.has(word)) {
            type = 'keywordControl';
          } else if (BOOLEAN_KW.has(word)) {
            type = 'boolean';
          } else if (CONST_KW.has(word)) {
            type = 'constant';
          } else if (STORAGE_KW.has(word)) {
            type = 'keyword';
          } else if (prevWord === 'class' || prevWord === 'interface' || prevWord === 'type' || prevWord === 'enum' || prevWord === 'extends' || prevWord === 'implements' || prevWord === 'new') {
            type = 'class';
          } else if (prevWord === 'function' || nextChar === '(') {
            type = 'function';
          } else if (
            nextChar === ':' &&
            line[nextNonWs + 1] !== ':' &&
            prevWord !== 'case' &&
            !CONTROL_KW.has(prevWord)
          ) {
            type = 'property';
          } else if (word.length > 1 && word === word.toUpperCase() && /[A-Z]/.test(word)) {
            type = 'constant';
          } else if (word[0]! >= 'A' && word[0]! <= 'Z' && /[a-z]/.test(word)) {
            type = 'type';
          }

          tokens.push({ startColumn: i + 1, endColumn: j + 1, type });
          regexAllowed =
            type === 'keywordControl' ||
            word === 'return' ||
            word === 'typeof' ||
            word === 'void' ||
            word === 'delete' ||
            word === 'new' ||
            word === 'in' ||
            word === 'of' ||
            word === 'instanceof';
          prevWord = word;
          afterDot = false;
          i = j;
          continue;
        }

        // Dot / optional chaining
        if (ch === '.' || (ch === '?' && line[i + 1] === '.')) {
          const step = ch === '?' ? 2 : 1;
          tokens.push({ startColumn: i + 1, endColumn: i + step + 1, type: 'punctuation' });
          i += step;
          afterDot = true;
          regexAllowed = false;
          prevWord = '';
          continue;
        }

        // Multi-char operators
        const op3 = line.slice(i, i + 3);
        const op2 = line.slice(i, i + 2);
        if (
          op3 === '===' || op3 === '!==' || op3 === '>>>' || op3 === '**=' ||
          op3 === '&&=' || op3 === '||=' || op3 === '??=' || op3 === '...'
        ) {
          tokens.push({ startColumn: i + 1, endColumn: i + 4, type: 'operator' });
          i += 3;
          regexAllowed = true;
          prevWord = '';
          afterDot = false;
          continue;
        }
        if (
          op2 === '=>' || op2 === '==' || op2 === '!=' || op2 === '<=' || op2 === '>=' ||
          op2 === '&&' || op2 === '||' || op2 === '??' || op2 === '++' || op2 === '--' ||
          op2 === '**' || op2 === '<<' || op2 === '>>' || op2 === '+=' || op2 === '-=' ||
          op2 === '*=' || op2 === '/=' || op2 === '%='
        ) {
          tokens.push({ startColumn: i + 1, endColumn: i + 3, type: 'operator' });
          i += 2;
          regexAllowed = op2 !== '++' && op2 !== '--';
          prevWord = '';
          afterDot = false;
          continue;
        }

        if ('+-*/%&|^~<>!?='.includes(ch)) {
          tokens.push({ startColumn: i + 1, endColumn: i + 2, type: 'operator' });
          i++;
          regexAllowed = true;
          prevWord = '';
          afterDot = false;
          continue;
        }

        // Non-ASCII runs (Indic/Arabic/Urdu scripts, emojis, surrogate pairs): keep intact for shaping
        if (ch.charCodeAt(0) > 0x7f) {
          const j = scanNonAsciiRun(line, i, len);
          tokens.push({ startColumn: i + 1, endColumn: j + 1, type: 'plain' });
          regexAllowed = false;
          prevWord = '';
          afterDot = false;
          i = j;
          continue;
        }

        // Punctuation: ( ) [ ] , ; :
        tokens.push({ startColumn: i + 1, endColumn: i + 2, type: 'punctuation' });
        regexAllowed = ch === '(' || ch === '[' || ch === ',' || ch === ';' || ch === ':';
        prevWord = '';
        afterDot = false;
        i++;
      }

      return { tokens, endState: internJsStack(stack) };
    },
  };
}

export function createTypeScriptTokensProvider(): MonoTokensProvider {
  return createJavaScriptTokensProvider('typescript');
}
