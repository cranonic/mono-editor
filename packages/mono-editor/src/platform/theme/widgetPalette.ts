import { monoThemeService } from './ThemeService';

/**
 * Shared popup palette + VS Code symbol-icon colours.
 *
 * One source of truth for the completion list, the breadcrumb picker and any
 * other list-style popup, so symbol icons are coloured the same everywhere and
 * follow the active colour theme (`symbolIcon.*Foreground`, `editorSuggestWidget.*`).
 * Pure data + string maths: no DOM.
 */

export type WidgetThemeType = 'dark' | 'light';

export const WIDGET_DARK = {
  background: '#252526',
  border: '#454545',
  foreground: '#cccccc',
  detailForeground: 'rgba(204, 204, 204, 0.65)',
  selectedBackground: '#04395e',
  selectedForeground: '#ffffff',
  selectedDetailForeground: 'rgba(255, 255, 255, 0.82)',
  hoverBackground: '#2a2d2e',
  highlight: '#2aaaff',
  focusHighlight: '#2aaaff',
  shadow: 'rgba(0, 0, 0, 0.36)',
  indentGuide: 'rgba(255, 255, 255, 0.14)',
  activeIndentGuide: 'rgba(255, 255, 255, 0.32)',
  iconDefault: '#cccccc',
  method: '#b180d7',
  field: '#75beff',
  klass: '#ee9d28',
  typeParam: '#4ec9b0',
};

export const WIDGET_LIGHT = {
  background: '#f3f3f3',
  border: '#c8c8c8',
  foreground: '#616161',
  detailForeground: 'rgba(97, 97, 97, 0.72)',
  selectedBackground: '#0060c0',
  selectedForeground: '#ffffff',
  selectedDetailForeground: 'rgba(255, 255, 255, 0.86)',
  hoverBackground: '#e8e8e8',
  highlight: '#0066bf',
  focusHighlight: '#bbe7ff',
  shadow: 'rgba(0, 0, 0, 0.16)',
  indentGuide: 'rgba(0, 0, 0, 0.14)',
  activeIndentGuide: 'rgba(0, 0, 0, 0.32)',
  iconDefault: '#616161',
  method: '#652d90',
  field: '#007acc',
  klass: '#d67e00',
  typeParam: '#267f99',
};

export type WidgetBase = typeof WIDGET_DARK;

export function widgetBase(type: WidgetThemeType | undefined): WidgetBase {
  return type === 'light' ? WIDGET_LIGHT : WIDGET_DARK;
}

/** Icon key → VS Code `symbolIcon.<name>Foreground` theme key(s), first hit wins. */
const THEME_KEYS = new Map<string, string[]>([
  ['enum', ['enum', 'enumerator']],
  ['enumMember', ['enumMember', 'enumeratorMember']],
]);

export type ThemeColorMap = Readonly<Record<string, string>>;

/**
 * Colour for a symbol icon key ('method', 'class', 'field', …).
 * Theme override first, then the VS Code default for the theme type.
 */
export function symbolIconColor(
  key: string,
  colors: ThemeColorMap | undefined,
  type: WidgetThemeType | undefined,
): string {
  const base = widgetBase(type);
  const c = colors ?? {};
  const fallback = defaultSymbolIconColor(key, base);
  for (const name of THEME_KEYS.get(key) ?? [key]) {
    const v = c[`symbolIcon.${name}Foreground`];
    if (v) return v;
  }
  return fallback;
}

function defaultSymbolIconColor(key: string, base: WidgetBase): string {
  switch (key) {
    case 'method':
    case 'function':
    case 'constructor':
      return base.method;
    case 'field':
    case 'variable':
    case 'interface':
    case 'enumMember':
    case 'constant':
      return base.field;
    case 'class':
    case 'enum':
    case 'event':
    case 'struct':
      return base.klass;
    case 'typeParameter':
      return base.typeParam;
    default:
      return base.iconDefault;
  }
}

/** `SymbolKind` (outline / breadcrumbs, LSP order shifted to 0-based) → icon key. */
const SYMBOL_KIND_KEYS = [
  'file', 'module', 'namespace', 'package', 'class', 'method', 'property', 'field',
  'constructor', 'enum', 'interface', 'function', 'variable', 'constant', 'string',
  'number', 'boolean', 'array', 'object', 'key', 'null', 'enumMember', 'struct',
  'event', 'operator', 'typeParameter',
] as const;

export function symbolKindIconKey(kind: number | undefined): string {
  return SYMBOL_KIND_KEYS[kind ?? -1] ?? 'variable';
}

/** True for a light `#rgb` / `#rrggbb` colour; unparsable values count as dark. */
function isLightHex(color: string): boolean {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})/i.exec(color.trim());
  if (!m) return false;
  const h = m[1]!.length === 3 ? m[1]!.replace(/./g, (ch) => ch + ch) : m[1]!;
  const n = parseInt(h, 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.6;
}

export interface PickerPalette {
  background: string;
  border: string;
  foreground: string;
  detailForeground: string;
  selectedBackground: string;
  selectedForeground: string;
  hoverBackground: string;
  highlight: string;
  shadow: string;
  indentGuide: string;
  activeIndentGuide: string;
  /** Colour of the symbol icon for an outline `SymbolKind`. */
  iconForSymbolKind: (kind: number | undefined) => string;
}

/**
 * Palette of list popups that sit next to the editor (breadcrumb picker).
 * By default this is the same palette as the completion list, because
 * `breadcrumbPicker.*` keys are only used when a theme defines them.
 */
export function resolvePickerPalette(
  colors: ThemeColorMap | undefined,
  type: WidgetThemeType | undefined,
): PickerPalette {
  const c = colors ?? {};
  const base = widgetBase(type);
  const foreground =
    c['editorSuggestWidget.foreground'] ?? c['editorWidget.foreground'] ?? base.foreground;
  const selectedBackground =
    c['editorSuggestWidget.selectedBackground'] ??
    c['list.activeSelectionBackground'] ??
    base.selectedBackground;
  return {
    background:
      c['breadcrumbPicker.background'] ??
      c['editorSuggestWidget.background'] ??
      c['editorWidget.background'] ??
      base.background,
    border: c['editorSuggestWidget.border'] ?? c['editorWidget.border'] ?? base.border,
    foreground,
    detailForeground: base.detailForeground,
    selectedBackground,
    selectedForeground:
      c['editorSuggestWidget.selectedForeground'] ??
      c['list.activeSelectionForeground'] ??
      (isLightHex(selectedBackground) ? foreground : base.selectedForeground),
    hoverBackground: c['list.hoverBackground'] ?? base.hoverBackground,
    highlight:
      c['editorSuggestWidget.highlightForeground'] ?? c['list.highlightForeground'] ?? base.highlight,
    shadow: c['widget.shadow'] ?? base.shadow,
    indentGuide:
      c['tree.inactiveIndentGuidesStroke'] ??
      c['tree.indentGuidesStroke'] ??
      base.indentGuide,
    activeIndentGuide:
      c['tree.indentGuidesStroke'] ??
      base.activeIndentGuide,
    iconForSymbolKind: (kind) => symbolIconColor(symbolKindIconKey(kind), c, type),
  };
}

export function activeWidgetThemeType(): WidgetThemeType {
  try {
    return monoThemeService.getColorTheme().type === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Picker palette of the currently active colour theme. */
export function getActivePickerPalette(): PickerPalette {
  let colors: ThemeColorMap = {};
  try {
    colors = monoThemeService.resolve().colors;
  } catch {
    /* default palette */
  }
  return resolvePickerPalette(colors, activeWidgetThemeType());
}
