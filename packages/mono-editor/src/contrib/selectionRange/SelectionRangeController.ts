import {
  ContributionIds,
  type IEditorContribution,
  type IEditorContributionHost,
} from '../../browser/editor/editorTypes';
import type { IRange } from '../../common/core/types';
import { languageFeatures } from '../../common/languages/languageFeaturesService';
import type { SelectionRange } from '../../common/languages/providers/types';
import type { TextModel } from '../../common/model/TextModel';
import { MonoCommands } from '../../platform/keybindings/KeybindingService';

function sameRange(a: IRange, b: IRange): boolean {
  return (
    a.startLineNumber === b.startLineNumber &&
    a.startColumn === b.startColumn &&
    a.endLineNumber === b.endLineNumber &&
    a.endColumn === b.endColumn
  );
}

function strictlyContains(outer: IRange, inner: IRange): boolean {
  if (sameRange(outer, inner)) return false;
  const startOk =
    outer.startLineNumber < inner.startLineNumber ||
    (outer.startLineNumber === inner.startLineNumber && outer.startColumn <= inner.startColumn);
  const endOk =
    outer.endLineNumber > inner.endLineNumber ||
    (outer.endLineNumber === inner.endLineNumber && outer.endColumn >= inner.endColumn);
  return startOk && endOk;
}

/** Built-in syntax-free smart expand fallback (word -> enclosing quotes/parens -> line -> document). */
function computeFallbackExpansion(model: TextModel, cur: IRange): IRange | null {
  const lineText = model.getLineContent(cur.startLineNumber);
  if (cur.startLineNumber === cur.endLineNumber) {
    // 1. Expand to word
    const isWord = (ch: string) => /[\p{L}\p{N}_$]/u.test(ch);
    const idx = Math.max(0, Math.min(lineText.length - 1, cur.startColumn - 1));
    if (lineText.length && isWord(lineText[idx]!)) {
      let s = idx;
      let e = idx;
      while (s > 0 && isWord(lineText[s - 1]!)) s--;
      while (e < lineText.length - 1 && isWord(lineText[e + 1]!)) e++;
      const wordRange: IRange = {
        startLineNumber: cur.startLineNumber,
        startColumn: s + 1,
        endLineNumber: cur.startLineNumber,
        endColumn: e + 2,
      };
      if (strictlyContains(wordRange, cur)) return wordRange;
    }

    // 2. Expand to enclosing same-line bracket/quote pair
    const pairs: [string, string][] = [['(', ')'], ['[', ']'], ['{', '}'], ['"', '"'], ["'", "'"], ['`', '`']];
    for (const [open, close] of pairs) {
      let left = -1;
      for (let i = cur.startColumn - 2; i >= 0; i--) {
        if (lineText[i] === open) { left = i; break; }
      }
      if (left >= 0) {
        let right = -1;
        for (let j = cur.endColumn - 1; j < lineText.length; j++) {
          if (lineText[j] === close) { right = j; break; }
        }
        if (right > left) {
          const inner: IRange = {
            startLineNumber: cur.startLineNumber,
            startColumn: left + 2,
            endLineNumber: cur.startLineNumber,
            endColumn: right + 1,
          };
          if (strictlyContains(inner, cur)) return inner;
          const outer: IRange = {
            startLineNumber: cur.startLineNumber,
            startColumn: left + 1,
            endLineNumber: cur.startLineNumber,
            endColumn: right + 2,
          };
          if (strictlyContains(outer, cur)) return outer;
        }
      }
    }

    // 3. Expand to full line
    const lineRange: IRange = {
      startLineNumber: cur.startLineNumber,
      startColumn: 1,
      endLineNumber: cur.startLineNumber,
      endColumn: lineText.length + 1,
    };
    if (strictlyContains(lineRange, cur)) return lineRange;
  }

  // 4. Expand to full document
  const last = model.getLineCount();
  const docRange: IRange = {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: last,
    endColumn: model.getLineContent(last).length + 1,
  };
  return strictlyContains(docRange, cur) ? docRange : null;
}

/**
 * Smart Expand / Shrink Selection controller (`registerSelectionRangeProvider` + built-in fallback).
 * Huge ergonomic win on mobile touch keyboards!
 */
export class SelectionRangeController implements IEditorContribution {
  readonly id = ContributionIds.SelectionRange;
  private readonly host: IEditorContributionHost;
  private stack: IRange[] = [];
  private applying = false;

  constructor(host: IEditorContributionHost) {
    this.host = host;

    host.keybindings.addMany([
      {
        id: MonoCommands.SmartSelectExpand,
        primary: 'shift+alt+right',
        weight: 6,
        handler: () => { void this.expandSelection(); },
      },
      {
        id: MonoCommands.SmartSelectShrink,
        primary: 'shift+alt+left',
        weight: 6,
        handler: () => { this.shrinkSelection(); },
      },
    ]);

    host.commands.registerCommand(
      MonoCommands.SmartSelectExpand,
      () => this.expandSelection(),
      { title: 'Expand Selection', category: 'Selection' },
    );
    host.commands.registerCommand(
      MonoCommands.SmartSelectShrink,
      () => this.shrinkSelection(),
      { title: 'Shrink Selection', category: 'Selection' },
    );
  }

  onCursorChange(_source: string): void {
    if (!this.applying) this.stack = [];
  }

  onModelChange(_model: TextModel): void {
    this.stack = [];
  }

  async expandSelection(): Promise<boolean> {
    const sel = this.host.getSelection();
    const cur: IRange = {
      startLineNumber: sel.startLineNumber,
      startColumn: sel.startColumn,
      endLineNumber: sel.endLineNumber,
      endColumn: sel.endColumn,
    };

    const pos = this.host.getPosition();
    const langId = this.host.getLanguageIdAtPosition(pos.lineNumber, pos.column);
    const providers = languageFeatures.getSelectionRangeProviders(langId);
    let nextRange: IRange | null = null;

    if (providers.length > 0) {
      const modelLike = this.host.modelAsFeatureLike();
      const token = { isCancellationRequested: false };
      for (const p of providers) {
        try {
          const res = await Promise.resolve(p.provideSelectionRanges(modelLike, [pos], token));
          const first = res?.[0];
          if (Array.isArray(first)) {
            for (const item of first) {
              if (strictlyContains(item.range, cur)) {
                nextRange = item.range;
                break;
              }
            }
          } else {
            let node: SelectionRange | undefined = first;
            while (node) {
              if (strictlyContains(node.range, cur)) {
                nextRange = node.range;
                break;
              }
              node = node.parent;
            }
          }
          if (nextRange) break;
        } catch (e) {
          console.warn('[mono selectionRange]', e);
        }
      }
    }

    if (!nextRange) {
      nextRange = computeFallbackExpansion(this.host.getModel(), cur);
    }
    if (!nextRange) return false;

    this.stack.push(cur);
    this.applyRange(nextRange);
    return true;
  }

  shrinkSelection(): boolean {
    const prev = this.stack.pop();
    if (!prev) return false;
    this.applyRange(prev);
    return true;
  }

  dispose(): void {
    this.stack = [];
  }

  private applyRange(r: IRange): void {
    this.applying = true;
    try {
      this.host.selection.anchor = { lineNumber: r.startLineNumber, column: r.startColumn };
      this.host.selection.active = { lineNumber: r.endLineNumber, column: r.endColumn };
      this.host.view.ensureCaretVisible();
      this.host.syncTextarea();
      this.host.view.paint();
      this.host.emitCursorEvents('smartSelect');
    } finally {
      this.applying = false;
    }
  }
}
