import {
  ContributionIds,
  type IEditorContribution,
  type IEditorContributionHost,
} from '../../browser/editor/editorTypes';
import type { InputChangeEvent } from '../../browser/input/InputController';
import { languageFeatures } from '../../common/languages/languageFeaturesService';
import { MonoCommands } from '../../platform/keybindings/KeybindingService';

export class FormatController implements IEditorContribution {
  readonly id = ContributionIds.Format;
  private readonly host: IEditorContributionHost;
  private onTypeInFlight = false;

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

  onInputChange(ev: InputChangeEvent): void {
    if (this.host.isReadOnly() || this.onTypeInFlight) return;
    let triggerCh = '';
    if (ev.kind === 'enter') triggerCh = '\n';
    else if (ev.kind === 'type' && ev.text && ev.text.length === 1) triggerCh = ev.text;
    if (!triggerCh) return;
    void this.runOnTypeFormatting(triggerCh);
  }

  async runOnTypeFormatting(ch: string): Promise<boolean> {
    if (this.host.isReadOnly() || this.host.isDisposed()) return false;
    const pos = this.host.getPosition();
    const langId = this.host.getLanguageIdAtPosition(pos.lineNumber, pos.column);
    const providers = languageFeatures.getOnTypeFormattingProviders(langId);
    if (!providers.length) return false;

    const matching = providers.filter((p) => p.autoFormatTriggerCharacters.includes(ch));
    if (!matching.length) return false;

    this.onTypeInFlight = true;
    // Edits are computed for the document as it is now; if the user types on before they arrive
    // (or the model is swapped) they would land at the wrong offsets, so they are dropped.
    const model = this.host.getModel();
    const versionAtRequest = model.getVersionId();
    const stale = (): boolean =>
      this.host.isDisposed() || this.host.getModel() !== model || model.getVersionId() !== versionAtRequest;
    try {
      const modelLike = this.host.modelAsFeatureLike();
      const opts = { tabSize: this.host.getTabSize(), insertSpaces: true };
      const token = { isCancellationRequested: false };
      for (const p of matching) {
        try {
          const edits = await Promise.resolve(
            p.provideOnTypeFormattingEdits(modelLike, pos, ch, opts, token),
          );
          if (stale()) return false;
          if (edits?.length) {
            return this.host.applyTextEditsAtomic(edits, 'formatOnType');
          }
        } catch (e) {
          console.warn('[mono on-type format]', e);
        }
      }
      return false;
    } finally {
      this.onTypeInFlight = false;
    }
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
