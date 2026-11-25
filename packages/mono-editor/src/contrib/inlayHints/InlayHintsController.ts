import {
  ContributionIds,
  type IEditorContribution,
  type IEditorContributionHost,
} from '../../browser/editor/editorTypes';
import type { InlayHintClickMeta } from '../../browser/input/pointer/PointerController';
import type { InlayHintHit } from '../../browser/render/CanvasRenderer';
import type { MonoEditorOptions } from '../../common/config/editorOptions';
import { languageFeatures } from '../../common/languages/languageFeaturesService';
import type { IInlayHintClickEvent, InlayHint, InlayHintLabelPart } from '../../common/languages/providers/types';
import type { TextModel } from '../../common/model/TextModel';
import {
  INLAY_CHIP_PAD_X,
  INLAY_OUTER_MARGIN,
  type ResolvedInlayHint,
} from '../../common/virtualText';

type InlayClickMode = 'placeCursor' | 'bubble' | 'none';

interface LiftAnimState {
  progress: number;
  target: number;
  startVal: number;
  startTs: number;
}

const LIFT_DURATION_MS = 120;

function flattenHintLabel(hint: InlayHint): string {
  if (typeof hint.label === 'string') return hint.label;
  return hint.label.map((p) => p.label).join('');
}

function hintKey(line: number, column: number, idx: number, text: string): string {
  return `${line}:${column}:${idx}:${text}`;
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

function easeOutCubic(t: number): number {
  const u = 1 - Math.max(0, Math.min(1, t));
  return 1 - u * u * u;
}

/**
 * Viewport-debounced LSP Inlay Hints controller (`registerInlayHintsProvider`).
 * Supports public `onDidClickInlayHint` (with `clickCount`, `source`, `part`, `preventDefault`),
 * `inlayHints.onClick: 'placeCursor' | 'bubble' | 'none'`, and animated bubble lifting
 * that collapses inline advance smoothly (`chipWidth * (1 - liftProgress)`) so caret,
 * selection, and teardrops stay glued on every frame.
 */
export class InlayHintsController implements IEditorContribution {
  readonly id = ContributionIds.InlayHints;
  private readonly host: IEditorContributionHost;
  private enabled: boolean;
  private onClickMode: InlayClickMode;
  private byLine = new Map<number, ResolvedInlayHint[]>();
  private liftState = new Map<string, LiftAnimState>();
  private liftRaf = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  constructor(host: IEditorContributionHost) {
    this.host = host;
    this.enabled = host.initialOptions.inlayHints?.enabled !== false;
    this.onClickMode = host.initialOptions.inlayHints?.onClick ?? 'placeCursor';
    host.view.setLineInlayHintsProvider((ln) => this.getHintsForLine(ln));
    this.scheduleFetch(60);
  }

  onModelChange(_model: TextModel): void {
    this.byLine.clear();
    this.liftState.clear();
    this.stopLiftAnim();
    this.scheduleFetch(60);
  }

  onModelContentChange(_versionId: number): void {
    this.scheduleFetch(140);
  }

  onCursorChange(_source: string): void {
    if (this.enabled && this.onClickMode === 'bubble') {
      this.syncBubbleTargets(false);
    }
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
        this.liftState.clear();
        this.stopLiftAnim();
        this.host.view.schedulePaint();
      } else {
        this.scheduleFetch(30);
      }
    }
    if (patch.inlayHints?.onClick !== undefined) {
      this.onClickMode = patch.inlayHints.onClick;
      if (this.onClickMode !== 'bubble') {
        this.liftState.clear();
        this.stopLiftAnim();
        this.host.view.schedulePaint();
      } else {
        this.syncBubbleTargets(false);
      }
    }
  }

  onInlayHintClick(hit: InlayHintHit, meta?: InlayHintClickMeta): void {
    const h = hit.hint;
    const rawHint: InlayHint = h.rawHint ?? {
      position: { lineNumber: h.lineNumber, column: h.column },
      label: h.parts.length === 1 ? h.parts[0]!.label : h.parts,
      kind: h.kind,
      tooltip: h.tooltip,
      paddingLeft: h.paddingLeft,
      paddingRight: h.paddingRight,
    };

    const clickedPart = this.resolveClickedPart(hit, meta?.localX);
    let prevented = false;
    const ev: IInlayHintClickEvent = {
      hint: rawHint,
      part: clickedPart,
      position: { lineNumber: h.lineNumber, column: h.column },
      clickCount: meta?.clickCount ?? 1,
      source: meta?.source ?? 'mouse',
      preventDefault() {
        prevented = true;
      },
    };
    this.host.emitInlayHintClick(ev);
    if (prevented) return;

    // Run command/location on clicked part first, then fallback across parts
    const partsToCheck = clickedPart
      ? [clickedPart, ...h.parts.filter((p) => p !== clickedPart)]
      : h.parts;
    for (const part of partsToCheck) {
      if (part.command) {
        void this.host.executeCommand(part.command.id, ...(part.command.arguments ?? []));
        return;
      }
      if (part.location) {
        this.host.jumpToLocation(part.location);
        return;
      }
    }

    if (this.onClickMode === 'none') return;

    // Default 'placeCursor' and 'bubble' both place caret at the hint's anchor column
    this.host.setPosition({ lineNumber: h.lineNumber, column: h.column });
    this.host.focus();
    if (this.onClickMode === 'bubble') {
      this.syncBubbleTargets(false);
    }
  }

  dispose(): void {
    this.cancelTimer();
    this.stopLiftAnim();
    this.host.view.setLineInlayHintsProvider(null);
    this.byLine.clear();
    this.liftState.clear();
  }

  private resolveClickedPart(hit: InlayHintHit, localX?: number): InlayHintLabelPart | undefined {
    const parts = hit.hint.parts;
    if (!parts.length) return undefined;
    if (parts.length === 1 || localX == null) return parts[0];
    let relX = localX - (hit.x + INLAY_CHIP_PAD_X);
    if (relX <= 0) return parts[0];
    for (const p of parts) {
      const w = Math.max(4, this.host.view.measureTextWidth(p.label) * 0.92);
      if (relX <= w) return p;
      relX -= w;
    }
    return parts[parts.length - 1];
  }

  /** Returns hints for a line with effective `totalAdvancePx` & `liftProgress` applied. */
  private getHintsForLine(ln: number): readonly ResolvedInlayHint[] {
    if (!this.enabled) return [];
    const base = this.byLine.get(ln);
    if (!base || !base.length) return [];
    if (this.onClickMode !== 'bubble' || !this.liftState.size) return base;

    let anyLifted = false;
    const perCol = new Map<number, number>();
    const out = base.map((h) => {
      const idx = perCol.get(h.column) ?? 0;
      perCol.set(h.column, idx + 1);
      const st = this.liftState.get(hintKey(h.lineNumber, h.column, idx, h.text));
      const p = st ? Math.max(0, Math.min(1, st.progress)) : 0;
      if (p <= 0.001) return h;
      anyLifted = true;
      return {
        ...h,
        totalAdvancePx: Math.max(0, h.totalAdvancePx * (1 - p)),
        liftProgress: p,
      };
    });
    return anyLifted ? out : base;
  }

  /**
   * Computes active anchor set from every caret and every non-empty selection's start edge,
   * updating lift targets and starting the rAF ease-out animation only when needed.
   */
  syncBubbleTargets(instant = false): void {
    if (!this.enabled || this.onClickMode !== 'bubble') return;
    const anchors = new Set<string>();
    for (const sel of this.host.selection.selections) {
      anchors.add(`${sel.active.lineNumber}:${sel.active.column}`);
      const a = sel.anchor;
      const b = sel.active;
      if (a.lineNumber !== b.lineNumber || a.column !== b.column) {
        const aBefore = a.lineNumber < b.lineNumber || (a.lineNumber === b.lineNumber && a.column <= b.column);
        const start = aBefore ? a : b;
        anchors.add(`${start.lineNumber}:${start.column}`);
      }
    }

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const useInstant = instant || prefersReducedMotion() || typeof requestAnimationFrame === 'undefined';
    const liveKeys = new Set<string>();
    let needsAnim = false;
    let changed = false;

    for (const list of this.byLine.values()) {
      const perCol = new Map<number, number>();
      for (const h of list) {
        const idx = perCol.get(h.column) ?? 0;
        perCol.set(h.column, idx + 1);
        const key = hintKey(h.lineNumber, h.column, idx, h.text);
        liveKeys.add(key);
        const target = anchors.has(`${h.lineNumber}:${h.column}`) ? 1 : 0;
        const cur = this.liftState.get(key);
        const curProg = cur ? cur.progress : 0;

        if (target === 0 && curProg <= 0.001) {
          if (cur) { this.liftState.delete(key); changed = true; }
          continue;
        }
        if (useInstant) {
          if (curProg !== target) changed = true;
          if (target === 0) this.liftState.delete(key);
          else this.liftState.set(key, { progress: target, target, startVal: target, startTs: now });
          continue;
        }
        if (!cur || cur.target !== target) {
          this.liftState.set(key, { progress: curProg, target, startVal: curProg, startTs: now });
          changed = true;
          needsAnim = true;
        } else if (Math.abs(cur.progress - cur.target) > 0.001) {
          needsAnim = true;
        }
      }
    }

    for (const key of this.liftState.keys()) {
      if (!liveKeys.has(key)) {
        this.liftState.delete(key);
        changed = true;
      }
    }

    if (needsAnim) {
      this.startLiftAnim();
    } else if (changed) {
      this.host.view.schedulePaint();
    }
  }

  private startLiftAnim(): void {
    if (this.liftRaf) return;
    const step = (ts: number) => {
      this.liftRaf = 0;
      if (this.host.isDisposed() || !this.enabled || this.onClickMode !== 'bubble') return;
      let more = false;
      for (const [key, st] of this.liftState) {
        const rawT = Math.min(1, Math.max(0, (ts - st.startTs) / LIFT_DURATION_MS));
        const eased = easeOutCubic(rawT);
        st.progress = st.startVal + (st.target - st.startVal) * eased;
        if (rawT < 1) {
          more = true;
        } else {
          st.progress = st.target;
          if (st.target === 0) this.liftState.delete(key);
        }
      }
      this.host.view.paint();
      if (more) {
        this.liftRaf = requestAnimationFrame(step);
      }
    };
    this.liftRaf = requestAnimationFrame(step);
  }

  private stopLiftAnim(): void {
    if (this.liftRaf) {
      cancelAnimationFrame(this.liftRaf);
      this.liftRaf = 0;
    }
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
        this.liftState.clear();
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
            rawHint: h,
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
    if (this.onClickMode === 'bubble') {
      this.syncBubbleTargets(false);
    } else {
      this.host.view.schedulePaint();
    }
  }
}
