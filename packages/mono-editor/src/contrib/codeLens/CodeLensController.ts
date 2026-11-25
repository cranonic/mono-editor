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

interface ResolvedLensGroup {
  lineNumber: number;
  lenses: CodeLens[];
}

/**
 * CodeLens contribution:
 * Queries registered `CodeLensProvider`s and renders compact clickable lens strips
 * directly above target lines using the editor's multi-zone `changeViewZones` API.
 */
export class CodeLensController implements IEditorContribution {
  readonly id = ContributionIds.CodeLens;
  private readonly host: IEditorContributionHost;
  private enabled: boolean;
  private zoneIds: string[] = [];
  private groups: ResolvedLensGroup[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private reqToken = 0;
  private mutedFg = '#9ca3af';
  private accentFg = '#60a5fa';
  private unsubRegistry: { dispose: () => void } | null = null;

  constructor(host: IEditorContributionHost) {
    this.host = host;
    this.enabled = host.initialOptions.codeLens !== false && !host.isPeekEditor;
    this.unsubRegistry = languageFeatures.onDidChange(() => this.scheduleRefresh(80));
    if (this.enabled) this.scheduleRefresh(120);
  }

  onModelChange(_model: TextModel): void {
    this.clearZones();
    if (this.enabled) this.scheduleRefresh(100);
  }

  onModelContentChange(_versionId: number): void {
    if (this.enabled) this.scheduleRefresh(220);
  }

  onOptionsChange(patch: Partial<MonoEditorOptions>): void {
    if (patch.codeLens !== undefined) {
      this.enabled = patch.codeLens && !this.host.isPeekEditor;
      if (!this.enabled) this.clearZones();
      else this.scheduleRefresh(60);
    }
  }

  onThemeChange(wt: ResolvedWidgetTheme): void {
    this.mutedFg = wt.mutedForeground;
    this.accentFg = wt.focusBorder;
    if (this.groups.length) this.renderZones();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.unsubRegistry?.dispose();
    this.clearZones();
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
      this.groups = [];
      this.clearZones();
      return;
    }

    const modelLike = this.host.modelAsFeatureLike();
    const token = { isCancellationRequested: false };
    const collected: { lens: CodeLens; provider: CodeLensProvider }[] = [];

    for (const provider of providers) {
      try {
        const res = await Promise.resolve(provider.provideCodeLenses(modelLike, token));
        if (myToken !== this.reqToken || this.host.isDisposed()) return;
        const lenses = Array.isArray(res) ? res : res?.lenses ?? [];
        for (const lens of lenses) collected.push({ lens, provider });
      } catch { /* ignore */ }
    }

    const byLine = new Map<number, CodeLens[]>();
    for (const item of collected) {
      let resolved = item.lens;
      if (!resolved.command && item.provider.resolveCodeLens) {
        try {
          const r = await Promise.resolve(item.provider.resolveCodeLens(modelLike, resolved, token));
          if (r) resolved = r;
        } catch { /* ignore */ }
      }
      if (!resolved.command?.title) continue;
      const ln = Math.max(1, resolved.range.startLineNumber);
      const arr = byLine.get(ln) ?? [];
      arr.push(resolved);
      byLine.set(ln, arr);
    }

    if (myToken !== this.reqToken || this.host.isDisposed()) return;
    this.groups = Array.from(byLine.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([lineNumber, lenses]) => ({ lineNumber, lenses }));
    this.renderZones();
  }

  private clearZones(): void {
    if (!this.zoneIds.length) return;
    const old = this.zoneIds;
    this.zoneIds = [];
    this.host.changeViewZones((acc) => {
      for (const id of old) acc.removeZone(id);
    });
  }

  private renderZones(): void {
    const prevIds = this.zoneIds;
    const nextIds: string[] = [];
    const model = this.host.getModel();

    this.host.changeViewZones((acc) => {
      for (const id of prevIds) acc.removeZone(id);
      for (const group of this.groups) {
        const lineText = model.getLineContent(Math.min(group.lineNumber, model.getLineCount()));
        const indentMatch = /^[ \t]*/.exec(lineText);
        const indentChars = indentMatch ? indentMatch[0].length : 0;
        const indentPx = Math.round(indentChars * this.host.getMetrics().charWidth);

        const strip = document.createElement('div');
        Object.assign(strip.style, {
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          height: '20px',
          paddingLeft: `${8 + indentPx}px`,
          fontSize: '12px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: this.mutedFg,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        });

        group.lenses.forEach((lens, idx) => {
          if (idx > 0) {
            const sep = document.createElement('span');
            sep.textContent = '|';
            sep.style.opacity = '0.45';
            strip.appendChild(sep);
          }
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = lens.command!.title;
          Object.assign(btn.style, {
            border: 'none',
            background: 'transparent',
            color: this.mutedFg,
            padding: '0 2px',
            margin: '0',
            fontSize: '12px',
            lineHeight: '20px',
            cursor: lens.command!.id ? 'pointer' : 'default',
          });
          const tip = (lens.command as { tooltip?: string }).tooltip;
          if (tip) btn.title = tip;
          btn.addEventListener('pointerenter', () => { btn.style.color = this.accentFg; btn.style.textDecoration = 'underline'; });
          btn.addEventListener('pointerleave', () => { btn.style.color = this.mutedFg; btn.style.textDecoration = 'none'; });
          btn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (lens.command?.id) {
              void this.host.executeCommand(lens.command.id, ...(lens.command.arguments ?? []));
            }
          });
          strip.appendChild(btn);
        });

        const id = acc.addZone({
          afterLineNumber: Math.max(0, group.lineNumber - 1),
          heightInPx: 20,
          domNode: strip,
        });
        nextIds.push(id);
      }
    });
    this.zoneIds = nextIds;
  }
}
