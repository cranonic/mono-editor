import type { FoldingMarkers } from '../../languages/languageConfigurationTypes';
import type { TextModel } from '../../model/TextModel';
import {
  StructureKind,
  type StructureKeywordPair,
  type StructureLanguageRules,
  type StructureNodeDraft,
} from '../types';

const DEFAULT_SHELL_PAIRS: readonly StructureKeywordPair[] = [
  { open: /^\s*if\b/, close: /^\s*fi\b/ },
  { open: /^\s*case\b/, close: /^\s*esac\b/ },
  { open: /\b(?:for|while|until|select)\b.*\bdo\b|^\s*do\b/, close: /^\s*done\b/ },
  { open: /\{\s*$/, close: /^\s*\}/ },
];

const DEFAULT_SQL_PAIRS: readonly StructureKeywordPair[] = [
  { open: /\bBEGIN\b/i, close: /\bEND\b/i },
  { open: /\bCASE\b/i, close: /\bEND\b/i },
  { open: /\(\s*$/, close: /^\s*\)/ },
];

const DEFAULT_GENERIC_PAIRS: readonly StructureKeywordPair[] = [
  { open: /^\s*(?:def|class|module|if|unless|case|while|until|for|begin|do|function)\b/, close: /^\s*end\b/ },
];

/**
 * S4: Keyword-pair structure engine for Shell, SQL, Ruby, Lua, etc.
 */
export function buildKeywordNodes(
  model: TextModel,
  rules: StructureLanguageRules,
  opts: { languageId?: string; markers?: FoldingMarkers } = {},
): StructureNodeDraft[] {
  const lang = (opts.languageId ?? model.getLanguageId()).toLowerCase();
  const pairs = rules.keywordPairs?.length
    ? rules.keywordPairs
    : lang === 'shell' || lang === 'bash' || lang === 'sh' || lang === 'zsh'
      ? DEFAULT_SHELL_PAIRS
      : lang === 'sql'
        ? DEFAULT_SQL_PAIRS
        : DEFAULT_GENERIC_PAIRS;

  const lineComment = rules.commentLinePrefix ?? (lang === 'sql' ? '--' : '#');
  const regionStart = opts.markers?.start ?? rules.regionMarkers?.start ?? /^\s*(?:#|--)\s*#?region\b/i;
  const regionEnd = opts.markers?.end ?? rules.regionMarkers?.end ?? /^\s*(?:#|--)\s*#?endregion\b/i;

  const lineCount = model.getLineCount();
  const nodes: StructureNodeDraft[] = [];
  const stack: Array<{ line: number; pairIdx: number }> = [];
  const regionStack: number[] = [];
  let commentRunStart = -1;

  for (let ln = 1; ln <= lineCount; ln++) {
    const raw = model.getLineContent(ln);
    const trimmed = raw.trimStart();

    if (trimmed.length === 0) {
      if (commentRunStart !== -1 && ln - 1 > commentRunStart) {
        nodes.push({ startLine: commentRunStart, endLine: ln - 1, foldEndLine: ln - 1, kind: StructureKind.Comment });
      }
      commentRunStart = -1;
      continue;
    }

    if (lineComment && trimmed.startsWith(lineComment)) {
      if (regionStart.test(raw)) {
        regionStack.push(ln);
      } else if (regionEnd.test(raw) && regionStack.length > 0) {
        const s = regionStack.pop()!;
        if (ln > s) nodes.push({ startLine: s, endLine: ln, foldEndLine: ln, kind: StructureKind.Region });
      } else if (commentRunStart === -1) {
        commentRunStart = ln;
      }
      continue;
    }

    if (commentRunStart !== -1) {
      if (ln - 1 > commentRunStart) {
        nodes.push({ startLine: commentRunStart, endLine: ln - 1, foldEndLine: ln - 1, kind: StructureKind.Comment });
      }
      commentRunStart = -1;
    }

    // Strip trailing inline comment
    const code = lineComment ? raw.split(lineComment)[0]! : raw;

    // Check closes first (handles `if ...; then ...; fi` on one line safely)
    let matchedClose = false;
    for (let p = 0; p < pairs.length; p++) {
      const pair = pairs[p]!;
      if (pair.close.test(code)) {
        if (pair.open.test(code)) {
          // Single-line open+close: ignore
          matchedClose = true;
          break;
        }
        // Pop matching open
        for (let s = stack.length - 1; s >= 0; s--) {
          if (stack[s]!.pairIdx === p) {
            const open = stack[s]!;
            stack.length = s;
            if (ln > open.line) {
              const foldEnd = ln - 1;
              nodes.push({
                startLine: open.line,
                endLine: ln,
                foldEndLine: foldEnd > open.line ? foldEnd : open.line,
                kind: StructureKind.Keyword,
              });
            }
            matchedClose = true;
            break;
          }
        }
        if (matchedClose) break;
      }
    }
    if (matchedClose) continue;

    for (let p = 0; p < pairs.length; p++) {
      if (pairs[p]!.open.test(code)) {
        stack.push({ line: ln, pairIdx: p });
        break;
      }
    }
  }

  if (commentRunStart !== -1 && lineCount > commentRunStart) {
    nodes.push({ startLine: commentRunStart, endLine: lineCount, foldEndLine: lineCount, kind: StructureKind.Comment });
  }

  return nodes;
}
