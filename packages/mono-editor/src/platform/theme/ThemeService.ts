import type { MonoEditorTheme } from '../../common/config/themeTypes';
import { DEFAULT_THEME } from '../../common/config/themeTypes';
import { DEFAULT_TOKEN_COLORS } from '../../common/languages/tokenization/tokenTypes';
import { mergeTokenColors, rulesToTokenColors } from './mapTokens';
import type {
  MonoColorTheme,
  MonoStandaloneThemeData,
  MonoThemeChangeListener,
  ResolvedMonoEditorTheme,
} from './types';

/**
 * Monaco-level theme registry for mono-editor.
 *
 * API mirror:
 *   monaco.editor.defineTheme(id, data)
 *   monaco.editor.setTheme(id)
 *   onDidChangeColorTheme
 *
 * Scalable: extensions / app call defineTheme at runtime; all mounted
 * MonoEditor instances subscribe and re-paint.
 */
export class MonoThemeService {
  private themes = new Map<string, MonoColorTheme>();
  private activeId = 'mscode-dark';
  private listeners = new Set<MonoThemeChangeListener>();

  defineTheme(
    id: string,
    data: MonoStandaloneThemeData,
    meta?: { label?: string; type?: MonoColorTheme['type'] },
  ): void {
    const type =
      meta?.type ??
      (data.base === 'vs' ? 'light' : data.base === 'hc-black' ? 'high-contrast' : 'dark');
    this.themes.set(id, {
      id,
      label: meta?.label ?? id,
      type,
      data: {
        inherit: true,
        ...data,
        colors: { ...(data.colors ?? {}) },
        tokenColors: data.tokenColors
          ? { ...DEFAULT_TOKEN_COLORS, ...data.tokenColors }
          : rulesToTokenColors(data.rules),
        rules: data.rules ? [...data.rules] : undefined,
      },
    });
  }

  /**
   * Accept app `ThemeDefinition`-shaped objects without importing app types.
   */
  defineFromVSCodeTheme(
    id: string,
    def: {
      name?: string;
      type?: 'dark' | 'light' | 'high-contrast';
      editorColors?: Record<string, string>;
      tokenColors?: Array<{
        scope: string | string[];
        settings: { foreground?: string; background?: string; fontStyle?: string };
      }>;
    },
  ): void {
    const rules =
      def.tokenColors?.flatMap((tc) => {
        const scopes = Array.isArray(tc.scope) ? tc.scope : [tc.scope];
        return scopes.map((token) => ({
          token,
          foreground: tc.settings.foreground,
          background: tc.settings.background,
          fontStyle: tc.settings.fontStyle,
        }));
      }) ?? [];

    const base =
      def.type === 'light' ? 'vs' : def.type === 'high-contrast' ? 'hc-black' : 'vs-dark';

    this.defineTheme(
      id,
      {
        base,
        inherit: true,
        colors: { ...(def.editorColors ?? {}) },
        rules,
        tokenColors: rulesToTokenColors(rules),
      },
      { label: def.name ?? id, type: def.type ?? 'dark' },
    );
  }

  setTheme(id: string): void {
    if (!this.themes.has(id)) {
      console.warn(`[MonoThemeService] Unknown theme "${id}", keeping "${this.activeId}"`);
      return;
    }
    this.activeId = id;
    const theme = this.themes.get(id)!;
    for (const l of this.listeners) {
      try {
        l(theme);
      } catch {
        /* */
      }
    }
  }

  getTheme(id?: string): MonoColorTheme | undefined {
    return this.themes.get(id ?? this.activeId);
  }

  getColorTheme(): MonoColorTheme {
    return (
      this.themes.get(this.activeId) ?? {
        id: this.activeId,
        label: this.activeId,
        type: 'dark',
        data: { base: 'vs-dark', colors: {}, tokenColors: { ...DEFAULT_TOKEN_COLORS } },
      }
    );
  }

  getActiveThemeId(): string {
    return this.activeId;
  }

  listThemes(): { id: string; label: string; type: MonoColorTheme['type'] }[] {
    return [...this.themes.values()].map((t) => ({
      id: t.id,
      label: t.label,
      type: t.type,
    }));
  }

