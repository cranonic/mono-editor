import type { LanguageConfiguration } from '../languageConfigurationTypes';
import { C_STYLE_BRACKET_ENTER_RULES, C_STYLE_DOC_ENTER_RULES, C_STYLE_INDENTATION } from './shared';

export const C_CPP_CONFIG: LanguageConfiguration = {
  comments: { lineComment: '//', blockComment: ['/*', '*/'] },
  brackets: [['{', '}'], ['[', ']'], ['(', ')']],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"', notIn: ['string', 'comment'] },
    { open: "'", close: "'", notIn: ['string', 'comment'] },
    { open: '/**', close: ' */', notIn: ['string'] },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
    { open: '<', close: '>' },
  ],
  wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
  indentationRules: C_STYLE_INDENTATION,
  onEnterRules: [...C_STYLE_DOC_ENTER_RULES, ...C_STYLE_BRACKET_ENTER_RULES],
  folding: {
    markers: {
      start: /^\s*#\s*pragma\s+region\b|^\s*\/\/\s*#?region\b/,
      end: /^\s*#\s*pragma\s+endregion\b|^\s*\/\/\s*#?endregion\b/,
    },
  },
};
