import type { TextModel } from '../model/TextModel';

const MAX_FULL_SCAN_CHARS = 200_000;
const WINDOW_RADIUS = 50_000;

/**
 * Checks whether the document currently has an unmatched closing bracket `closeCh`
 * at or after the caret (ignoring string literals and `//` / `/* *\/` comments).
 *
 * Used to suppress auto-closing brackets when the user is repairing a missing
 * opening bracket — e.g. deleting `{` in `function apple () {\n  // hello\n}`
 * and re-typing `{` should insert only `{`, not `{}`.
 */
export function hasUnmatchedClosingBracket(
  model: TextModel,
  lineNumber: number,
  column: number,
  openCh: string,
  closeCh: string,
): boolean {
  if (!openCh || !closeCh || openCh === closeCh || openCh.length !== 1 || closeCh.length !== 1) {
    return false;
  }

  const fullText = model.getValue();
  const len = fullText.length;
  if (len === 0) return false;

  const caretOffset = model.getOffsetAt(lineNumber, column);
  let start = 0;
  let end = len;
  if (len > MAX_FULL_SCAN_CHARS) {
    start = Math.max(0, caretOffset - WINDOW_RADIUS);
    end = Math.min(len, caretOffset + WINDOW_RADIUS);
  }

  let openCount = 0;
  let closeCount = 0;
  let forwardDepth = 0;
  let hasUnmatchedCloseAfterCaret = false;
  let caretInsideLiteralOrComment = false;

  // Track string/comment lexer state. Template literals can nest `${ ... }`.
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  let inTemplate = false;
  const templateBraceStack: number[] = [];

  for (let i = start; i < end; i++) {
    if (i === caretOffset) {
      caretInsideLiteralOrComment = inSingle || inDouble || inLineComment || inBlockComment || inTemplate;
    }

    const ch = fullText[i]!;
    const next = i + 1 < end ? fullText[i + 1]! : '';

    if (inLineComment) {
      if (ch === '\n' || ch === '\r') inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inSingle) {
      if (ch === '\\') {
        i++;
      } else if (ch === '\'' || ch === '\n') {
        inSingle = false;
      }
      continue;
    }

    if (inDouble) {
      if (ch === '\\') {
        i++;
      } else if (ch === '"' || ch === '\n') {
        inDouble = false;
      }
      continue;
    }

    if (inTemplate) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === '`') {
        inTemplate = false;
        continue;
      }
      if (ch === '$' && next === '{') {
        inTemplate = false;
        templateBraceStack.push(0);
        i++;
        continue;
      }
      continue;
    }

    // Enter comments
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }

    // Enter strings
    if (ch === '\'') {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      continue;
    }

    // Track braces inside template `${ ... }` so closing `}` resumes template string
    if (templateBraceStack.length > 0) {
      if (ch === '{') {
        templateBraceStack[templateBraceStack.length - 1]!++;
      } else if (ch === '}') {
        const top = templateBraceStack[templateBraceStack.length - 1]!;
        if (top === 0) {
          templateBraceStack.pop();
          inTemplate = true;
          continue;
        }
        templateBraceStack[templateBraceStack.length - 1] = top - 1;
      }
    }

    if (ch === openCh) {
      openCount++;
      if (i >= caretOffset) {
        forwardDepth++;
      }
    } else if (ch === closeCh) {
      closeCount++;
      if (i >= caretOffset) {
        forwardDepth--;
        if (forwardDepth < 0) {
          hasUnmatchedCloseAfterCaret = true;
        }
      }
    }
  }

  if (caretOffset === end) {
    caretInsideLiteralOrComment = inSingle || inDouble || inLineComment || inBlockComment || inTemplate;
  }

  if (caretInsideLiteralOrComment) return false;
  return closeCount > openCount && hasUnmatchedCloseAfterCaret;
}
