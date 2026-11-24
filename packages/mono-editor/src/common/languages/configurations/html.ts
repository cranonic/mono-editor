import { IndentAction } from '../../core/enums';
import type { LanguageConfiguration } from '../languageConfigurationTypes';
import { C_STYLE_BRACKET_ENTER_RULES } from './shared';

export const HTML_CONFIG: LanguageConfiguration = {
  comments: { blockComment: ['<!--', '-->'] },
  brackets: [['<!--', '-->'], ['<', '>'], ['{', '}'], ['(', ')']],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"', notIn: ['string', 'comment'] },
    { open: "'", close: "'", notIn: ['string', 'comment'] },
  ],
  surroundingPairs: [
    { open: '"', close: '"' },
    { open: "'", close: "'" },
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '<', close: '>' },
  ],
  wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\$\^\&\*\(\)\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\s]+)/g,
  indentationRules: {
    increaseIndentPattern:
      /<(?!\?|(?:area|base|br|col|frame|hr|html|img|input|link|meta|param)\b|[^>]*\/>)([-_\.A-Za-z0-9]+)(?=\s|>)\b[^>]*>(?!.*<\/\1>)|<!--(?!.*-->)|\{[^}"']*$/,
    decreaseIndentPattern: /^\s*(<\/(?!html)[-_\.A-Za-z0-9]+\b[^>]*>|-->|\})/,
  },
  onEnterRules: [
    {
      beforeText: /<([_:\w][_:\w-.\d]*)(?:\s[^>]*)?>\s*$/,
      afterText: /^<\/([_:\w][_:\w-.\d]*)\s*>/,
      action: { indentAction: IndentAction.IndentOutdent },
    },
    {
      beforeText:
        /<(?!area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)([_:\w][_:\w-.\d]*)(?:\s[^>]*)?>\s*$/,
      action: { indentAction: IndentAction.Indent },
    },
    ...C_STYLE_BRACKET_ENTER_RULES,
  ],
  folding: {
    markers: { start: /^\s*<!--\s*#region\b.*-->/, end: /^\s*<!--\s*#endregion\b.*-->/ },
  },
};
