import {
  ContributionIds,
  type IEditorContribution,
  type IEditorContributionHost,
} from '../../browser/editor/editorTypes';
import type { InlayHintHit } from '../../browser/render/CanvasRenderer';
import type { MonoEditorOptions } from '../../common/config/editorOptions';
import { languageFeatures } from '../../common/languages/languageFeaturesService';
import type { InlayHint } from '../../common/languages/providers/types';
import type { TextModel } from '../../common/model/TextModel';
import {
  INLAY_CHIP_PAD_X,
  INLAY_OUTER_MARGIN,
  type ResolvedInlayHint,
} from '../../common/virtualText';

function flattenHintLabel(hint: InlayHint): string {
  if (typeof hint.label === 'string') return hint.label;
  return hint.label.map((p) => p.label).join('');
}

/**
 * Viewport-debounced LSP Inlay Hints controller (`registerInlayHintsProvider`).
 * Measures chip advance deterministically so Canvas rendering, caret X, and tap hit-testing stay exact.
 */
export class InlayHintsController implements IEditorContribution {
  readonly id = ContributionIds.InlayHints;
  private readonly host: IEditorContributionHost;
  private enabled: boolean;
  private byLine = new Map<number, ResolvedInlayHint[]>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  constructor(host: IEditorContributionHost) {
    this.host = host;
    this.enabled = host.initialOptions.inlayHints?.enabled !== false;
    host.view.setLineInlayHintsProvider((ln) => (this.enabled ? (this.byLine.get(ln) ?? []) : []));
    this.scheduleFetch(60);
  }

  onModelChange(_model: TextModel): void {
    this.byLine.clear();
    this.scheduleFetch(60);
  }

  onModelContentChange(_versionId: number): void {
    this.scheduleFetch(140);
  }

  onScrollEnd(): void {
    this.scheduleFetch(90);
  }

  onLayout(): void {
    this.scheduleFetch(120);
  }

  onOptionsChange(patch: Partial<MonoEditorOptions>): void {
    if (patch.inlayHints?.enabled !== undefined) {
      this.enabled = patch.inlayHints.enabled;
      if (!this.enabled) {
        this.byLine.clear();
        this.host.view.schedulePaint();
      } else {
        this.scheduleFetch(30);
      }
    }
  }

  onInlayHintClick(hit: InlayHintHit): void {
    for (const part of hit.hint.parts) {
      if (part.command) {
        void this.host.executeCommand(part.command.id, ...(part.command.arguments ?? []));
        return;
      }
      if (part.location) {
        this.host.jumpToLocation(part.location);
        return;
      }
    }
  }

  dispose(): void {
    this.cancelTimer();
    this.host.view.setLineInlayHintsProvider(null);
    this.byLine.clear();
  }

  private cancelTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleFetch(delayMs: number): void {
    if (!this.enabled || this.host.isDisposed()) return;
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.fetchViewportHints();
    }, delayMs);
  }

  async fetchViewportHints(): Promise<void> {
    if (!this.enabled || this.host.isDisposed()) return;
    const model = this.host.getModel();
    const providers = languageFeatures.getInlayHintsProviders(model.getLanguageId());
    if (!providers.length) {
      if (this.byLine.size > 0) {
        this.byLine.clear();
        this.host.view.schedulePaint();
      }
      return;
    }

    const my = ++this.seq;
    const vis = this.host.view.getVisibleLineRange();
    const startLine = Math.max(1, vis.startLineNumber - 10);
    const endLine = Math.min(model.getLineCount(), vis.endLineNumber + 10);
    const range = {
      startLineNumber: startLine,
      startColumn: 1,
      endLineNumber: endLine,
      endColumn: model.getLineContent(endLine).length + 1,
    };

    const modelLike = this.host.modelAsFeatureLike();
    const token = { isCancellationRequested: false };
    const nextMap = new Map<number, ResolvedInlayHint[]>();

    for (const p of providers) {
      try {
        const res = await Promise.resolve(p.provideInlayHints(modelLike, range, token));
        if (my !== this.seq || this.host.isDisposed()) return;
        const hints = Array.isArray(res) ? res : (res?.hints ?? []);
        for (const h of hints) {
          const ln = h.position.lineNumber;
          if (ln < 1 || ln > model.getLineCount()) continue;
          const text = flattenHintLabel(h);
          if (!text) continue;
          const parts = typeof h.label === 'string' ? [{ label: h.label }] : h.label;
          const textW = Math.ceil(this.host.view.measureTextWidth(text) * 0.92);
          const chipW = textW + INLAY_CHIP_PAD_X * 2;
          const padLeft = h.paddingLeft ? INLAY_OUTER_MARGIN : 2;
          const padRight = h.paddingRight ? INLAY_OUTER_MARGIN : 2;
          const tooltip = typeof h.tooltip === 'string' ? h.tooltip : h.tooltip?.value;
          const resolved: ResolvedInlayHint = {
            lineNumber: ln,
            column: Math.max(1, h.position.column),
            text,
            parts,
            kind: h.kind,
            tooltip,
            paddingLeft: Boolean(h.paddingLeft),
            paddingRight: Boolean(h.paddingRight),
            marginLeftPx: padLeft,
            chipWidthPx: chipW,
            totalAdvancePx: padLeft + chipW + padRight,
          };
          const arr = nextMap.get(ln) ?? [];
          arr.push(resolved);
          nextMap.set(ln, arr);
        }
      } catch (e) {
        console.warn('[mono inlay hints]', e);
      }
    }

    for (const arr of nextMap.values()) {
      arr.sort((a, b) => a.column - b.column);
    }

    if (my !== this.seq || this.host.isDisposed()) return;
    this.byLine = nextMap;
    this.host.view.schedulePaint();
  }
}
