import type { LanguageConfiguration } from '../languageConfigurationTypes';
import { C_STYLE_BRACKET_ENTER_RULES, C_STYLE_DOC_ENTER_RULES } from './shared';

export const CSS_CONFIG: LanguageConfiguration = {
  comments: { blockComment: ['/*', '*/'] },
  brackets: [['{', '}'], ['[', ']'], ['(', ')']],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"', notIn: ['string', 'comment'] },
    { open: "'", close: "'", notIn: ['string', 'comment'] },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
  wordPattern: /(#?-?\d*\.\d\w*%?)|((::|[@#.!:])?[\w-?]+%?)|::|[@#.!:]/g,
  indentationRules: {
    increaseIndentPattern: /(^.*\{[^}]*$)/,
    decreaseIndentPattern: /^\s*\}/,
  },
  onEnterRules: [...C_STYLE_DOC_ENTER_RULES, ...C_STYLE_BRACKET_ENTER_RULES],
  folding: {
    markers: {
      start: /^\s*\/\*\s*#region\b\s*(.*?)\s*\*\//,
      end: /^\s*\/\*\s*#endregion\b.*\*\//,
    },
  },
};
