import type { MonoToken } from '../languages';
import type { TextModel } from '../model/TextModel';

export type LineTokensProvider = (lineNumber: number) => readonly MonoToken[];

export interface ScannedBracket {
  readonly line: number;
  readonly col: number;
  readonly char: string;
  readonly isOpen: boolean;
  readonly pairIdx: number;
}

export interface BracketScanResult {
  readonly brackets: ScannedBracket[];
  readonly blockCommentSpans: Array<{ startLine: number; endLine: number }>;
  readonly multilineStringSpans: Array<{ startLine: number; endLine: number }>;
  readonly lineCommentOnly: Uint8Array;
}

const SKIP_TOKEN_TYPES = new Set(['comment', 'string', 'stringEscape', 'regexp']);

/**
 * Checks whether a 1-based column lies inside a comment/string/regexp token.
 */
export function isColumnIgnoredByTokens(tokens: readonly MonoToken[], col1: number): boolean {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (col1 < t.startColumn) return false;
    if (col1 < t.endColumn) return SKIP_TOKEN_TYPES.has(t.type);
  }
  return false;
}

export interface BracketScanOptions {
  readonly pairs?: readonly (readonly [string, string])[];
  readonly lineComment?: string | null;
  readonly blockComment?: readonly [string, string] | null;
  readonly maxLineLength?: number;
  readonly supportsBacktick?: boolean;
  readonly supportsRegex?: boolean;
  readonly hashLineComment?: boolean;
  readonly getLineTokens?: LineTokensProvider;
}

const DEFAULT_PAIRS: readonly (readonly [string, string])[] = [
  ['{', '}'],
  ['[', ']'],
  ['(', ')'],
];

/**
 * Single-pass token-aware (or built-in lexical) bracket, block-comment, and
 * multi-line string scanner. Strictly DOM-free and safe against unterminated
 * literals or malformed regexes.
 */
