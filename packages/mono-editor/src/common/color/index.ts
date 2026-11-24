export { DEFAULT_COLOR_DECORATOR_RULES } from './colorTypes';
export type {
  RgbaColor,
  ColorFormat,
  ColorContextMode,
  EmbeddedColorScope,
  ColorFormatOptions,
  ColorScopeRule,
  ColorRuleContext,
  ColorDecoratorRules,
  ColorMatch,
} from './colorTypes';
export { CSS_NAMED_COLORS } from './namedColors';
export { hexToRgba, hslToRgba, rgbaToHsl, rgbaToHsv, hsvToRgba, parseColorLiteral } from './colorParse';
export { rgbaToHex, rgbaToRgbString, rgbaToHslString, rgbaToCss, formatColorPresentation } from './colorFormat';
export { detectLineEmbeddedScope, analyzeEmbeddedLineContext, detectHtmlAttributeAt } from './colorEmbeddedScope';
export type { LineEmbeddedInfo, LineSourceLike } from './colorEmbeddedScope';
export { detectLineColors } from './colorDecoratorRules';
export type { ColorModelLike } from './colorDecoratorRules';
