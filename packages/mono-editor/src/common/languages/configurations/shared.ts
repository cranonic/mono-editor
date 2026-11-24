import { IndentAction } from '../../core/enums';
import type { IndentationRule, OnEnterRule } from '../languageConfigurationTypes';

/** C-family / JS / TS / Java JSDoc & block-comment continuation rules. */
export const C_STYLE_DOC_ENTER_RULES: OnEnterRule[] = [
  {
    beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
    afterText: /^\s*\*\/$/,
    action: { indentAction: IndentAction.IndentOutdent, appendText: ' * ' },
  },
  {
    beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
    action: { indentAction: IndentAction.None, appendText: ' * ' },
  },
  {
    beforeText: /^(\t|(\ \ ))*\ \*(\ ([^\*]|\*(?!\/))*)?$/,
    action: { indentAction: IndentAction.None, appendText: '* ' },
  },
  {
    beforeText: /^(\t|(\ \ ))*\ \*\/\s*$/,
    action: { indentAction: IndentAction.None, removeText: 1 },
  },
];

export const C_STYLE_BRACKET_ENTER_RULES: OnEnterRule[] = [
  {
    beforeText: /[\{\[\(]\s*$/,
    afterText: /^\s*[\}\]\)]/,
    action: { indentAction: IndentAction.IndentOutdent },
  },
];

export const C_STYLE_INDENTATION: IndentationRule = {
  increaseIndentPattern: /^((?!\/\/).)*(\{[^}"'`]*|\([^)"'`]*|\[[^\]"'`]*)$/,
  decreaseIndentPattern: /^((?!.*?\/\*).*\*\/)?\s*[\}\]\)]/,
};
