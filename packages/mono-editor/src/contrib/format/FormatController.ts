import {
  ContributionIds,
  type IEditorContribution,
  type IEditorContributionHost,
} from '../../browser/editor/editorTypes';
import { languageFeatures } from '../../common/languages/languageFeaturesService';
import { MonoCommands } from '../../platform/keybindings/KeybindingService';

export class FormatController implements IEditorContribution {
  readonly id = ContributionIds.Format;
  private readonly host: IEditorContributionHost;

  constructor(host: IEditorContributionHost) {
    this.host = host;

    host.keybindings.add({
      id: MonoCommands.FormatDocument,
      primary: 'shift+alt+f',
      weight: 5,
      handler: () => { void this.runFormatDocument(); },
    });

    host.commands.registerCommand(
      MonoCommands.FormatDocument,
      () => this.runFormatDocument(),
      { title: 'Format Document', category: 'Format' },
    );
    host.commands.registerCommand(
      MonoCommands.FormatSelection,
      () => this.runFormatSelection(),
      { title: 'Format Selection', category: 'Format' },
    );
  }

  async runFormatDocument(): Promise<boolean> {
    if (this.host.isReadOnly()) return false;
    const providers = languageFeatures.getDocumentFormattingProviders(this.host.getModel().getLanguageId());
    if (!providers.length) return false;
    const modelLike = this.host.modelAsFeatureLike();
    const opts = { tabSize: this.host.getTabSize(), insertSpaces: true };
    const token = { isCancellationRequested: false };
    for (const p of providers) {
      try {
        const edits = await Promise.resolve(p.provideDocumentFormattingEdits(modelLike, opts, token));
        if (edits?.length) return this.host.applyTextEditsAtomic(edits, 'formatDocument');
      } catch (e) {
        console.warn('[mono format]', e);
      }
    }
    return false;
  }

  async runFormatSelection(): Promise<boolean> {
    if (this.host.isReadOnly()) return false;
    const sel = this.host.getSelection();
    const langId = this.host.getLanguageIdAtPosition(sel.startLineNumber, sel.startColumn);
    const providers = languageFeatures.getDocumentRangeFormattingProviders(langId);
    if (!providers.length) return false;
    const range = {
      startLineNumber: sel.startLineNumber,
      startColumn: sel.startColumn,
      endLineNumber: sel.endLineNumber,
      endColumn: sel.endColumn,
    };
    const modelLike = this.host.modelAsFeatureLike();
    const opts = { tabSize: this.host.getTabSize(), insertSpaces: true };
    const token = { isCancellationRequested: false };
    for (const p of providers) {
      try {
        const edits = await Promise.resolve(p.provideDocumentRangeFormattingEdits(modelLike, range, opts, token));
        if (edits?.length) return this.host.applyTextEditsAtomic(edits, 'formatSelection');
      } catch (e) {
        console.warn('[mono range format]', e);
      }
    }
    return false;
  }

  dispose(): void {
    /* stateless */
  }
}
