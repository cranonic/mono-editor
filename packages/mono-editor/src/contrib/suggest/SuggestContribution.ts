import {
  ContributionIds,
  type IEditorContribution,
  type IEditorContributionHost,
} from '../../browser/editor/editorTypes';
import type { InputChangeEvent } from '../../browser/input/InputController';
import type { PointerInteractKind } from '../../browser/input/pointer/PointerController';
import type { MonoEditorOptions } from '../../common/config/editorOptions';
import type { MonoEditorTheme } from '../../common/config/themeTypes';
import { SnippetSession } from '../../common/editOperations/SnippetSession';
import type { TextModel } from '../../common/model/TextModel';
import { monoThemeService } from '../../platform/theme';
import type { ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';
import { SuggestController } from './SuggestController';
import { buildKindVisibilityMap } from './suggestFilter';

export class SuggestContribution implements IEditorContribution {
  readonly id = ContributionIds.Suggest;
  private readonly host: IEditorContributionHost;
  private readonly suggest: SuggestController;
  private readonly snippetSession: SnippetSession;
  private suggestFontSizeOverride = 0;
  private suggestLineHeightOverride = 0;
  private insertSpaces = true;

  constructor(host: IEditorContributionHost) {
    this.host = host;
    this.snippetSession = new SnippetSession(() => {
      host.view.ensureCaretVisible();
      host.syncTextarea();
      host.view.paint();
      host.emitCursorEvents('snippet');
    });

    const opts = host.initialOptions;
    this.suggestFontSizeOverride = Math.max(0, opts.suggestFontSize ?? 0);
    this.suggestLineHeightOverride = Math.max(0, opts.suggestLineHeight ?? 0);
    this.insertSpaces = opts.insertSpaces !== false;

    const effectiveFontSize =
      this.suggestFontSizeOverride > 0 ? this.suggestFontSizeOverride : host.getFontSize();
    const effectiveRowHeight =
      this.suggestLineHeightOverride > 0 ? this.suggestLineHeightOverride : undefined;

    this.suggest = new SuggestController(
      host.root,
      host.getModel(),
      host.selection,
      host.view,
      () => {
        host.view.ensureCaretVisible();
        host.syncTextarea();
        host.input.focus();
        host.view.paint();
        host.emitContent();
        host.emitCursorEvents('suggest');
      },
      {
        fontFamily: host.getFontFamily(),
        fontSize: effectiveFontSize,
        rowHeight: effectiveRowHeight,
        showIcons: opts.suggest?.showIcons ?? true,
        showStatusBar: opts.suggest?.showStatusBar ?? false,
      },
      {
        quickSuggestions: opts.quickSuggestions,
        quickSuggestionsDelay: opts.quickSuggestionsDelay,
        suggestOnTriggerCharacters: opts.suggestOnTriggerCharacters,
        suggestMode: opts.suggest?.mode ?? 'palette',
        suggestDocs: opts.suggest?.docs ?? 'off',
        acceptSuggestionOnCommitCharacter: opts.acceptSuggestionOnCommitCharacter ?? true,
        acceptSuggestionOnEnter: opts.acceptSuggestionOnEnter ?? 'on',
        suggestSelection: opts.suggestSelection ?? 'first',
        insertMode: opts.suggest?.insertMode ?? 'insert',
        filterGraceful: opts.suggest?.filterGraceful ?? true,
        matchOnWordStartOnly:
          opts.suggestMatchOnWordStartOnly ?? opts.suggest?.matchOnWordStartOnly ?? true,
        localityBonus: opts.suggest?.localityBonus ?? false,
        preview: opts.suggest?.preview ?? false,
        previewMode: opts.suggest?.previewMode ?? 'subwordSmart',
        showIcons: opts.suggest?.showIcons ?? true,
        showStatusBar: opts.suggest?.showStatusBar ?? false,
        wordBasedSuggestions: opts.wordBasedSuggestions ?? 'matchingDocuments',
        snippetSuggestions: opts.snippetSuggestions ?? 'inline',
        tabCompletion: opts.tabCompletion ?? 'off',
        kindVisibility: buildKindVisibilityMap(opts.suggest),
        getTokenTypeAt: (ln, col) => host.getTokenTypeAt(ln, col),
        getLanguageIdAtPosition: (ln, col) => host.getLanguageIdAtPosition(ln, col),
        getModelLike:
          typeof host.modelAsFeatureLike === 'function'
            ? (effectiveLang) => {
                const base = host.modelAsFeatureLike();
                return effectiveLang && effectiveLang !== base.getLanguageId()
                  ? { ...base, getLanguageId: () => effectiveLang }
                  : base;
              }
            : undefined,
        onVisibilityChange: (visible, rect) => {
          host.setSuggestWidgetRect(rect);
          host.setContext('suggestWidgetVisible', visible);
        },
        setGhostTexts: (items) => host.setGhostTexts(items),
        clearGhostTexts: (owner) => host.clearGhostTexts(owner),
        getGhostTexts: (owner) => host.getGhostTexts(owner),
        onTabFallback: () => this.insertStandardTab(),
      },
    );
    this.suggest.setSnippetSession(this.snippetSession);

    host.input.setPreKeyHandler((e: KeyboardEvent) => {
      if (this.suggest.isOpen() && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        this.suggest.handleCommitCharacter(e.key);
        return false;
      }
      if (this.snippetSession.handleKey(e)) return true;
      return false;
    });

    host.keybindings.add({
      id: 'editor.action.triggerSuggest',
      primary: 'ctrl+space',
      handler: () => { void this.suggest.trigger(); },
    });
    host.commands.registerCommand(
      'editor.action.triggerSuggest',
      () => { void this.suggest.trigger(); },
      { title: 'Trigger Suggest', category: 'Edit' },
    );
  }

  onKeyDown(e: KeyboardEvent): boolean { return this.suggest.handleKey(e); }

  onInputChange(ev: InputChangeEvent): void {
    if (ev.kind === 'composition') {
      this.suggest.cancel();
      return;
    }
    this.snippetSession.syncAfterEdit();
    if (ev.kind === 'type' && ev.text) {
      void this.suggest.onType(ev.text);
    } else if (ev.kind === 'backspace') {
      void this.suggest.onBackspace();
    } else {
      this.suggest.cancel();
      if (ev.kind === 'move') this.snippetSession.cancel();
    }
  }

  onCursorChange(_source: string, keepSuggest?: boolean): void {
    if (!keepSuggest) this.suggest.syncCursor();
  }

  onScroll(): void {
    if (this.suggest.isOpen()) this.suggest.updatePosition();
  }

  onPointerInteract(kind: PointerInteractKind): void {
    if (kind === 'tap' || kind === 'handle' || kind === 'handleTap' || kind === 'select') {
      this.suggest.cancel();
      this.snippetSession.cancel();
    }
  }

  onOutsidePointerDown(): void { this.suggest.cancel(); }
  onColorSwatchClick(): void { this.suggest.cancel(); }

  onModelChange(model: TextModel): void {
    this.suggest.cancel();
    this.snippetSession.cancel();
    this.suggest.setModel(model);
  }

  onThemeChange(_wt: ResolvedWidgetTheme, editorTheme: MonoEditorTheme): void {
    this.applySuggestStyle(editorTheme);
  }

  onOptionsChange(patch: Partial<MonoEditorOptions>): void {
    if (patch.insertSpaces !== undefined) {
      this.insertSpaces = patch.insertSpaces;
    }
    let styleDirty = patch.fontFamily != null || patch.fontSize != null;
    if (patch.suggestFontSize !== undefined) {
      this.suggestFontSizeOverride = Math.max(0, patch.suggestFontSize);
      styleDirty = true;
    }
    if (patch.suggestLineHeight !== undefined) {
      this.suggestLineHeightOverride = Math.max(0, patch.suggestLineHeight);
      styleDirty = true;
    }
    if (styleDirty) {
      this.applySuggestStyle(this.host.getTheme());
    }

    const matchWordStart =
      patch.suggestMatchOnWordStartOnly !== undefined
        ? patch.suggestMatchOnWordStartOnly
        : patch.suggest?.matchOnWordStartOnly;

    this.suggest.setOptions({
      quickSuggestions: patch.quickSuggestions,
      quickSuggestionsDelay: patch.quickSuggestionsDelay,
      suggestOnTriggerCharacters: patch.suggestOnTriggerCharacters,
      suggestMode: patch.suggest?.mode,
      suggestDocs: patch.suggest?.docs,
      acceptSuggestionOnCommitCharacter: patch.acceptSuggestionOnCommitCharacter,
      acceptSuggestionOnEnter: patch.acceptSuggestionOnEnter,
      suggestSelection: patch.suggestSelection,
      insertMode: patch.suggest?.insertMode,
      filterGraceful: patch.suggest?.filterGraceful,
      matchOnWordStartOnly: matchWordStart,
      localityBonus: patch.suggest?.localityBonus,
      preview: patch.suggest?.preview,
      previewMode: patch.suggest?.previewMode,
      showIcons: patch.suggest?.showIcons,
      showStatusBar: patch.suggest?.showStatusBar,
      wordBasedSuggestions: patch.wordBasedSuggestions,
      snippetSuggestions: patch.snippetSuggestions,
      tabCompletion: patch.tabCompletion,
      kindVisibility: patch.suggest ? buildKindVisibilityMap(patch.suggest) : undefined,
    });
  }

  dispose(): void {
    this.host.input.setPreKeyHandler(null);
    this.snippetSession.cancel();
    this.suggest.dispose();
  }

  private insertStandardTab(): void {
    if (this.host.isReadOnly()) return;
    const pos = this.host.selection.active;
    const text = this.insertSpaces ? ' '.repeat(Math.max(1, this.host.getTabSize())) : '\t';
    this.host.executeEdits('tab', [
      {
        range: {
          startLineNumber: pos.lineNumber,
          startColumn: pos.column,
          endLineNumber: pos.lineNumber,
          endColumn: pos.column,
        },
        text,
      },
    ]);
  }

  private applySuggestStyle(editorTheme: MonoEditorTheme): void {
    const bg = editorTheme.background || '#1e1e1e';
    const m = /^#?([0-9a-f]{6})$/i.exec(bg.trim());
    let dark = true;
    if (m) {
      const n = parseInt(m[1]!, 16);
      const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
      dark = lum < 0.5;
    }
    let colors: Record<string, string> = {};
    try { colors = monoThemeService.resolve().colors; } catch { /* */ }
    this.suggest.setWidgetOptions({
      fontFamily: this.host.getFontFamily(),
      fontSize:
        this.suggestFontSizeOverride > 0 ? this.suggestFontSizeOverride : this.host.getFontSize(),
      rowHeight:
        this.suggestLineHeightOverride > 0 ? this.suggestLineHeightOverride : undefined,
      themeType: dark ? 'dark' : 'light',
      themeColors: colors,
    });
  }
}
