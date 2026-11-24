import { IndentAction } from '../../core/enums';
import type { LanguageConfiguration } from '../languageConfigurationTypes';

export const JSON_CONFIG: LanguageConfiguration = {
  comments: { lineComment: '//', blockComment: ['/*', '*/'] },
  brackets: [['{', '}'], ['[', ']']],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '"', close: '"', notIn: ['string', 'comment'] },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '"', close: '"' },
  ],
  wordPattern: /("(?:[^\\"]|\\.)*")|([^\s\{\}\[\]\,\:]+)/g,
  indentationRules: {
    increaseIndentPattern: /^.*(\{[^}"]*|\[[^\]]*)$/,
    decreaseIndentPattern: /^\s*[\}\]]/,
  },
  onEnterRules: [
    {
      beforeText: /[\{\[]\s*$/,
      afterText: /^\s*[\}\]]/,
      action: { indentAction: IndentAction.IndentOutdent },
    },
  ],
  folding: {
    markers: { start: /^\s*\/\/\s*#?region\b/, end: /^\s*\/\/\s*#?endregion\b/ },
  },
};
