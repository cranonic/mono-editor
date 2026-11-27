import type { FoldingMarkers } from '../../languages/languageConfigurationTypes';
import type { TextModel } from '../../model/TextModel';
import {
  StructureKind,
  type StructureLanguageRules,
  type StructureNodeDraft,
} from '../types';

function measureIndent(line: string, tabSize: number): number {
  let w = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === ' ') w++;
    else if (ch === '\t') w += tabSize - (w % tabSize);
    else return w;
  }
  return -1;
}

/**
 * S2: Off-side indentation structure engine for Python, YAML, CoffeeScript, Nim, etc.
 * Handles multi-line bracket continuations (`(...)`, `[...]`, `{...}`), triple-quoted
 * docstrings (`"""` / `'''`), `#region`/`#endregion`, consecutive `#` comment runs,
 * and trims trailing blank lines from folded blocks.
 */
export function buildOffsideNodes(
  model: TextModel,
  rules: StructureLanguageRules,
  opts: {
    tabSize?: number;
    maxLineLength?: number;
    languageId?: string;
    markers?: FoldingMarkers;
  } = {},
): StructureNodeDraft[] {
  const lineCount = model.getLineCount();
  const tabSize = Math.max(1, opts.tabSize ?? model.getOptions().tabSize ?? 4);
  const maxLen = opts.maxLineLength ?? 20_000;
  const lang = (opts.languageId ?? model.getLanguageId()).toLowerCase();
  const isPython = lang === 'python' || lang === 'py';

  const nodes: StructureNodeDraft[] = [];
  const logicalIndent = new Int32Array(lineCount + 1).fill(-1);
  const isContinuation = new Uint8Array(lineCount + 1);
  const isCommentOnly = new Uint8Array(lineCount + 1);

  const regionStart = opts.markers?.start ?? rules.regionMarkers?.start ?? /^\s*#\s*region\b/i;
  const regionEnd = opts.markers?.end ?? rules.regionMarkers?.end ?? /^\s*#\s*endregion\b/i;
  const regionStack: number[] = [];

  let tripleQuote: '"""' | "'''" | null = null;
  let tripleStart = -1;
  let bracketDepth = 0;
  let bracketStart = -1;

  for (let ln = 1; ln <= lineCount; ln++) {
    const raw = model.getLineContent(ln);
    const len = Math.min(raw.length, maxLen);
    const trimmed = raw.trimStart();

    if (tripleQuote) {
      isContinuation[ln] = 1;
      let i = 0;
      while (i < len) {
        if (raw[i] === '\\') { i += 2; continue; }
        if (raw.startsWith(tripleQuote, i)) {
          if (ln > tripleStart) {
            nodes.push({
              startLine: tripleStart,
              endLine: ln,
              foldEndLine: ln,
              kind: StructureKind.Comment,
            });
          }
          tripleQuote = null;
          tripleStart = -1;
          i += 3;
          break;
        }
        i++;
      }
      continue;
    }

    if (trimmed.length === 0) continue;

    if (trimmed.startsWith('#')) {
      if (regionStart.test(raw)) {
        regionStack.push(ln);
      } else if (regionEnd.test(raw) && regionStack.length > 0) {
        const s = regionStack.pop()!;
        if (ln > s) nodes.push({ startLine: s, endLine: ln, foldEndLine: ln, kind: StructureKind.Region });
      } else {
        isCommentOnly[ln] = 1;
      }
      continue;
    }

    const wasInBracket = bracketDepth > 0;
    if (wasInBracket) isContinuation[ln] = 1;
    else logicalIndent[ln] = measureIndent(raw, tabSize);

    // Scan brackets & triple-quoted strings on this line
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < len; i++) {
      const ch = raw[i]!;
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
      if (ch === '#') break;
      if (isPython && (raw.startsWith('"""', i) || raw.startsWith("'''", i))) {
        const q = raw.slice(i, i + 3) as '"""' | "'''";
        const closeAt = raw.indexOf(q, i + 3);
        if (closeAt !== -1) {
          i = closeAt + 2;
          continue;
        }
        tripleQuote = q;
        tripleStart = ln;
        break;
      }
      if (ch === "'") { inSingle = true; continue; }
      if (ch === '"') { inDouble = true; continue; }
      if (ch === '(' || ch === '[' || ch === '{') {
        if (bracketDepth === 0) bracketStart = ln;
        bracketDepth++;
      } else if (ch === ')' || ch === ']' || ch === '}') {
        if (bracketDepth > 0) {
          bracketDepth--;
          if (bracketDepth === 0 && bracketStart > 0 && ln > bracketStart) {
            const foldEnd = ln - 1;
            if (foldEnd > bracketStart) {
              nodes.push({
                startLine: bracketStart,
                endLine: ln,
                foldEndLine: foldEnd,
                kind: StructureKind.Block,
              });
            }
            bracketStart = -1;
          }
        }
      }
    }
  }

  // Consecutive # comment runs (2+ lines)
  let cStart = -1;
  for (let ln = 1; ln <= lineCount + 1; ln++) {
    if (ln <= lineCount && isCommentOnly[ln] === 1) {
      if (cStart === -1) cStart = ln;
    } else if (cStart !== -1) {
      if (ln - 1 > cStart) {
        nodes.push({ startLine: cStart, endLine: ln - 1, foldEndLine: ln - 1, kind: StructureKind.Comment });
      }
      cStart = -1;
    }
  }

  // Consecutive Python import runs
  if (isPython) {
    let impStart = -1;
    for (let ln = 1; ln <= lineCount + 1; ln++) {
      const isImp = ln <= lineCount && /^\s*(?:import\s+|from\s+\S+\s+import\s+)/.test(model.getLineContent(ln));
      if (isImp) {
        if (impStart === -1) impStart = ln;
      } else if (impStart !== -1) {
        if (ln - 1 > impStart) {
          nodes.push({ startLine: impStart, endLine: ln - 1, foldEndLine: ln - 1, kind: StructureKind.Imports });
        }
        impStart = -1;
      }
    }
  }

  // Off-side indentation scope sweep
  for (let ln = 1; ln <= lineCount; ln++) {
    const ind = logicalIndent[ln]!;
    if (ind < 0) continue;
    let lastBody = ln;
    for (let j = ln + 1; j <= lineCount; j++) {
      if (isContinuation[j] === 1) {
        lastBody = j;
        continue;
      }
      const jInd = logicalIndent[j]!;
      if (jInd < 0) continue;
      if (jInd <= ind) break;
      lastBody = j;
    }
    if (lastBody > ln) {
      nodes.push({
        startLine: ln,
        endLine: lastBody,
        foldEndLine: lastBody,
        kind: StructureKind.Offside,
      });
    }
  }

  return nodes;
}
