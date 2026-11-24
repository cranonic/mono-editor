import {
  ContributionIds,
  type IEditorContribution,
  type IEditorContributionHost,
} from '../../browser/editor/editorTypes';
import type { InputChangeEvent } from '../../browser/input/InputController';
import type { PointerInteractKind } from '../../browser/input/pointer/PointerController';
import type { TextModel } from '../../common/model/TextModel';
import { MonoCommands } from '../../platform/keybindings/KeybindingService';
import type { ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';
import { SignatureHelpController } from './SignatureHelpController';

export class SignatureHelpContribution implements IEditorContribution {
  readonly id = ContributionIds.SignatureHelp;
  private readonly controller: SignatureHelpController;

  constructor(host: IEditorContributionHost) {
    this.controller = new SignatureHelpController(
      host.root,
      host.getModel(),
      host.selection,
      host.view,
      (ln, col) => host.getLanguageIdAtPosition(ln, col),
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

  onInputChange(ev: InputChangeEvent): void {
    if (ev.kind === 'composition') return;
    if (ev.kind === 'type' && ev.text) {
      void this.controller.onType(ev.text);
    } else if (ev.kind === 'backspace') {
      void this.controller.onBackspace();
    } else {
      this.controller.syncCursor();
    }
  }

  onScroll(): void {
    if (this.controller.isOpen()) this.controller.updatePosition();
  }

  onPointerInteract(kind: PointerInteractKind): void {
    if (kind === 'tap' || kind === 'handle' || kind === 'handleTap' || kind === 'select') {
      this.controller.hide();
    }
  }

  onModelChange(model: TextModel): void {
    this.controller.hide();
    this.controller.setModel(model);
  }

  onThemeChange(wt: ResolvedWidgetTheme): void { this.controller.applyTheme(wt); }

  dispose(): void { this.controller.dispose(); }
}
