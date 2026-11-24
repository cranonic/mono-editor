import type { ViewController } from '../../browser/view/ViewController';
import type { SelectionState } from '../../common/core/SelectionState';
import { hasSnippetSyntax, type SnippetSession } from '../../common/editOperations/SnippetSession';
import { languageFeatures } from '../../common/languages/languageFeaturesService';
import {
  CompletionItemInsertTextRule,
  type CompletionContext,
  type CompletionItem,
  type CompletionProvider,
} from '../../common/languages/providers/types';
import type { TextModel } from '../../common/model/TextModel';
import {
  ensureDefaultCompletionProviders,
  filterAndSortSuggestions,
  labelOfCompletion,
  scoreCompletionMatch,
} from './suggestFilter';
import { SuggestWidget, type SuggestAnchor, type SuggestWidgetOptions } from './SuggestWidget';

export { filterAndSortSuggestions, scoreCompletionMatch };

export type QuickSuggestionsOption =
  | boolean
  | {
      other?: boolean | 'on' | 'off';
      comments?: boolean | 'on' | 'off';
      strings?: boolean | 'on' | 'off';
    };

export interface SuggestControllerOptions {
  quickSuggestions?: QuickSuggestionsOption;
  quickSuggestionsDelay?: number;
  suggestOnTriggerCharacters?: boolean;
  getTokenTypeAt?: (lineNumber: number, column: number) => string | null;
  getLanguageIdAtPosition?: (lineNumber: number, column: number) => string;
}

function isEnabledFlag(v: boolean | 'on' | 'off' | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  if (typeof v === 'boolean') return v;
  return v !== 'off';
}

export class SuggestController {
  private model: TextModel;
  private selection: SelectionState;
  private view: ViewController;
  private widget: SuggestWidget;
  private open = false;
  private seq = 0;
  private onEdit: () => void;
  private disposed = false;
  private quickTimer: ReturnType<typeof setTimeout> | null = null;
  private quickSuggestions: QuickSuggestionsOption = true;
  private quickSuggestionsDelay = 10;
  private suggestOnTriggerCharacters = true;
  private getTokenTypeAt?: (lineNumber: number, column: number) => string | null;
  private getLanguageIdAtPosition?: (lineNumber: number, column: number) => string;
  private anchorPos: { lineNumber: number; column: number } | null = null;
  private wordStartCol = 1;
  private itemProviders = new WeakMap<CompletionItem, CompletionProvider>();
  private snippetSession: SnippetSession | null = null;
  private resolveSeq = 0;

  constructor(
    host: HTMLElement,
    model: TextModel,
    selection: SelectionState,
    view: ViewController,
    onEdit: () => void,
    widgetOptions?: SuggestWidgetOptions,
    options?: SuggestControllerOptions,
  ) {
    this.model = model;
    this.selection = selection;
    this.view = view;
    this.onEdit = onEdit;
    if (options) this.setOptions(options);
    this.widget = new SuggestWidget(
      host,
      {
        onAccept: (item) => {
          this.open = false;
          this.seq++;
          this.anchorPos = null;
          this.clearQuickTimer();
          this.apply(item);
        },
        onDismiss: () => this.cancel(),
        onSelectionChange: (item) => {
          void this.resolveItem(item);
        },
      },
      widgetOptions,
    );
    ensureDefaultCompletionProviders();
  }

  setModel(model: TextModel): void { this.cancel(); this.model = model; }
  setSnippetSession(session: SnippetSession | null): void { this.snippetSession = session; }

  setOptions(opts: SuggestControllerOptions): void {
    if (opts.quickSuggestions !== undefined) this.quickSuggestions = opts.quickSuggestions;
    if (opts.quickSuggestionsDelay !== undefined) this.quickSuggestionsDelay = Math.max(0, opts.quickSuggestionsDelay);
    if (opts.suggestOnTriggerCharacters !== undefined) this.suggestOnTriggerCharacters = opts.suggestOnTriggerCharacters;
    if (opts.getTokenTypeAt !== undefined) this.getTokenTypeAt = opts.getTokenTypeAt;
    if (opts.getLanguageIdAtPosition !== undefined) this.getLanguageIdAtPosition = opts.getLanguageIdAtPosition;
  }

