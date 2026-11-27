import {
  ContributionIds,
  type IEditorContribution,
  type IEditorContributionHost,
} from '../../browser/editor/editorTypes';
import type { MonoEditorOptions } from '../../common/config/editorOptions';
import { languageFeatures } from '../../common/languages/languageFeaturesService';
import { SemanticTokensCache } from '../../common/languages/semanticTokens';
import type { TextModel } from '../../common/model/TextModel';

/**
 * Additive LSP Semantic Tokens Controller (`DocumentSemanticTokensProvider` +
 * `DocumentRangeSemanticTokensProvider`). Decodes LSP 5-int delta arrays asynchronously
 * and overlays them cleanly on top of Monarch syntax highlighting with zero typing latency.
 */
export class SemanticTokensController implements IEditorContribution {
  readonly id = ContributionIds.SemanticTokens;
  private readonly host: IEditorContributionHost;
  private readonly cache = new SemanticTokensCache();
  private enabled: boolean;
  private fullTimer: ReturnType<typeof setTimeout> | null = null;
  private rangeTimer: ReturnType<typeof setTimeout> | null = null;
  private fullSeq = 0;
  private rangeSeq = 0;
  private featuresSub: { dispose(): void } | null = null;

  constructor(host: IEditorContributionHost) {
    this.host = host;
    this.enabled = host.initialOptions.semanticHighlighting?.enabled !== false;
    host.view.setLineSemanticTokensProvider((ln) =>
      this.enabled ? this.cache.getLineSpans(ln) : [],
    );
    this.featuresSub = languageFeatures.onDidChange(() => {
      this.scheduleFull(40);
      this.scheduleRange(40);
    });
    this.scheduleFull(80);
    this.scheduleRange(60);
  }

  onModelChange(_model: TextModel): void {
    this.cache.clear();
    this.scheduleFull(80);
    this.scheduleRange(60);
  }

  onModelContentChange(_versionId: number): void {
    this.scheduleFull(180);
    this.scheduleRange(120);
  }

  onScrollEnd(): void {
    this.scheduleRange(80);
  }

  onOptionsChange(patch: Partial<MonoEditorOptions>): void {
    if (patch.semanticHighlighting?.enabled !== undefined) {
      this.enabled = patch.semanticHighlighting.enabled;
      if (!this.enabled) {
        this.cache.clear();
        this.host.view.schedulePaint();
      } else {
        this.scheduleFull(40);
        this.scheduleRange(40);
      }
    }
  }

  dispose(): void {
    if (this.fullTimer) clearTimeout(this.fullTimer);
    if (this.rangeTimer) clearTimeout(this.rangeTimer);
    this.fullTimer = null;
    this.rangeTimer = null;
    this.featuresSub?.dispose();
    this.featuresSub = null;
    this.host.view.setLineSemanticTokensProvider(null);
    this.cache.clear();
  }

  private scheduleFull(delayMs: number): void {
    if (!this.enabled || this.host.isDisposed()) return;
    if (this.fullTimer) clearTimeout(this.fullTimer);
    this.fullTimer = setTimeout(() => {
      this.fullTimer = null;
      void this.fetchFull();
    }, delayMs);
  }

  private scheduleRange(delayMs: number): void {
    if (!this.enabled || this.host.isDisposed()) return;
    if (this.rangeTimer) clearTimeout(this.rangeTimer);
    this.rangeTimer = setTimeout(() => {
      this.rangeTimer = null;
      void this.fetchRange();
    }, delayMs);
  }

  async fetchFull(): Promise<void> {
    if (!this.enabled || this.host.isDisposed()) return;
    const model = this.host.getModel();
    const providers = languageFeatures.getDocumentSemanticTokensProviders(model.getLanguageId());
    if (!providers.length) {
      this.cache.clear();
      this.host.view.schedulePaint();
      return;
    }

    const my = ++this.fullSeq;
    const provider = providers[0]!;
    const legend = provider.getLegend();
    const modelLike = this.host.modelAsFeatureLike();
    const token = { isCancellationRequested: false };
    const prevId = this.cache.getResultId();

    try {
      const res = await Promise.resolve(
        provider.provideDocumentSemanticTokens(modelLike, prevId, token),
      );
      if (my !== this.fullSeq || this.host.isDisposed() || !res) return;
      if ('data' in res) {
        this.cache.setFull(res.data, legend, res.resultId);
      } else if ('edits' in res) {
        this.cache.applyEdits(res.edits, legend, res.resultId);
      }
      this.host.view.schedulePaint();
    } catch (e) {
      console.warn('[mono semantic tokens]', e);
    }
  }

  async fetchRange(): Promise<void> {
    if (!this.enabled || this.host.isDisposed()) return;
    const model = this.host.getModel();
    const providers = languageFeatures.getDocumentRangeSemanticTokensProviders(model.getLanguageId());
    if (!providers.length) return;

    const my = ++this.rangeSeq;
    const provider = providers[0]!;
    const legend = provider.getLegend();
    const vis = this.host.view.getVisibleLineRange();
    const startLine = Math.max(1, vis.startLineNumber - 5);
    const endLine = Math.min(model.getLineCount(), vis.endLineNumber + 5);
    const range = {
      startLineNumber: startLine,
      startColumn: 1,
      endLineNumber: endLine,
      endColumn: model.getLineContent(endLine).length + 1,
    };

    try {
      const res = await Promise.resolve(
        provider.provideDocumentRangeSemanticTokens(
          this.host.modelAsFeatureLike(),
          range,
          { isCancellationRequested: false },
        ),
      );
      if (my !== this.rangeSeq || this.host.isDisposed() || !res) return;
      this.cache.setRange(startLine, endLine, res.data, legend);
      this.host.view.schedulePaint();
    } catch (e) {
      console.warn('[mono range semantic tokens]', e);
    }
  }
}
