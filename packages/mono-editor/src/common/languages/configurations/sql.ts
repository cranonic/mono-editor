import type { LanguageConfiguration } from '../languageConfigurationTypes';
import { C_STYLE_BRACKET_ENTER_RULES, C_STYLE_DOC_ENTER_RULES } from './shared';

export const SQL_CONFIG: LanguageConfiguration = {
  comments: { lineComment: '--', blockComment: ['/*', '*/'] },
  brackets: [['{', '}'], ['[', ']'], ['(', ')']],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"', notIn: ['string', 'comment'] },
    { open: "'", close: "'", notIn: ['string', 'comment'] },
    { open: '`', close: '`', notIn: ['string', 'comment'] },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
    { open: '`', close: '`' },
  ],
  indentationRules: {
    increaseIndentPattern: /\b(?:BEGIN|CASE)\b\s*$/i,
    decreaseIndentPattern: /^\s*\b(?:END)\b/i,
  },
  onEnterRules: [...C_STYLE_DOC_ENTER_RULES, ...C_STYLE_BRACKET_ENTER_RULES],
};
