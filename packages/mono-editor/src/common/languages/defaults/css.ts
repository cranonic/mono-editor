import { isOverTimeBudget, nowMs, resolveLineBudget, scanKeycapEmojiEnd, scanNonAsciiRun } from '../tokenization/monarchEngine';
import { StateInterner } from '../tokenization/stateInterner';
import type { MonoToken } from '../tokenization/tokenTypes';
import type { LineTokenizeResult, MonoTokensProvider, TokenizeLineOptions } from '../tokenization/TokensProvider';

interface CssState {
  inComment: boolean;
  braceDepth: number;
}

const cssInterner = new StateInterner<CssState>();
const CSS_ROOT_ID = cssInterner.intern('0:0', () => ({ inComment: false, braceDepth: 0 }));

function internCss(inComment: boolean, braceDepth: number): number {
  const depth = Math.max(0, Math.min(32, braceDepth));
  return cssInterner.intern(`${inComment ? 1 : 0}:${depth}`, () => ({ inComment, braceDepth: depth }));
}

const CSS_KEYWORDS = new Set([
  'important', 'from', 'to', 'only', 'not', 'and', 'or', 'inherit', 'initial',
  'unset', 'revert', 'auto', 'none', 'transparent', 'currentColor', 'solid',
  'dashed', 'dotted', 'flex', 'grid', 'block', 'inline', 'inline-flex', 'relative',
  'absolute', 'fixed', 'sticky', 'hidden', 'visible', 'scroll', 'center', 'pointer',
]);

/**
 * Prism/Monaco-grade stateful CSS tokenizer:
 * distinguishes selectors, properties, CSS custom properties (--var), at-rules,
 * pseudo-classes/elements, functions (rgb/var/calc), numbers + units, and multiline comments.
 */
