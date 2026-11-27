import type { FoldingMarkers } from '../../languages/languageConfigurationTypes';
import type { TextModel } from '../../model/TextModel';
import { scanDocumentBrackets, type LineTokensProvider } from '../bracketScan';
import {
  StructureKind,
  type StructureLanguageRules,
  type StructureNodeDraft,
} from '../types';

const DEFAULT_REGION_START = /^\s*(?:\/\/|#|\/\*|<!--|--)\s*#?region\b/i;
const DEFAULT_REGION_END = /^\s*(?:\/\/|#|\/\*|<!--|--)\s*#?endregion\b/i;
const DEFAULT_IMPORT_RE = /^\s*(?:import\b|from\s+\S+\s+import\b|#\s*include\b|using\b|use\b|require\s*\()/;

/**
 * S1: Token-aware brackets, comments, strings, imports, and `#region` folding engine.
 * Works for JS/TS, Java, C/C++, C#, Rust, Go, CSS/SCSS, JSON, PHP, etc.
 */
export function buildBracketNodes(
  model: TextModel,
  rules: StructureLanguageRules,
  opts: {
    maxLineLength?: number;
    getLineTokens?: LineTokensProvider;
    languageId?: string;
    markers?: FoldingMarkers;
  } = {},
): StructureNodeDraft[] {
  const lang = (opts.languageId ?? model.getLanguageId()).toLowerCase();
  const isCss = lang === 'css' || lang === 'scss' || lang === 'less';
  const isJson = lang === 'json' || lang === 'jsonc';
  const isSql = lang === 'sql';
  const supportsBacktick = !isCss && !isJson && !isSql;
  const supportsRegex = lang === 'javascript' || lang === 'typescript' || lang === 'javascriptreact' || lang === 'typescriptreact';

  const scan = scanDocumentBrackets(model, {
    pairs: rules.brackets,
    lineComment: rules.commentLinePrefix ?? (isCss ? null : isSql ? '--' : '//'),
    blockComment: rules.blockComment ?? (isJson ? null : ['/*', '*/']),
    maxLineLength: opts.maxLineLength,
    supportsBacktick,
    supportsRegex,
    getLineTokens: opts.getLineTokens,
  });

  const nodes: StructureNodeDraft[] = [];
  const lineCount = model.getLineCount();

  // 1. Region markers (#region / #endregion)
  const regionStart = opts.markers?.start ?? rules.regionMarkers?.start ?? DEFAULT_REGION_START;
  const regionEnd = opts.markers?.end ?? rules.regionMarkers?.end ?? DEFAULT_REGION_END;
  const regionStack: number[] = [];
  for (let ln = 1; ln <= lineCount; ln++) {
    const line = model.getLineContent(ln);
    if (regionStart.test(line)) {
      regionStack.push(ln);
    } else if (regionEnd.test(line) && regionStack.length > 0) {
      const s = regionStack.pop()!;
      if (ln > s) {
        nodes.push({ startLine: s, endLine: ln, foldEndLine: ln, kind: StructureKind.Region });
      }
    }
  }

  // 2. Multi-line block comments and template strings
  for (const span of scan.blockCommentSpans) {
    if (span.endLine > span.startLine) {
      nodes.push({
        startLine: span.startLine,
        endLine: span.endLine,
        foldEndLine: span.endLine,
        kind: StructureKind.Comment,
      });
    }
  }
  for (const span of scan.multilineStringSpans) {
    if (span.endLine > span.startLine) {
      nodes.push({
        startLine: span.startLine,
        endLine: span.endLine,
        foldEndLine: span.endLine - 1 > span.startLine ? span.endLine - 1 : span.endLine,
        kind: StructureKind.Block,
      });
    }
  }

  // 3. Consecutive line-comment runs (2+ lines) & consecutive import runs (2+ lines)
  const importRe = rules.importPattern ?? DEFAULT_IMPORT_RE;
  let commentRunStart = -1;
  let importRunStart = -1;
  for (let ln = 1; ln <= lineCount + 1; ln++) {
    const isLineComment = ln <= lineCount && scan.lineCommentOnly[ln] === 1;
    if (isLineComment) {
      const txt = model.getLineContent(ln);
      if (regionStart.test(txt) || regionEnd.test(txt)) {
        if (commentRunStart !== -1 && ln - 1 > commentRunStart) {
          nodes.push({ startLine: commentRunStart, endLine: ln - 1, foldEndLine: ln - 1, kind: StructureKind.Comment });
        }
        commentRunStart = -1;
      } else if (commentRunStart === -1) {
        commentRunStart = ln;
      }
    } else if (commentRunStart !== -1) {
      if (ln - 1 > commentRunStart) {
        nodes.push({ startLine: commentRunStart, endLine: ln - 1, foldEndLine: ln - 1, kind: StructureKind.Comment });
      }
      commentRunStart = -1;
    }

    const isImport = ln <= lineCount && !isLineComment && importRe.test(model.getLineContent(ln));
    if (isImport) {
      if (importRunStart === -1) importRunStart = ln;
    } else if (importRunStart !== -1) {
      if (ln - 1 > importRunStart) {
        nodes.push({ startLine: importRunStart, endLine: ln - 1, foldEndLine: ln - 1, kind: StructureKind.Imports });
      }
      importRunStart = -1;
    }
  }

  // 4. Matched bracket pairs (mismatch-safe stack per pair kind)
  const stack: Array<{ line: number; col: number; pairIdx: number }> = [];
  for (let i = 0; i < scan.brackets.length; i++) {
    const tok = scan.brackets[i]!;
    if (tok.isOpen) {
      stack.push({ line: tok.line, col: tok.col, pairIdx: tok.pairIdx });
      continue;
    }
    // Search back up to 16 entries for matching pairIdx (safe against stray unmatched openers)
    let matchIdx = -1;
    const minIdx = Math.max(0, stack.length - 16);
    for (let s = stack.length - 1; s >= minIdx; s--) {
      if (stack[s]!.pairIdx === tok.pairIdx) {
        matchIdx = s;
        break;
      }
    }
    if (matchIdx === -1) continue;
    const open = stack[matchIdx]!;
    stack.length = matchIdx;
    if (tok.line > open.line) {
      // VS Code closer-on-code-line rule: closing bracket line remains visible (`foldEndLine = tok.line - 1`)
      const foldEnd = tok.line - 1;
      nodes.push({
        startLine: open.line,
        endLine: tok.line,
        foldEndLine: foldEnd > open.line ? foldEnd : open.line,
        startCol: open.col,
        endCol: tok.col,
        kind: StructureKind.Block,
      });
    }
  }

  return nodes;
}
