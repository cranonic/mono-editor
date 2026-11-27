import type { SuggestInsertMode } from '../../common/config/editorOptions';
import type { SelectionState } from '../../common/core/SelectionState';
import { hasSnippetSyntax, type SnippetSession } from '../../common/editOperations/SnippetSession';
import {
  CompletionItemInsertTextRule,
  CompletionItemKind,
  type CompletionItem,
} from '../../common/languages/providers/types';
import type { TextModel } from '../../common/model/TextModel';
import { labelOfCompletion } from './suggestFilter';

export function getWordPrefixAtCaret(
  model: TextModel,
  selection: SelectionState,
  getLanguageIdAtPosition?: (lineNumber: number, column: number) => string,
): string {
  const pos = selection.active;
  const line = model.getLineContent(pos.lineNumber);
  const before = line.slice(0, Math.max(0, pos.column - 1));
  const lang = getLanguageIdAtPosition?.(pos.lineNumber, pos.column) ?? model.getLanguageId();
  if (lang === 'css' || lang === 'html') {
    return before.match(/[A-Za-z0-9_$-]*$/)?.[0] ?? '';
  }
  return before.match(/[A-Za-z0-9_$]*$/)?.[0] ?? '';
}

export function shouldSmartAcceptCompletionOnEnter(
  item: CompletionItem | null,
  prefix: string,
): boolean {
  if (!item) return false;
  const raw = item.textEdit?.text ?? item.insertText ?? labelOfCompletion(item);
  const isSnippet =
    item.kind === CompletionItemKind.Snippet ||
    Boolean(item.insertTextRules && (item.insertTextRules & CompletionItemInsertTextRule.InsertAsSnippet)) ||
    hasSnippetSyntax(raw);
  if (isSnippet || item.additionalTextEdits?.length || item.textEdit) return true;
  return raw !== prefix;
}

export function applyCompletionToModel(
  model: TextModel,
  selection: SelectionState,
  snippetSession: SnippetSession | null,
  item: CompletionItem,
  opts: {
    prefix: string;
    insertMode: SuggestInsertMode;
    getLanguageIdAtPosition?: (lineNumber: number, column: number) => string;
  },
): void {
  const rawText = item.textEdit?.text ?? item.insertText ?? labelOfCompletion(item);
  const isSnippet =
    Boolean(item.insertTextRules && (item.insertTextRules & CompletionItemInsertTextRule.InsertAsSnippet)) ||
    hasSnippetSyntax(rawText);

  let start: number;
  let end: number;
  const editRange = item.textEdit?.range ?? item.range;
  if (editRange) {
    start = model.getOffsetAt(editRange.startLineNumber, editRange.startColumn);
    end = model.getOffsetAt(editRange.endLineNumber, editRange.endColumn);
  } else {
    const a = selection.active;
    end = model.getOffsetAt(a.lineNumber, a.column);
    start = end - opts.prefix.length;
    if (opts.insertMode === 'replace') {
      const line = model.getLineContent(a.lineNumber);
      const after = line.slice(Math.max(0, a.column - 1));
      const lang = opts.getLanguageIdAtPosition?.(a.lineNumber, a.column) ?? model.getLanguageId();
      const wordAfter =
        lang === 'css' || lang === 'html'
          ? after.match(/^[A-Za-z0-9_$-]+/)?.[0] ?? ''
          : after.match(/^[A-Za-z0-9_$]+/)?.[0] ?? '';
      end += wordAfter.length;
    }
  }

  const startPos = model.getPositionAt(start);
  const lineIndent = model.getLineContent(startPos.lineNumber).match(/^[ \t]*/)?.[0] ?? '';
  const additional = item.additionalTextEdits?.length ? [...item.additionalTextEdits] : [];

  let usedSnippet = false;
  model.transact(() => {
    if (additional.length > 0) {
      const normalized = additional
        .map((ed) => ({
          s: model.getOffsetAt(ed.range.startLineNumber, ed.range.startColumn),
          e: model.getOffsetAt(ed.range.endLineNumber, ed.range.endColumn),
          text: ed.text,
        }))
        .sort((a, b) => b.s - a.s);
      let deltaBefore = 0;
      for (const ed of normalized) {
        if (ed.e <= start) {
          const normText = model.normalizeEol(ed.text);
          model.replaceRange(ed.s, ed.e, normText);
          deltaBefore += normText.length - (ed.e - ed.s);
        } else if (ed.s >= end) {
          model.replaceRange(ed.s, ed.e, ed.text);
        }
      }
      start += deltaBefore;
      end += deltaBefore;
    }

    if (isSnippet && snippetSession) {
      snippetSession.insert(model, selection, start, end, rawText, lineIndent);
      usedSnippet = true;
    } else {
      const plain = rawText.replace(/\$\d+/g, '');
      const norm = model.normalizeEol(plain);
      model.replaceRange(start, end, norm);
      const pos = model.getPositionAt(start + norm.length);
      selection.setCaret(pos.lineNumber, pos.column);
    }
  });

  if (!usedSnippet && snippetSession?.isActive()) snippetSession.cancel();
}
