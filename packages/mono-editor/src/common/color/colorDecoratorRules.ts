import type { MonoToken } from '../languages/tokenization/tokenTypes';
import {
  DEFAULT_COLOR_DECORATOR_RULES,
  type ColorContextMode,
  type ColorDecoratorRules,
  type ColorFormatOptions,
  type ColorMatch,
  type ColorRuleContext,
  type ColorScopeRule,
  type EmbeddedColorScope,
} from './colorTypes';
import { parseColorLiteral } from './colorParse';
import {
  analyzeEmbeddedLineContext,
  detectHtmlAttributeAt,
  detectLineEmbeddedScope,
  type LineSourceLike,
} from './colorEmbeddedScope';

export interface ColorModelLike extends LineSourceLike {
  getLanguageId(): string;
}

function mergeScopeRules(
  base: ColorScopeRule,
  override?: ColorScopeRule,
): Required<Pick<ColorScopeRule, 'enabled' | 'allowInComments' | 'context'>> & {
  formats: Required<ColorFormatOptions>;
} {
  const baseFmt = base.formats ?? {};
  const ovFmt = override?.formats ?? {};
  return {
    enabled: override?.enabled ?? base.enabled ?? true,
    allowInComments: override?.allowInComments ?? base.allowInComments ?? false,
    context: override?.context ?? base.context ?? 'auto',
    formats: {
      hex: ovFmt.hex ?? baseFmt.hex ?? true,
      rgb: ovFmt.rgb ?? baseFmt.rgb ?? true,
      hsl: ovFmt.hsl ?? baseFmt.hsl ?? true,
      named: ovFmt.named ?? baseFmt.named ?? true,
    },
  };
}

function resolveEffectiveRules(
  rules: ColorDecoratorRules | undefined,
  languageId: string,
  embeddedScope: EmbeddedColorScope,
  tagName?: string,
  attributeName?: string,
  templateTag?: string,
): {
  enabled: boolean;
  allowInComments: boolean;
  context: ColorContextMode;
  formats: Required<ColorFormatOptions>;
} {
  const mergedBase = mergeScopeRules(DEFAULT_COLOR_DECORATOR_RULES, rules);
  let eff = mergedBase;

  const lang = languageId.toLowerCase();
  const langOv = rules?.languageOverrides?.[lang];
  if (langOv) eff = mergeScopeRules(eff, langOv);

  const defEmb = DEFAULT_COLOR_DECORATOR_RULES.embeddedScopes;
  const userEmb = rules?.embeddedScopes;

  if (embeddedScope === 'htmlStyleTag') {
    eff = mergeScopeRules(eff, defEmb?.styleTag);
    eff = mergeScopeRules(eff, userEmb?.styleTag);
  } else if (embeddedScope === 'htmlScriptTag') {
    eff = mergeScopeRules(eff, defEmb?.scriptTag);
    eff = mergeScopeRules(eff, userEmb?.scriptTag);
  } else if (embeddedScope === 'htmlStyleAttr') {
    eff = mergeScopeRules(eff, defEmb?.styleAttribute);
    eff = mergeScopeRules(eff, userEmb?.styleAttribute);
  }

  if (tagName) {
    const t = tagName.toLowerCase();
    if (defEmb?.tags?.[t]) eff = mergeScopeRules(eff, defEmb.tags[t]);
    if (userEmb?.tags?.[t]) eff = mergeScopeRules(eff, userEmb.tags[t]);
  }
  if (attributeName) {
    const a = attributeName.toLowerCase();
    if (defEmb?.attributes?.[a]) eff = mergeScopeRules(eff, defEmb.attributes[a]);
    if (userEmb?.attributes?.[a]) eff = mergeScopeRules(eff, userEmb.attributes[a]);
  }
  if (templateTag) {
    const tt = templateTag.toLowerCase();
    if (defEmb?.taggedTemplates?.[tt]) eff = mergeScopeRules(eff, defEmb.taggedTemplates[tt]);
    if (userEmb?.taggedTemplates?.[tt]) eff = mergeScopeRules(eff, userEmb.taggedTemplates[tt]);
  }

  return eff;
}

function tokenTypeAtColumn(tokens: readonly MonoToken[] | undefined, col1: number): string {
  if (!tokens) return 'plain';
  for (const tok of tokens) {
    if (col1 >= tok.startColumn && col1 < tok.endColumn) {
      return tok.type;
    }
  }
  return 'plain';
}

const COLOR_SCAN_RE =
  /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b|rgba?\(\s*[^)]+\)|hsla?\(\s*[^)]+\)|\b[a-zA-Z]{3,20}\b/g;

/**
 * Scan a single model line for color literals respecting the full ColorDecoratorRules
 * API (comments, strings, CSS vs JS, HTML `<style>`/`<script>`/`style="..."`, tagged templates,
 * format toggles, and custom predicates).
 */
