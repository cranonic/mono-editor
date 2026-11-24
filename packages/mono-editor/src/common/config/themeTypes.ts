import type { MonoTokenTheme } from '../languages/tokenization/tokenTypes';
import {
  DEFAULT_RAINBOW_BRACKET_COLORS,
  DEFAULT_UNEXPECTED_BRACKET_COLOR,
} from '../brackets/bracketColorizerTypes';

export interface MonoEditorTheme {
  background: string;
  foreground: string;
  gutterBackground: string;
  gutterForeground: string;
  caret: string;
  selection: string;
  lineHighlight: string;
  /** Syntax token colors (VS Code style). Missing keys fall back to DEFAULT_TOKEN_COLORS. */
  tokenColors?: MonoTokenTheme;
  /** Up to 5 theme-harmonic colors for Rainbow Bracket Pair Colorization. */
  rainbowBrackets?: readonly string[];
  /** Highlight color for unexpected/unmatched closing brackets. */
  unexpectedBracketColor?: string;
  /** Faded greyish foreground for inline & multiline Ghost Text. */
  ghostTextForeground?: string;
  /** Inlay hint chip text color. */
  inlayHintForeground?: string;
  /** Inlay hint chip subtle background fill. */
  inlayHintBackground?: string;
  /** Document highlight fill for Read occurrences. */
  documentHighlightRead?: string;
  /** Document highlight fill for Write occurrences. */
  documentHighlightWrite?: string;
  /** Translucent highlight fill for active hover range. */
  hoverRangeBackground?: string;
  /** Underline/accent color for clickable document links. */
  linkForeground?: string;
}

export const DEFAULT_THEME: MonoEditorTheme = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  gutterBackground: '#1e1e1e',
  gutterForeground: '#858585',
  caret: '#aeafad',
  selection: '#264f78',
  lineHighlight: '#2a2a2a',
  rainbowBrackets: DEFAULT_RAINBOW_BRACKET_COLORS,
  unexpectedBracketColor: DEFAULT_UNEXPECTED_BRACKET_COLOR,
  ghostTextForeground: 'rgba(156, 163, 175, 0.56)',
  inlayHintForeground: '#969696',
  inlayHintBackground: 'rgba(128, 128, 128, 0.14)',
  documentHighlightRead: 'rgba(87, 87, 87, 0.42)',
  documentHighlightWrite: 'rgba(14, 99, 156, 0.38)',
  hoverRangeBackground: 'rgba(38, 79, 120, 0.32)',
  linkForeground: '#3794ff',
};
