import type {
  SuggestPreviewMode,
  WordBasedSuggestionsMode,
} from '../../common/config/editorOptions';
import {
  CompletionItemKind,
  type CompletionItem,
} from '../../common/languages/providers/types';
import { getAllRegisteredStandaloneModels } from '../../common/model/modelRegistry';
import type { TextModel } from '../../common/model/TextModel';
import { labelOfCompletion } from './suggestFilter';

export function previewTextForGhost(item: CompletionItem): string {
  const raw = item.textEdit?.text ?? item.insertText ?? labelOfCompletion(item);
  const cleaned = raw
    .replace(/\$\{\d+:([^}]*)\}/g, '$1')
    .replace(/\$\{\d+\|([^,|}]*)[^}]*\|\}/g, '$1')
    .replace(/\$\d+/g, '');
  const firstLine = cleaned.split(/\r?\n/)[0] ?? '';
  return firstLine || labelOfCompletion(item);
}

export function computePreviewSuffix(
  preview: string,
  prefix: string,
  mode: SuggestPreviewMode,
): string | null {
  if (!preview) return null;
  if (!prefix) return preview;
  const pLow = preview.toLowerCase();
  const fLow = prefix.toLowerCase();

  if (pLow.startsWith(fLow)) {
    const suffix = preview.slice(prefix.length);
    return suffix.length > 0 ? suffix : null;
  }
  if (mode === 'prefix') return null;

  const idx = pLow.indexOf(fLow);
  if (idx >= 0) {
    if (mode === 'subwordSmart' && idx > 0) {
      const prev = preview[idx - 1]!;
      const cur = preview[idx]!;
      const atBoundary =
        prev === '_' || prev === '-' || prev === '.' || prev === '$' || prev === ' ' ||
        (/[a-z]/.test(prev) && /[A-Z]/.test(cur));
      if (!atBoundary) return null;
    }
    const suffix = preview.slice(idx + prefix.length);
    return suffix.length > 0 ? suffix : null;
  }
  return null;
}

export function collectWordCompletionsForModel(
  model: TextModel,
  activeLang: string,
  prefix: string,
  mode: WordBasedSuggestionsMode,
): CompletionItem[] {
  if (!prefix || !/^[A-Za-z_$]/.test(prefix)) return [];
  const words = new Set<string>();
  const maxWords = 80;
  const re = /[A-Za-z_][A-Za-z0-9_]{2,}/g;

  const scanText = (text: string) => {
    if (words.size >= maxWords) return;
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      const w = match[0];
      if (w !== prefix) words.add(w);
      if (words.size >= maxWords) break;
    }
  };

  scanText(model.getValue());

  if ((mode === 'matchingDocuments' || mode === 'allDocuments') && words.size < maxWords) {
    const models = getAllRegisteredStandaloneModels();
    for (const m of models) {
      if (words.size >= maxWords) break;
      try {
        if (m.isDisposed?.()) continue;
        if (mode === 'matchingDocuments' && m.getLanguageId() !== activeLang) continue;
        scanText(m.getValue());
      } catch {
        // ignore disposed model
      }
    }
  }

  return Array.from(words).map((w) => ({
    label: w,
    kind: CompletionItemKind.Text,
    insertText: w,
  }));
}

export function computeWordLocalityScores(model: TextModel, caretLine: number): Map<string, number> {
  const scores = new Map<string, number>();
  const totalLines = model.getLineCount();
  const startLine = Math.max(1, caretLine - 80);
  const endLine = Math.min(totalLines, caretLine + 40);
  const re = /[A-Za-z_$][A-Za-z0-9_$]*/g;
  for (let ln = startLine; ln <= endLine; ln++) {
    const dist = Math.abs(ln - caretLine);
    const bonus = Math.max(2, Math.round(140 - dist * 2));
    const content = model.getLineContent(ln);
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      const word = m[0];
      const prev = scores.get(word) ?? 0;
      if (bonus > prev) scores.set(word, bonus);
    }
  }
  return scores;
}
