import type { WidgetBoxRect } from '../../browser/editor/editorTypes';
import type { ViewController } from '../../browser/view/ViewController';
import type {
  AcceptSuggestionOnEnterMode,
  SnippetSuggestionsMode,
  SuggestInsertMode,
  SuggestPreviewMode,
  SuggestSelectionMode,
  TabCompletionMode,
  WordBasedSuggestionsMode,
} from '../../common/config/editorOptions';
import type { SelectionState } from '../../common/core/SelectionState';
import type { SnippetSession } from '../../common/editOperations/SnippetSession';
import { completionOptions, languageFeatures } from '../../common/languages/languageFeaturesService';
import {
  CompletionItemKind,
  type CompletionContext,
  type CompletionItem,
  type CompletionProvider,
  type ModelLike,
} from '../../common/languages/providers/types';
import type { TextModel } from '../../common/model/TextModel';
import {
  applyCompletionToModel,
  getWordPrefixAtCaret,
  shouldSmartAcceptCompletionOnEnter,
} from './suggestApply';
import {
  ensureDefaultCompletionProviders,
  filterAndSortSuggestions,
  isBuiltinCompletionProvider,
  isMemberAccessContext,
  isSnippetCompletionItem,
  isSuppressedSuggestOpenBracket,
  isSuppressedSuggestOperator,
  labelOfCompletion,
  orderCompletionProviders,
  scoreCompletionMatch,
} from './suggestFilter';
import {
  SUGGEST_GHOST_OWNER,
  SuggestGhostManager,
  SuggestMruTracker,
} from './suggestGhost';
import type { QuickSuggestionsOption, SuggestControllerOptions } from './suggestTypes';
import {
  SuggestWidget,
  type SuggestAnchor,
  type SuggestWidgetOptions,
} from './SuggestWidget';
import {
  collectWordCompletionsForModel,
  computeWordLocalityScores,
} from './suggestWordCollector';

