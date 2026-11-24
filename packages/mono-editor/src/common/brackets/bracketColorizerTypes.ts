/**
 * Theme-aware 5-level Rainbow Bracket Pair Colorization types & defaults.
 * Pure data layer (DOM-free).
 */

export type BracketPairDef = readonly [open: string, close: string];

export interface BracketColorizationRule {
  enabled?: boolean;
  /** Number of nesting color levels (clamped to 1..5). */
  maxLevels?: number;
  /** Custom palette override (up to 5 colors). Falls back to active theme `rainbowBrackets`. */
  colors?: readonly string[];
  /** Custom color for unmatched closing brackets. Falls back to theme `unexpectedBracketColor`. */
  unexpectedColor?: string;
  /** Single-character bracket pairs to colorize (default: (), [], {}). */
  pairs?: readonly BracketPairDef[];
  /** When true, each bracket pair type maintains its own independent nesting depth counter. */
  independentColorPoolPerBracketType?: boolean;
  /** Skip colorization entirely for files exceeding this line count (perf cutoff). */
  maxLines?: number;
  /** Skip scanning lines longer than this character count (perf cutoff). */
  maxLineLength?: number;
}

export interface BracketPairColorizationOptions extends BracketColorizationRule {
  enabled: boolean;
  maxLevels: number;
  pairs: readonly BracketPairDef[];
  independentColorPoolPerBracketType: boolean;
  maxLines: number;
  maxLineLength: number;
  /** Per-language rule overrides (e.g. `{ html: { pairs: [['(', ')'], ['[', ']'], ['{', '}']] } }`). */
  languageRules?: Record<string, BracketColorizationRule>;
}

export interface LineBracketColor {
  /** 0-based character column on the line. */
  readonly column: number;
  /** 0-based nesting color level (`0 .. maxLevels - 1`), or `-1` when `unexpected` is true. */
  readonly level: number;
  /** True when this closing bracket does not match any open bracket on the stack. */
  readonly unexpected: boolean;
}

export const DEFAULT_BRACKET_PAIRS: readonly BracketPairDef[] = [
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
];

export const DEFAULT_RAINBOW_BRACKET_COLORS: readonly string[] = [
  '#ffd700', // Level 1 — Gold
  '#da70d6', // Level 2 — Orchid
  '#179fff', // Level 3 — Sky Blue
  '#3fb950', // Level 4 — Emerald
  '#ff9f43', // Level 5 — Amber
];

export const DEFAULT_UNEXPECTED_BRACKET_COLOR = '#f14c4c';

export const DEFAULT_BRACKET_COLORIZATION_OPTIONS: BracketPairColorizationOptions = {
  enabled: true,
  maxLevels: 5,
  pairs: DEFAULT_BRACKET_PAIRS,
  independentColorPoolPerBracketType: false,
  maxLines: 20_000,
  maxLineLength: 10_000,
  languageRules: {
    plaintext: { enabled: false },
    markdown: { enabled: false },
  },
};

export function clampRainbowLevels(levels: number | undefined): number {
  if (typeof levels !== 'number' || !Number.isFinite(levels)) return 5;
  return Math.max(1, Math.min(5, Math.floor(levels)));
}

export function resolveBracketColorizationOptions(
  input?: Partial<BracketPairColorizationOptions>,
  languageId?: string,
): BracketPairColorizationOptions {
  const mergedRules: Record<string, BracketColorizationRule> = {
    ...(DEFAULT_BRACKET_COLORIZATION_OPTIONS.languageRules ?? {}),
    ...(input?.languageRules ?? {}),
  };
  const base: BracketPairColorizationOptions = {
    enabled: input?.enabled ?? DEFAULT_BRACKET_COLORIZATION_OPTIONS.enabled,
    maxLevels: clampRainbowLevels(input?.maxLevels ?? DEFAULT_BRACKET_COLORIZATION_OPTIONS.maxLevels),
    colors: input?.colors,
    unexpectedColor: input?.unexpectedColor,
    pairs: input?.pairs && input.pairs.length > 0 ? input.pairs : DEFAULT_BRACKET_PAIRS,
    independentColorPoolPerBracketType:
      input?.independentColorPoolPerBracketType ??
      DEFAULT_BRACKET_COLORIZATION_OPTIONS.independentColorPoolPerBracketType,
    maxLines:
      typeof input?.maxLines === 'number' && input.maxLines > 0
        ? Math.floor(input.maxLines)
        : DEFAULT_BRACKET_COLORIZATION_OPTIONS.maxLines,
    maxLineLength:
      typeof input?.maxLineLength === 'number' && input.maxLineLength > 0
        ? Math.floor(input.maxLineLength)
        : DEFAULT_BRACKET_COLORIZATION_OPTIONS.maxLineLength,
    languageRules: mergedRules,
  };
  if (!languageId) return base;
  const langRule = mergedRules[languageId];
  if (!langRule) return base;
  return {
    ...base,
    enabled: langRule.enabled ?? base.enabled,
    maxLevels: clampRainbowLevels(langRule.maxLevels ?? base.maxLevels),
    colors: langRule.colors ?? base.colors,
    unexpectedColor: langRule.unexpectedColor ?? base.unexpectedColor,
    pairs: langRule.pairs && langRule.pairs.length > 0 ? langRule.pairs : base.pairs,
    independentColorPoolPerBracketType:
      langRule.independentColorPoolPerBracketType ?? base.independentColorPoolPerBracketType,
    maxLines:
      typeof langRule.maxLines === 'number' && langRule.maxLines > 0
        ? Math.floor(langRule.maxLines)
        : base.maxLines,
    maxLineLength:
      typeof langRule.maxLineLength === 'number' && langRule.maxLineLength > 0
        ? Math.floor(langRule.maxLineLength)
        : base.maxLineLength,
  };
}
