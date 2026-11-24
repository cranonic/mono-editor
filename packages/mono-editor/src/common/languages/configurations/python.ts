import { IndentAction } from '../../core/enums';
import type { LanguageConfiguration } from '../languageConfigurationTypes';
import { C_STYLE_BRACKET_ENTER_RULES } from './shared';

export const PYTHON_CONFIG: LanguageConfiguration = {
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
  wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
  indentationRules: {
    increaseIndentPattern: /^\s*(?:def|class|for|if|elif|else|while|try|with|finally|except|async|match|case)\b.*:\s*(?:#.*)?$/,
    decreaseIndentPattern: /^\s*(?:elif|else|except|finally)\b.*:\s*$/,
  },
  onEnterRules: [
    ...C_STYLE_BRACKET_ENTER_RULES,
    {
      beforeText: /^\s*(?:def|class|for|if|elif|else|while|try|with|finally|except|async|match|case)\b.*:\s*(?:#.*)?$/,
      action: { indentAction: IndentAction.Indent },
    },
    {
      beforeText: /:\s*(?:#.*)?$/,
      action: { indentAction: IndentAction.Indent },
    },
  ],
  folding: {
    offSide: true,
    markers: { start: /^\s*#\s*region\b/, end: /^\s*#\s*endregion\b/ },
  },
};
