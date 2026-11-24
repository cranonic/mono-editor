import { IndentAction } from '../../core/enums';
import type { LanguageConfiguration } from '../languageConfigurationTypes';
import { C_STYLE_BRACKET_ENTER_RULES } from './shared';

export const YAML_CONFIG: LanguageConfiguration = {
  comments: { lineComment: '#' },
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
  indentationRules: {
    increaseIndentPattern: /^\s*.*:\s*(?:#.*)?$|^\s*-\s*$/,
    decreaseIndentPattern: /^\s*[\}\]]/,
  },
  onEnterRules: [
    ...C_STYLE_BRACKET_ENTER_RULES,
    {
      beforeText: /:\s*(?:#.*)?$/,
      action: { indentAction: IndentAction.Indent },
    },
  ],
  folding: { offSide: true },
};