export function scanDocumentBrackets(
  model: TextModel,
  opts: BracketScanOptions = {},
): BracketScanResult {
  const lineCount = model.getLineCount();
  const maxLen = opts.maxLineLength ?? 20_000;
  const pairs = opts.pairs?.length ? opts.pairs : DEFAULT_PAIRS;
  const openMap = new Map<string, number>();
  const closeMap = new Map<string, number>();
  for (let p = 0; p < pairs.length; p++) {
    const [o, c] = pairs[p]!;
    if (o.length === 1 && c.length === 1) {
      openMap.set(o, p);
      closeMap.set(c, p);
    }
  }

  const lineComment = opts.lineComment === undefined ? '//' : opts.lineComment;
  const blockOpen = opts.blockComment?.[0] ?? '/*';
  const blockClose = opts.blockComment?.[1] ?? '*/';
  const hasBlockComment = opts.blockComment !== null && blockOpen.length > 0 && blockClose.length > 0;
  const supportsBacktick = opts.supportsBacktick !== false;
  const supportsRegex = opts.supportsRegex !== false;

  const brackets: ScannedBracket[] = [];
  const blockCommentSpans: Array<{ startLine: number; endLine: number }> = [];
  const multilineStringSpans: Array<{ startLine: number; endLine: number }> = [];
  const lineCommentOnly = new Uint8Array(lineCount + 1);

  let inBlockComment = false;
  let blockCommentStart = -1;
  let inTemplate = false;
  let templateStart = -1;
  let templateExprDepth = 0;

  for (let ln = 1; ln <= lineCount; ln++) {
    const raw = model.getLineContent(ln);
    const len = Math.min(raw.length, maxLen);
    const trimmed = raw.trimStart();

    if (!inBlockComment && !inTemplate && lineComment && trimmed.startsWith(lineComment)) {
      lineCommentOnly[ln] = 1;
      continue;
    }

    const tokens = opts.getLineTokens ? opts.getLineTokens(ln) : null;
    let inSingle = false;
    let inDouble = false;
    let inRegex = false;
    let inRegexClass = false;
    let prevNonWs = '';

    for (let i = 0; i < len; i++) {
      const ch = raw[i]!;
      const next = i + 1 < len ? raw[i + 1]! : '';

      if (inBlockComment) {
        if (hasBlockComment && raw.startsWith(blockClose, i)) {
          inBlockComment = false;
          if (ln > blockCommentStart) {
            blockCommentSpans.push({ startLine: blockCommentStart, endLine: ln });
          }
          blockCommentStart = -1;
          i += blockClose.length - 1;
        }
        continue;
      }

      if (inTemplate && templateExprDepth === 0) {
        if (ch === '\\') { i++; continue; }
        if (ch === '$' && next === '{') {
          templateExprDepth = 1;
          brackets.push({ line: ln, col: i + 2, char: '{', isOpen: true, pairIdx: openMap.get('{') ?? 0 });
          i++;
          continue;
        }
        if (ch === '`') {
          inTemplate = false;
          if (ln > templateStart) {
            multilineStringSpans.push({ startLine: templateStart, endLine: ln });
          }
          templateStart = -1;
        }
        continue;
      }

      if (inSingle) {
        if (ch === '\\') { i++; continue; }
        if (ch === "'") inSingle = false;
        continue;
      }
      if (inDouble) {
        if (ch === '\\') { i++; continue; }
        if (ch === '"') inDouble = false;
        continue;
      }
      if (inRegex) {
        if (ch === '\\') { i++; continue; }
        if (ch === '[') { inRegexClass = true; continue; }
        if (ch === ']') { inRegexClass = false; continue; }
        if (ch === '/' && !inRegexClass) { inRegex = false; }
        continue;
      }

      if (lineComment && raw.startsWith(lineComment, i)) {
        break;
      }
      if (opts.hashLineComment && ch === '#') {
        break;
      }
      if (hasBlockComment && raw.startsWith(blockOpen, i)) {
        inBlockComment = true;
        blockCommentStart = ln;
        i += blockOpen.length - 1;
        continue;
      }

      if (ch === "'") { inSingle = true; prevNonWs = ch; continue; }
      if (ch === '"') { inDouble = true; prevNonWs = ch; continue; }
      if (supportsBacktick && ch === '`') {
        inTemplate = true;
        templateStart = ln;
        prevNonWs = ch;
        continue;
      }
      if (
        supportsRegex &&
        ch === '/' &&
        next !== '/' &&
        next !== '*' &&
        (prevNonWs === '' || '=(,[!:;&|?{+-%*^~<>'.includes(prevNonWs))
      ) {
        // Verify closing slash exists on this line before committing regex mode
        let closed = false;
        let cls = false;
        for (let k = i + 1; k < len; k++) {
          const rc = raw[k]!;
          if (rc === '\\') { k++; continue; }
          if (rc === '[') { cls = true; continue; }
          if (rc === ']') { cls = false; continue; }
          if (rc === '/' && !cls) { closed = true; break; }
        }
        if (closed) {
          inRegex = true;
          inRegexClass = false;
          prevNonWs = '/';
          continue;
        }
      }

      if (ch !== ' ' && ch !== '\t') prevNonWs = ch;

      if (tokens && isColumnIgnoredByTokens(tokens, i + 1)) {
        continue;
      }

      if (inTemplate && templateExprDepth > 0) {
        if (ch === '{') templateExprDepth++;
        else if (ch === '}') {
          templateExprDepth--;
          brackets.push({ line: ln, col: i + 1, char: '}', isOpen: false, pairIdx: closeMap.get('}') ?? 0 });
          continue;
        }
      }

      const openIdx = openMap.get(ch);
      if (openIdx !== undefined) {
        brackets.push({ line: ln, col: i + 1, char: ch, isOpen: true, pairIdx: openIdx });
        continue;
      }
      const closeIdx = closeMap.get(ch);
      if (closeIdx !== undefined) {
        brackets.push({ line: ln, col: i + 1, char: ch, isOpen: false, pairIdx: closeIdx });
      }
    }
  }

  return { brackets, blockCommentSpans, multilineStringSpans, lineCommentOnly };
}
