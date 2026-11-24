import type { IPosition } from '../core/types';
import type { ModelLike } from './providers/types';

export interface ActiveCallContext {
  /** Identifier / member expression immediately before the opening `(` (e.g. `fetchData`, `console.log`). */
  readonly calleeName: string;
  /** 1-based line number of the opening `(`. */
  readonly openParenLine: number;
  /** 1-based column of the opening `(`. */
  readonly openParenColumn: number;
  /** 0-based active argument index computed from top-level commas inside the call. */
  readonly activeParameter: number;
}

const MAX_SCAN_LINES = 40;

/**
 * Pure multi-line balanced-parenthesis call analyzer for live Signature Help.
 * Walks backward from `position` across up to 40 lines, ignoring quoted strings,
 * line comments, and nested `()`, `[]`, `{}` groups to find the innermost open call
 * expression and the 0-based active parameter index.
 */
export function analyzeCallContext(
  model: ModelLike,
  position: IPosition,
): ActiveCallContext | null {
  const startLine = Math.max(1, position.lineNumber);
  const minLine = Math.max(1, startLine - MAX_SCAN_LINES);

  // Build stripped chunks from minLine..position so comments/strings don't confuse paren/comma counts
  const lines: { lineNumber: number; text: string }[] = [];
  for (let ln = minLine; ln <= startLine; ln++) {
    const raw = model.getLineContent(ln) ?? '';
    const slice = ln === startLine ? raw.slice(0, Math.max(0, position.column - 1)) : raw;
    lines.push({ lineNumber: ln, text: slice });
  }

  // Forward-scan to strip strings & comments while preserving character positions 1:1
  const cleanLines: string[] = [];
  let inBlockComment = false;
  let inTemplate = false;

  for (const item of lines) {
    const s = item.text;
    const out = new Array<string>(s.length);
    let inQuote: string | null = null;

    for (let i = 0; i < s.length; i++) {
      const ch = s[i]!;
      const next = s[i + 1] ?? '';

      if (inBlockComment) {
        out[i] = ' ';
        if (ch === '*' && next === '/') {
          out[i + 1] = ' ';
          inBlockComment = false;
          i++;
        }
        continue;
      }

      if (inQuote) {
        out[i] = ' ';
        if (ch === '\\' && i + 1 < s.length) {
          out[i + 1] = ' ';
          i++;
        } else if (ch === inQuote) {
          inQuote = null;
        }
        continue;
      }

      if (inTemplate) {
        out[i] = ' ';
        if (ch === '\\' && i + 1 < s.length) {
          out[i + 1] = ' ';
          i++;
        } else if (ch === '`') {
          inTemplate = false;
        }
        continue;
      }

      if (ch === '/' && next === '/') {
        for (let k = i; k < s.length; k++) out[k] = ' ';
        break;
      }
      if (ch === '/' && next === '*') {
        out[i] = ' ';
        out[i + 1] = ' ';
        inBlockComment = true;
        i++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        out[i] = ' ';
        inQuote = ch;
        continue;
      }
      if (ch === '`') {
        out[i] = ' ';
        inTemplate = true;
        continue;
      }
      out[i] = ch;
    }
    cleanLines.push(out.join(''));
  }

  // Backward-scan from caret to find matching unmatched '(' and count top-level commas
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let commas = 0;

  for (let li = cleanLines.length - 1; li >= 0; li--) {
    const clean = cleanLines[li]!;
    const rawLine = lines[li]!.text;
    const lineNumber = lines[li]!.lineNumber;

    for (let i = clean.length - 1; i >= 0; i--) {
      const ch = clean[i]!;
      if (ch === ')') parenDepth++;
      else if (ch === ']') bracketDepth++;
      else if (ch === '}') braceDepth++;
      else if (ch === '[') {
        if (bracketDepth > 0) bracketDepth--;
        else return null;
      } else if (ch === '{') {
        if (braceDepth > 0) braceDepth--;
        else return null;
      } else if (ch === ',' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
        commas++;
      } else if (ch === '(') {
        if (parenDepth > 0) {
          parenDepth--;
        } else {
          // Found the active call's opening '('
          const beforeParen = rawLine.slice(0, i).trimEnd();
          const m = /([A-Za-z_$][A-Za-z0-9_$.]*)$/.exec(beforeParen);
          const calleeName = m ? m[1]! : '';
          // Skip control-flow keywords like `if (`, `for (`, `while (`, `switch (`, `catch (`
          if (!calleeName || /^(?:if|for|while|switch|catch|return|typeof|new)$/.test(calleeName)) {
            return null;
          }
          return {
            calleeName,
            openParenLine: lineNumber,
            openParenColumn: i + 1,
            activeParameter: commas,
          };
        }
      }
    }
  }

  return null;
}

/**
 * Resolves the exact `[start, end]` character highlight span of a parameter inside
 * a signature label, supporting both `[number, number]` tuples and safe comma-aware
 * string matching (so duplicate parameter names like `(a, a2)` match the exact slot).
 */
export function resolveParameterLabelRange(
  sigLabel: string,
  paramLabel: string | [number, number] | undefined,
  paramIndex: number,
  allParams?: readonly { label: string | [number, number] }[],
): [number, number] | null {
  if (!paramLabel) return null;
  if (Array.isArray(paramLabel)) {
    const [s, e] = paramLabel;
    if (s >= 0 && e > s && e <= sigLabel.length) return [s, e];
    return null;
  }
  // Walk forward past earlier parameters so identical/prefix labels don't collide
  let searchFrom = Math.max(0, sigLabel.indexOf('(') + 1);
  if (allParams && paramIndex > 0) {
    for (let i = 0; i < paramIndex && i < allParams.length; i++) {
      const prev = allParams[i]!.label;
      if (Array.isArray(prev)) {
        searchFrom = Math.max(searchFrom, prev[1]);
      } else {
        const hit = sigLabel.indexOf(prev, searchFrom);
        if (hit >= 0) searchFrom = hit + prev.length;
      }
    }
  }
  const idx = sigLabel.indexOf(paramLabel, searchFrom);
  if (idx >= 0) return [idx, idx + paramLabel.length];
  const fallback = sigLabel.indexOf(paramLabel);
  return fallback >= 0 ? [fallback, fallback + paramLabel.length] : null;
}
