import {
  ContributionIds,
  type IEditorContributionHost,
  type IInlineSuggestContribution,
} from '../../browser/editor/editorTypes';
import type { InputChangeEvent } from '../../browser/input/InputController';
import type { MonoEditorOptions } from '../../common/config/editorOptions';
import { languageFeatures } from '../../common/languages/languageFeaturesService';
import {
  InlineCompletionTriggerKind,
  type GhostTextItem,
  type InlineCompletionItem,
} from '../../common/languages/providers/types';
import type { TextModel } from '../../common/model/TextModel';
import { GhostTextModel } from '../../common/virtualText';
import { MonoCommands } from '../../platform/keybindings/KeybindingService';
import type { ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';
import { GhostTextBarWidget } from './GhostTextBarWidget';

/**
 * Universal Multiline Wrap-Aware Ghost Text & AI Inline Completions Controller.
 *
 * Powers BOTH:
 *  1. Standard Monaco/Copilot `registerInlineCompletionsProvider` (debounced automatic + manual trigger)
 *  2. Direct imperative plugin API (`setGhostTexts`, `clearGhostTexts`, `getGhostTexts`)
 *     for Copilot / Codex / multi-anchor arbitrary-position AI edit previews.
 */
export class InlineSuggestController implements IInlineSuggestContribution {
  readonly id = ContributionIds.InlineSuggest;
  private readonly host: IEditorContributionHost;
  private readonly ghost = new GhostTextModel();
  private readonly bar: GhostTextBarWidget;
  private enabled: boolean;
  private debounceMs: number;
  private showToolbar: 'always' | 'touch' | 'onHover' | 'never';
  private italic: boolean;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private lastLineCount: number;
  private applyingAccept = false;
  private lastPointerWasTouch = false;

  constructor(host: IEditorContributionHost) {
    this.host = host;
    const opt = host.initialOptions.inlineSuggest;
    this.enabled = opt?.enabled !== false;
    this.debounceMs = opt?.debounceMs ?? 180;
    this.showToolbar = opt?.showToolbar ?? 'touch';
    this.italic = opt?.italic === true;
    this.lastLineCount = host.getModel().getLineCount();

    this.bar = new GhostTextBarWidget(host.root, {
      onAccept: () => { this.accept(); this.host.focus(); },
      onAcceptWord: () => { this.acceptWord(); this.host.focus(); },
      onAcceptLine: () => { this.acceptLine(); this.host.focus(); },
      onPrev: () => { this.prev(); this.host.focus(); },
      onNext: () => { this.next(); this.host.focus(); },
      onDismiss: () => { this.dismiss(); this.host.focus(); },
    });

    host.view.setGhostTextProviders({
      getLineGhostInline: (ln) => this.ghost.getInlineRunsForLine(ln),
      getGhostVersion: () => this.ghost.getVersion(),
      hasGhostRows: () => this.ghost.hasAny(),
      getLineGhostRows: (ln, wrapWidthPx, effectiveWrap) =>
        this.ghost.getVirtualRowsForLine({
          lineNumber: ln,
          effectiveWrap,
          wrapWidthPx,
          charWidth: host.getMetrics().charWidth,
          measureText: (t) => host.view.measureTextWidth(t),
        }),
      getGhostTextItalic: () => this.italic,
    });

    host.root.addEventListener('pointerdown', this.onRootPointerDown, { passive: true });
    this.registerCommandsAndKeybindings();
  }

  private registerCommandsAndKeybindings(): void {
    const h = this.host;
    h.keybindings.addMany([
      { id: MonoCommands.InlineSuggestNext, primary: 'alt+]', weight: 8, handler: () => this.next() },
      { id: MonoCommands.InlineSuggestPrev, primary: 'alt+[', weight: 8, handler: () => this.prev() },
      {
        id: MonoCommands.InlineSuggestTrigger,
        primary: 'alt+\\',
        weight: 8,
        handler: () => { void this.trigger(InlineCompletionTriggerKind.Invoke); },
      },
    ]);

    h.commands.registerCommand(MonoCommands.InlineSuggestAccept, () => this.accept(), {
      title: 'Accept Inline Suggestion',
      category: 'Edit',
    });
    h.commands.registerCommand(MonoCommands.InlineSuggestAcceptNextWord, () => this.acceptWord(), {
      title: 'Accept Next Word of Inline Suggestion',
      category: 'Edit',
    });
    h.commands.registerCommand(MonoCommands.InlineSuggestAcceptNextLine, () => this.acceptLine(), {
      title: 'Accept Next Line of Inline Suggestion',
      category: 'Edit',
    });
    h.commands.registerCommand(MonoCommands.InlineSuggestNext, () => this.next(), {
      title: 'Next Inline Suggestion',
      category: 'Edit',
    });
    h.commands.registerCommand(MonoCommands.InlineSuggestPrev, () => this.prev(), {
      title: 'Previous Inline Suggestion',
      category: 'Edit',
    });
    h.commands.registerCommand(MonoCommands.InlineSuggestHide, () => this.dismiss(), {
      title: 'Dismiss Inline Suggestion',
      category: 'Edit',
    });
    h.commands.registerCommand(
      MonoCommands.InlineSuggestTrigger,
      () => this.trigger(InlineCompletionTriggerKind.Invoke),
      { title: 'Trigger Inline Suggestion', category: 'Edit' },
    );
  }

  // ---- Direct Plugin API (Copilot / Codex / multi-anchor arbitrary position) ----

  setGhostTexts(items: readonly GhostTextItem[]): void {
    // Group by explicit item.owner (or 'default') so multiple plugins coexist independently
    const grouped = new Map<string, GhostTextItem[]>();
    for (const it of items) {
      const owner = it.owner ?? 'default';
      const arr = grouped.get(owner) ?? [];
      arr.push(it);
      grouped.set(owner, arr);
    }
    if (grouped.size === 0) {
      this.ghost.clearGhostTexts('default');
    } else {
      for (const [owner, list] of grouped.entries()) {
        this.ghost.setGhostTexts(list, owner);
      }
    }
    this.refreshView();
  }

  clearGhostTexts(owner?: string): void {
    this.ghost.clearGhostTexts(owner);
    this.refreshView();
  }

  getGhostTexts(owner?: string): readonly GhostTextItem[] {
    const all = this.ghost.getAllActive();
    return owner ? all.filter((it) => it.owner === owner) : all;
  }

  accept(): boolean {
    return this.applyAccept('full');
  }

  acceptWord(): boolean {
    return this.applyAccept('word');
  }

  acceptLine(): boolean {
    return this.applyAccept('line');
  }

  next(): void {
    if (this.ghost.nextCandidate()) this.refreshView();
  }

  prev(): void {
    if (this.ghost.prevCandidate()) this.refreshView();
  }

  dismiss(): void {
    ++this.seq;
    this.cancelDebounce();
    if (!this.ghost.hasAny()) return;
    this.ghost.clearGhostTexts();
    this.refreshView();
  }

  async trigger(kind: InlineCompletionTriggerKind = InlineCompletionTriggerKind.Automatic): Promise<boolean> {
    if (!this.enabled || this.host.isReadOnly() || this.host.isDisposed()) return false;
    const pos = this.host.getPosition();
    const langId = this.host.getLanguageIdAtPosition(pos.lineNumber, pos.column);
    const providers = languageFeatures.getInlineCompletionsProviders(langId);
    if (!providers.length) return false;

    const my = ++this.seq;
    const modelLike = this.host.modelAsFeatureLike();
    const token = { isCancellationRequested: false };
    const collected: InlineCompletionItem[] = [];

    for (const p of providers) {
      try {
        const res = await Promise.resolve(
          p.provideInlineCompletions(modelLike, pos, { triggerKind: kind }, token),
        );
        if (my !== this.seq || this.host.isDisposed()) return false;
        const items = Array.isArray(res) ? res : (res?.items ?? []);
        if (items.length) collected.push(...items);
      } catch (e) {
        console.warn('[mono inline completions]', e);
      }
    }

    if (!collected.length) {
      this.ghost.clearGhostTexts('__inlineCompletions__');
      this.refreshView();
      return false;
    }

    this.ghost.setProviderCandidates(collected, pos);
    this.refreshView();
    return true;
  }

  // ---- Lifecycle & Input Hooks ----

  onKeyDown(e: KeyboardEvent): boolean {
    if (!this.ghost.hasAny() || this.host.isReadOnly()) return false;
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      return this.accept();
    }
    if (e.key === 'ArrowRight' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      return this.acceptWord();
    }
    if (e.key === 'Escape' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      this.dismiss();
      return true;
    }
    return false;
  }

  onInputChange(ev: InputChangeEvent): void {
    if (this.applyingAccept || ev.kind === 'composition') return;
    if (!this.enabled || this.host.isReadOnly()) return;
    if (ev.kind === 'type' || ev.kind === 'enter' || ev.kind === 'backspace') {
      this.scheduleProviderFetch();
    }
  }

  onModelContentChange(_versionId: number): void {
    const model = this.host.getModel();
    const nextLineCount = model.getLineCount();
    const delta = nextLineCount - this.lastLineCount;
    this.lastLineCount = nextLineCount;
    if (this.applyingAccept) return;
    if (this.ghost.hasAny()) {
      this.ghost.onDocumentEdit(this.host.getPosition().lineNumber, delta);
      this.syncBar();
      this.host.view.projection.invalidate();
    }
  }

  onModelChange(model: TextModel): void {
    this.lastLineCount = model.getLineCount();
    this.dismiss();
  }

  onScroll(): void {
    this.syncBar();
  }

  onLayout(): void {
    this.syncBar();
  }

  onThemeChange(wt: ResolvedWidgetTheme): void {
    this.bar.applyTheme(wt);
  }

  onOptionsChange(patch: Partial<MonoEditorOptions>): void {
    if (!patch.inlineSuggest) return;
    if (patch.inlineSuggest.enabled !== undefined) {
      this.enabled = patch.inlineSuggest.enabled;
      if (!this.enabled) this.dismiss();
    }
    if (patch.inlineSuggest.debounceMs !== undefined) {
      this.debounceMs = Math.max(0, patch.inlineSuggest.debounceMs);
    }
    if (patch.inlineSuggest.showToolbar !== undefined) {
      this.showToolbar = patch.inlineSuggest.showToolbar;
      this.syncBar();
    }
    if (patch.inlineSuggest.italic !== undefined) {
      this.italic = patch.inlineSuggest.italic;
      this.host.view.schedulePaint();
    }
  }

  dispose(): void {
    this.cancelDebounce();
    this.host.root.removeEventListener('pointerdown', this.onRootPointerDown);
    this.host.view.setGhostTextProviders({});
    this.bar.dispose();
  }

  private onRootPointerDown = (e: PointerEvent): void => {
    this.lastPointerWasTouch = e.pointerType === 'touch' || e.pointerType === 'pen';
  };

  private applyAccept(mode: 'full' | 'word' | 'line'): boolean {
    if (this.host.isReadOnly()) return false;
    const caret = this.host.getPosition();
    const res = this.ghost.consumeAccept(mode, caret);
    if (!res) return false;

    this.applyingAccept = true;
    try {
      this.host.executeEdits('inlineSuggest', [{ range: res.range, text: res.text }]);
      const parts = res.text.replace(/\r\n/g, '\n').split('\n');
      const endLine = res.range.startLineNumber + parts.length - 1;
      const endCol =
        parts.length === 1
          ? res.range.startColumn + parts[0]!.length
          : parts[parts.length - 1]!.length + 1;
      this.host.setPosition(endLine, endCol);
      if (!res.remainingText && res.item.command) {
        void this.host.executeCommand(res.item.command.id, ...(res.item.command.arguments ?? []));
      }
    } finally {
      this.applyingAccept = false;
    }

    this.refreshView();
    return true;
  }

  private scheduleProviderFetch(): void {
    this.cancelDebounce();
    const pos = this.host.getPosition();
    const langId = this.host.getLanguageIdAtPosition(pos.lineNumber, pos.column);
    if (!languageFeatures.getInlineCompletionsProviders(langId).length) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.trigger(InlineCompletionTriggerKind.Automatic);
    }, this.debounceMs);
  }

  private cancelDebounce(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private refreshView(): void {
    const active = this.ghost.getAllActive();
    const hasNonSuggest = active.some((g) => g.owner !== 'suggest-ghost');
    if (hasNonSuggest && active.some((g) => g.owner === 'suggest-ghost')) {
      this.ghost.clearGhostTexts('suggest-ghost');
    }
    this.host.commands.setContext('inlineSuggestionVisible', this.ghost.hasAny());
    this.host.view.projection.invalidate();
    this.host.view.paint();
    this.syncBar();
  }

  private syncBar(): void {
    if (this.showToolbar === 'never' || !this.ghost.hasAny()) {
      this.bar.hide();
      return;
    }
    const isCoarse =
      this.lastPointerWasTouch ||
      (typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)')?.matches));
    if ((this.showToolbar === 'touch' || this.showToolbar === 'onHover') && !isCoarse) {
      this.bar.hide();
      return;
    }
    const target = this.ghost.getPrimaryAcceptTarget(this.host.getPosition());
    if (!target || !this.host.view.isLineInView(target.lineNumber)) {
      this.bar.hide();
      return;
    }
    const scr = this.host.view.screenPosOf(target.lineNumber, target.column);
    this.bar.show({
      candidateCount: Math.max(1, this.ghost.getCandidateCount()),
      activeIndex: this.ghost.getActiveCandidateIndex(),
      hasMultiline: target.extraLines.length > 0,
      anchor: { x: scr.x, y: scr.y + scr.h, top: scr.y },
    });
  }
}