  setWidgetOptions(opts: SuggestWidgetOptions): void { this.widget.setOptions(opts); }
  isOpen(): boolean { return this.open; }

  handleCommitCharacter(ch: string): boolean {
    if (!this.open || this.widget.isSuspended() || !ch || ch.length !== 1) return false;
    const item = this.widget.getSelectedItem();
    if (!item?.commitCharacters?.length || !item.commitCharacters.includes(ch)) return false;
    return this.widget.acceptSelected();
  }

  async trigger(triggerCharacter?: string, manual = true): Promise<void> {
    if (this.disposed) return;
    this.clearQuickTimer();
    const my = ++this.seq;
    const pos = { lineNumber: this.selection.active.lineNumber, column: this.selection.active.column };
    const lang = this.getLanguageIdAtPosition?.(pos.lineNumber, pos.column) ?? this.model.getLanguageId();
    const providers = languageFeatures.getCompletionProviders(lang);
    const context: CompletionContext = { triggerKind: triggerCharacter ? 1 : 0, triggerCharacter };
    const token = { isCancellationRequested: false };
    const modelLike = this.modelAsLike(lang);

    const all: CompletionItem[] = [];
    for (const p of providers) {
      try {
        const list = await Promise.resolve(p.provideCompletionItems(modelLike, pos, context, token));
        if (my !== this.seq || this.disposed) return;
        const items = Array.isArray(list) ? list : list?.suggestions;
        if (items?.length) {
          for (const it of items) {
            this.itemProviders.set(it, p);
            all.push(it);
          }
        }
      } catch (e) {
        console.warn('[mono suggest]', e);
      }
    }

    const seen = new Set<string>();
    const unique = all.filter((it) => {
      const lab = labelOfCompletion(it);
      if (!lab || seen.has(lab)) return false;
      seen.add(lab);
      return true;
    });

    const now = this.selection.active;
    if (now.lineNumber !== pos.lineNumber || now.column !== pos.column) return;

    const prefix = this.currentPrefix();
    if (!manual && !triggerCharacter && !prefix) {
      this.cancel();
      return;
    }

    const filtered = filterAndSortSuggestions(unique, prefix);
    if (!filtered.length) {
      this.cancel();
      return;
    }

    this.open = true;
    this.anchorPos = pos;
    this.wordStartCol = pos.column - prefix.length;
    this.widget.show(filtered, this.anchor(), prefix);
    this.widget.setSuspended(!this.view.isLineInView(pos.lineNumber));
  }

  async onType(typedText: string): Promise<void> {
    if (this.disposed || !typedText || typedText.includes('\n')) {
      this.cancel();
      return;
    }
    const ch = typedText[typedText.length - 1]!;
    const triggers = this.collectTriggerCharacters();

    if (this.suggestOnTriggerCharacters && triggers.has(ch)) {
      await this.trigger(ch, false);
      return;
    }

    if (/[A-Za-z0-9_$]/.test(ch)) {
      const prefix = this.currentPrefix();
      const validWord = /^[A-Za-z_$]/.test(prefix);
      if (!this.open && (!validWord || !this.shouldQuickSuggestAtCaret())) return;
      if (this.open) {
        this.anchorPos = { lineNumber: this.selection.active.lineNumber, column: this.selection.active.column };
      }
      if (this.open || this.quickSuggestionsDelay <= 0) {
        await this.trigger(undefined, false);
      } else {
        this.clearQuickTimer();
        const delay = this.quickSuggestionsDelay;
        this.quickTimer = setTimeout(() => {
          this.quickTimer = null;
          if (!this.disposed) void this.trigger(undefined, false);
        }, delay);
      }
      return;
    }

    if (this.open || this.quickTimer) this.cancel();
  }

