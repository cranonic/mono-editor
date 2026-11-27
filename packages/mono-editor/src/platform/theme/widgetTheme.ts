import type { MonoEditorTheme } from '../../common/config/themeTypes';

export interface ResolvedWidgetTheme {
  isDark: boolean;
  editorBackground: string;
  background: string;
  foreground: string;
  mutedForeground: string;
  border: string;
  inputBackground: string;
  inputForeground: string;
  inputBorder: string;
  focusBorder: string;
  activeOptionBg: string;
  activeOptionFg: string;
  activeOptionBorder: string;
  hoverBackground: string;
  selectionBackground: string;
  selectionForeground: string;
  codeBackground: string;
  shadow: string;
}

export function isDarkColor(hex: string | undefined): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim());
  if (!m) return true;
  const n = parseInt(m[1]!, 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum < 0.5;
}

function adjustHex(hex: string, delta: number): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp((n >> 16) + delta);
  const g = clamp(((n >> 8) & 255) + delta);
  const b = clamp((n & 255) + delta);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

/**
 * Resolves a consistent dark/light color palette for floating editor widgets
 * (Find, Hover, Signature Help, Rename, References, Code Actions, Diagnostics)
 * from the active Mono editor theme + VS Code color keys.
 */
export function resolveWidgetTheme(
  editorTheme: MonoEditorTheme,
  rawColors: Record<string, string> = {},
): ResolvedWidgetTheme {
  const dark = isDarkColor(editorTheme.background);
  const c = rawColors;

  const fallbackBg = dark
    ? (adjustHex(editorTheme.background, 9) ?? '#252526')
    : (adjustHex(editorTheme.background, -7) ?? '#f3f3f3');

  const fallbackInputBg = dark
    ? (adjustHex(editorTheme.background, 22) ?? '#3c3c3c')
    : '#ffffff';

  const fallbackBorder = dark
    ? (adjustHex(editorTheme.background, 38) ?? '#454545')
    : (adjustHex(editorTheme.background, -34) ?? '#d0d7de');

  const focusBorder =
    c['focusBorder'] ??
    (dark ? '#007fd4' : '#0066b8');

  return {
    isDark: dark,
    editorBackground: c['editor.background'] ?? editorTheme.background ?? (dark ? '#1e1e1e' : '#ffffff'),
    background: c['editorWidget.background'] ?? fallbackBg,
    foreground:
      c['editorWidget.foreground'] ??
      c['editor.foreground'] ??
      editorTheme.foreground ??
      (dark ? '#cccccc' : '#1f2328'),
    mutedForeground:
      c['descriptionForeground'] ??
      c['editorLineNumber.foreground'] ??
      editorTheme.gutterForeground ??
      (dark ? '#9d9d9d' : '#57606a'),
    border: c['editorWidget.border'] ?? fallbackBorder,
    inputBackground: c['input.background'] ?? fallbackInputBg,
    inputForeground:
      c['input.foreground'] ??
      c['editor.foreground'] ??
      editorTheme.foreground ??
      (dark ? '#cccccc' : '#1f2328'),
    inputBorder: c['input.border'] ?? fallbackBorder,
    focusBorder,
    activeOptionBg:
      c['inputOption.activeBackground'] ??
      (dark ? 'rgba(0, 127, 212, 0.36)' : 'rgba(0, 102, 184, 0.16)'),
    activeOptionFg:
      c['inputOption.activeForeground'] ??
      (dark ? '#ffffff' : '#005a9e'),
    activeOptionBorder:
      c['inputOption.activeBorder'] ??
      focusBorder,
    hoverBackground:
      c['list.hoverBackground'] ??
      (dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.07)'),
    selectionBackground:
      c['list.activeSelectionBackground'] ??
      (dark ? '#094771' : '#0060c0'),
    selectionForeground:
      c['list.activeSelectionForeground'] ??
      '#ffffff',
    codeBackground: dark ? 'rgba(0, 0, 0, 0.28)' : 'rgba(15, 23, 42, 0.06)',
    shadow: dark
      ? '0 4px 16px rgba(0, 0, 0, 0.42)'
      : '0 4px 16px rgba(15, 23, 42, 0.14)',
  };
}
