import { IndentAction } from '../core/enums';
import type {
  AutoIndentBehavior,
  CharacterPair,
  EnterAction,
  LanguageConfiguration,
} from './languageConfigurationTypes';

export interface EvaluatedEnterResult {
  /** Text to insert at the caret position (always starts with '\n'). */
  insertText: string;
  /** Caret line delta relative to the starting line (usually 1). */
  caretLineDelta: number;
  /** 1-based column for the caret on `startLine + caretLineDelta`. */
  caretColumn: number;
  /** Resolved IndentAction. */
  indentAction: IndentAction;
}

function outdentOnce(indent: string, tabSize: number): string {
  if (!indent) return '';
  if (indent.endsWith('\t')) return indent.slice(0, -1);
  let remove = 0;
  while (remove < tabSize && remove < indent.length && indent[indent.length - 1 - remove] === ' ') {
    remove++;
  }
  return indent.slice(0, indent.length - remove);
}

function applyRemoveText(indent: string, removeText?: number): string {
  if (!removeText || removeText <= 0) return indent;
  return indent.slice(0, Math.max(0, indent.length - removeText));
}

function matchBracketPairAroundCaret(
  config: LanguageConfiguration | undefined,
  beforeText: string,
  afterText: string,
): boolean {
  const bTrim = beforeText.trimEnd();
  const aTrim = afterText.trimStart();
  if (!bTrim || !aTrim) return false;
  const pairs: CharacterPair[] = config?.brackets ?? [];
  for (const [open, close] of pairs) {
    if (open && close && bTrim.endsWith(open) && aTrim.startsWith(close)) {
      return true;
    }
  }
  return false;
}

/**
 * Evaluates Monaco-style `onEnterRules` and `indentationRules` for a line split at `column`.
 */
export function evaluateOnEnter(
  config: LanguageConfiguration | undefined,
  lineText: string,
  column: number,
  previousLineText: string,
  tabSize: number,
  autoIndent: AutoIndentBehavior = 'full',
): EvaluatedEnterResult {
  const beforeText = lineText.slice(0, Math.max(0, column - 1));
  const afterText = lineText.slice(Math.max(0, column - 1));
  const indentMatch = lineText.match(/^[ \t]*/);
  const currentIndent = indentMatch ? indentMatch[0]! : '';

  if (autoIndent === 'none') {
    return {
      insertText: '\n',
      caretLineDelta: 1,
      caretColumn: 1,
      indentAction: IndentAction.None,
    };
  }

  if (autoIndent === 'keep') {
    return {
      insertText: '\n' + currentIndent,
      caretLineDelta: 1,
      caretColumn: currentIndent.length + 1,
      indentAction: IndentAction.None,
    };
  }

  const unit = ' '.repeat(Math.max(1, tabSize));
  let matched: EnterAction | null = null;

  // 1. Check explicit onEnterRules (in registration order, like Monaco)
  if (config?.onEnterRules && (autoIndent === 'advanced' || autoIndent === 'full')) {
    for (const rule of config.onEnterRules) {
      if (!rule.beforeText.test(beforeText)) continue;
      if (rule.afterText && !rule.afterText.test(afterText)) continue;
      if (rule.previousLineText && !rule.previousLineText.test(previousLineText)) continue;
      matched = rule.action;
      break;
    }
  }

  // 2. Bracket pair around caret: {|} / [|] / (|)
  if (!matched && matchBracketPairAroundCaret(config, beforeText, afterText)) {
    matched = { indentAction: IndentAction.IndentOutdent };
  }

  // 3. Language indentationRules.increaseIndentPattern
  if (!matched && (autoIndent === 'advanced' || autoIndent === 'full')) {
    if (config?.indentationRules?.increaseIndentPattern?.test(beforeText)) {
      matched = { indentAction: IndentAction.Indent };
    }
  }

  // 4. Fallback for 'brackets' mode: opening bracket at end of beforeText
  if (!matched && config?.brackets?.length) {
    const bTrim = beforeText.trimEnd();
    for (const [open] of config.brackets) {
      if (open.length === 1 && bTrim.endsWith(open)) {
        matched = { indentAction: IndentAction.Indent };
        break;
      }
    }
  }

  const action: EnterAction = matched ?? { indentAction: IndentAction.None };
  const appendText = action.appendText ?? '';

  if (action.indentAction === IndentAction.IndentOutdent) {
    if (appendText) {
      const mid = currentIndent + appendText;
      const tailIndent = currentIndent + (appendText.startsWith(' ') ? ' ' : '');
      return {
        insertText: `\n${mid}\n${tailIndent}`,
        caretLineDelta: 1,
        caretColumn: mid.length + 1,
        indentAction: IndentAction.IndentOutdent,
      };
    }
    const inner = currentIndent + unit;
    return {
      insertText: `\n${inner}\n${currentIndent}`,
      caretLineDelta: 1,
      caretColumn: inner.length + 1,
      indentAction: IndentAction.IndentOutdent,
    };
  }

  if (action.indentAction === IndentAction.Indent) {
    const nextIndent = applyRemoveText(currentIndent + unit, action.removeText);
    const linePrefix = nextIndent + appendText;
    return {
      insertText: '\n' + linePrefix,
      caretLineDelta: 1,
      caretColumn: linePrefix.length + 1,
      indentAction: IndentAction.Indent,
    };
  }

  if (action.indentAction === IndentAction.Outdent) {
    const nextIndent = applyRemoveText(outdentOnce(currentIndent, tabSize), action.removeText);
    const linePrefix = nextIndent + appendText;
    return {
      insertText: '\n' + linePrefix,
      caretLineDelta: 1,
      caretColumn: linePrefix.length + 1,
      indentAction: IndentAction.Outdent,
    };
  }

  const nextIndent = applyRemoveText(currentIndent, action.removeText);
  const linePrefix = nextIndent + appendText;
  return {
    insertText: '\n' + linePrefix,
    caretLineDelta: 1,
    caretColumn: linePrefix.length + 1,
    indentAction: IndentAction.None,
  };
}
