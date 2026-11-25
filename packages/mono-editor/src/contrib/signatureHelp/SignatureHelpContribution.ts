import {
  ContributionIds,
  type IEditorContribution,
  type IEditorContributionHost,
} from '../../browser/editor/editorTypes';
import type { InputChangeEvent } from '../../browser/input/InputController';
import type { PointerInteractKind } from '../../browser/input/pointer/PointerController';
import type { MonoEditorOptions } from '../../common/config/editorOptions';
import type { TextModel } from '../../common/model/TextModel';
import { MonoCommands } from '../../platform/keybindings/KeybindingService';
import type { ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';
import { SignatureHelpController } from './SignatureHelpController';

export class SignatureHelpContribution implements IEditorContribution {
  readonly id = ContributionIds.SignatureHelp;
  private readonly host: IEditorContributionHost;
  private readonly controller: SignatureHelpController;

  constructor(host: IEditorContributionHost) {
    this.host = host;
    const sigOpts = host.initialOptions.signatureHelp;
    this.controller = new SignatureHelpController(
      host.root,
      host.getModel(),
      host.selection,
      host.view,
      {
        enabled: sigOpts?.enabled ?? true,
        trigger: sigOpts?.trigger ?? 'auto',
        fontSize: host.getFontSize(),
        fontFamily: host.getFontFamily(),
        getLanguageIdAtPosition: (ln, col) => host.getLanguageIdAtPosition(ln, col),
        getAvoidRect: () => host.getSuggestWidgetRect(),
        isSuggestVisible: () => host.isSuggestVisible(),
      },
    );

    host.keybindings.add({
      id: MonoCommands.TriggerParameterHints,
      primary: 'ctrl+shift+space',
      weight: 5,
      handler: () => { void this.controller.trigger(undefined, true); },
    });

    host.commands.registerCommand(
      MonoCommands.TriggerParameterHints,
      () => this.controller.trigger(undefined, true),
      { title: 'Trigger Parameter Hints', category: 'Edit' },
    );
  }

  onKeyDown(e: KeyboardEvent): boolean { return this.controller.handleKey(e); }

  shouldAllowWheelTarget(target: Node): boolean {
    return this.controller.isOpen() && this.controller.containsNode(target);
  }

  onInputChange(ev: InputChangeEvent): void {
    if (ev.kind === 'composition') return;
    if (ev.kind === 'type' && ev.text) {
      void this.controller.onType(ev.text);
    } else if (ev.kind === 'backspace') {
      void this.controller.onBackspace();
    } else if (ev.kind === 'enter') {
      void this.controller.onEnter();
    } else {
      this.controller.syncCursor();
    }
  }

  onCursorChange(source: string): void {
    if (source === 'suggest') {
      void this.controller.onCompletionAccepted();
    } else if (source === 'snippet') {
      if (this.controller.isOpen()) this.controller.syncCursor();
      else void this.controller.onCompletionAccepted();
    } else if (source === 'mouse' || source === 'api' || source === 'keyboard') {
      this.controller.syncCursor();
    }
  }

  onScroll(): void {
    if (this.controller.isOpen()) this.controller.updatePosition();
  }

  onLayout(): void {
    if (this.controller.isOpen()) this.controller.updatePosition();
  }

  onOutsidePointerDown(): void {
    this.controller.hide();
  }

  onPointerInteract(kind: PointerInteractKind): void {
    if (kind === 'handle' || kind === 'handleTap' || kind === 'select') {
      this.controller.hide();
    } else if (kind === 'tap') {
      this.controller.syncCursor();
    }
  }

  onOptionsChange(patch: Partial<MonoEditorOptions>): void {
    if (patch.fontSize != null || patch.fontFamily != null) {
      this.controller.setOptions({
        fontSize: this.host.getFontSize(),
        fontFamily: this.host.getFontFamily(),
      });
    }
    if (!patch.signatureHelp) return;
    this.controller.setOptions({
      enabled: patch.signatureHelp.enabled,
      trigger: patch.signatureHelp.trigger,
    });
  }

  onModelChange(model: TextModel): void {
    this.controller.hide();
    this.controller.setModel(model);
  }

  onThemeChange(wt: ResolvedWidgetTheme): void { this.controller.applyTheme(wt); }

  dispose(): void { this.controller.dispose(); }
}
