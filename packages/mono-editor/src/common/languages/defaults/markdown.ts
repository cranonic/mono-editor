import {
  coalesceLanguageSegments,
  delegateEmbeddedSlice,
  isOverTimeBudget,
  nowMs,
  resolveLineBudget,
  scanNonAsciiRun,
} from '../tokenization/monarchEngine';
import { StateInterner } from '../tokenization/stateInterner';
import type { LanguageSegment, MonoToken } from '../tokenization/tokenTypes';
import { languages, type LineTokenizeResult, type MonoTokensProvider, type TokenizeLineOptions } from '../tokenization/TokensProvider';

type MdState =
  | { kind: 'root' }
  | { kind: 'mathBlock' }
  | { kind: 'fence'; marker: string; langId: string; innerState: unknown };

const mdInterner = new StateInterner<MdState>();
const MD_ROOT_ID = mdInterner.intern('root', () => ({ kind: 'root' }));

function stateKeyOf(v: unknown): string {
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return String(v);
  if (v == null) return 'null';
  try { return JSON.stringify(v); } catch { return 'obj'; }
}

function internMd(s: MdState): number {
  if (s.kind === 'root') return MD_ROOT_ID;
  if (s.kind === 'mathBlock') return mdInterner.intern('math', () => ({ kind: 'mathBlock' }));
  return mdInterner.intern(
    `f:${s.marker}:${s.langId}:${stateKeyOf(s.innerState)}`,
    () => ({ ...s }),
  );
}