export function detectLineColors(
  model: ColorModelLike,
  lineNumber: number,
  tokens: readonly MonoToken[] | undefined,
  rules: ColorDecoratorRules | undefined,
  extraProviderColors?: readonly ColorMatch[],
): ColorMatch[] {
  if (rules?.enabled === false) return [];
  const lineText = model.getLineContent(lineNumber);
  if (!lineText) return extraProviderColors ? [...extraProviderColors] : [];

  const languageId = model.getLanguageId().toLowerCase();
  const embedded = detectLineEmbeddedScope(model, lineNumber, languageId);
  const results: ColorMatch[] = [];

  COLOR_SCAN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COLOR_SCAN_RE.exec(lineText)) !== null) {
    const rawText = m[0]!;
    const startIdx = m.index;
    const endIdx = startIdx + rawText.length;

    if (rawText.startsWith('#')) {
      const prevChar = startIdx > 0 ? lineText[startIdx - 1]! : '';
      if (/[A-Za-z0-9_$]/.test(prevChar)) continue;
      if (languageId === 'css' || embedded.scope === 'htmlStyleTag') {
        const after = lineText.slice(endIdx);
        if (/^\s*[{,>+~.#\[]/.test(after) && !lineText.slice(0, startIdx).includes(':')) {
          continue;
        }
      }
    }

    const parsed = parseColorLiteral(rawText);
    if (!parsed) continue;

    if (parsed.format === 'named') {
      const prevChar = startIdx > 0 ? lineText[startIdx - 1]! : '';
      const nextChar = endIdx < lineText.length ? lineText[endIdx]! : '';
      if (prevChar === '-' || nextChar === '-' || prevChar === '.' || nextChar === '(') continue;
      if (nextChar === ':') continue;
    }

    const startColumn = startIdx + 1;
    const endColumn = endIdx + 1;
    const tokenType = tokenTypeAtColumn(tokens, startColumn);

    let effectiveScope = embedded.scope;
    let attributeName: string | undefined;
    if ((languageId === 'html' || languageId === 'svg' || languageId === 'xml') && effectiveScope === 'root') {
      attributeName = detectHtmlAttributeAt(lineText, startIdx);
      if (attributeName === 'style') effectiveScope = 'htmlStyleAttr';
    }

    let inComment = tokenType === 'comment' || tokenType.startsWith('comment.');
    let inString = tokenType === 'string' || tokenType.startsWith('string.');

    if (effectiveScope === 'htmlStyleTag' || effectiveScope === 'htmlScriptTag') {
      const embCtx = analyzeEmbeddedLineContext(lineText, startIdx, effectiveScope, embedded.inBlockComment);
      if (embCtx.inComment) inComment = true;
      inString = embCtx.inString;
    } else if (effectiveScope === 'htmlStyleAttr') {
      inString = true;
    }

    if (parsed.format === 'named' && inString && effectiveScope !== 'htmlStyleAttr') {
      const prevChar = startIdx > 0 ? lineText[startIdx - 1]! : '';
      const nextChar = endIdx < lineText.length ? lineText[endIdx]! : '';
      const isWholeQuoted =
        (prevChar === '"' && nextChar === '"') ||
        (prevChar === "'" && nextChar === "'") ||
        (prevChar === '`' && nextChar === '`');
      if (!isWholeQuoted) continue;
    }

    const eff = resolveEffectiveRules(
      rules,
      languageId,
      effectiveScope,
      embedded.tagName,
      attributeName,
      embedded.templateTag,
    );

    const ruleCtx: ColorRuleContext = {
      languageId,
      embeddedScope: effectiveScope,
      tagName: embedded.tagName,
      attributeName,
      templateTag: embedded.templateTag,
      tokenType,
      inComment,
      inString,
      format: parsed.format,
      rawText,
      lineNumber,
      startColumn,
      endColumn,
      lineText,
    };

    const customDecision = rules?.customRule?.(ruleCtx);
    let allowed: boolean;
    if (typeof customDecision === 'boolean') {
      allowed = customDecision;
    } else {
      allowed = eff.enabled;
      if (allowed && !eff.formats[parsed.format]) allowed = false;
      if (allowed && inComment && !eff.allowInComments) allowed = false;

      if (allowed && !inComment) {
        let mode = eff.context;
        if (mode === 'auto') {
          if (
            languageId === 'css' ||
            languageId === 'scss' ||
            languageId === 'less' ||
            effectiveScope === 'htmlStyleTag' ||
            effectiveScope === 'cssTemplateLiteral'
          ) {
            mode = 'outsideStrings';
          } else if (effectiveScope === 'htmlStyleAttr') {
            mode = 'all';
          } else if (languageId === 'html' || languageId === 'svg') {
            mode = attributeName ? 'all' : 'outsideStrings';
          } else {
            mode = 'stringsOnly';
          }
        }
        if (mode === 'stringsOnly' && !inString) allowed = false;
        if (mode === 'outsideStrings' && inString) allowed = false;
      }
    }

    if (!allowed) continue;

    if (
      parsed.format === 'named' &&
      !inString &&
      languageId !== 'css' &&
      languageId !== 'scss' &&
      languageId !== 'less' &&
      effectiveScope !== 'htmlStyleTag' &&
      effectiveScope !== 'htmlStyleAttr' &&
      effectiveScope !== 'cssTemplateLiteral' &&
      typeof customDecision !== 'boolean'
    ) {
      continue;
    }

    results.push({
      lineNumber,
      startColumn,
      endColumn,
      rgba: parsed.rgba,
      format: parsed.format,
      rawText,
    });
  }

  if (extraProviderColors && extraProviderColors.length > 0) {
    for (const extra of extraProviderColors) {
      const overlaps = results.some(
        (r) => !(extra.endColumn <= r.startColumn || extra.startColumn >= r.endColumn),
      );
      if (!overlaps) results.push(extra);
    }
    results.sort((a, b) => a.startColumn - b.startColumn);
  }

  return results;
}
