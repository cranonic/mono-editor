import {
  ContributionIds,
  type IEditorContributionHost,
  type IFoldingContribution,
} from '../../browser/editor/editorTypes';
import { MonoCommands } from '../../platform/keybindings/KeybindingService';

export class FoldingController implements IFoldingContribution {
  readonly id = ContributionIds.Folding;
  private readonly host: IEditorContributionHost;

  constructor(host: IEditorContributionHost) {
    this.host = host;

    host.keybindings.addMany([
      {
        id: MonoCommands.Fold,
        primary: 'ctrl+shift+[',
        weight: 5,
        handler: () => this.foldCurrent(),
      },
      {
        id: MonoCommands.Unfold,
        primary: 'ctrl+shift+]',
        weight: 5,
        handler: () => this.unfoldCurrent(),
      },
    ]);

    host.commands.registerCommand(MonoCommands.Fold, () => this.foldCurrent(), { title: 'Fold', category: 'Fold' });
    host.commands.registerCommand(MonoCommands.Unfold, () => this.unfoldCurrent(), { title: 'Unfold', category: 'Fold' });
    host.commands.registerCommand(
      MonoCommands.ToggleFold,
      () => this.toggleFoldAtLine(host.selection.active.lineNumber),
      { title: 'Toggle Fold', category: 'Fold' },
    );
    host.commands.registerCommand(MonoCommands.FoldAll, () => this.foldAll(), { title: 'Fold All', category: 'Fold' });
    host.commands.registerCommand(MonoCommands.UnfoldAll, () => this.unfoldAll(), { title: 'Unfold All', category: 'Fold' });
  }

  toggleFoldAtLine(lineNumber: number): void {
    if (!this.host.isFoldingEnabled()) return;
    if (this.host.folding.toggle(lineNumber)) {
      if (this.host.folding.isLineHidden(this.host.selection.active.lineNumber)) {
        const col = this.host.getModel().getLineContent(lineNumber).length + 1;
        this.host.selection.setCaret(lineNumber, col);
      }
      this.commitFoldView();
    }
  }

  foldAll(): void {
    if (!this.host.isFoldingEnabled()) return;
    if (this.host.folding.foldAll()) {
      const cur = this.host.selection.active.lineNumber;
      if (this.host.folding.isLineHidden(cur)) {
        for (let ln = cur - 1; ln >= 1; ln--) {
          if (!this.host.folding.isLineHidden(ln)) {
            this.host.selection.setCaret(ln, 1);
            break;
          }
        }
      }
      this.commitFoldView();
    }
  }

  unfoldAll(): void {
    if (this.host.folding.unfoldAll()) {
      this.commitFoldView();
    }
  }

  dispose(): void {
    /* stateless controller */
  }

  private foldCurrent(): void {
    if (!this.host.isFoldingEnabled()) return;
    const cur = this.host.selection.active.lineNumber;
    if (this.host.folding.foldAtLine(cur)) {
      if (this.host.folding.isLineHidden(cur)) {
        const model = this.host.getModel();
        for (let ln = cur - 1; ln >= 1; ln--) {
          if (!this.host.folding.isLineHidden(ln)) {
            this.host.selection.setCaret(ln, model.getLineContent(ln).length + 1);
            break;
          }
        }
      }
      this.commitFoldView();
    }
  }

  private unfoldCurrent(): void {
    if (this.host.folding.unfoldContaining(this.host.selection.active.lineNumber)) {
      this.commitFoldView();
    }
  }

  private commitFoldView(): void {
    this.host.view.projection.invalidate();
    this.host.view.clampScrollPublic();
    this.host.view.paint();
    this.host.syncTextarea();
    this.host.emitCursorEvents('fold');
  }
}
