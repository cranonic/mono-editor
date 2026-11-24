export interface RgbaColor {
  /** 0..255 */
  r: number;
  /** 0..255 */
  g: number;
  /** 0..255 */
  b: number;
  /** 0..1 */
  a: number;
}

export type ColorFormat = 'hex' | 'rgb' | 'hsl' | 'named';

export type ColorContextMode = 'auto' | 'stringsOnly' | 'outsideStrings' | 'all';

export type EmbeddedColorScope =
  | 'root'
  | 'htmlStyleTag'
  | 'htmlScriptTag'
  | 'htmlStyleAttr'
  | 'cssTemplateLiteral'
  | 'htmlTemplateLiteral';

export interface ColorFormatOptions {
  hex?: boolean;
  rgb?: boolean;
  hsl?: boolean;
  named?: boolean;
}

export interface ColorScopeRule {
  /** Enable or disable color bullets in this scope/language. */
  enabled?: boolean;
  /** Allow color bullets inside comments (default: false). */
  allowInComments?: boolean;
  /** Where color literals are allowed ('auto' | 'stringsOnly' | 'outsideStrings' | 'all'). */
  context?: ColorContextMode;
  /** Which color literal formats are recognized. */
  formats?: ColorFormatOptions;
}

export interface ColorRuleContext {
  languageId: string;
  embeddedScope: EmbeddedColorScope;
  tagName?: string;
  attributeName?: string;
  templateTag?: string;
  tokenType: string;
  inComment: boolean;
  inString: boolean;
  format: ColorFormat;
  rawText: string;
  lineNumber: number;
  startColumn: number;
  endColumn: number;
  lineText: string;
}

export interface ColorDecoratorRules extends ColorScopeRule {
  embeddedScopes?: {
    styleTag?: ColorScopeRule;
    scriptTag?: ColorScopeRule;
    styleAttribute?: ColorScopeRule;
    tags?: Record<string, ColorScopeRule>;
    attributes?: Record<string, ColorScopeRule>;
    taggedTemplates?: Record<string, ColorScopeRule>;
  };
  languageOverrides?: Record<string, ColorScopeRule>;
  customRule?: (ctx: ColorRuleContext) => boolean | null | undefined;
}

export interface ColorMatch {
  lineNumber: number;
  /** 1-based inclusive start column of the color token */
  startColumn: number;
  /** 1-based exclusive end column of the color token */
  endColumn: number;
  rgba: RgbaColor;
  format: ColorFormat;
  rawText: string;
}

export const DEFAULT_COLOR_DECORATOR_RULES: ColorDecoratorRules = {
  enabled: true,
  allowInComments: false,
  context: 'auto',
  formats: { hex: true, rgb: true, hsl: true, named: true },
  embeddedScopes: {
    styleTag: { enabled: true, allowInComments: false, context: 'outsideStrings', formats: { hex: true, rgb: true, hsl: true, named: true } },
    scriptTag: { enabled: true, allowInComments: false, context: 'stringsOnly', formats: { hex: true, rgb: true, hsl: true, named: true } },
    styleAttribute: { enabled: true, allowInComments: false, context: 'all', formats: { hex: true, rgb: true, hsl: true, named: true } },
    attributes: {
      fill: { enabled: true, context: 'all' },
      stroke: { enabled: true, context: 'all' },
      color: { enabled: true, context: 'all' },
      bgcolor: { enabled: true, context: 'all' },
    },
    taggedTemplates: {
      css: { enabled: true, allowInComments: false, context: 'all' },
      styled: { enabled: true, allowInComments: false, context: 'all' },
    },
  },
};
