import {
  ContributionIds,
  type IEditorContributionHost,
  type IFoldingContribution,
} from '../../browser/editor/editorTypes';
import type { MonoEditorOptions } from '../../common/config/editorOptions';
import { languageFeatures } from '../../common/languages/languageFeaturesService';
import type { TextModel } from '../../common/model/TextModel';
import { MonoCommands } from '../../platform/keybindings/KeybindingService';

export class FoldingController implements IFoldingContribution {
  readonly id = ContributionIds.Folding;
  private readonly host: IEditorContributionHost;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubFeatures: { dispose(): void } | null = null;

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

    this.unsubFeatures = languageFeatures.onDidChange(() => {
      this.scheduleProviderSync(60);
    });
    this.scheduleProviderSync(80);
  }

  onModelChange(_model: TextModel): void {
    this.scheduleProviderSync(80);
  }

  onModelContentChange(_versionId: number): void {
    this.scheduleProviderSync(120);
  }

  onOptionsChange(patch: Partial<MonoEditorOptions>): void {
    if (patch.folding !== undefined || patch.foldingStrategy !== undefined || patch.language !== undefined) {
      this.scheduleProviderSync(60);
    }
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
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.unsubFeatures?.dispose();
    this.unsubFeatures = null;
  }

  private scheduleProviderSync(delayMs: number): void {
    if (this.host.isDisposed() || !this.host.isFoldingEnabled()) return;
    if (this.timer) clearTimeout(this.timer);
    const lang = this.host.getModel().getLanguageId();
    if (!languageFeatures.getFoldingProviders(lang).length) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.host.isDisposed() || !this.host.isFoldingEnabled()) return;
      void this.host.folding.update(this.host.modelAsFeatureLike()).then((changed) => {
        if (changed && !this.host.isDisposed()) {
          this.host.view.projection.invalidate();
          this.host.view.schedulePaint();
        }
      });
    }, delayMs);
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
