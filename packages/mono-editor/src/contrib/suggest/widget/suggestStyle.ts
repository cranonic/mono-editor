import { symbolIconColor, WIDGET_DARK, WIDGET_LIGHT } from '../../../platform/theme/widgetPalette';
import {
  CompletionItemKind as Kind,
  type CompletionItem,
} from '../../../common/languages/providers/types';

export type SuggestDocsMode = 'off' | 'auto' | 'side' | 'below';

export interface SuggestWidgetOptions {
  maxHeight?: number;
  maxWidth?: number;
  minWidth?: number;
  fontFamily?: string;
  fontSize?: number;
  rowHeight?: number;
  docsMode?: SuggestDocsMode;
  showIcons?: boolean;
  showStatusBar?: boolean;
  background?: string;
  border?: string;
  foreground?: string;
  selectedBackground?: string;
  selectedForeground?: string;
  hoverBackground?: string;
  highlightForeground?: string;
  detailForeground?: string;
  className?: string;
  themeColors?: Record<string, string>;
  themeType?: 'dark' | 'light';
}

export interface SuggestAnchor {
  x: number;
  y: number;
  top?: number;
}

export interface SuggestPalette {
  background: string;
  border: string;
  foreground: string;
  detailForeground: string;
  selectedBackground: string;
  selectedForeground: string;
  selectedDetailForeground: string;
  hoverBackground: string;
  highlight: string;
  focusHighlight: string;
  shadow: string;
  icon: (kind: number | undefined) => string;
}

export const LABEL_OFFSET = 4 + 2 + 16 + 4;
export const BORDER = 1;

const DARK = WIDGET_DARK;
const LIGHT = WIDGET_LIGHT;

const ICON_KEY: Record<number, string> = {
  [Kind.Text]: 'text', [Kind.Method]: 'method', [Kind.Function]: 'function',
  [Kind.Constructor]: 'constructor', [Kind.Field]: 'field', [Kind.Variable]: 'variable',
  [Kind.Class]: 'class', [Kind.Interface]: 'interface', [Kind.Module]: 'module',
  [Kind.Property]: 'property', [Kind.Unit]: 'unit', [Kind.Value]: 'value',
  [Kind.Enum]: 'enum', [Kind.Keyword]: 'keyword', [Kind.Snippet]: 'snippet',
  [Kind.Color]: 'color', [Kind.File]: 'file', [Kind.Reference]: 'reference',
  [Kind.Folder]: 'folder', [Kind.EnumMember]: 'enumMember', [Kind.Constant]: 'constant',
  [Kind.Struct]: 'struct', [Kind.Event]: 'event', [Kind.Operator]: 'operator',
  [Kind.TypeParameter]: 'typeParameter', [Kind.User]: 'user', [Kind.Issue]: 'issue',
};

const KIND_NAME: Record<number, string> = {
  [Kind.Text]: 'text', [Kind.Method]: 'method', [Kind.Function]: 'function',
  [Kind.Constructor]: 'constructor', [Kind.Field]: 'field', [Kind.Variable]: 'variable',
  [Kind.Class]: 'class', [Kind.Interface]: 'interface', [Kind.Module]: 'module',
  [Kind.Property]: 'property', [Kind.Unit]: 'unit', [Kind.Value]: 'value',
  [Kind.Enum]: 'enum', [Kind.Keyword]: 'keyword', [Kind.Snippet]: 'snippet',
  [Kind.Color]: 'color', [Kind.File]: 'file', [Kind.Reference]: 'reference',
  [Kind.Folder]: 'folder', [Kind.EnumMember]: 'enum member', [Kind.Constant]: 'constant',
  [Kind.Struct]: 'struct', [Kind.Event]: 'event', [Kind.Operator]: 'operator',
  [Kind.TypeParameter]: 'type parameter', [Kind.User]: 'user', [Kind.Issue]: 'issue',
};

