import { TextModel } from '../../model/TextModel';
import {
  StructureKind,
  type StructureLanguageRules,
  type StructureNodeDraft,
} from '../types';
import { buildBracketNodes } from './bracketsEngine';

export const DEFAULT_HTML_VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** HTML elements whose closing tag is optional when a sibling or parent closes them. */
export const DEFAULT_OPTIONAL_END_TAGS = new Set([
  'p', 'li', 'td', 'tr', 'th', 'dt', 'dd', 'option',
]);

const DEFAULT_RAW_TEXT_TAGS = new Set(['script', 'style', 'pre', 'textarea']);

const OPTIONAL_CLOSE_BY: Record<string, ReadonlySet<string>> = {
  p: new Set(['p', 'div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav', 'ul', 'ol', 'dl', 'table', 'form', 'hr', 'pre', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']),
  li: new Set(['li']),
  dt: new Set(['dt', 'dd']),
  dd: new Set(['dt', 'dd']),
  tr: new Set(['tr']),
  td: new Set(['td', 'th', 'tr']),
  th: new Set(['td', 'th', 'tr']),
  option: new Set(['option', 'optgroup']),
};

/**
 * S3: Tag-matching structure engine for HTML, XML, SVG, Vue, Svelte, JSX.
 * Supports void elements, self-closing tags, optional-end HTML tags, `<!-- -->` comments,
 * and embedded `<script>` / `<style>` delegation to `buildBracketNodes`.
 */
export function buildTagNodes(
  model: TextModel,
  rules: StructureLanguageRules,
  opts: { maxLineLength?: number; languageId?: string } = {},
): StructureNodeDraft[] {
  const lang = (opts.languageId ?? model.getLanguageId()).toLowerCase();
  const isXml = lang === 'xml' || lang === 'svg';
  const voidTags = rules.voidTags ? new Set(rules.voidTags) : (isXml ? new Set<string>() : DEFAULT_HTML_VOID_TAGS);
  const optionalEndTags = rules.optionalEndTags ? new Set(rules.optionalEndTags) : (isXml ? new Set<string>() : DEFAULT_OPTIONAL_END_TAGS);
  const rawTextTags = rules.rawTextTags ? new Set(rules.rawTextTags) : (isXml ? new Set<string>() : DEFAULT_RAW_TEXT_TAGS);

  const lineCount = model.getLineCount();
  const text = model.getValue();
  const n = text.length;
  const nodes: StructureNodeDraft[] = [];

  // Precompute 1-based line start offsets for O(log L) offset -> line
  const lineStarts = new Int32Array(lineCount + 1);
  lineStarts[1] = 0;
  let lnCur = 1;
  for (let idx = 0; idx < n; idx++) {
    if (text[idx] === '\n' && lnCur < lineCount) {
      lnCur++;
      lineStarts[lnCur] = idx + 1;
    }
  }
  const offsetToLine = (off: number): number => {
    let lo = 1;
    let hi = lineCount;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (lineStarts[mid]! <= off) lo = mid + 1;
      else hi = mid - 1;
    }
    return Math.max(1, hi);
  };

  interface OpenTag {
    name: string;
    startLine: number;
    startCol: number;
  }
  const stack: OpenTag[] = [];

  const pushTagNode = (open: OpenTag, closeLine: number, isImplicit = false) => {
    const endLine = isImplicit ? closeLine - 1 : closeLine;
    const foldEnd = isImplicit ? endLine : closeLine - 1;
    if (endLine > open.startLine) {
      nodes.push({
        startLine: open.startLine,
        endLine,
        foldEndLine: foldEnd > open.startLine ? foldEnd : open.startLine,
        startCol: open.startCol,
        kind: StructureKind.Tag,
      });
    }
  };

  let i = 0;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt === -1) break;
    i = lt + 1;
    if (i >= n) break;

    // HTML comment <!-- ... -->
    if (text.startsWith('!--', i)) {
      const startLine = offsetToLine(lt);
      const endIdx = text.indexOf('-->', i + 3);
      const closePos = endIdx === -1 ? n - 1 : endIdx + 2;
      const endLine = offsetToLine(closePos);
      if (endLine > startLine) {
        nodes.push({ startLine, endLine, foldEndLine: endLine, kind: StructureKind.Comment });
      }
      i = endIdx === -1 ? n : endIdx + 3;
      continue;
    }

    // Skip DOCTYPE, CDATA, processing instructions
    if (text[i] === '!' || text[i] === '?') {
      const gt = text.indexOf('>', i);
      i = gt === -1 ? n : gt + 1;
      continue;
    }

    const isClose = text[i] === '/';
    if (isClose) i++;

    const nameStart = i;
    while (i < n && /[A-Za-z0-9_:\-.]/.test(text[i]!)) i++;
    const rawName = text.slice(nameStart, i);
    if (!rawName) continue;
    const tagName = isXml ? rawName : rawName.toLowerCase();

    // Scan attributes respecting quoted values until '>'
    let quote: string | null = null;
    let selfClosing = false;
    while (i < n) {
      const ch = text[i]!;
      if (quote) {
        if (ch === quote) quote = null;
        i++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        i++;
        continue;
      }
      if (ch === '/' && i + 1 < n && text[i + 1] === '>') {
        selfClosing = true;
        i += 2;
        break;
      }
      if (ch === '>') {
        i++;
        break;
      }
      i++;
    }

    const tagLine = offsetToLine(lt);
    const tagCol = lt - lineStarts[tagLine]! + 1;

    if (isClose) {
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s]!.name === tagName) {
          // Implicitly close any unclosed optional-end tags above s
          for (let k = stack.length - 1; k > s; k--) {
            if (optionalEndTags.has(stack[k]!.name)) {
              pushTagNode(stack[k]!, tagLine, true);
            }
          }
          pushTagNode(stack[s]!, tagLine, false);
          stack.length = s;
          break;
        }
      }
      continue;
    }

    // Optional-end tag auto-closure when a sibling opens
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const closers = OPTIONAL_CLOSE_BY[top.name];
      if (optionalEndTags.has(top.name) && closers?.has(tagName)) {
        stack.pop();
        pushTagNode(top, tagLine, true);
      } else {
        break;
      }
    }

    if (selfClosing || voidTags.has(tagName)) {
      const tagEndLine = offsetToLine(Math.max(lt, i - 1));
      if (tagEndLine > tagLine) {
        nodes.push({
          startLine: tagLine,
          endLine: tagEndLine,
          foldEndLine: tagEndLine - 1 > tagLine ? tagEndLine - 1 : tagLine,
          startCol: tagCol,
          kind: StructureKind.Tag,
        });
      }
      continue;
    }

    // Raw text elements (<script>, <style>, <pre>, <textarea>)
    if (rawTextTags.has(tagName)) {
      const closeRe = new RegExp(`</${tagName}\\s*>`, 'i');
      const rest = text.slice(i);
      const m = closeRe.exec(rest);
      const closeStartOff = m ? i + m.index : n;
      const closeLine = offsetToLine(closeStartOff);
      pushTagNode({ name: tagName, startLine: tagLine, startCol: tagCol }, closeLine, false);

      if (m && (tagName === 'script' || tagName === 'style')) {
        const inner = text.slice(i, closeStartOff);
        if (inner.trim().length > 0) {
          const innerStartLine = offsetToLine(i);
          const embeddedLang = tagName === 'script' ? 'javascript' : 'css';
          const innerModel = new TextModel(inner, embeddedLang);
          const innerNodes = buildBracketNodes(innerModel, {}, { languageId: embeddedLang, maxLineLength: opts.maxLineLength });
          const lineOffset = innerStartLine - 1;
          for (const nd of innerNodes) {
            nodes.push({
              ...nd,
              startLine: nd.startLine + lineOffset,
              endLine: nd.endLine + lineOffset,
              foldEndLine: nd.foldEndLine !== undefined ? nd.foldEndLine + lineOffset : undefined,
            });
          }
        }
      }

      i = m ? closeStartOff + m[0].length : n;
      continue;
    }

    stack.push({ name: tagName, startLine: tagLine, startCol: tagCol });
  }

  // Close any remaining optional-end tags at EOF
  for (let s = stack.length - 1; s >= 0; s--) {
    const top = stack[s]!;
    if (optionalEndTags.has(top.name) && lineCount > top.startLine) {
      nodes.push({
        startLine: top.startLine,
        endLine: lineCount,
        foldEndLine: lineCount,
        startCol: top.startCol,
        kind: StructureKind.Tag,
      });
    }
  }

  return nodes;
}