  onDidChangeColorTheme(listener: MonoThemeChangeListener): { dispose: () => void } {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  /** Resolve to canvas MonoEditorTheme + tokenColors + raw colors */
  resolve(id?: string): ResolvedMonoEditorTheme {
    const theme = this.getTheme(id) ?? this.getColorTheme();
    const c = theme.data.colors ?? {};
    const tokenColors = mergeTokenColors(
      theme.data.tokenColors,
      undefined,
    );
    const extractedRainbow: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const col = c[`editorBracketHighlight.foreground${i}`];
      if (col) extractedRainbow.push(col);
    }
    const rainbowBrackets =
      extractedRainbow.length > 0
        ? extractedRainbow
        : DEFAULT_THEME.rainbowBrackets;
    const unexpectedBracketColor =
      c['editorBracketHighlight.unexpectedBracket.foreground'] ??
      c['editorError.foreground'] ??
      DEFAULT_THEME.unexpectedBracketColor;

    const isLight = theme.type === 'light';
    const ghostTextForeground =
      c['editorGhostText.foreground'] ??
      (isLight ? 'rgba(100, 116, 139, 0.62)' : 'rgba(156, 163, 175, 0.56)');
    const inlayHintForeground =
      c['editorInlayHint.foreground'] ??
      (isLight ? '#64748b' : '#969696');
    const inlayHintBackground =
      c['editorInlayHint.background'] ??
      (isLight ? 'rgba(100, 116, 139, 0.10)' : 'rgba(128, 128, 128, 0.15)');
    const documentHighlightRead =
      c['editor.wordHighlightBackground'] ??
      (isLight ? 'rgba(15, 23, 42, 0.08)' : 'rgba(87, 87, 87, 0.42)');
    const documentHighlightWrite =
      c['editor.wordHighlightStrongBackground'] ??
      (isLight ? 'rgba(14, 165, 233, 0.18)' : 'rgba(14, 99, 156, 0.40)');
    const hoverRangeBackground =
      c['editor.hoverHighlightBackground'] ??
      (isLight ? 'rgba(37, 99, 235, 0.12)' : 'rgba(38, 79, 120, 0.34)');
    const linkForeground =
      c['editorLink.activeForeground'] ??
      c['textLink.foreground'] ??
      (isLight ? '#006ab1' : '#3794ff');

    return {
      themeId: theme.id,
      background: c['editor.background'] ?? DEFAULT_THEME.background,
      foreground: c['editor.foreground'] ?? DEFAULT_THEME.foreground,
      gutterBackground:
        c['editorGutter.background'] ??
        c['editor.background'] ??
        DEFAULT_THEME.gutterBackground,
      gutterForeground:
        c['editorLineNumber.foreground'] ?? DEFAULT_THEME.gutterForeground,
      caret: c['editorCursor.foreground'] ?? DEFAULT_THEME.caret,
      selection: c['editor.selectionBackground'] ?? DEFAULT_THEME.selection,
      lineHighlight:
        c['editor.lineHighlightBackground'] ?? DEFAULT_THEME.lineHighlight,
      tokenColors,
      rainbowBrackets,
      unexpectedBracketColor,
      ghostTextForeground,
      inlayHintForeground,
      inlayHintBackground,
      documentHighlightRead,
      documentHighlightWrite,
      hoverRangeBackground,
      linkForeground,
      colors: { ...c },
    };
  }

  toPartialEditorTheme(id?: string): Partial<MonoEditorTheme> {
    const r = this.resolve(id);
    return {
      background: r.background,
      foreground: r.foreground,
      gutterBackground: r.gutterBackground,
      gutterForeground: r.gutterForeground,
      caret: r.caret,
      selection: r.selection,
      lineHighlight: r.lineHighlight,
      tokenColors: r.tokenColors,
      rainbowBrackets: r.rainbowBrackets,
      unexpectedBracketColor: r.unexpectedBracketColor,
      ghostTextForeground: r.ghostTextForeground,
      inlayHintForeground: r.inlayHintForeground,
      inlayHintBackground: r.inlayHintBackground,
      documentHighlightRead: r.documentHighlightRead,
      documentHighlightWrite: r.documentHighlightWrite,
      hoverRangeBackground: r.hoverRangeBackground,
      linkForeground: r.linkForeground,
    };
  }
}

/** Process-wide singleton (Monaco has one global editor theme too). */
export const monoThemeService = new MonoThemeService();
