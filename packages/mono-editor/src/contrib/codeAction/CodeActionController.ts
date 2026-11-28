import {
  ContributionIds,
  type IEditorContribution,
  type IEditorContributionHost,
} from '../../browser/editor/editorTypes';
import type { InputChangeEvent } from '../../browser/input/InputController';
import type { PointerInteractKind } from '../../browser/input/pointer/PointerController';
import type { LightbulbEnabledMode, MonoEditorOptions } from '../../common/config/editorOptions';
import { languageFeatures } from '../../common/languages/languageFeaturesService';
import type { CodeAction } from '../../common/languages/providers/types';
import type { TextModel } from '../../common/model/TextModel';
import { MonoCommands } from '../../platform/keybindings/KeybindingService';
import type { ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';
import { CodeActionLightbulbWidget } from './CodeActionLightbulbWidget';

export class CodeActionController implements IEditorContribution {
  readonly id = ContributionIds.CodeAction;
  private readonly host: IEditorContributionHost;
  private readonly widget: CodeActionLightbulbWidget;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lightbulbMode: LightbulbEnabledMode;
  private featuresSub: { dispose(): void } | null = null;
  private lastActions: CodeAction[] = [];
  private actionProviders = new WeakMap<CodeAction, { resolveCodeAction?: (a: CodeAction, token: { isCancellationRequested: boolean }) => CodeAction | Promise<CodeAction | null | undefined> | null | undefined }>();

  constructor(host: IEditorContributionHost) {
    this.host = host;
    this.lightbulbMode = host.initialOptions.lightbulb?.enabled ?? 'on';
    this.widget = new CodeActionLightbulbWidget(host.root);
    this.syncWidgetFontOptions();
    this.featuresSub = languageFeatures.onDidChange(() => this.scheduleLightbulb());

    host.keybindings.add({
      id: MonoCommands.QuickFix,
      primary: 'ctrl+.',
      weight: 5,
      handler: () => { void this.runQuickFix(); },
    });

    host.commands.registerCommand(
      MonoCommands.QuickFix,
      () => this.runQuickFix(),
      { title: 'Quick Fix...', category: 'Refactor' },
    );
  }

  onKeyDown(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' && this.widget.isMenuOpen()) {
      this.widget.hideMenu();
      return true;
    }
    return false;
  }

  onInputChange(ev: InputChangeEvent): void {
    if (ev.kind !== 'composition') this.scheduleLightbulb();
  }

  onScroll(): void { this.widget.hideAll(); }

  onPointerInteract(kind: PointerInteractKind): void {
    if (kind === 'tap' || kind === 'handle' || kind === 'handleTap' || kind === 'select') {
      this.widget.hideMenu();
    }
    if (kind === 'tap') this.scheduleLightbulb();
  }

  onMarkersChange(): void { this.scheduleLightbulb(); }

  onModelChange(_model: TextModel): void {
    this.widget.hideAll();
    this.scheduleLightbulb();
  }

  onThemeChange(wt: ResolvedWidgetTheme): void { this.widget.applyTheme(wt); }

  onOptionsChange(patch: Partial<MonoEditorOptions>): void {
    const typographyChanged =
      patch.fontSize !== undefined ||
      patch.lineHeight !== undefined ||
      patch.fontFamily !== undefined ||
      patch.lineNumbers !== undefined ||
      patch.glyphMargin !== undefined ||
      patch.folding !== undefined;
    if (typographyChanged) {
      this.syncWidgetFontOptions();
      if (this.lightbulbMode !== 'off' && this.widget.isLightbulbVisible() && this.lastActions.length) {
        this.presentLightbulb(this.lastActions);
      }
      if (this.widget.isMenuOpen()) {
        const scr = this.host.view.caretScreenPos();
        this.widget.openMenu(this.lastActions, { x: scr.x, y: scr.y + scr.h }, (act) => this.executeCodeAction(act));
      }
    }
    if (patch.lightbulb?.enabled !== undefined) {
      this.lightbulbMode = patch.lightbulb.enabled;
      if (this.lightbulbMode === 'off') {
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        this.lastActions = [];
        this.widget.hideLightbulb();
      } else {
        this.scheduleLightbulb();
      }
    }
  }

  async runQuickFix(): Promise<boolean> {
    this.syncWidgetFontOptions();
    const actions = await this.collectCodeActionsAtSelection();
    this.lastActions = actions;
    const scr = this.host.view.caretScreenPos();
    this.widget.openMenu(actions, { x: scr.x, y: scr.y + scr.h }, (act) => this.executeCodeAction(act));
    return actions.length > 0;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.featuresSub?.dispose();
    this.featuresSub = null;
    this.widget.dispose();
  }

  private async collectCodeActionsAtSelection(): Promise<CodeAction[]> {
    const sel = this.host.getSelection();
    const langId = this.host.getLanguageIdAtPosition(sel.startLineNumber, sel.startColumn);
    const providers = languageFeatures.getCodeActionProviders(langId);
    if (!providers.length) return [];
    const range = {
      startLineNumber: sel.startLineNumber,
      startColumn: sel.startColumn,
      endLineNumber: sel.endLineNumber,
      endColumn: sel.endColumn,
    };
    const overlappingMarkers = this.host.getMarkers().filter(
      (m) => m.endLineNumber >= range.startLineNumber && m.startLineNumber <= range.endLineNumber,
    );
    const modelLike = this.host.modelAsFeatureLike();
    const token = { isCancellationRequested: false };
    const actions: CodeAction[] = [];
    for (const p of providers) {
      try {
        const list = await Promise.resolve(
          p.provideCodeActions(modelLike, range, { markers: overlappingMarkers }, token),
        );
        if (!list) continue;
        const found = Array.isArray(list) ? list : (list.actions ?? []);
        for (const a of found) {
          this.actionProviders.set(a, p as any);
          actions.push(a);
        }
      } catch (e) {
        console.warn('[mono codeAction]', e);
      }
    }
    return actions;
  }

  private executeCodeAction(action: CodeAction): void {
    void (async () => {
      let resolved = action;
      const prov = this.actionProviders.get(action);
      if (!resolved.edit && prov && typeof prov.resolveCodeAction === 'function') {
        try {
          const r = await Promise.resolve(prov.resolveCodeAction(resolved, { isCancellationRequested: false }));
          if (r) resolved = r;
        } catch (e) {
          console.warn('[mono codeAction resolve]', e);
        }
      }
      if (resolved.edit) this.host.applyWorkspaceEdit(resolved.edit, 'codeAction');
      if (resolved.command) {
        void this.host.executeCommand(resolved.command.id, ...(resolved.command.arguments ?? []));
      }
      this.widget.hideAll();
      this.host.focus();
      this.scheduleLightbulb();
    })();
  }

  private scheduleLightbulb(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.lightbulbMode === 'off') {
      this.widget.hideLightbulb();
      return;
    }
    this.timer = setTimeout(() => {
      if (this.host.isDisposed() || this.lightbulbMode === 'off') return;
      if (this.lightbulbMode === 'onCode') {
        const sel = this.host.getSelection();
        const isEmptySel =
          sel.startLineNumber === sel.endLineNumber && sel.startColumn === sel.endColumn;
        const lineContent = this.host.getModel().getLineContent(sel.startLineNumber);
        const hasMarkersOnLine = this.host.getMarkers().some(
          (m) => m.endLineNumber >= sel.startLineNumber && m.startLineNumber <= sel.endLineNumber,
        );
        if (isEmptySel && lineContent.trim().length === 0 && !hasMarkersOnLine) {
          this.widget.hideLightbulb();
          return;
        }
      }
      void (async () => {
        const actions = await this.collectCodeActionsAtSelection();
        if (this.host.isDisposed() || this.lightbulbMode === 'off') return;
        if (!actions.length) {
          this.lastActions = [];
          this.widget.hideLightbulb();
          return;
        }
        this.presentLightbulb(actions);
      })();
    }, 220);
  }

  private syncWidgetFontOptions(): void {
    this.widget.setFontOptions({
      fontSize: this.host.getFontSize(),
      lineHeight: this.host.getLineHeight(),
    });
  }

  private presentLightbulb(actions: CodeAction[]): void {
    this.syncWidgetFontOptions();
    this.lastActions = actions;
    const pos = this.host.selection.active;
    const scr = this.host.view.screenPosOf(pos.lineNumber, 1);
    const bulbSize = this.widget.getBulbSize();
    const gutterLeft = Math.max(2, this.host.view.contentLeft - Math.round(bulbSize * 0.9));
    const bulbTop = scr.y + Math.max(0, Math.round((scr.h - bulbSize) / 2));
    this.widget.showLightbulb(actions, { x: gutterLeft, y: bulbTop }, (act) => this.executeCodeAction(act));
  }
}
