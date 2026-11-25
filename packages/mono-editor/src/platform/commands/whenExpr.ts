import type { MonoContextKeyValue } from './types';

type TokenKind = 'ident' | 'string' | 'number' | 'lparen' | 'rparen' | 'and' | 'or' | 'not' | 'eq' | 'neq' | 'eof';

interface Token {
  kind: TokenKind;
  value: string;
}

function tokenizeWhen(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    const ch = input[i]!;
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '(') { tokens.push({ kind: 'lparen', value: '(' }); i++; continue; }
    if (ch === ')') { tokens.push({ kind: 'rparen', value: ')' }); i++; continue; }
    if (ch === '&' && input[i + 1] === '&') { tokens.push({ kind: 'and', value: '&&' }); i += 2; continue; }
    if (ch === '|' && input[i + 1] === '|') { tokens.push({ kind: 'or', value: '||' }); i += 2; continue; }
    if (ch === '=' && input[i + 1] === '=') { tokens.push({ kind: 'eq', value: '==' }); i += 2; continue; }
    if (ch === '!' && input[i + 1] === '=') { tokens.push({ kind: 'neq', value: '!=' }); i += 2; continue; }
    if (ch === '!') { tokens.push({ kind: 'not', value: '!' }); i++; continue; }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      let str = '';
      while (i < n && input[i] !== quote) {
        if (input[i] === '\\' && i + 1 < n) { str += input[i + 1]!; i += 2; }
        else { str += input[i]!; i++; }
      }
      if (i < n && input[i] === quote) i++;
      tokens.push({ kind: 'string', value: str });
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let num = '';
      while (i < n && /[0-9.]/.test(input[i]!)) { num += input[i]!; i++; }
      tokens.push({ kind: 'number', value: num });
      continue;
    }
    if (/[A-Za-z_.$:-]/.test(ch)) {
      let id = '';
      while (i < n && /[A-Za-z0-9_.$:-]/.test(input[i]!)) { id += input[i]!; i++; }
      tokens.push({ kind: 'ident', value: id });
      continue;
    }
    i++;
  }
  tokens.push({ kind: 'eof', value: '' });
  return tokens;
}

/**
 * Evaluates a Monaco-compatible `when` boolean expression with full support for
 * `&&`, `||`, `!`, `==`, `!=`, string/boolean/number literals, and nested parentheses.
 */
export function evaluateWhenExpression(
  expr: string,
  getValue: (key: string) => MonoContextKeyValue | undefined,
): boolean {
  const trimmed = expr.trim();
  if (!trimmed) return true;
  const tokens = tokenizeWhen(trimmed);
  let pos = 0;

  const peek = (): Token => tokens[pos] ?? { kind: 'eof', value: '' };
  const consume = (): Token => tokens[pos++] ?? { kind: 'eof', value: '' };

  const parseOr = (): boolean => {
    let left = parseAnd();
    while (peek().kind === 'or') {
      consume();
      const right = parseAnd();
      left = left || right;
    }
    return left;
  };

  const parseAnd = (): boolean => {
    let left = parseUnary();
    while (peek().kind === 'and') {
      consume();
      const right = parseUnary();
      left = left && right;
    }
    return left;
  };

  const parseUnary = (): boolean => {
    if (peek().kind === 'not') {
      consume();
      return !parseUnary();
    }
    return parsePrimary();
  };

  const resolveLiteral = (tok: Token): MonoContextKeyValue => {
    if (tok.kind === 'string') return tok.value;
    if (tok.kind === 'number') return Number(tok.value);
    if (tok.value === 'true') return true;
    if (tok.value === 'false') return false;
    return tok.value;
  };

  const parsePrimary = (): boolean => {
    const tok = peek();
    if (tok.kind === 'lparen') {
      consume();
      const val = parseOr();
      if (peek().kind === 'rparen') consume();
      return val;
    }
    if (tok.kind === 'ident') {
      consume();
      const next = peek();
      if (next.kind === 'eq' || next.kind === 'neq') {
        const op = consume().kind;
        const rhsTok = consume();
        const lhs = getValue(tok.value);
        const rhs = resolveLiteral(rhsTok);
        const equal =
          typeof rhs === 'boolean'
            ? Boolean(lhs) === rhs
            : typeof rhs === 'number'
              ? Number(lhs) === rhs
              : String(lhs ?? '') === String(rhs);
        return op === 'eq' ? equal : !equal;
      }
      if (tok.value === 'true') return true;
      if (tok.value === 'false') return false;
      return Boolean(getValue(tok.value));
    }
    if (tok.kind === 'string') {
      consume();
      return tok.value.length > 0;
    }
    if (tok.kind === 'number') {
      consume();
      return Number(tok.value) !== 0;
    }
    return false;
  };

  return parseOr();
}
