import {
  coalesceLanguageSegments,
  delegateEmbeddedSlice,
  isOverTimeBudget,
  nowMs,
  resolveLineBudget,
} from '../tokenization/monarchEngine';
import { StateInterner } from '../tokenization/stateInterner';
import type { LanguageSegment, MonoToken } from '../tokenization/tokenTypes';
import { languages, type LineTokenizeResult, type MonoTokensProvider, type TokenizeLineOptions } from '../tokenization/TokensProvider';

type HtmlMode =
  | { kind: 'root' }
  | { kind: 'comment' }
  | { kind: 'openTag'; tagName: string; scriptLang: string }
  | { kind: 'embedded'; tagName: 'style' | 'script'; langId: string; innerState: unknown };

const htmlInterner = new StateInterner<HtmlMode>();
const HTML_ROOT_ID = htmlInterner.intern('root', () => ({ kind: 'root' }));

function stateKeyOf(v: unknown): string {
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return String(v);
  if (v == null) return 'null';
  try { return JSON.stringify(v); } catch { return 'obj'; }
}

function internHtml(m: HtmlMode): number {
  if (m.kind === 'root') return HTML_ROOT_ID;
  if (m.kind === 'comment') return htmlInterner.intern('comment', () => ({ kind: 'comment' }));
  if (m.kind === 'openTag') {
    return htmlInterner.intern(`tag:${m.tagName}:${m.scriptLang}`, () => ({ ...m }));
  }
  return htmlInterner.intern(
    `emb:${m.tagName}:${m.langId}:${stateKeyOf(m.innerState)}`,
    () => ({ ...m }),
  );
}

/**
 * Determine embedded language for `<script>` attributes per HTML5 / TypeScript conventions:
 * - default / `type="module"` / `type="text/javascript"` / `type="application/javascript"` -> 'javascript'
 * - `lang="ts"` / `type="text/typescript"` / `type="application/typescript"` -> 'typescript'
 * - `type="application/json"` / `type="application/ld+json"` / `type="importmap"` -> 'json'
 * - unknown non-JS MIME types (e.g. `text/template`) -> 'plaintext'
 */
function resolveScriptAttrLang(attrName: string, attrVal: string, current: string): string {
  const name = attrName.toLowerCase();
  const val = attrVal.trim().toLowerCase();
  if (name === 'lang') {
    if (val === 'ts' || val === 'typescript' || val === 'tsx') return 'typescript';
    if (val === 'js' || val === 'javascript' || val === 'jsx') return 'javascript';
    return current;
  }
  if (name === 'type') {
    if (
      val === '' ||
      val === 'module' ||
      val === 'text/javascript' ||
      val === 'application/javascript' ||
      val === 'application/ecmascript' ||
      val === 'text/ecmascript'
    ) {
      return 'javascript';
    }
    if (val === 'text/typescript' || val === 'application/typescript' || val === 'ts') {
      return 'typescript';
    }
    if (
      val === 'application/json' ||
      val === 'application/ld+json' ||
      val === 'importmap' ||
      val === 'speculationrules'
    ) {
      return 'json';
    }
    return 'plaintext';
  }
  return current;
}

/**
 * HTML5 raw-text end-tag scanner:
 * Per HTML5 parsing spec, `</script` (followed by whitespace, `>`, or `/`) terminates a `<script>`
 * element even inside JS string literals (authors must write `<\/script>` in valid HTML).
 * Same rule applies to `</style`.
 */
function findRawEndTag(line: string, from: number, tagName: 'style' | 'script'): number {
  const needle = `</${tagName}`;
  const lower = line.toLowerCase();
  let pos = from;
  while (pos < line.length) {
    const idx = lower.indexOf(needle, pos);
    if (idx < 0) return -1;
    const after = line[idx + needle.length];
    if (
      after === undefined ||
      after === '>' ||
      after === '/' ||
      after === ' ' ||
      after === '\t' ||
      after === '\r'
    ) {
      return idx;
    }
    pos = idx + needle.length;
  }
  return -1;
}

/**
 * Stateful HTML5 tokenizer with embedded `<style>` (CSS) and `<script>` (JS/TS/JSON) delegation.
 * Emits compact per-line `languageSegments` (zero per-token languageId overhead).
 */
