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

  constructor(host: IEditorContributionHost) {
    this.host = host;
    this.lightbulbMode = host.initialOptions.lightbulb?.enabled ?? 'on';
    this.widget = new CodeActionLightbulbWidget(host.root);

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
    if (patch.lightbulb?.enabled !== undefined) {
      this.lightbulbMode = patch.lightbulb.enabled;
      if (this.lightbulbMode === 'off') {
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        this.widget.hideLightbulb();
      } else {
        this.scheduleLightbulb();
      }
    }
  }

  async runQuickFix(): Promise<boolean> {
    const actions = await this.collectCodeActionsAtSelection();
    const scr = this.host.view.caretScreenPos();
    this.widget.openMenu(actions, { x: scr.x, y: scr.y + scr.h }, (act) => this.executeCodeAction(act));
    return actions.length > 0;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
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
        if (Array.isArray(list)) actions.push(...list);
        else if (list.actions?.length) actions.push(...list.actions);
      } catch (e) {
        console.warn('[mono codeAction]', e);
      }
    }
    return actions;
  }

  private executeCodeAction(action: CodeAction): void {
    if (action.edit) this.host.applyWorkspaceEdit(action.edit, 'codeAction');
    if (action.command) {
      void this.host.executeCommand(action.command.id, ...(action.command.arguments ?? []));
    }
    this.widget.hideAll();
    this.host.focus();
    this.scheduleLightbulb();
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
          this.widget.hideLightbulb();
          return;
        }
        const pos = this.host.selection.active;
        const scr = this.host.view.screenPosOf(pos.lineNumber, 1);
        const gutterLeft = Math.max(2, this.host.view.contentLeft - 18);
        this.widget.showLightbulb(actions, { x: gutterLeft, y: scr.y + 1 }, (act) => this.executeCodeAction(act));
      })();
    }, 220);
  }
}
