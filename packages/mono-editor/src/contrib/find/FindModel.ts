import type { TextModel } from '../../common/model/TextModel';
import type { FindMatch, FindOptions } from './types';

/**
 * Pure search over TextModel — Monaco FindModel equivalent (simplified).
 */
export function findMatches(
  model: TextModel,
  searchString: string,
  options: FindOptions,
): FindMatch[] {
  if (!searchString) return [];

  const text = model.getValue();
  const matches: FindMatch[] = [];

  try {
    const re = buildRegExp(searchString, options);
    if (!re) return [];

    let m: RegExpExecArray | null;
    // Avoid infinite loop on empty matches
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (m[0].length === 0) {
        re.lastIndex = start + 1;
        continue;
      }
      const s = model.getPositionAt(start);
      const e = model.getPositionAt(end);
      matches.push({
        startLineNumber: s.lineNumber,
        startColumn: s.column,
        endLineNumber: e.lineNumber,
        endColumn: e.column,
      });
      if (matches.length > 20000) break; // safety
    }
  } catch {
    return [];
  }

  return matches;
}

function buildRegExp(searchString: string, options: FindOptions): RegExp | null {
  let source: string;
  if (options.regex) {
    source = searchString;
  } else {
    source = escapeRegExp(searchString);
  }
  if (options.wholeWord) {
    source = `\\b(?:${source})\\b`;
  }
  const flags = options.matchCase ? 'g' : 'gi';
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyPreserveCase(matched: string, replacement: string): string {
  if (!matched || !replacement) return replacement;
  if (matched === matched.toUpperCase() && matched !== matched.toLowerCase()) {
    return replacement.toUpperCase();
  }
  if (matched === matched.toLowerCase()) {
    return replacement.toLowerCase();
  }
  if (
    matched[0] === matched[0]!.toUpperCase() &&
    matched.slice(1) === matched.slice(1).toLowerCase()
  ) {
    return replacement[0]!.toUpperCase() + replacement.slice(1).toLowerCase();
  }
  return replacement;
}

export function replaceMatch(
  model: TextModel,
  match: FindMatch,
  replaceString: string,
  searchString: string,
  options: FindOptions,
  /** Document text captured BEFORE a batch of replacements (Replace All) — avoids re-joining the whole document per match */
  source?: string,
  preserveCase = false,
): void {
  const start = model.getOffsetAt(match.startLineNumber, match.startColumn);
  const end = model.getOffsetAt(match.endLineNumber, match.endColumn);
  const matchedSlice = (source ?? model.getValue()).slice(start, end);
  let replacement = replaceString;
  if (options.regex) {
    try {
      const re = buildRegExp(searchString, { ...options, regex: true });
      if (re) {
        replacement = matchedSlice.replace(re, replaceString);
      }
    } catch {
      /* use literal */
    }
  }
  if (preserveCase) {
    replacement = applyPreserveCase(matchedSlice, replacement);
  }
  model.replaceRange(start, end, replacement);
}
