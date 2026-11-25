import type { MonoEditorOptions } from '../../common/config/editorOptions';
import { languageFeatures } from '../../common/languages/languageFeaturesService';
import type { CodeLens, CodeLensProvider } from '../../common/languages/providers/extendedTypes';
import type { TextModel } from '../../common/model/TextModel';
import type { ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';
import {
  ContributionIds,
  type IEditorContribution,
  type IEditorContributionHost,
} from '../../browser/editor/editorTypes';

interface PendingLensItem {
  lens: CodeLens;
  provider: CodeLensProvider;
  resolved: boolean;
}

interface ResolvedLensGroup {
  lineNumber: number;
  lenses: CodeLens[];
}

interface ActiveZoneEntry {
  zoneId: string;
  lineNumber: number;
  heightPx: number;
  domNode: HTMLDivElement;
  signature: string;
}

const TAP_SLOP_PX = 8;

/**
 * CodeLens contribution:
 * Queries registered `CodeLensProvider`s, lazily resolves visible lenses,
 * renders accessible clickable lens strips (tap/click + keyboard, never on scroll-start),
 * scales with `codeLensFontSize`/`codeLensFontFamily`, skips folded/hidden lines,
 * diffs view zones in place, and anchors scrollTop so edits never cause visual jumps.
 */
export class CodeLensController implements IEditorContribution {
  readonly id = ContributionIds.CodeLens;
  private readonly host: IEditorContributionHost;
  private enabled: boolean;
  private fontSizeOpt?: number;
  private fontFamilyOpt?: string;
  private activeZones = new Map<number, ActiveZoneEntry>();
  private rawItems: PendingLensItem[] = [];
  private groups: ResolvedLensGroup[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private resolveTimer: ReturnType<typeof setTimeout> | null = null;
  private reqToken = 0;
  private mutedFg = '#9ca3af';
  private accentFg = '#60a5fa';
  private unsubRegistry: { dispose: () => void } | null = null;
  private providerEventUnsubs: { dispose: () => void }[] = [];

  constructor(host: IEditorContributionHost) {
    this.host = host;
    this.enabled = host.initialOptions.codeLens !== false && !host.isPeekEditor;
    this.fontSizeOpt = host.initialOptions.codeLensFontSize;
    this.fontFamilyOpt = host.initialOptions.codeLensFontFamily;
    this.unsubRegistry = languageFeatures.onDidChange(() => {
      this.rebindProviderEvents();
      this.scheduleRefresh(80);
    });
    this.rebindProviderEvents();
    if (this.enabled) this.scheduleRefresh(120);
  }

  onModelChange(_model: TextModel): void {
    this.rebindProviderEvents();
    this.rawItems = [];
    this.groups = [];
    this.clearZones();
    if (this.enabled) this.scheduleRefresh(100);
  }

  onModelContentChange(_versionId: number): void {
    if (this.enabled) this.scheduleRefresh(220);
  }

  onScroll(): void {
    if (!this.enabled || !this.rawItems.length) return;
    if (this.resolveTimer) clearTimeout(this.resolveTimer);
    this.resolveTimer = setTimeout(() => {
      this.resolveTimer = null;
      void this.resolveVisibleLenses();
    }, 60);
  }

  onLayout(): void {
    if (this.enabled && this.groups.length) this.renderZones(false);
  }

  onOptionsChange(patch: Partial<MonoEditorOptions>): void {
    let rerender = false;
    if (patch.codeLens !== undefined) {
      this.enabled = patch.codeLens && !this.host.isPeekEditor;
      if (!this.enabled) {
        this.rawItems = [];
        this.groups = [];
        this.clearZones();
        return;
      }
      this.scheduleRefresh(60);
    }
    if (patch.codeLensFontSize !== undefined) {
      this.fontSizeOpt = patch.codeLensFontSize;
      rerender = true;
    }
    if (patch.codeLensFontFamily !== undefined) {
      this.fontFamilyOpt = patch.codeLensFontFamily;
      rerender = true;
    }
    if (patch.fontSize !== undefined || patch.lineHeight !== undefined || patch.fontFamily !== undefined) {
      rerender = true;
    }
    if (rerender && this.enabled && this.groups.length) {
      this.renderZones(true);
    }
  }

  onThemeChange(wt: ResolvedWidgetTheme): void {
    this.mutedFg = wt.mutedForeground;
    this.accentFg = wt.focusBorder;
    if (this.groups.length) this.renderZones(false);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.resolveTimer) clearTimeout(this.resolveTimer);
    this.unsubRegistry?.dispose();
    for (const u of this.providerEventUnsubs) {
      try { u.dispose(); } catch { /* ignore */ }
    }
    this.providerEventUnsubs = [];
    this.clearZones();
  }

  private rebindProviderEvents(): void {
    for (const u of this.providerEventUnsubs) {
      try { u.dispose(); } catch { /* ignore */ }
    }
    this.providerEventUnsubs = [];
    if (this.host.isDisposed()) return;
    const providers = languageFeatures.getCodeLensProviders(this.host.getModel().getLanguageId());
    for (const p of providers) {
      const sub = p.onDidChangeCodeLenses ?? p.onDidChange;
      if (typeof sub === 'function') {
        try {
          const d = sub(() => this.scheduleRefresh(60));
          if (d) this.providerEventUnsubs.push(d);
        } catch { /* ignore */ }
      }
    }
  }

  private scheduleRefresh(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, delayMs);
  }

  private async refresh(): Promise<void> {
    if (!this.enabled || this.host.isDisposed()) return;
    const myToken = ++this.reqToken;
    const langId = this.host.getModel().getLanguageId();
    const providers = languageFeatures.getCodeLensProviders(langId);
    if (!providers.length) {
      this.rawItems = [];
      this.groups = [];
      this.clearZones();
      return;
    }

    const modelLike = this.host.modelAsFeatureLike();
    const token = { isCancellationRequested: false };
    const collected: PendingLensItem[] = [];

    for (const provider of providers) {
      try {
        const res = await Promise.resolve(provider.provideCodeLenses(modelLike, token));
        if (myToken !== this.reqToken || this.host.isDisposed()) return;
        const lenses = Array.isArray(res) ? res : res?.lenses ?? [];
        for (const lens of lenses) {
          collected.push({ lens, provider, resolved: Boolean(lens.command?.title) });
        }
      } catch { /* ignore */ }
    }

    if (myToken !== this.reqToken || this.host.isDisposed()) return;
    this.rawItems = collected;
    await this.resolveVisibleLenses(myToken);
  }

  private async resolveVisibleLenses(expectedToken = this.reqToken): Promise<void> {
    if (!this.enabled || this.host.isDisposed()) return;
    const vis = this.host.view?.getVisibleLineRange?.() ?? {
      startLineNumber: 1,
      endLineNumber: this.host.getModel().getLineCount(),
    };
    const minLine = Math.max(1, vis.startLineNumber - 10);
    const maxLine = vis.endLineNumber + 10;
    const modelLike = this.host.modelAsFeatureLike();
    const token = { isCancellationRequested: false };

    for (const item of this.rawItems) {
      if (item.resolved || !item.provider.resolveCodeLens) continue;
      const ln = Math.max(1, item.lens.range.startLineNumber);
      if (ln < minLine || ln > maxLine) continue;
      try {
        const r = await Promise.resolve(item.provider.resolveCodeLens(modelLike, item.lens, token));
        if (expectedToken !== this.reqToken || this.host.isDisposed()) return;
        if (r) item.lens = r;
        item.resolved = true;
      } catch {
        item.resolved = true;
      }
    }

    if (expectedToken !== this.reqToken || this.host.isDisposed()) return;
    const byLine = new Map<number, CodeLens[]>();
    for (const item of this.rawItems) {
      if (!item.lens.command?.title) continue;
      const ln = Math.max(1, item.lens.range.startLineNumber);
      if (this.host.view?.isLineHidden?.(ln)) continue;
      const arr = byLine.get(ln) ?? [];
      arr.push(item.lens);
      byLine.set(ln, arr);
    }

    this.groups = Array.from(byLine.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([lineNumber, lenses]) => ({ lineNumber, lenses }));
    this.renderZones(true);
  }

  private clearZones(): void {
    if (!this.activeZones.size) return;
    const oldIds = Array.from(this.activeZones.values()).map((z) => z.zoneId);
    this.activeZones.clear();
    this.host.changeViewZones((acc) => {
      for (const id of oldIds) acc.removeZone(id);
    });
  }

  private computeStripMetrics(): { fontSize: number; fontFamily: string; stripHeight: number } {
    const m = this.host.getMetrics();
    const fontSize = this.fontSizeOpt ?? Math.max(10, Math.round(m.fontSize * 0.85));
    const fontFamily = this.fontFamilyOpt ?? 'system-ui, -apple-system, sans-serif';
    const stripHeight = Math.max(16, Math.round(m.lineHeight * 0.9));
    return { fontSize, fontFamily, stripHeight };
  }

  private buildStripContents(
    strip: HTMLDivElement,
    group: ResolvedLensGroup,
    fontSize: number,
    fontFamily: string,
    stripHeight: number,
  ): void {
    const model = this.host.getModel();
    const lineText = model.getLineContent(Math.min(group.lineNumber, model.getLineCount()));
    const indentMatch = /^[ \t]*/.exec(lineText);
    const indentChars = indentMatch ? indentMatch[0].length : 0;
    const indentPx = Math.round(indentChars * this.host.getMetrics().charWidth);

    strip.replaceChildren();
    strip.setAttribute('role', 'toolbar');
    strip.setAttribute('aria-label', `CodeLens actions for line ${group.lineNumber}`);
    Object.assign(strip.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      height: `${stripHeight}px`,
      paddingLeft: `${8 + indentPx}px`,
      fontSize: `${fontSize}px`,
      fontFamily,
      color: this.mutedFg,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
    });

    group.lenses.forEach((lens, idx) => {
      if (idx > 0) {
        const sep = document.createElement('span');
        sep.textContent = '|';
        sep.setAttribute('aria-hidden', 'true');
        sep.style.opacity = '0.45';
        strip.appendChild(sep);
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.tabIndex = 0;
      btn.setAttribute('role', 'button');
      btn.setAttribute('aria-label', lens.command!.title);
      btn.textContent = lens.command!.title;
      Object.assign(btn.style, {
        border: 'none',
        background: 'transparent',
        color: this.mutedFg,
        padding: '0 2px',
        margin: '0',
        fontSize: `${fontSize}px`,
        fontFamily,
        lineHeight: `${stripHeight}px`,
        cursor: lens.command!.id ? 'pointer' : 'default',
      });
      const tip = (lens.command as { tooltip?: string }).tooltip;
      if (tip) btn.title = tip;

      const trigger = () => {
        if (lens.command?.id) {
          void this.host.executeCommand(lens.command.id, ...(lens.command.arguments ?? []));
        }
      };

      btn.addEventListener('pointerenter', () => {
        btn.style.color = this.accentFg;
        btn.style.textDecoration = 'underline';
      });
      btn.addEventListener('pointerleave', () => {
        btn.style.color = this.mutedFg;
        btn.style.textDecoration = 'none';
      });

      // Stop PointerController on host.root from calling setPointerCapture() and swallowing pointerup,
      // while preserving tap-slop protection so slight drags do not accidentally trigger commands.
      let downX = 0;
      let downY = 0;
      let pointerActive = false;
      let handledByPointerUp = false;
      btn.addEventListener('pointerdown', (e) => {
        downX = e.clientX ?? 0;
        downY = e.clientY ?? 0;
        pointerActive = true;
        handledByPointerUp = false;
        e.stopPropagation();
      });
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      btn.addEventListener('pointercancel', () => {
        pointerActive = false;
      });
      btn.addEventListener('pointerup', (e) => {
        if (!pointerActive) return;
        pointerActive = false;
        const dist = Math.hypot((e.clientX ?? 0) - downX, (e.clientY ?? 0) - downY);
        if (dist <= TAP_SLOP_PX) {
          e.preventDefault();
          e.stopPropagation();
          handledByPointerUp = true;
          trigger();
        }
      });
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (handledByPointerUp) {
          handledByPointerUp = false;
          return;
        }
        trigger();
      });
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          trigger();
        }
      });
      strip.appendChild(btn);
    });
  }

  private renderZones(anchorScroll: boolean): void {
    const { fontSize, fontFamily, stripHeight } = this.computeStripMetrics();
    const view = this.host.view;
    const prevScrollTop = view?.scrollTop ?? 0;

    // Determine anchor row (first visible visual row) & total zone height above it before updating
    let anchorRow = 0;
    let beforeExtra = 0;
    if (view && anchorScroll && prevScrollTop > 0) {
      view.syncProjection();
      const beforeGeom = view.getRowGeometry();
      anchorRow = beforeGeom.rowAtDocY(prevScrollTop + view.getTopInset()).row;
      beforeExtra = beforeGeom.extraAbove(anchorRow);
    }

    const desiredByLine = new Map<number, ResolvedLensGroup>();
    for (const g of this.groups) {
      if (!view?.isLineHidden?.(g.lineNumber)) desiredByLine.set(g.lineNumber, g);
    }

    const toRemove: string[] = [];
    const toAdd: { group: ResolvedLensGroup; domNode: HTMLDivElement; sig: string }[] = [];

    for (const [ln, entry] of this.activeZones) {
      const next = desiredByLine.get(ln);
      if (!next || entry.heightPx !== stripHeight) {
        toRemove.push(entry.zoneId);
        this.activeZones.delete(ln);
      } else {
        const sig = `${fontSize}|${fontFamily}|${this.mutedFg}|${next.lenses.map((l) => l.command?.title ?? '').join('\u0000')}`;
        if (sig !== entry.signature) {
          this.buildStripContents(entry.domNode, next, fontSize, fontFamily, stripHeight);
          entry.signature = sig;
        }
      }
    }

    for (const [ln, group] of desiredByLine) {
      if (this.activeZones.has(ln)) continue;
      const strip = document.createElement('div');
      this.buildStripContents(strip, group, fontSize, fontFamily, stripHeight);
      const sig = `${fontSize}|${fontFamily}|${this.mutedFg}|${group.lenses.map((l) => l.command?.title ?? '').join('\u0000')}`;
      toAdd.push({ group, domNode: strip, sig });
    }

    if (toRemove.length || toAdd.length) {
      this.host.changeViewZones((acc) => {
        for (const id of toRemove) acc.removeZone(id);
        for (const item of toAdd) {
          const zoneId = acc.addZone({
            afterLineNumber: Math.max(0, item.group.lineNumber - 1),
            heightInPx: stripHeight,
            domNode: item.domNode,
          });
          this.activeZones.set(item.group.lineNumber, {
            zoneId,
            lineNumber: item.group.lineNumber,
            heightPx: stripHeight,
            domNode: item.domNode,
            signature: item.sig,
          });
        }
      });

      // Scroll anchoring: keep visible text stationary if lens zones above the viewport changed height
      if (view && anchorScroll && prevScrollTop > 0) {
        const afterGeom = view.getRowGeometry();
        const afterExtra = afterGeom.extraAbove(anchorRow);
        const delta = afterExtra - beforeExtra;
        if (delta !== 0) {
          view.scrollTop = Math.max(0, prevScrollTop + delta);
          view.clampScrollPublic();
          view.paint();
        }
      }
    }
  }
}
