import type { MonoTokenTheme, MonoTokenType } from '../../common/languages/tokenization/tokenTypes';
import { DEFAULT_TOKEN_COLORS } from '../../common/languages/tokenization/tokenTypes';
import type { MonoThemeRule } from './types';

/**
 * Map Monaco/TextMate scope strings → MonoTokenType.
 * Expandable: add scopes without touching the renderer.
 */
const SCOPE_TO_MONO: Array<{ match: RegExp | string; type: MonoTokenType }> = [
  { match: /^comment/, type: 'comment' },
  { match: /^constant\.character\.escape/, type: 'stringEscape' },
  { match: /^punctuation\.definition\.template-expression/, type: 'templateDelimiter' },
  { match: /^string\.regexp/, type: 'regexp' },
  { match: /^string/, type: 'string' },
  { match: /^constant\.numeric|^constant\.language\.numeric/, type: 'number' },
  { match: /^constant\.language\.boolean/, type: 'boolean' },
  { match: /^keyword\.control/, type: 'keywordControl' },
  { match: /^keyword\.operator\.new|^storage\.type|^storage\.modifier/, type: 'keyword' },
  { match: /^keyword\.other\.unit/, type: 'unit' },
  { match: /^keyword/, type: 'keyword' },
  { match: /^meta\.decorator|^punctuation\.decorator/, type: 'decorator' },
  { match: /^entity\.name\.function|^support\.function/, type: 'function' },
  { match: /^entity\.name\.class|^support\.class/, type: 'class' },
  { match: /^entity\.name\.type|^support\.type|^meta\.type/, type: 'type' },
  { match: /^entity\.other\.attribute-name\.class\.css|^entity\.other\.attribute-name\.id\.css/, type: 'selector' },
  { match: /^variable|^support\.variable/, type: 'variable' },
  { match: /^entity\.other\.attribute-name|^meta\.attribute/, type: 'attribute' },
  { match: /^entity\.name\.tag|^meta\.tag/, type: 'tag' },
  { match: /^support\.constant|^constant\.language|^constant\.other/, type: 'constant' },
  { match: /^meta\.preprocessor|^keyword\.control\.directive/, type: 'macro' },
  { match: /^markup\.heading/, type: 'heading' },
  { match: /^markup\.italic/, type: 'emphasis' },
  { match: /^markup\.bold/, type: 'strong' },
  { match: /^markup\.underline\.link/, type: 'link' },
  { match: /^markup\.inline\.raw/, type: 'codeInline' },
  { match: /^markup\.math/, type: 'math' },
  { match: /^invalid/, type: 'invalid' },
  { match: /^punctuation/, type: 'punctuation' },
  { match: /^keyword\.operator/, type: 'operator' },
  // Direct mono type names
  { match: 'plain', type: 'plain' },
  { match: 'comment', type: 'comment' },
  { match: 'string', type: 'string' },
  { match: 'stringEscape', type: 'stringEscape' },
  { match: 'templateDelimiter', type: 'templateDelimiter' },
  { match: 'keyword', type: 'keyword' },
  { match: 'keywordControl', type: 'keywordControl' },
  { match: 'number', type: 'number' },
  { match: 'boolean', type: 'boolean' },
  { match: 'regexp', type: 'regexp' },
  { match: 'operator', type: 'operator' },
  { match: 'punctuation', type: 'punctuation' },
  { match: 'variable', type: 'variable' },
  { match: 'function', type: 'function' },
  { match: 'type', type: 'type' },
  { match: 'class', type: 'class' },
  { match: 'property', type: 'property' },
  { match: 'decorator', type: 'decorator' },
  { match: 'tag', type: 'tag' },
  { match: 'attribute', type: 'attribute' },
  { match: 'selector', type: 'selector' },
  { match: 'unit', type: 'unit' },
  { match: 'constant', type: 'constant' },
  { match: 'macro', type: 'macro' },
  { match: 'heading', type: 'heading' },
  { match: 'emphasis', type: 'emphasis' },
  { match: 'strong', type: 'strong' },
  { match: 'link', type: 'link' },
  { match: 'math', type: 'math' },
  { match: 'codeInline', type: 'codeInline' },
  { match: 'invalid', type: 'invalid' },
];

function normalizeHex(c?: string): string | undefined {
  if (!c) return undefined;
  const s = c.trim();
  if (s.startsWith('#')) return s.length === 4
    ? `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`
    : s.slice(0, 7);
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s}`;
  if (/^[0-9a-fA-F]{3}$/.test(s)) return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`;
  return s.startsWith('#') ? s : `#${s}`;
}

function scopeToType(scope: string): MonoTokenType | null {
  for (const { match, type } of SCOPE_TO_MONO) {
    if (typeof match === 'string') {
      if (scope === match || scope.startsWith(match + '.')) return type;
    } else if (match.test(scope)) {
      return type;
    }
  }
  return null;
}

/** Convert Monaco rules → MonoTokenTheme (first match wins per type). */
export function rulesToTokenColors(rules: MonoThemeRule[] | undefined): MonoTokenTheme {
  const out: MonoTokenTheme = { ...DEFAULT_TOKEN_COLORS };
  if (!rules?.length) return out;
  const filled = new Set<MonoTokenType>();
  for (const rule of rules) {
    const fg = normalizeHex(rule.foreground);
    if (!fg) continue;
    const type = scopeToType(rule.token);
    if (!type || filled.has(type)) continue;
    out[type] = fg;
    filled.add(type);
  }
  return out;
}

export function mergeTokenColors(
  base: MonoTokenTheme | undefined,
  extra: MonoTokenTheme | undefined,
): MonoTokenTheme {
  return { ...DEFAULT_TOKEN_COLORS, ...base, ...extra };
}
