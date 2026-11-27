import type { TextModel } from '../../model/TextModel';
import {
  StructureKind,
  type StructureLanguageRules,
  type StructureNodeDraft,
} from '../types';

/**
 * S4: Markdown ATX headings (`#`..`######`) + fenced code blocks (` ``` ` / `~~~`).
 */
export function buildHeadingNodes(
  model: TextModel,
  _rules: StructureLanguageRules,
): StructureNodeDraft[] {
  const total = model.getLineCount();
  const nodes: StructureNodeDraft[] = [];
  const headings: Array<{ line: number; level: number }> = [];

  let fenceChar: '`' | '~' | null = null;
  let fenceLen = 0;
  let fenceStart = -1;

  for (let ln = 1; ln <= total; ln++) {
    const raw = model.getLineContent(ln);
    const trimmed = raw.trimStart();

    if (fenceChar) {
      const closeRe = fenceChar === '`' ? /^`{3,}\s*$/ : /^~{3,}\s*$/;
      if (closeRe.test(trimmed) && trimmed.trim().length >= fenceLen) {
        if (ln > fenceStart) {
          nodes.push({
            startLine: fenceStart,
            endLine: ln,
            foldEndLine: ln,
            kind: StructureKind.Block,
          });
        }
        fenceChar = null;
        fenceLen = 0;
        fenceStart = -1;
      }
      continue;
    }

    const openFence = /^(`{3,}|~{3,})/.exec(trimmed);
    if (openFence) {
      fenceChar = openFence[1]![0] as '`' | '~';
      fenceLen = openFence[1]!.length;
      fenceStart = ln;
      continue;
    }

    const h = /^ {0,3}(#{1,6})(?:[ \t]+|$)/.exec(raw);
    if (h) {
      headings.push({ line: ln, level: h[1]!.length });
    }
  }

  for (let i = 0; i < headings.length; i++) {
    const cur = headings[i]!;
    let end = total;
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j]!.level <= cur.level) {
        end = headings[j]!.line - 1;
        break;
      }
    }
    // Trim trailing blank lines
    while (end > cur.line && model.getLineContent(end).trim().length === 0) {
      end--;
    }
    if (end > cur.line) {
      nodes.push({
        startLine: cur.line,
        endLine: end,
        foldEndLine: end,
        kind: StructureKind.Heading,
      });
    }
  }

  return nodes;
}
