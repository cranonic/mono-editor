import { IndentAction } from '../../core/enums';
import type { LanguageConfiguration } from '../languageConfigurationTypes';
import { C_STYLE_BRACKET_ENTER_RULES } from './shared';

export const SHELL_CONFIG: LanguageConfiguration = {
  comments: { lineComment: '#' },
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
    increaseIndentPattern: /^\s*(?:if|elif|else|for|while|until|case|select)\b.*(?:then|do|in|\{)\s*(?:#.*)?$|\{\s*$/,
    decreaseIndentPattern: /^\s*(?:fi|done|esac|elif|else|\})\b/,
  },
  onEnterRules: [
    ...C_STYLE_BRACKET_ENTER_RULES,
    {
      beforeText: /\b(?:then|do)\s*(?:#.*)?$/,
      action: { indentAction: IndentAction.Indent },
    },
  ],
  folding: {
    markers: { start: /^\s*#\s*region\b/, end: /^\s*#\s*endregion\b/ },
  },
};