  async onBackspace(): Promise<void> {
    if (this.disposed) return;
    if (!this.open) { this.clearQuickTimer(); return; }
    const prefix = this.currentPrefix();
    if (prefix.length > 0) {
      this.anchorPos = { lineNumber: this.selection.active.lineNumber, column: this.selection.active.column };
      await this.trigger(undefined, false);
      return;
    }
    const pos = this.selection.active;
    const line = this.model.getLineContent(pos.lineNumber);
    const prevCh = pos.column > 1 ? line[pos.column - 2] : '';
    if (prevCh && this.suggestOnTriggerCharacters && this.collectTriggerCharacters().has(prevCh)) {
      this.anchorPos = { lineNumber: pos.lineNumber, column: pos.column };
      await this.trigger(prevCh, false);
      return;
    }
    this.cancel();
  }

  handleKey(e: KeyboardEvent): boolean {
    if (!this.open || this.widget.isSuspended()) return false;
    if (e.key === 'ArrowDown') { e.preventDefault(); this.widget.selectNext(); return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); this.widget.selectPrev(); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); return this.widget.acceptSelected(); }
    if (e.key === 'Escape') { e.preventDefault(); this.cancel(); return true; }
    return false;
  }

  updatePosition(): void {
    if (!this.open || !this.anchorPos) return;
    const visible = this.view.isLineInView(this.anchorPos.lineNumber);
    this.widget.setSuspended(!visible);
    if (visible) this.widget.reposition(this.anchor());
  }

  syncCursor(): void {
    if (!this.open || !this.anchorPos) return;
    const a = this.selection.active;
    if (a.lineNumber !== this.anchorPos.lineNumber || a.column !== this.anchorPos.column) this.cancel();
  }

  cancel(): void {
    this.clearQuickTimer();
    this.open = false;
    this.anchorPos = null;
    this.seq++;
    this.widget.hide();
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
    this.widget.dispose();
  }

  private clearQuickTimer(): void {
    if (this.quickTimer) { clearTimeout(this.quickTimer); this.quickTimer = null; }
  }

  private collectTriggerCharacters(): Set<string> {
    const triggers = new Set<string>();
    const pos = this.selection.active;
    const lang = this.getLanguageIdAtPosition?.(pos.lineNumber, pos.column) ?? this.model.getLanguageId();
    for (const p of languageFeatures.getCompletionProviders(lang)) {
      for (const t of p.triggerCharacters ?? []) triggers.add(t);
    }
    return triggers;
  }

  private shouldQuickSuggestAtCaret(): boolean {
    const qs = this.quickSuggestions;
    if (qs === false) return false;
    const pos = this.selection.active;
    const tokType = this.getTokenTypeAt?.(pos.lineNumber, Math.max(1, pos.column - 1)) ?? null;
    if (qs === true) return tokType !== 'comment' && tokType !== 'string';
    if (tokType === 'comment') return isEnabledFlag(qs.comments, false);
    if (tokType === 'string') return isEnabledFlag(qs.strings, false);
    return isEnabledFlag(qs.other, true);
  }

  private async resolveItem(item: CompletionItem | null): Promise<void> {
    if (!item || !this.open) return;
    const provider = this.itemProviders.get(item);
    if (!provider?.resolveCompletionItem) return;
    const my = ++this.resolveSeq;
    try {
      const resolved = await Promise.resolve(provider.resolveCompletionItem(item, { isCancellationRequested: false }));
      if (my !== this.resolveSeq || !this.open || this.disposed) return;
      if (resolved) {
        Object.assign(item, resolved);
        if (this.widget.getSelectedItem() === item) this.widget.showDocumentation(item);
      }
    } catch (e) {
      console.warn('[mono suggest resolve]', e);
    }
  }

  private apply(item: CompletionItem): void {
    const rawText = item.textEdit?.text ?? item.insertText ?? labelOfCompletion(item);
    const isSnippet =
      Boolean(item.insertTextRules && (item.insertTextRules & CompletionItemInsertTextRule.InsertAsSnippet)) ||
      hasSnippetSyntax(rawText);

    let start: number;
    let end: number;
    const editRange = item.textEdit?.range ?? item.range;
    if (editRange) {
      start = this.model.getOffsetAt(editRange.startLineNumber, editRange.startColumn);
      end = this.model.getOffsetAt(editRange.endLineNumber, editRange.endColumn);
    } else {
      const a = this.selection.active;
      end = this.model.getOffsetAt(a.lineNumber, a.column);
      start = end - this.currentPrefix().length;
    }

    const startPos = this.model.getPositionAt(start);
    const lineIndent = this.model.getLineContent(startPos.lineNumber).match(/^[ \t]*/)?.[0] ?? '';
    const additional = item.additionalTextEdits?.length ? [...item.additionalTextEdits] : [];

    let usedSnippet = false;
    this.model.transact(() => {
      if (additional.length > 0) {
        const normalized = additional
          .map((ed) => ({
            s: this.model.getOffsetAt(ed.range.startLineNumber, ed.range.startColumn),
            e: this.model.getOffsetAt(ed.range.endLineNumber, ed.range.endColumn),
            text: ed.text,
          }))
          .sort((a, b) => b.s - a.s);
        let deltaBefore = 0;
        for (const ed of normalized) {
          if (ed.e <= start) {
            const normText = this.model.normalizeEol(ed.text);
            this.model.replaceRange(ed.s, ed.e, normText);
            deltaBefore += normText.length - (ed.e - ed.s);
          } else if (ed.s >= end) {
            this.model.replaceRange(ed.s, ed.e, ed.text);
          }
        }
        start += deltaBefore;
        end += deltaBefore;
      }

      if (isSnippet && this.snippetSession) {
        this.snippetSession.insert(this.model, this.selection, start, end, rawText, lineIndent);
        usedSnippet = true;
      } else {
        const plain = rawText.replace(/\$\d+/g, '');
        const norm = this.model.normalizeEol(plain);
        this.model.replaceRange(start, end, norm);
        const pos = this.model.getPositionAt(start + norm.length);
        this.selection.setCaret(pos.lineNumber, pos.column);
      }
    });

    if (!usedSnippet && this.snippetSession?.isActive()) this.snippetSession.cancel();
    this.onEdit();
  }

  private currentPrefix(): string {
    const pos = this.selection.active;
    const line = this.model.getLineContent(pos.lineNumber);
    const before = line.slice(0, Math.max(0, pos.column - 1));
    const lang = this.getLanguageIdAtPosition?.(pos.lineNumber, pos.column) ?? this.model.getLanguageId();
    if (lang === 'css' || lang === 'html') {
      return before.match(/[A-Za-z0-9_$-]*$/)?.[0] ?? '';
    }
    return before.match(/[A-Za-z0-9_$]*$/)?.[0] ?? '';
  }

  private anchor(): SuggestAnchor {
    const line = this.anchorPos?.lineNumber ?? this.selection.active.lineNumber;
    const p = this.view.screenPosOf(line, this.wordStartCol);
    return { x: p.x, y: p.y + p.h, top: p.y };
  }

  private modelAsLike(effectiveLang?: string) {
    return {
      getValue: () => this.model.getValue(),
      getLineContent: (n: number) => this.model.getLineContent(n),
      getLineCount: () => this.model.getLineCount(),
      getOffsetAt: (l: number, c: number) => this.model.getOffsetAt(l, c),
      getPositionAt: (o: number) => this.model.getPositionAt(o),
      getLanguageId: () => effectiveLang ?? this.model.getLanguageId(),
    };
  }
}
