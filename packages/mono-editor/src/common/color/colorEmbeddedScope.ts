import type { EmbeddedColorScope } from './colorTypes';

export interface LineEmbeddedInfo {
  scope: EmbeddedColorScope;
  tagName?: string;
  templateTag?: string;
  inBlockComment: boolean;
}

export interface LineSourceLike {
  getLineContent(lineNumber: number): string;
}

/**
 * Lightweight backward scan (capped for performance) that determines whether `lineNumber`
 * resides inside an HTML `<style>` or `<script>` tag, a custom HTML tag, or a JS/TS
 * tagged template literal (e.g. `` css`...` ``), plus embedded block-comment state.
 */
export function detectLineEmbeddedScope(
  model: LineSourceLike,
  lineNumber: number,
  languageId: string,
): LineEmbeddedInfo {
  const lang = languageId.toLowerCase();
  const scanStart = Math.max(1, lineNumber - 250);

  if (lang === 'html' || lang === 'xml' || lang === 'svg') {
    let activeTag: string | undefined;
    let inEmbeddedComment = false;

    for (let ln = scanStart; ln < lineNumber; ln++) {
      const text = model.getLineContent(ln);
      const tagRe = /<\/?([a-zA-Z][\w:-]*)(?:\s[^>]*)?>/g;
      let m: RegExpExecArray | null;
      while ((m = tagRe.exec(text)) !== null) {
        const full = m[0]!;
        const name = m[1]!.toLowerCase();
        if (full.startsWith('</')) {
          if (activeTag === name) {
            activeTag = undefined;
            inEmbeddedComment = false;
          }
        } else if (!full.endsWith('/>') && (name === 'style' || name === 'script' || name === 'svg')) {
          activeTag = name;
        }
      }
      if (activeTag === 'style' || activeTag === 'script') {
        let idx = 0;
        while (idx < text.length) {
          if (inEmbeddedComment) {
            const end = text.indexOf('*/', idx);
            if (end < 0) break;
            inEmbeddedComment = false;
            idx = end + 2;
          } else {
            const start = text.indexOf('/*', idx);
            if (start < 0) break;
            const end = text.indexOf('*/', start + 2);
            if (end < 0) {
              inEmbeddedComment = true;
              break;
            }
            idx = end + 2;
          }
        }
      }
    }

    if (activeTag === 'style') {
      return { scope: 'htmlStyleTag', tagName: 'style', inBlockComment: inEmbeddedComment };
    }
    if (activeTag === 'script') {
      return { scope: 'htmlScriptTag', tagName: 'script', inBlockComment: inEmbeddedComment };
    }
    return { scope: 'root', tagName: activeTag, inBlockComment: false };
  }

  if (
    lang === 'javascript' ||
    lang === 'typescript' ||
    lang === 'js' ||
    lang === 'ts' ||
    lang === 'jsx' ||
    lang === 'tsx'
  ) {
    let activeTemplateTag: string | undefined;
    for (let ln = scanStart; ln < lineNumber; ln++) {
      const text = model.getLineContent(ln);
      let i = 0;
      while (i < text.length) {
        if (activeTemplateTag) {
          if (text[i] === '\\') {
            i += 2;
            continue;
          }
          if (text[i] === '`') {
            activeTemplateTag = undefined;
          }
          i++;
        } else {
          const tick = text.indexOf('`', i);
          if (tick < 0) break;
          const before = text.slice(0, tick);
          const tagMatch = /([A-Za-z_$][\w$]*)(?:\.[A-Za-z_$][\w$]*)?(?:\([^)]*\))?\s*$/.exec(before);
          let closeIdx = -1;
          for (let j = tick + 1; j < text.length; j++) {
            if (text[j] === '\\') {
              j++;
              continue;
            }
            if (text[j] === '`') {
              closeIdx = j;
              break;
            }
          }
          if (closeIdx < 0 && tagMatch) {
            activeTemplateTag = tagMatch[1]!.toLowerCase();
            break;
          }
          i = closeIdx >= 0 ? closeIdx + 1 : text.length;
        }
      }
    }
    if (activeTemplateTag === 'css' || activeTemplateTag === 'styled') {
      return { scope: 'cssTemplateLiteral', templateTag: activeTemplateTag, inBlockComment: false };
    }
    if (activeTemplateTag === 'html') {
      return { scope: 'htmlTemplateLiteral', templateTag: activeTemplateTag, inBlockComment: false };
    }
    if (activeTemplateTag) {
      return { scope: 'root', templateTag: activeTemplateTag, inBlockComment: false };
    }
  }

  return { scope: 'root', inBlockComment: false };
}

/** Check if offset `idx` on a line inside `<style>` or `<script>` is inside a JS/CSS comment or string. */
export function analyzeEmbeddedLineContext(
  lineText: string,
  idx: number,
  scope: EmbeddedColorScope,
  inBlockCommentAtLineStart: boolean,
): { inComment: boolean; inString: boolean } {
  let inBlock = inBlockCommentAtLineStart;
  let quote: string | null = null;
  for (let i = 0; i < idx; i++) {
    const ch = lineText[i]!;
    if (inBlock) {
      if (ch === '*' && lineText[i + 1] === '/') {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (scope === 'htmlScriptTag' && ch === '/' && lineText[i + 1] === '/') {
      return { inComment: true, inString: false };
    }
    if (ch === '/' && lineText[i + 1] === '*') {
      inBlock = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || (scope === 'htmlScriptTag' && ch === '`')) {
      quote = ch;
    }
  }
  return { inComment: inBlock, inString: quote !== null };
}

/** Detect active HTML attribute name (e.g. `style`, `fill`, `stroke`) enclosing `idx` on an HTML line. */
export function detectHtmlAttributeAt(lineText: string, idx: number): string | undefined {
  const before = lineText.slice(0, idx);
  const m = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"[^"]*|'[^']*)$/.exec(before);
  return m ? m[1]!.toLowerCase() : undefined;
}