export function createCssTokensProvider(): MonoTokensProvider {
  return {
    languageId: 'css',
    getInitialState: () => CSS_ROOT_ID,
    tokenizeLine(
      line: string,
      state: unknown,
      options?: TokenizeLineOptions,
    ): LineTokenizeResult {
      const { maxLineLength, timeBudgetMs } = resolveLineBudget(options);
      const len = line.length;
      const incomingId = typeof state === 'number' ? state : CSS_ROOT_ID;
      if (len === 0) return { tokens: [], endState: incomingId };
      if (len > maxLineLength) {
        return {
          tokens: [{ startColumn: 1, endColumn: len + 1, type: 'plain' }],
          endState: incomingId,
        };
      }

      const init = cssInterner.get(incomingId) ?? { inComment: false, braceDepth: 0 };
      let inComment = init.inComment;
      let braceDepth = init.braceDepth;
      let afterColon = false;

      const tokens: MonoToken[] = [];
      const startMs = nowMs();
      let i = 0;
      let steps = 0;

      while (i < len) {
        if (isOverTimeBudget(startMs, timeBudgetMs, ++steps)) {
          tokens.push({ startColumn: i + 1, endColumn: len + 1, type: 'plain' });
          break;
        }

        if (inComment) {
          const end = line.indexOf('*/', i);
          if (end < 0) {
            tokens.push({ startColumn: i + 1, endColumn: len + 1, type: 'comment' });
            i = len;
          } else {
            tokens.push({ startColumn: i + 1, endColumn: end + 3, type: 'comment' });
            i = end + 2;
            inComment = false;
          }
          continue;
        }

        const ch = line[i]!;
        if (ch === ' ' || ch === '\t' || ch === '\r') {
          i++;
          continue;
        }

        if (ch === '/' && line[i + 1] === '*') {
          const end = line.indexOf('*/', i + 2);
          if (end >= 0) {
            tokens.push({ startColumn: i + 1, endColumn: end + 3, type: 'comment' });
            i = end + 2;
          } else {
            tokens.push({ startColumn: i + 1, endColumn: len + 1, type: 'comment' });
            inComment = true;
            i = len;
          }
          continue;
        }

        if (ch === '"' || ch === "'") {
          let j = i + 1;
          while (j < len) {
            if (line[j] === '\\') { j += 2; continue; }
            if (line[j] === ch) { j++; break; }
            j++;
          }
          tokens.push({ startColumn: i + 1, endColumn: j + 1, type: 'string' });
          i = j;
          continue;
        }

        if (ch === '{') {
          braceDepth++;
          afterColon = false;
          tokens.push({ startColumn: i + 1, endColumn: i + 2, type: 'punctuation' });
          i++;
          continue;
        }
        if (ch === '}') {
          braceDepth = Math.max(0, braceDepth - 1);
          afterColon = false;
          tokens.push({ startColumn: i + 1, endColumn: i + 2, type: 'punctuation' });
          i++;
          continue;
        }
        if (ch === ';') {
          afterColon = false;
          tokens.push({ startColumn: i + 1, endColumn: i + 2, type: 'punctuation' });
          i++;
          continue;
        }
        if (ch === ':' && braceDepth > 0 && !afterColon && line[i + 1] !== ':') {
          afterColon = true;
          tokens.push({ startColumn: i + 1, endColumn: i + 2, type: 'punctuation' });
          i++;
          continue;
        }

        // At-rules (@media, @keyframes, @import)
        if (ch === '@' && i + 1 < len && /[A-Za-z-]/.test(line[i + 1]!)) {
          let j = i + 2;
          while (j < len && /[A-Za-z0-9_-]/.test(line[j]!)) j++;
          tokens.push({ startColumn: i + 1, endColumn: j + 1, type: 'keywordControl' });
          i = j;
          continue;
        }

        // !important
        if (ch === '!' && /^!important\b/i.test(line.slice(i))) {
          tokens.push({ startColumn: i + 1, endColumn: i + 11, type: 'keyword' });
          i += 10;
          continue;
        }

        // Hex color in value position or #id selector
        if (ch === '#') {
          const hex = /^#[0-9a-fA-F]{3,8}\b/.exec(line.slice(i));
          if (hex && (afterColon || braceDepth > 0)) {
            tokens.push({ startColumn: i + 1, endColumn: i + hex[0].length + 1, type: 'constant' });
            i += hex[0].length;
            continue;
          }
          let j = i + 1;
          while (j < len && /[A-Za-z0-9_-]/.test(line[j]!)) j++;
          tokens.push({ startColumn: i + 1, endColumn: j + 1, type: 'selector' });
          i = j;
          continue;
        }

        // CSS custom property `--my-var`
        if (ch === '-' && line[i + 1] === '-' && i + 2 < len && /[A-Za-z0-9_-]/.test(line[i + 2]!)) {
          let j = i + 2;
          while (j < len && /[A-Za-z0-9_-]/.test(line[j]!)) j++;
          tokens.push({ startColumn: i + 1, endColumn: j + 1, type: 'variable' });
          i = j;
          continue;
        }

        // Emoji keycap sequence ([0-9#*]\uFE0F?\u20E3)
        const keycapEnd = scanKeycapEmojiEnd(line, i, len);
        if (keycapEnd > i) {
          tokens.push({ startColumn: i + 1, endColumn: keycapEnd + 1, type: 'plain' });
          i = keycapEnd;
          continue;
        }

        // Numbers + CSS units (`14px`, `1.5rem`, `100%`, `-2px`, `360deg`, `0.2s`)
        const numMatch = /^-?(?:\d+\.?\d*|\.\d+)(%|px|em|rem|vh|vw|vmin|vmax|ch|ex|dvh|svh|fr|deg|rad|turn|ms|s|dpi)?/.exec(
          line.slice(i),
        );
        if (numMatch && numMatch[0].length > 0 && !(ch === '-' && numMatch[0] === '-')) {
          const fullLen = numMatch[0].length;
          const unit = numMatch[1] ?? '';
          const numLen = fullLen - unit.length;
          tokens.push({ startColumn: i + 1, endColumn: i + numLen + 1, type: 'number' });
          if (unit) {
            tokens.push({ startColumn: i + numLen + 1, endColumn: i + fullLen + 1, type: 'unit' });
          }
          i += fullLen;
          continue;
        }

        // Pseudo-class / pseudo-element (`:hover`, `::before`)
        if (ch === ':') {
          const pseudo = /^::?[a-zA-Z-]+/.exec(line.slice(i));
          if (pseudo) {
            tokens.push({ startColumn: i + 1, endColumn: i + pseudo[0].length + 1, type: 'decorator' });
            i += pseudo[0].length;
            continue;
          }
        }

        // Class selector `.btn`
        if (ch === '.' && i + 1 < len && /[A-Za-z_-]/.test(line[i + 1]!)) {
          let j = i + 2;
          while (j < len && /[A-Za-z0-9_-]/.test(line[j]!)) j++;
          tokens.push({ startColumn: i + 1, endColumn: j + 1, type: 'selector' });
          i = j;
          continue;
        }

        // Identifiers: property name vs function vs keyword vs tag selector
        if (/[A-Za-z_-]/.test(ch)) {
          let j = i + 1;
          while (j < len && /[A-Za-z0-9_-]/.test(line[j]!)) j++;
          const word = line.slice(i, j);
          if (line[j] === '(') {
            tokens.push({ startColumn: i + 1, endColumn: j + 1, type: 'function' });
          } else if (braceDepth > 0 && !afterColon) {
            // Check if followed by `:` (property declaration)
            let k = j;
            while (k < len && (line[k] === ' ' || line[k] === '\t')) k++;
            tokens.push({
              startColumn: i + 1,
              endColumn: j + 1,
              type: line[k] === ':' ? 'property' : 'selector',
            });
          } else if (afterColon) {
            tokens.push({
              startColumn: i + 1,
              endColumn: j + 1,
              type: CSS_KEYWORDS.has(word) ? 'keyword' : 'string',
            });
          } else {
            tokens.push({ startColumn: i + 1, endColumn: j + 1, type: 'tag' });
          }
          i = j;
          continue;
        }

        if ('>+~*=|^$'.includes(ch)) {
          tokens.push({ startColumn: i + 1, endColumn: i + 2, type: 'operator' });
          i++;
          continue;
        }

        if (ch.charCodeAt(0) > 0x7f) {
          const j = scanNonAsciiRun(line, i, len);
          tokens.push({ startColumn: i + 1, endColumn: j + 1, type: 'plain' });
          i = j;
          continue;
        }

        tokens.push({ startColumn: i + 1, endColumn: i + 2, type: 'punctuation' });
        i++;
      }

      return { tokens, endState: internCss(inComment, braceDepth) };
    },
  };
}
