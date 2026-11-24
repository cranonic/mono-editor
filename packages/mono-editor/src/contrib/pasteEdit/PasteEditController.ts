import {
  ContributionIds,
  type IEditorContributionHost,
  type IPasteEditContribution,
} from '../../browser/editor/editorTypes';
import { languageFeatures } from '../../common/languages/languageFeaturesService';

/**
 * LSP Document Paste Edit controller (`registerDocumentPasteEditProvider`).
 * Allows smart paste transformations (e.g. auto-imports, paste-as-Markdown-link, JSON-to-TypeScript).
 */
export class PasteEditController implements IPasteEditContribution {
  readonly id = ContributionIds.PasteEdit;
  private readonly host: IEditorContributionHost;

  constructor(host: IEditorContributionHost) {
    this.host = host;
  }

  async tryHandlePaste(text: string): Promise<boolean> {
    if (this.host.isReadOnly() || this.host.isDisposed() || !text) return false;
    const sel = this.host.getSelection();
    const langId = this.host.getLanguageIdAtPosition(sel.startLineNumber, sel.startColumn);
    const providers = languageFeatures.getDocumentPasteEditProviders(langId);
    if (!providers.length) return false;

    const range = {
      startLineNumber: sel.startLineNumber,
      startColumn: sel.startColumn,
      endLineNumber: sel.endLineNumber,
      endColumn: sel.endColumn,
    };
    const modelLike = this.host.modelAsFeatureLike();
    const token = { isCancellationRequested: false };
    const data = new Map<string, string>([['text/plain', text]]);

    for (const p of providers) {
      try {
        const edits = await Promise.resolve(
          p.provideDocumentPasteEdits(modelLike, [range], data, { only: undefined }, token),
        );
        const first = edits?.[0];
        if (!first) continue;
        const insertText =
          typeof first.insertText === 'string' ? first.insertText : first.insertText.snippet;
        this.host.executeEdits('pasteEdit', [{ range, text: insertText }]);
        if (first.additionalEdit) {
          this.host.applyWorkspaceEdit(first.additionalEdit, 'pasteEdit');
        }
        return true;
      } catch (e) {
        console.warn('[mono pasteEdit]', e);
      }
    }
    return false;
  }

  dispose(): void {
    /* stateless */
  }
}
