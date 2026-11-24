import {
  ContributionIds,
  type IEditorContributionHost,
  type IFindContribution,
} from '../../browser/editor/editorTypes';
import type { TextModel } from '../../common/model/TextModel';
import type { ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';
import { FindController } from './FindController';
import type { FindMatch } from './types';

export class FindContribution implements IFindContribution {
  readonly id = ContributionIds.Find;
  private readonly controller: FindController;
  private readonly host: IEditorContributionHost;

  constructor(host: IEditorContributionHost) {
    this.host = host;
    this.controller = new FindController(
      host.root,
      host.getModel(),
      host.selection,
      host.view,
      () => {
        host.view.ensureCaretVisible();
        host.syncTextarea();
        host.view.paint();
        host.emitContent();
      },
      () => host.focus(),
      (heightPx) => {
        host.view.setTopInset(heightPx > 0 ? heightPx + 10 : 0);
        host.notifyLayoutChange();
      },
    );

    host.view.setFindDecorationsProvider(() => ({
      matches: this.controller.getMatches(),
      currentIndex: this.controller.getCurrentIndex(),
    }));

    host.keybindings.addMany([
      { id: 'actions.find', primary: 'ctrl+f', weight: 5, handler: () => this.controller.startFind() },
      { id: 'editor.action.startFindReplaceAction', primary: 'ctrl+h', weight: 5, handler: () => this.controller.startFindReplace() },
      { id: 'editor.action.nextMatchFindAction', primary: 'f3', weight: 5, handler: () => this.controller.findNext() },
      { id: 'editor.action.previousMatchFindAction', primary: 'shift+f3', weight: 5, handler: () => this.controller.findPrevious() },
    ]);

    host.commands.registerCommand('actions.find', () => this.controller.startFind(), { title: 'Find', category: 'Find' });
    host.commands.registerCommand('editor.action.startFindReplaceAction', () => this.controller.startFindReplace(), { title: 'Replace', category: 'Find' });
    host.commands.registerCommand('editor.action.nextMatchFindAction', () => this.controller.findNext(), { title: 'Find Next', category: 'Find' });
    host.commands.registerCommand('editor.action.previousMatchFindAction', () => this.controller.findPrevious(), { title: 'Find Previous', category: 'Find' });
  }

  startFind(): void { this.controller.startFind(); }
  startFindReplace(): void { this.controller.startFindReplace(); }
  getMatches(): FindMatch[] { return this.controller.getMatches(); }
  getCurrentIndex(): number { return this.controller.getCurrentIndex(); }

  onModelChange(model: TextModel): void { this.controller.setModel(model); }
  onThemeChange(wt: ResolvedWidgetTheme): void { this.controller.applyTheme(wt); }

  dispose(): void {
    this.host.view.setFindDecorationsProvider(null);
    this.controller.dispose();
  }
}
