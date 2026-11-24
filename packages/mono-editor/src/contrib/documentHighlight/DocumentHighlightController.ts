import {
  ContributionIds,
  type IEditorContribution,
  type IEditorContributionHost,
} from '../../browser/editor/editorTypes';
import { languageFeatures } from '../../common/languages/languageFeaturesService';
import type { DocumentHighlight } from '../../common/languages/providers/types';
import type { TextModel } from '../../common/model/TextModel';

/**
 * LSP Document Highlight controller (`registerDocumentHighlightProvider`).
 * Highlights Read / Write / Text semantic occurrences of the symbol under the caret.
 */
export class DocumentHighlightController implements IEditorContribution {
  readonly id = ContributionIds.DocumentHighlight;
  private readonly host: IEditorContributionHost;
  private highlights: DocumentHighlight[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  constructor(host: IEditorContributionHost) {
    this.host = host;
    host.view.setDocumentHighlightsProvider(() => this.highlights);
  }

  onCursorChange(_source: string): void {
    this.scheduleFetch(140);
  }

  onModelContentChange(_versionId: number): void {
    this.clear();
  }

  onModelChange(_model: TextModel): void {
    this.clear();
  }

  dispose(): void {
    this.cancelTimer();
    this.highlights = [];
    this.host.view.setDocumentHighlightsProvider(null);
  }

  private clear(): void {
    this.cancelTimer();
    ++this.seq;
    if (this.highlights.length > 0) {
      this.highlights = [];
      this.host.view.schedulePaint();
    }
  }

  private cancelTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleFetch(delayMs: number): void {
    if (this.host.isDisposed()) return;
    this.cancelTimer();
    const pos = this.host.getPosition();
    const langId = this.host.getLanguageIdAtPosition(pos.lineNumber, pos.column);
    if (!languageFeatures.getDocumentHighlightProviders(langId).length) {
      this.clear();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.fetchAtCaret();
    }, delayMs);
  }

  async fetchAtCaret(): Promise<void> {
    if (this.host.isDisposed()) return;
    const pos = this.host.getPosition();
    const langId = this.host.getLanguageIdAtPosition(pos.lineNumber, pos.column);
    const providers = languageFeatures.getDocumentHighlightProviders(langId);
    if (!providers.length) {
      this.clear();
      return;
    }

    const my = ++this.seq;
    const modelLike = this.host.modelAsFeatureLike();
    const token = { isCancellationRequested: false };
    const collected: DocumentHighlight[] = [];

    for (const p of providers) {
      try {
        const res = await Promise.resolve(p.provideDocumentHighlights(modelLike, pos, token));
        if (my !== this.seq || this.host.isDisposed()) return;
        if (res?.length) collected.push(...res);
      } catch (e) {
        console.warn('[mono document highlight]', e);
      }
    }

    this.highlights = collected;
    this.host.view.schedulePaint();
  }
}