export { filterAndSortSuggestions, scoreCompletionMatch, SUGGEST_GHOST_OWNER };
export type { QuickSuggestionsOption, SuggestControllerOptions };

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
  private ghost = new SuggestGhostManager();
  private mru = new SuggestMruTracker();
  private open = false;
  private seq = 0;
  private onEdit: () => void;
  private disposed = false;
  private quickTimer: ReturnType<typeof setTimeout> | null = null;
  private quickSuggestions: QuickSuggestionsOption = true;
  private quickSuggestionsDelay = 10;
  private suggestOnTriggerCharacters = true;
  private suggestMode: 'palette' | 'ghost' = 'palette';
  private acceptSuggestionOnCommitCharacter = true;
  private acceptSuggestionOnEnter: AcceptSuggestionOnEnterMode = 'on';
  private suggestSelection: SuggestSelectionMode = 'first';
  private insertMode: SuggestInsertMode = 'insert';
  private filterGraceful = true;
  private matchOnWordStartOnly = true;
  private localityBonus = false;
  private preview = false;
  private previewMode: SuggestPreviewMode = 'subwordSmart';
  private wordBasedSuggestions: WordBasedSuggestionsMode = 'matchingDocuments';
  private snippetSuggestions: SnippetSuggestionsMode = 'inline';
  private tabCompletion: TabCompletionMode = 'off';
  private kindVisibility: Partial<Record<number, boolean>> = {};
  private getTokenTypeAt?: (lineNumber: number, column: number) => string | null;
  private getLanguageIdAtPosition?: (lineNumber: number, column: number) => string;
  private getModelLike?: (effectiveLang?: string) => ModelLike;
  private onVisibilityChange?: (visible: boolean, rect: WidgetBoxRect | null) => void;
  private onTabFallback?: () => void;
  private anchorPos: { lineNumber: number; column: number } | null = null;
  private wordStartCol = 1;
  private itemProviders = new WeakMap<CompletionItem, CompletionProvider>();
  private snippetSession: SnippetSession | null = null;
  private resolveSeq = 0;
  private currentPrefixText = '';

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
    const mergedWidgetOpts: SuggestWidgetOptions = {
      docsMode: options?.suggestDocs ?? 'off',
      showIcons: options?.showIcons ?? true,
      showStatusBar: options?.showStatusBar ?? false,
      ...widgetOptions,
    };
    this.widget = new SuggestWidget(
      host,
      {
        onAccept: (item) => {
          this.open = false;
          this.seq++;
          this.anchorPos = null;
          this.clearQuickTimer();
          this.ghost.clear();
          this.apply(item);
        },
        onDismiss: () => this.cancel(),
        onSelectionChange: (item) => {
          void this.resolveItem(item);
          this.ghost.updatePalettePreview(
            this.open,
            this.preview,
            item,
            this.anchorPos,
            this.currentPrefixText,
            this.previewMode,
          );
        },
        onBoundsChange: (rect) => {
          this.onVisibilityChange?.(rect !== null, rect);
        },
      },
      mergedWidgetOpts,
    );
    if (options) this.setOptions(options);
    ensureDefaultCompletionProviders();
  }

  setModel(model: TextModel): void { this.cancel(); this.model = model; }
  setSnippetSession(session: SnippetSession | null): void { this.snippetSession = session; }

  setOptions(opts: SuggestControllerOptions): void {
    if (opts.quickSuggestions !== undefined) this.quickSuggestions = opts.quickSuggestions;
    if (opts.quickSuggestionsDelay !== undefined) this.quickSuggestionsDelay = Math.max(0, opts.quickSuggestionsDelay);
    if (opts.suggestOnTriggerCharacters !== undefined) this.suggestOnTriggerCharacters = opts.suggestOnTriggerCharacters;
    if (opts.suggestMode !== undefined && this.suggestMode !== opts.suggestMode) {
      this.suggestMode = opts.suggestMode;
      this.cancel();
    }
    if (opts.acceptSuggestionOnCommitCharacter !== undefined) {
      this.acceptSuggestionOnCommitCharacter = opts.acceptSuggestionOnCommitCharacter;
    }
    if (opts.acceptSuggestionOnEnter !== undefined) this.acceptSuggestionOnEnter = opts.acceptSuggestionOnEnter;
    if (opts.suggestSelection !== undefined) this.suggestSelection = opts.suggestSelection;
    if (opts.insertMode !== undefined) this.insertMode = opts.insertMode;
    if (opts.filterGraceful !== undefined) this.filterGraceful = opts.filterGraceful;
    if (opts.matchOnWordStartOnly !== undefined) this.matchOnWordStartOnly = opts.matchOnWordStartOnly;
    if (opts.localityBonus !== undefined) this.localityBonus = opts.localityBonus;
    if (opts.preview !== undefined) {
      this.preview = opts.preview;
      if (!this.preview) this.ghost.clear();
    }
    if (opts.previewMode !== undefined) this.previewMode = opts.previewMode;
    if (opts.wordBasedSuggestions !== undefined) this.wordBasedSuggestions = opts.wordBasedSuggestions;
    if (opts.snippetSuggestions !== undefined) this.snippetSuggestions = opts.snippetSuggestions;
    if (opts.tabCompletion !== undefined) this.tabCompletion = opts.tabCompletion;
    if (opts.kindVisibility !== undefined) this.kindVisibility = { ...this.kindVisibility, ...opts.kindVisibility };
    const widgetPatch: SuggestWidgetOptions = {};
    if (opts.suggestDocs !== undefined) widgetPatch.docsMode = opts.suggestDocs;
    if (opts.showIcons !== undefined) widgetPatch.showIcons = opts.showIcons;
    if (opts.showStatusBar !== undefined) widgetPatch.showStatusBar = opts.showStatusBar;
    if (Object.keys(widgetPatch).length > 0) this.widget.setOptions(widgetPatch);
    if (opts.getTokenTypeAt !== undefined) this.getTokenTypeAt = opts.getTokenTypeAt;
    if (opts.getLanguageIdAtPosition !== undefined) this.getLanguageIdAtPosition = opts.getLanguageIdAtPosition;
    if (opts.getModelLike !== undefined) this.getModelLike = opts.getModelLike;
    if (opts.onVisibilityChange !== undefined) this.onVisibilityChange = opts.onVisibilityChange;
    if (opts.onTabFallback !== undefined) this.onTabFallback = opts.onTabFallback;
    this.ghost.setCallbacks({
      setGhostTexts: opts.setGhostTexts,
      clearGhostTexts: opts.clearGhostTexts,
      getGhostTexts: opts.getGhostTexts,
    });
  }

  setWidgetOptions(opts: SuggestWidgetOptions): void { this.widget.setOptions(opts); }
  isOpen(): boolean { return this.open; }
  isDocsOpen(): boolean { return this.widget.isDocsOpen(); }
  hasGhostCandidates(): boolean { return this.ghost.hasCandidates(); }
  toggleDocs(): boolean { return this.widget.toggleDocs(); }

  handleCommitCharacter(ch: string): boolean {
    if (!this.acceptSuggestionOnCommitCharacter) return false;
    if (!this.open || this.widget.isSuspended() || !ch || ch.length !== 1) return false;
    const item = this.widget.getSelectedItem();
    if (!item?.commitCharacters?.length || !item.commitCharacters.includes(ch)) return false;
    return this.widget.acceptSelected();
  }

  async trigger(triggerCharacter?: string, manual = true): Promise<void> {
    if (this.disposed) return;
    if (manual && !triggerCharacter && this.open) {
      this.widget.toggleDocs();
      return;
    }
    this.clearQuickTimer();
    const my = ++this.seq;
    const pos = { lineNumber: this.selection.active.lineNumber, column: this.selection.active.column };
    const lang = this.getLanguageIdAtPosition?.(pos.lineNumber, pos.column) ?? this.model.getLanguageId();
    const prefix = this.currentPrefix();

    const unique = await this.collectCompletions(lang, pos, prefix, triggerCharacter, my);
    if (!unique || my !== this.seq || this.disposed) return;

    const now = this.selection.active;
    if (now.lineNumber !== pos.lineNumber || now.column !== pos.column) return;

    if (!manual && !triggerCharacter && !prefix) {
      this.cancel();
      return;
    }

    const localityScores = this.localityBonus ? computeWordLocalityScores(this.model, pos.lineNumber) : undefined;
    const filtered = filterAndSortSuggestions(unique, prefix, {
      filterGraceful: this.filterGraceful,
      matchOnWordStartOnly: this.matchOnWordStartOnly,
      localityBonus: this.localityBonus,
      localityScores,
      snippetSuggestions: this.snippetSuggestions,
      kindVisibility: this.kindVisibility,
    });
    if (!filtered.length) {
      this.cancel();
      return;
    }

    this.anchorPos = pos;
    this.wordStartCol = pos.column - prefix.length;
    this.currentPrefixText = prefix;

    if (!manual && this.suggestMode === 'ghost') {
      this.open = false;
      this.widget.hide();
      this.ghost.showCandidates(filtered, prefix, pos, this.previewMode);
      return;
    }

    this.ghost.clear();
    this.open = true;
    const initialIndex = this.mru.resolveInitialIndex(filtered, prefix, this.suggestSelection);
    this.widget.show(filtered, this.anchor(), prefix, initialIndex);
    this.widget.setSuspended(!this.view.isLineInView(pos.lineNumber));
  }

  async onType(typedText: string): Promise<void> {
    if (this.disposed || !typedText || typedText.includes('\n')) { this.cancel(); return; }
    const ch = typedText[typedText.length - 1]!;
    if (isSuppressedSuggestOpenBracket(typedText) || isSuppressedSuggestOpenBracket(ch)) { this.cancel(); return; }
    if (isSuppressedSuggestOperator(ch)) { this.cancel(); return; }
    const triggers = this.collectTriggerCharacters();
    if (this.suggestOnTriggerCharacters && triggers.has(ch)) { await this.trigger(ch, false); return; }

    if (/[A-Za-z0-9_$]/.test(ch)) {
      const prefix = this.currentPrefix();
      const validWord = /^[A-Za-z_$]/.test(prefix);
      if (!this.open && !this.ghost.hasCandidates() && (!validWord || !this.shouldQuickSuggestAtCaret())) {
        return;
      }
      if (this.open || this.ghost.hasCandidates()) {
        this.anchorPos = { lineNumber: this.selection.active.lineNumber, column: this.selection.active.column };
      }
      if (this.open || this.ghost.hasCandidates() || this.quickSuggestionsDelay <= 0) {
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

    if (this.open || this.quickTimer || this.ghost.hasCandidates()) this.cancel();
  }

  async onBackspace(): Promise<void> {
    if (this.disposed) return;
    if (!this.open && !this.ghost.hasCandidates()) { this.clearQuickTimer(); return; }
    const prefix = this.currentPrefix();
    if (prefix.length > 0) {
      this.anchorPos = { lineNumber: this.selection.active.lineNumber, column: this.selection.active.column };
      await this.trigger(undefined, false);
      return;
    }
    const pos = this.selection.active;
    const line = this.model.getLineContent(pos.lineNumber);
    const prevCh = pos.column > 1 ? line[pos.column - 2] : '';
    if (prevCh && !isSuppressedSuggestOpenBracket(prevCh) && this.suggestOnTriggerCharacters && this.collectTriggerCharacters().has(prevCh)) {
      this.anchorPos = { lineNumber: pos.lineNumber, column: pos.column };
      await this.trigger(prevCh, false);
      return;
    }
    this.cancel();
  }

  handleKey(e: KeyboardEvent): boolean {
    const noMods = !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
    if (this.open && !this.widget.isSuspended()) {
      // Only intercept unmodified navigation/accept keys so Alt+Up/Down, Shift+Alt+Up/Down,
      // Ctrl+Alt+Up/Down, Ctrl+Enter, etc. pass through to editor line/cursor commands.
      if (noMods) {
        if (e.key === 'ArrowDown') { e.preventDefault(); this.widget.selectNext(); return true; }
        if (e.key === 'ArrowUp') { e.preventDefault(); this.widget.selectPrev(); return true; }
        if (e.key === 'Tab') { e.preventDefault(); return this.widget.acceptSelected(); }
        if (e.key === 'Enter') {
          if (this.acceptSuggestionOnEnter === 'off') {
            this.cancel();
            return false;
          }
          if (this.acceptSuggestionOnEnter === 'smart') {
            const sel = this.widget.getSelectedItem();
            if (!shouldSmartAcceptCompletionOnEnter(sel, this.currentPrefix())) {
              this.cancel();
              return false;
            }
          }
          e.preventDefault();
          return this.widget.acceptSelected();
        }
        if (e.key === 'Escape') { e.preventDefault(); this.cancel(); return true; }
      }
      return false;
    }
    if (this.ghost.hasCandidates() && !this.ghost.hasHigherPriorityGhost() && noMods) {
      if (e.key === 'Tab') {
        e.preventDefault();
        const item = this.ghost.takeActiveCandidate();
        if (!item) return false;
        this.anchorPos = null;
        this.seq++;
        this.apply(item);
        return true;
      }
      if (e.key === 'ArrowDown' && this.ghost.candidateCount() > 1) {
        e.preventDefault();
        return this.ghost.cycle(1, this.anchorPos);
      }
      if (e.key === 'ArrowUp' && this.ghost.candidateCount() > 1) {
        e.preventDefault();
        return this.ghost.cycle(-1, this.anchorPos);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        this.ghost.clear();
        return true;
      }
    }
    if (
      this.tabCompletion !== 'off' &&
      e.key === 'Tab' &&
      noMods &&
      this.selection.isEmpty &&
      !this.snippetSession?.isActive() &&
      !this.ghost.hasHigherPriorityGhost()
    ) {
      const prefix = this.currentPrefix();
      if (prefix.length > 0) {
        e.preventDefault();
        void this.tryTabComplete(prefix);
        return true;
      }
    }
    return false;
  }

  updatePosition(): void {
    if (!this.open || !this.anchorPos) return;
    const visible = this.view.isLineInView(this.anchorPos.lineNumber);
    this.widget.setSuspended(!visible);
    if (visible) this.widget.reposition(this.anchor());
  }

  syncCursor(): void {
    if (!this.open && !this.ghost.hasCandidates()) {
      if (this.quickTimer) this.cancel();
      return;
    }
    if (!this.anchorPos) return;
    const a = this.selection.active;
    if (a.lineNumber !== this.anchorPos.lineNumber || a.column !== this.anchorPos.column) this.cancel();
  }

  cancel(): void {
    this.clearQuickTimer();
    this.open = false;
    this.anchorPos = null;
    this.seq++;
    this.widget.hide();
    this.ghost.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
    this.widget.dispose();
  }

  private async tryTabComplete(prefix: string): Promise<void> {
    if (this.disposed) return;
    const my = ++this.seq;
    const pos = { lineNumber: this.selection.active.lineNumber, column: this.selection.active.column };
    const lang = this.getLanguageIdAtPosition?.(pos.lineNumber, pos.column) ?? this.model.getLanguageId();
    const unique = await this.collectCompletions(lang, pos, prefix, undefined, my);
    if (!unique || my !== this.seq || this.disposed) return;

    const now = this.selection.active;
    if (now.lineNumber !== pos.lineNumber || now.column !== pos.column) return;

    const candidates =
      this.tabCompletion === 'onlySnippets'
        ? unique.filter((it) => it.kind === CompletionItemKind.Snippet)
        : unique;

    const localityScores = this.localityBonus ? computeWordLocalityScores(this.model, pos.lineNumber) : undefined;
    const filtered = filterAndSortSuggestions(candidates, prefix, {
      filterGraceful: this.filterGraceful,
      matchOnWordStartOnly: this.matchOnWordStartOnly,
      localityBonus: this.localityBonus,
      localityScores,
      snippetSuggestions: this.tabCompletion === 'onlySnippets' ? 'inline' : this.snippetSuggestions,
      kindVisibility: this.tabCompletion === 'onlySnippets' ? undefined : this.kindVisibility,
    });

    if (filtered.length > 0) {
      const idx = this.mru.resolveInitialIndex(filtered, prefix, this.suggestSelection);
      const best = filtered[idx] ?? filtered[0]!;
      this.currentPrefixText = prefix;
      this.apply(best);
      return;
    }

    this.onTabFallback?.();
  }

  private async collectCompletions(
    lang: string,
    pos: { lineNumber: number; column: number },
    prefix: string,
    triggerCharacter: string | undefined,
    mySeq: number,
  ): Promise<CompletionItem[] | null> {
    const providers = orderCompletionProviders(languageFeatures.getCompletionProviders(lang));
    const context: CompletionContext = { triggerKind: triggerCharacter ? 1 : 0, triggerCharacter };
    const token = { isCancellationRequested: false };
    const modelLike = this.modelAsLike(lang);
    const memberAccess = isMemberAccessContext(this.model.getLineContent(pos.lineNumber), pos.column, triggerCharacter);

    const all: CompletionItem[] = [];
    let gotExternalItems = false;
    for (const p of providers) {
      if (gotExternalItems && isBuiltinCompletionProvider(p)) continue;
      try {
        const list = await Promise.resolve(p.provideCompletionItems(modelLike, pos, context, token));
        if (mySeq !== this.seq || this.disposed) return null;
        const items = Array.isArray(list) ? list : list?.suggestions;
        if (items?.length) {
          if (!isBuiltinCompletionProvider(p)) gotExternalItems = true;
          for (const it of items) {
            this.itemProviders.set(it, p);
            all.push(it);
          }
        }
      } catch (e) {
        console.warn('[mono suggest]', e);
      }
    }

    if (
      !memberAccess &&
      this.wordBasedSuggestions !== 'off' &&
      completionOptions.wordBasedSuggestions !== false &&
      this.kindVisibility[CompletionItemKind.Text] !== false
    ) {
      const wordItems = collectWordCompletionsForModel(this.model, lang, prefix, this.wordBasedSuggestions);
      for (const wi of wordItems) all.push(wi);
    }

    const inString =
      (this.getTokenTypeAt?.(pos.lineNumber, Math.max(1, pos.column - 1)) ?? null) === 'string';
    const seen = new Set<string>();
    return all.filter((it) => {
      if (inString && isSnippetCompletionItem(it)) return false;
      // After `.` only show properties/fields/methods — no snippets, keywords, or text
      if (memberAccess) {
        const k = it.kind ?? 0;
        // Only Property(9), Method(1), Function(2), Field(4), Variable(5), Constant(20)
        const allowed = k === 1 || k === 2 || k === 4 || k === 5 || k === 9 || k === 20;
        if (!allowed) return false;
      }
      const lab = labelOfCompletion(it);
      if (!lab || seen.has(lab)) return false;
      seen.add(lab);
      return true;
    });
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
    const prefix = this.currentPrefix();
    this.mru.record(item, prefix || this.currentPrefixText);
    applyCompletionToModel(this.model, this.selection, this.snippetSession, item, {
      prefix,
      insertMode: this.insertMode,
      getLanguageIdAtPosition: this.getLanguageIdAtPosition,
    });
    this.onEdit();
  }

  private currentPrefix(): string {
    return getWordPrefixAtCaret(this.model, this.selection, this.getLanguageIdAtPosition);
  }

  private anchor(): SuggestAnchor {
    const line = this.anchorPos?.lineNumber ?? this.selection.active.lineNumber;
    const p = this.view.screenPosOf(line, this.wordStartCol);
    return { x: p.x, y: p.y + p.h, top: p.y };
  }

  private modelAsLike(effectiveLang?: string): ModelLike {
    const lang = effectiveLang ?? this.model.getLanguageId();
    if (this.getModelLike) return this.getModelLike(lang);
    return {
      getValue: () => this.model.getValue(),
      getLineContent: (n: number) => this.model.getLineContent(n),
      getLineCount: () => this.model.getLineCount(),
      getOffsetAt: (l: number, c: number) => this.model.getOffsetAt(l, c),
      getPositionAt: (o: number) => this.model.getPositionAt(o),
      getLanguageId: () => lang,
      getVersionId: () => this.model.getVersionId(),
      getWordAtPosition: (p) => this.model.getWordAtPosition(p),
      getWordUntilPosition: (p) => this.model.getWordUntilPosition(p),
    };
  }
}
