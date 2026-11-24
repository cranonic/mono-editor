import { IndentAction } from '../../core/enums';
import type { LanguageConfiguration } from '../languageConfigurationTypes';

export const MARKDOWN_CONFIG: LanguageConfiguration = {
  comments: { blockComment: ['<!--', '-->'] },
  brackets: [['{', '}'], ['[', ']'], ['(', ')']],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '`', close: '`', notIn: ['string'] },
    { open: '"', close: '"', notIn: ['string'] },
    { open: "'", close: "'", notIn: ['string'] },
  ],
  surroundingPairs: [
    { open: '(', close: ')' },
    { open: '[', close: ']' },
    { open: '`', close: '`' },
    { open: '*', close: '*' },
    { open: '_', close: '_' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
  onEnterRules: [
    {
      beforeText: /^\s*-\s+\S.*$/,
      action: { indentAction: IndentAction.None, appendText: '- ' },
    },
    {
      beforeText: /^\s*\*\s+\S.*$/,
      action: { indentAction: IndentAction.None, appendText: '* ' },
    },
    {
      beforeText: /^\s*>\s+\S.*$/,
      action: { indentAction: IndentAction.None, appendText: '> ' },
    },
  ],
  folding: {
    offSide: true,
    markers: { start: /^\s*<!--\s*#?region\b.*-->/, end: /^\s*<!--\s*#?endregion\b.*-->/ },
  },
};
