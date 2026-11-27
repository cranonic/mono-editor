import {
  ContributionIds,
  type IDocumentSymbolsContribution,
  type IEditorContributionHost,
} from '../../browser/editor/editorTypes';
import { languageFeatures } from '../../common/languages/languageFeaturesService';
import type { DocumentSymbol } from '../../common/languages/providers/types';
import type { TextModel } from '../../common/model/TextModel';

/**
 * Document Symbol controller (`registerDocumentSymbolProvider` + built-in structure fallback).
 * Powers `editor.getDocumentSymbols()`, feeds Sticky Scroll's `OutlineScopeFinder`,
 * and syncs external LSP symbols into `DocumentStructureService`.
 */
export class DocumentSymbolsController implements IDocumentSymbolsContribution {
  readonly id = ContributionIds.DocumentSymbols;
  private readonly host: IEditorContributionHost;
  private cachedSymbols: DocumentSymbol[] = [];
  private cachedVersion = -1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private unsubFeatures: { dispose(): void } | null = null;

  constructor(host: IEditorContributionHost) {
    this.host = host;
    this.unsubFeatures = languageFeatures.onDidChange(() => {
      this.cachedVersion = -1;
      this.scheduleSync(60);
    });
    this.applyBuiltInFallback();
    this.scheduleSync(80);
  }

  onModelChange(_model: TextModel): void {
    this.cachedSymbols = [];
    this.cachedVersion = -1;
    this.applyBuiltInFallback();
    this.scheduleSync(80);
  }

  onModelContentChange(_versionId: number): void {
    this.cachedVersion = -1;
    this.applyBuiltInFallback();
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
      const builtin = this.host.getStructure().getTree().symbols;
      this.cachedSymbols = [...builtin];
      this.cachedVersion = ver;
      this.host.setExternalStructureSymbols(null);
      this.host.view.setStickyOutlineSymbols(builtin.length > 0 ? builtin : null);
      return this.cachedSymbols;
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

    if (collected.length > 0) {
      this.cachedSymbols = collected;
      this.cachedVersion = ver;
      this.host.setExternalStructureSymbols(collected);
      this.host.view.setStickyOutlineSymbols(collected);
      this.host.view.schedulePaint();
      return collected;
    }

    // LSP returned empty -> fall back to built-in structure outline
    const builtin = [...this.host.getStructure().getTree().symbols];
    this.cachedSymbols = builtin;
    this.cachedVersion = ver;
    this.host.setExternalStructureSymbols(null);
    this.host.view.setStickyOutlineSymbols(builtin.length > 0 ? builtin : null);
    this.host.view.schedulePaint();
    return builtin;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.unsubFeatures?.dispose();
    this.unsubFeatures = null;
    this.host.view.setStickyOutlineSymbols(null);
  }

  private applyBuiltInFallback(): void {
    if (this.host.isDisposed()) return;
    const builtin = this.host.getStructure().getTree().symbols;
    this.host.view.setStickyOutlineSymbols(builtin.length > 0 ? builtin : null);
  }

  private scheduleSync(delayMs: number): void {
    if (this.host.isDisposed()) return;
    if (this.timer) clearTimeout(this.timer);
    const providers = languageFeatures.getDocumentSymbolProviders(this.host.getModel().getLanguageId());
    if (!providers.length) {
      this.applyBuiltInFallback();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.getDocumentSymbols();
    }, delayMs);
  }
}