function normalizeFenceLang(raw: string): string {
  const id = raw.trim().toLowerCase().split(/[\s{]/)[0] ?? '';
  const map: Record<string, string> = {
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    jsx: 'jsx',
    ts: 'typescript',
    tsx: 'tsx',
    py: 'python',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    yml: 'yaml',
    md: 'markdown',
    'c++': 'cpp',
    cxx: 'cpp',
    cc: 'cpp',
    h: 'cpp',
    hpp: 'cpp',
    htm: 'html',
    xml: 'html',
    svg: 'html',
  };
  return map[id] ?? id;
}

/**
 * Rich stateful Markdown tokenizer with:
 * - Embedded syntax highlighting inside fenced code blocks (delegated to registered Mono tokenizers)
 * - Inline `$...$` and multiline display `$$...$$` LaTeX math highlighting
 * - Headings, bold, italic, strikethrough, inline code, links/images, tables, blockquotes, task lists
 */
export function createMarkdownTokensProvider(languageId = 'markdown'): MonoTokensProvider {
  return {
    languageId,
    getInitialState: () => MD_ROOT_ID,
    tokenizeLine(
      line: string,
      state: unknown,
      options?: TokenizeLineOptions,
    ): LineTokenizeResult {
      const { maxLineLength, timeBudgetMs } = resolveLineBudget(options);
      const len = line.length;
      const incomingId = typeof state === 'number' ? state : MD_ROOT_ID;
      let cur: MdState = mdInterner.get(incomingId) ?? { kind: 'root' };

      if (len === 0) {
        const segs =
          cur.kind === 'fence' && cur.langId
            ? [{ startColumn: 1, endColumn: 1, languageId: cur.langId }]
            : undefined;
        return { tokens: [], endState: incomingId, languageSegments: segs };
      }
      if (len > maxLineLength) {
        return {
          tokens: [{ startColumn: 1, endColumn: len + 1, type: 'plain' }],
          endState: incomingId,
        };
      }

      const tokens: MonoToken[] = [];
      const segments: LanguageSegment[] = [];

      // 1. Inside multiline display math block `$$ ... $$`
      if (cur.kind === 'mathBlock') {
        if (/^\s*\$\$\s*$/.test(line)) {
          tokens.push({ startColumn: 1, endColumn: len + 1, type: 'templateDelimiter' });
          return { tokens, endState: MD_ROOT_ID };
        }
        tokens.push({ startColumn: 1, endColumn: len + 1, type: 'math' });
        return { tokens, endState: incomingId };
      }

      // 2. Inside fenced code block
      if (cur.kind === 'fence') {
        const trimmed = line.trim();
        if (trimmed.startsWith(cur.marker) && /^(`{3,}|~{3,})$/.test(trimmed) && trimmed.length >= cur.marker.length) {
          tokens.push({ startColumn: 1, endColumn: len + 1, type: 'comment' });
          return { tokens, endState: MD_ROOT_ID };
        }
        if (cur.langId && cur.langId !== 'mermaid' && languages.getTokensProvider(cur.langId)) {
          const nextInner = delegateEmbeddedSlice(cur.langId, line, 0, cur.innerState, tokens, options);
          segments.push({ startColumn: 1, endColumn: len + 1, languageId: cur.langId });
          return {
            tokens,
            endState: internMd({ ...cur, innerState: nextInner }),
            languageSegments: coalesceLanguageSegments(segments, languageId),
          };
        }
        if (cur.langId === 'mermaid') {
          tokenizeMermaidLine(line, tokens);
          segments.push({ startColumn: 1, endColumn: len + 1, languageId: 'mermaid' });
          return {
            tokens,
            endState: incomingId,
            languageSegments: coalesceLanguageSegments(segments, languageId),
          };
        }
        tokens.push({ startColumn: 1, endColumn: len + 1, type: 'codeInline' });
        return { tokens, endState: incomingId };
      }

      // 3. Root Markdown block openers
      const fenceOpen = /^(\s*)(`{3,}|~{3,})([^\n]*)$/.exec(line);
      if (fenceOpen) {
        const indentLen = fenceOpen[1]!.length;
        const marker = fenceOpen[2]!;
        const info = fenceOpen[3]!;
        tokens.push({ startColumn: indentLen + 1, endColumn: indentLen + marker.length + 1, type: 'comment' });
        if (info.length > 0) {
          tokens.push({
            startColumn: indentLen + marker.length + 1,
            endColumn: len + 1,
            type: 'type',
          });
        }
        const normLang = normalizeFenceLang(info);
        const innerProv = normLang && normLang !== 'mermaid' ? languages.getTokensProvider(normLang) : undefined;
        return {
          tokens,
          endState: internMd({
            kind: 'fence',
            marker,
            langId: normLang,
            innerState: innerProv?.getInitialState(),
          }),
        };
      }

      // Display math block `$$` on its own line (or single-line `$$ ... $$`)
      const singleMath = /^(\s*)(\$\$)(.+)(\$\$)\s*$/.exec(line);
      if (singleMath) {
        const p0 = singleMath[1]!.length;
        tokens.push({ startColumn: p0 + 1, endColumn: p0 + 3, type: 'templateDelimiter' });
        tokens.push({ startColumn: p0 + 3, endColumn: p0 + 3 + singleMath[3]!.length, type: 'math' });
        tokens.push({
          startColumn: p0 + 3 + singleMath[3]!.length,
          endColumn: p0 + 5 + singleMath[3]!.length,
          type: 'templateDelimiter',
        });
        return { tokens, endState: MD_ROOT_ID };
      }
      if (/^\s*\$\$\s*$/.test(line)) {
        tokens.push({ startColumn: 1, endColumn: len + 1, type: 'templateDelimiter' });
        return { tokens, endState: internMd({ kind: 'mathBlock' }) };
      }

      // Headings
      const heading = /^(\s*)(#{1,6})(\s+)(.*)$/.exec(line);
      if (heading) {
        const p = heading[1]!.length;
        tokens.push({ startColumn: p + 1, endColumn: len + 1, type: 'heading' });
        return { tokens, endState: MD_ROOT_ID };
      }

      // Horizontal rule
      if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) {
        tokens.push({ startColumn: 1, endColumn: len + 1, type: 'operator' });
        return { tokens, endState: MD_ROOT_ID };
      }

      // Blockquote
      if (/^\s*>/.test(line)) {
        tokens.push({ startColumn: 1, endColumn: len + 1, type: 'comment' });
        return { tokens, endState: MD_ROOT_ID };
      }

      // Inline Markdown scan with time budget
      const startMs = nowMs();
      let i = 0;
      let steps = 0;

      // Optional list bullet / task checkbox prefix
      const listPrefix = /^(\s*)(?:[-*+]|\d+\.)\s+(?:\[([ xX])\]\s+)?/.exec(line);
      if (listPrefix) {
        tokens.push({ startColumn: 1, endColumn: listPrefix[0].length + 1, type: 'operator' });
        i = listPrefix[0].length;
      }

      while (i < len) {
        if (isOverTimeBudget(startMs, timeBudgetMs, ++steps)) {
          tokens.push({ startColumn: i + 1, endColumn: len + 1, type: 'plain' });
          break;
        }
        const ch = line[i]!;

        // Inline code `...`
        if (ch === '`') {
          const end = line.indexOf('`', i + 1);
          if (end > i) {
            tokens.push({ startColumn: i + 1, endColumn: end + 2, type: 'codeInline' });
            i = end + 1;
            continue;
          }
        }

        // Inline math $...$
        if (ch === '$' && line[i + 1] !== '$' && line[i + 1] !== ' ') {
          let j = i + 1;
          while (j < len) {
            if (line[j] === '\\') { j += 2; continue; }
            if (line[j] === '$' && line[j - 1] !== ' ') break;
            j++;
          }
          if (j < len && line[j] === '$' && j > i + 1) {
            tokens.push({ startColumn: i + 1, endColumn: i + 2, type: 'templateDelimiter' });
            tokens.push({ startColumn: i + 2, endColumn: j + 1, type: 'math' });
            tokens.push({ startColumn: j + 1, endColumn: j + 2, type: 'templateDelimiter' });
            i = j + 1;
            continue;
          }
        }

        // Links & images ![alt](url) or [text](url)
        if (ch === '[' || (ch === '!' && line[i + 1] === '[')) {
          const m = /^!?\[([^\]]*)\]\(([^)]*)\)/.exec(line.slice(i));
          if (m) {
            const bracketEnd = i + m[0].indexOf('](') + 1;
            tokens.push({ startColumn: i + 1, endColumn: bracketEnd + 1, type: 'link' });
            tokens.push({ startColumn: bracketEnd + 1, endColumn: i + m[0].length + 1, type: 'string' });
            i += m[0].length;
            continue;
          }
        }

        // Strong **...** or __...__
        if ((ch === '*' && line[i + 1] === '*') || (ch === '_' && line[i + 1] === '_')) {
          const delim = ch + ch;
          const end = line.indexOf(delim, i + 2);
          if (end > i + 2) {
            tokens.push({ startColumn: i + 1, endColumn: end + 3, type: 'strong' });
            i = end + 2;
            continue;
          }
        }

        // Strikethrough ~~...~~
        if (ch === '~' && line[i + 1] === '~') {
          const end = line.indexOf('~~', i + 2);
          if (end > i + 2) {
            tokens.push({ startColumn: i + 1, endColumn: end + 3, type: 'comment' });
            i = end + 2;
            continue;
          }
        }

        // Emphasis *...*
        if (ch === '*' && line[i + 1] !== ' ' && line[i + 1] !== '*') {
          const end = line.indexOf('*', i + 1);
          if (end > i + 1) {
            tokens.push({ startColumn: i + 1, endColumn: end + 2, type: 'emphasis' });
            i = end + 1;
            continue;
          }
        }

        // Table pipe separator
        if (ch === '|') {
          tokens.push({ startColumn: i + 1, endColumn: i + 2, type: 'punctuation' });
          i++;
          continue;
        }

        // HTML comment / inline HTML tag
        if (ch === '<') {
          const cm = /^<!--[\s\S]*?-->/.exec(line.slice(i));
          if (cm) {
            tokens.push({ startColumn: i + 1, endColumn: i + cm[0].length + 1, type: 'comment' });
            i += cm[0].length;
            continue;
          }
          const tm = /^<\/?[a-zA-Z][\w:-]*(?:\s+[^>]*)?>/.exec(line.slice(i));
          if (tm) {
            tokens.push({ startColumn: i + 1, endColumn: i + tm[0].length + 1, type: 'tag' });
            i += tm[0].length;
            continue;
          }
        }

        let next = i + 1;
        while (next < len && !'`$[!*_~|<'.includes(line[next]!)) next++;
        tokens.push({ startColumn: i + 1, endColumn: next + 1, type: 'plain' });
        i = next;
      }

      return { tokens, endState: MD_ROOT_ID };
    },
  };
}

const MERMAID_KW = new Set([
  'graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 'stateDiagram', 'stateDiagram-v2',
  'erDiagram', 'gantt', 'pie', 'gitGraph', 'mindmap', 'timeline', 'subgraph', 'end',
  'participant', 'actor', 'Note', 'loop', 'alt', 'else', 'opt', 'par', 'and', 'rect',
  'classDef', 'class', 'style', 'linkStyle', 'click', 'TD', 'TB', 'BT', 'RL', 'LR',
]);

function tokenizeMermaidLine(line: string, tokens: MonoToken[]): void {
  const len = line.length;
  let i = 0;
  while (i < len) {
    if (line[i] === ' ' || line[i] === '\t') { i++; continue; }
    if (line.startsWith('%%', i)) {
      tokens.push({ startColumn: i + 1, endColumn: len + 1, type: 'comment' });
      return;
    }
    if (line[i] === '"') {
      let j = i + 1;
      while (j < len && line[j] !== '"') j++;
      tokens.push({ startColumn: i + 1, endColumn: Math.min(len, j + 1) + 1, type: 'string' });
      i = Math.min(len, j + 1);
      continue;
    }
    const arrow = /^(?:-->|-->>|->>|==>|-\.-?>|---|===|<-->)/.exec(line.slice(i));
    if (arrow) {
      tokens.push({ startColumn: i + 1, endColumn: i + arrow[0].length + 1, type: 'operator' });
      i += arrow[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(line[i]!)) {
      let j = i + 1;
      while (j < len && /[A-Za-z0-9_-]/.test(line[j]!)) j++;
      const w = line.slice(i, j);
      tokens.push({ startColumn: i + 1, endColumn: j + 1, type: MERMAID_KW.has(w) ? 'keywordControl' : 'variable' });
      i = j;
      continue;
    }
    if (line.charCodeAt(i) > 0x7f) {
      const j = scanNonAsciiRun(line, i, len);
      tokens.push({ startColumn: i + 1, endColumn: j + 1, type: 'plain' });
      i = j;
      continue;
    }
    tokens.push({ startColumn: i + 1, endColumn: i + 2, type: 'punctuation' });
    i++;
  }
}
