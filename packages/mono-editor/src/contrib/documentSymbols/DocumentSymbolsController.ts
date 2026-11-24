import {
  ContributionIds,
  type IDocumentSymbolsContribution,
  type IEditorContributionHost,
} from '../../browser/editor/editorTypes';
import { languageFeatures } from '../../common/languages/languageFeaturesService';
import type { DocumentSymbol } from '../../common/languages/providers/types';
import type { TextModel } from '../../common/model/TextModel';

/**
 * LSP Document Symbol controller (`registerDocumentSymbolProvider`).
 * Powers `editor.getDocumentSymbols()` AND feeds Sticky Scroll's `OutlineScopeFinder`.
 */
export class DocumentSymbolsController implements IDocumentSymbolsContribution {
  readonly id = ContributionIds.DocumentSymbols;
  private readonly host: IEditorContributionHost;
  private cachedSymbols: DocumentSymbol[] = [];
  private cachedVersion = -1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  constructor(host: IEditorContributionHost) {
    this.host = host;
    this.scheduleSync(80);
  }

  onModelChange(_model: TextModel): void {
    this.cachedSymbols = [];
    this.cachedVersion = -1;
    this.host.view.setStickyOutlineSymbols(null);
    this.scheduleSync(80);
  }

  onModelContentChange(_versionId: number): void {
    this.cachedVersion = -1;
    this.scheduleSync(200);
  }

  async getDocumentSymbols(): Promise<DocumentSymbol[]> {
    const model = this.host.getModel();
    const ver = model.getVersionId();
    if (this.cachedVersion === ver && this.cachedSymbols.length > 0) {
      return this.cachedSymbols;
    }
    const providers = languageFeatures.getDocumentSymbolProviders(model.getLanguageId());
    if (!providers.length) {
      this.cachedSymbols = [];
      this.cachedVersion = ver;
      this.host.view.setStickyOutlineSymbols(null);
      return [];
    }

    const my = ++this.seq;
    const modelLike = this.host.modelAsFeatureLike();
    const token = { isCancellationRequested: false };
    const collected: DocumentSymbol[] = [];

    for (const p of providers) {
      try {
        const res = await Promise.resolve(p.provideDocumentSymbols(modelLike, token));
        if (my !== this.seq || this.host.isDisposed()) return this.cachedSymbols;
        if (res?.length) collected.push(...res);
      } catch (e) {
        console.warn('[mono document symbols]', e);
      }
    }

    this.cachedSymbols = collected;
    this.cachedVersion = ver;
    this.host.view.setStickyOutlineSymbols(collected.length > 0 ? collected : null);
    this.host.view.schedulePaint();
    return collected;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.host.view.setStickyOutlineSymbols(null);
  }

  private scheduleSync(delayMs: number): void {
    if (this.host.isDisposed()) return;
    if (this.timer) clearTimeout(this.timer);
    const providers = languageFeatures.getDocumentSymbolProviders(this.host.getModel().getLanguageId());
    if (!providers.length) {
      this.host.view.setStickyOutlineSymbols(null);
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.getDocumentSymbols();
    }, delayMs);
  }
}