export function createHtmlTokensProvider(): MonoTokensProvider {
  return {
    languageId: 'html',
    getInitialState: () => HTML_ROOT_ID,
    tokenizeLine(
      line: string,
      state: unknown,
      options?: TokenizeLineOptions,
    ): LineTokenizeResult {
      const { maxLineLength, timeBudgetMs } = resolveLineBudget(options);
      const len = line.length;
      const incomingId = typeof state === 'number' ? state : HTML_ROOT_ID;
      let mode: HtmlMode = htmlInterner.get(incomingId) ?? { kind: 'root' };

      if (len === 0) {
        const segs =
          mode.kind === 'embedded'
            ? [{ startColumn: 1, endColumn: 1, languageId: mode.langId }]
            : undefined;
        return { tokens: [], endState: incomingId, languageSegments: segs };
      }
      if (len > maxLineLength) {
        const segs =
          mode.kind === 'embedded'
            ? [{ startColumn: 1, endColumn: len + 1, languageId: mode.langId }]
            : undefined;
        return {
          tokens: [{ startColumn: 1, endColumn: len + 1, type: 'plain' }],
          endState: incomingId,
          languageSegments: segs,
        };
      }

      const tokens: MonoToken[] = [];
      const segments: LanguageSegment[] = [];
      const startMs = nowMs();
      let i = 0;
      let steps = 0;

      while (i < len) {
        if (isOverTimeBudget(startMs, timeBudgetMs, ++steps)) {
          tokens.push({ startColumn: i + 1, endColumn: len + 1, type: 'plain' });
          break;
        }

        // 1. HTML comment
        if (mode.kind === 'comment') {
          const end = line.indexOf('-->', i);
          if (end < 0) {
            tokens.push({ startColumn: i + 1, endColumn: len + 1, type: 'comment' });
            i = len;
          } else {
            tokens.push({ startColumn: i + 1, endColumn: end + 4, type: 'comment' });
            i = end + 3;
            mode = { kind: 'root' };
          }
          continue;
        }

        // 2. Embedded <style> or <script> content
        if (mode.kind === 'embedded') {
          const endIdx = findRawEndTag(line, i, mode.tagName);
          const sliceEnd = endIdx >= 0 ? endIdx : len;
          if (sliceEnd > i) {
            const slice = line.slice(i, sliceEnd);
            const nextInner = delegateEmbeddedSlice(
              mode.langId,
              slice,
              i,
              mode.innerState,
              tokens,
              options,
            );
            segments.push({ startColumn: i + 1, endColumn: sliceEnd + 1, languageId: mode.langId });
            mode = { ...mode, innerState: nextInner };
            i = sliceEnd;
          }
          if (endIdx >= 0) {
            // Paint closing </style> or </script> in HTML mode
            const closeGt = line.indexOf('>', i);
            const tagNameEnd = i + 2 + mode.tagName.length;
            tokens.push({ startColumn: i + 1, endColumn: i + 3, type: 'punctuation' });
            tokens.push({ startColumn: i + 3, endColumn: tagNameEnd + 1, type: 'tag' });
            if (closeGt >= 0) {
              if (closeGt > tagNameEnd) {
                tokens.push({ startColumn: tagNameEnd + 1, endColumn: closeGt + 1, type: 'plain' });
              }
              tokens.push({ startColumn: closeGt + 1, endColumn: closeGt + 2, type: 'punctuation' });
              i = closeGt + 1;
            } else {
              i = tagNameEnd;
            }
            mode = { kind: 'root' };
          }
          continue;
        }

        // 3. Inside an opening tag `<tag attr="val" ...>`
        if (mode.kind === 'openTag') {
          const ch = line[i]!;
          if (ch === ' ' || ch === '\t') {
            i++;
            continue;
          }
          if (ch === '/' && line[i + 1] === '>') {
            tokens.push({ startColumn: i + 1, endColumn: i + 3, type: 'punctuation' });
            i += 2;
            mode = { kind: 'root' };
            continue;
          }
          if (ch === '>') {
            tokens.push({ startColumn: i + 1, endColumn: i + 2, type: 'punctuation' });
            i++;
            if (mode.tagName === 'style') {
              const cssProvider = languages.getTokensProvider('css');
              mode = {
                kind: 'embedded',
                tagName: 'style',
                langId: 'css',
                innerState: cssProvider?.getInitialState(),
              };
            } else if (mode.tagName === 'script') {
              const langId = mode.scriptLang || 'javascript';
              const innerProvider = languages.getTokensProvider(langId);
              mode = {
                kind: 'embedded',
                tagName: 'script',
                langId,
                innerState: innerProvider?.getInitialState(),
              };
            } else {
              mode = { kind: 'root' };
            }
            continue;
          }
          if (/[A-Za-z_:@-]/.test(ch)) {
            let j = i + 1;
            while (j < len && /[A-Za-z0-9_:.-]/.test(line[j]!)) j++;
            const attrName = line.slice(i, j);
            tokens.push({ startColumn: i + 1, endColumn: j + 1, type: 'attribute' });
            i = j;

            // Optional `= "value"` or `= 'value'` or `= unquoted`
            let k = i;
            while (k < len && (line[k] === ' ' || line[k] === '\t')) k++;
            if (line[k] === '=') {
              tokens.push({ startColumn: k + 1, endColumn: k + 2, type: 'operator' });
              k++;
              while (k < len && (line[k] === ' ' || line[k] === '\t')) k++;
              const q = line[k];
              if (q === '"' || q === "'") {
                let endQ = k + 1;
                while (endQ < len && line[endQ] !== q) endQ++;
                const rawVal = line.slice(k + 1, endQ);
                const fullEnd = endQ < len ? endQ + 1 : len;
                if (attrName.toLowerCase() === 'style' && rawVal.length > 0) {
                  // Highlight inline style="..." attribute using CSS tokenizer
                  tokens.push({ startColumn: k + 1, endColumn: k + 2, type: 'string' });
                  const cssProv = languages.getTokensProvider('css');
                  delegateEmbeddedSlice('css', rawVal, k + 1, cssProv?.getInitialState(), tokens, options);
                  segments.push({ startColumn: k + 2, endColumn: endQ + 1, languageId: 'css' });
                  if (endQ < len) {
                    tokens.push({ startColumn: endQ + 1, endColumn: endQ + 2, type: 'string' });
                  }
                } else {
                  tokens.push({ startColumn: k + 1, endColumn: fullEnd + 1, type: 'string' });
                }
                if (mode.tagName === 'script') {
                  mode = { ...mode, scriptLang: resolveScriptAttrLang(attrName, rawVal, mode.scriptLang) };
                }
                i = fullEnd;
              } else if (k < len && !/[\s/>]/.test(line[k]!)) {
                let endV = k + 1;
                while (endV < len && !/[\s/>]/.test(line[endV]!)) endV++;
                const rawVal = line.slice(k, endV);
                tokens.push({ startColumn: k + 1, endColumn: endV + 1, type: 'string' });
                if (mode.tagName === 'script') {
                  mode = { ...mode, scriptLang: resolveScriptAttrLang(attrName, rawVal, mode.scriptLang) };
                }
                i = endV;
              } else {
                i = k;
              }
            }
            continue;
          }
          tokens.push({ startColumn: i + 1, endColumn: i + 2, type: 'punctuation' });
          i++;
          continue;
        }

        // 4. Root HTML text mode
        const ch = line[i]!;
        // Comment start `<!--`
        if (ch === '<' && line.startsWith('<!--', i)) {
          const end = line.indexOf('-->', i + 4);
          if (end >= 0) {
            tokens.push({ startColumn: i + 1, endColumn: end + 4, type: 'comment' });
            i = end + 3;
          } else {
            tokens.push({ startColumn: i + 1, endColumn: len + 1, type: 'comment' });
            mode = { kind: 'comment' };
            i = len;
          }
          continue;
        }
        // DOCTYPE / declaration `<!DOCTYPE html>`
        if (ch === '<' && line[i + 1] === '!') {
          const end = line.indexOf('>', i + 2);
          const stop = end >= 0 ? end + 1 : len;
          tokens.push({ startColumn: i + 1, endColumn: stop + 1, type: 'macro' });
          i = stop;
          continue;
        }
        // Closing tag `</tag>`
        if (ch === '<' && line[i + 1] === '/' && i + 2 < len && /[A-Za-z]/.test(line[i + 2]!)) {
          let j = i + 3;
          while (j < len && /[A-Za-z0-9_:-]/.test(line[j]!)) j++;
          tokens.push({ startColumn: i + 1, endColumn: i + 3, type: 'punctuation' });
          tokens.push({ startColumn: i + 3, endColumn: j + 1, type: 'tag' });
          let k = j;
          while (k < len && (line[k] === ' ' || line[k] === '\t')) k++;
          if (line[k] === '>') {
            tokens.push({ startColumn: k + 1, endColumn: k + 2, type: 'punctuation' });
            i = k + 1;
          } else {
            i = j;
          }
          continue;
        }
        // Opening tag `<tag ...>`
        if (ch === '<' && i + 1 < len && /[A-Za-z]/.test(line[i + 1]!)) {
          let j = i + 2;
          while (j < len && /[A-Za-z0-9_:-]/.test(line[j]!)) j++;
          const tagName = line.slice(i + 1, j).toLowerCase();
          tokens.push({ startColumn: i + 1, endColumn: i + 2, type: 'punctuation' });
          tokens.push({ startColumn: i + 2, endColumn: j + 1, type: 'tag' });
          i = j;
          mode = {
            kind: 'openTag',
            tagName,
            scriptLang: tagName === 'script' ? 'javascript' : '',
          };
          continue;
        }
        // HTML entities `&amp;`, `&#x20;`
        if (ch === '&') {
          const m = /^&(?:#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/.exec(line.slice(i));
          if (m) {
            tokens.push({ startColumn: i + 1, endColumn: i + m[0].length + 1, type: 'constant' });
            i += m[0].length;
            continue;
          }
        }
        // Plain text run up to next `<` or `&`
        let next = i + 1;
        while (next < len && line[next] !== '<' && line[next] !== '&') next++;
        tokens.push({ startColumn: i + 1, endColumn: next + 1, type: 'plain' });
        i = next;
      }

      return {
        tokens,
        endState: internHtml(mode),
        languageSegments: coalesceLanguageSegments(segments, 'html'),
      };
    },
  };
}