export function kindLabel(k?: number): string {
  return k == null ? '' : KIND_NAME[k] ?? '';
}

export function labelOfItem(item: CompletionItem): string {
  return typeof item.label === 'string' ? item.label : item.label?.label || '';
}

export function matchIndexes(label: string, filter: string): Set<number> | null {
  if (!filter) return null;
  const l = label.toLowerCase();
  const f = filter.toLowerCase();
  const at = l.startsWith(f) ? 0 : l.indexOf(f);
  const out = new Set<number>();
  if (at >= 0) {
    for (let i = 0; i < f.length; i++) out.add(at + i);
    return out;
  }
  let j = 0;
  for (let i = 0; i < l.length && j < f.length; i++) {
    if (l[i] === f[j]) {
      out.add(i);
      j++;
    }
  }
  return j === f.length ? out : null;
}

const STYLE_ID = 'mono-suggest-style';
export function ensureSuggestStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
.mono-suggest-widget .mono-suggest-list,.mono-suggest-docs{scrollbar-width:thin;scrollbar-color:rgba(121,121,121,.4) transparent}
.mono-suggest-widget .mono-suggest-list::-webkit-scrollbar,.mono-suggest-docs::-webkit-scrollbar{width:8px;height:8px}
.mono-suggest-widget .mono-suggest-list::-webkit-scrollbar-track,.mono-suggest-docs::-webkit-scrollbar-track{background:transparent}
.mono-suggest-widget .mono-suggest-list::-webkit-scrollbar-thumb,.mono-suggest-docs::-webkit-scrollbar-thumb{background:rgba(121,121,121,.4)}
.mono-suggest-widget .mono-suggest-list::-webkit-scrollbar-thumb:hover,.mono-suggest-docs::-webkit-scrollbar-thumb:hover{background:rgba(100,100,100,.7)}
.mono-suggest-widget .codicon{line-height:16px}
.mono-suggest-widget .mono-sg-info-btn:hover{background:rgba(255,255,255,0.14)!important;opacity:1!important}
`;
  document.head.appendChild(s);
}

export function resolveSuggestPalette(o: SuggestWidgetOptions): SuggestPalette {
  const c = o.themeColors ?? {};
  const base = o.themeType === 'light' ? LIGHT : DARK;
  const foreground =
    o.foreground ?? c['editorSuggestWidget.foreground'] ?? c['editorWidget.foreground'] ?? base.foreground;
  const pick = (kind: number | undefined): string =>
    symbolIconColor(ICON_KEY[kind ?? 0] ?? 'text', c, o.themeType);
  return {
    background: o.background ?? c['editorSuggestWidget.background'] ?? c['editorWidget.background'] ?? base.background,
    border: o.border ?? `1px solid ${c['editorSuggestWidget.border'] ?? c['editorWidget.border'] ?? base.border}`,
    foreground,
    detailForeground: o.detailForeground ?? base.detailForeground,
    selectedBackground:
      o.selectedBackground ?? c['editorSuggestWidget.selectedBackground'] ?? c['list.activeSelectionBackground'] ?? base.selectedBackground,
    selectedForeground:
      o.selectedForeground ?? c['editorSuggestWidget.selectedForeground'] ?? c['list.activeSelectionForeground'] ?? base.selectedForeground,
    selectedDetailForeground: base.selectedDetailForeground,
    hoverBackground: o.hoverBackground ?? c['list.hoverBackground'] ?? base.hoverBackground,
    highlight:
      o.highlightForeground ?? c['editorSuggestWidget.highlightForeground'] ?? c['list.highlightForeground'] ?? base.highlight,
    focusHighlight:
      o.highlightForeground ?? c['editorSuggestWidget.focusHighlightForeground'] ?? c['list.focusHighlightForeground'] ?? base.focusHighlight,
    shadow: c['widget.shadow'] ?? base.shadow,
    icon: pick,
  };
}
