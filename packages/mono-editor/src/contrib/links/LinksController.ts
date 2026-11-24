import {
  ContributionIds,
  type IEditorContribution,
  type IEditorContributionHost,
} from '../../browser/editor/editorTypes';
import type { LinkHit } from '../../browser/render/CanvasRenderer';
import type { MonoEditorOptions } from '../../common/config/editorOptions';
import { languageFeatures } from '../../common/languages/languageFeaturesService';
import type { ILink, LinkProvider } from '../../common/languages/providers/types';
import type { TextModel } from '../../common/model/TextModel';
import { MonoCommands } from '../../platform/keybindings/KeybindingService';

const URL_RE = /https?:\/\/[^\s"'`<>()[\]{}]+/gi;

interface TrackedLink {
  link: ILink;
  provider?: LinkProvider;
}

/**
 * LSP Document Links controller (`registerLinkProvider` + built-in URL detection).
 * Renders underlined active links and dispatches `mono:openLink` when Ctrl/Cmd-clicked or invoked via Open Link command.
 */
export class LinksController implements IEditorContribution {
  readonly id = ContributionIds.Links;
  private readonly host: IEditorContributionHost;
  private enabled: boolean;
  private byLine = new Map<number, TrackedLink[]>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  constructor(host: IEditorContributionHost) {
    this.host = host;
    this.enabled = host.initialOptions.links !== false;
    host.view.setLineLinksProvider((ln) =>
      this.enabled ? (this.byLine.get(ln)?.map((t) => t.link) ?? []) : [],
    );

    host.commands.registerCommand(
      MonoCommands.OpenLink,
      () => this.openLinkAtCaret(),
      { title: 'Open Link', category: 'Go' },
    );

    this.scheduleFetch(100);
  }

  onModelChange(_model: TextModel): void {
    this.byLine.clear();
    this.scheduleFetch(80);
  }

  onModelContentChange(_versionId: number): void {
    this.scheduleFetch(180);
  }

  onOptionsChange(patch: Partial<MonoEditorOptions>): void {
    if (patch.links !== undefined) {
      this.enabled = patch.links;
      if (!this.enabled) {
        this.byLine.clear();
        this.host.view.schedulePaint();
      } else {
        this.scheduleFetch(40);
      }
    }
  }

  onLinkClick(hit: LinkHit, _e: PointerEvent): void {
    if (!this.enabled) return;
    const list = this.byLine.get(hit.range.startLineNumber) ?? [];
    const tracked = list.find(
      (t) =>
        t.link.range.startColumn === hit.range.startColumn &&
        t.link.range.endColumn === hit.range.endColumn,
    );
    void this.activateTrackedLink(tracked ?? { link: { range: hit.range, url: hit.url, tooltip: hit.tooltip } });
  }

  async openLinkAtCaret(): Promise<boolean> {
    if (!this.enabled) return false;
    const pos = this.host.getPosition();
    const list = this.byLine.get(pos.lineNumber) ?? [];
    const tracked = list.find(
      (t) => pos.column >= t.link.range.startColumn && pos.column <= t.link.range.endColumn,
    );
    if (!tracked) return false;
    return this.activateTrackedLink(tracked);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.host.view.setLineLinksProvider(null);
    this.byLine.clear();
  }

  private async activateTrackedLink(tracked: TrackedLink): Promise<boolean> {
    let url = tracked.link.url;
    if (!url && tracked.provider?.resolveLink) {
      try {
        const resolved = await Promise.resolve(
          tracked.provider.resolveLink(tracked.link, { isCancellationRequested: false }),
        );
        url = resolved?.url;
      } catch (e) {
        console.warn('[mono resolveLink]', e);
      }
    }
    const urlStr = url ? String(url) : undefined;
    if (!urlStr) return false;
    window.dispatchEvent(
      new CustomEvent('mono:openLink', { detail: { url: urlStr, range: tracked.link.range } }),
    );
    return true;
  }

  private scheduleFetch(delayMs: number): void {
    if (!this.enabled || this.host.isDisposed()) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refreshLinks();
    }, delayMs);
  }

  async refreshLinks(): Promise<void> {
    if (!this.enabled || this.host.isDisposed()) return;
    const my = ++this.seq;
    const model = this.host.getModel();
    const nextMap = new Map<number, TrackedLink[]>();

    // 1. Built-in fast URL detection (bounded for huge files)
    const maxScan = Math.min(model.getLineCount(), 2000);
    for (let ln = 1; ln <= maxScan; ln++) {
      const text = model.getLineContent(ln);
      if (!text.includes('http://') && !text.includes('https://')) continue;
      URL_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = URL_RE.exec(text)) !== null) {
        const raw = m[0].replace(/[.,;:!?]+$/, '');
        if (!raw) continue;
        const arr = nextMap.get(ln) ?? [];
        arr.push({
          link: {
            range: {
              startLineNumber: ln,
              startColumn: m.index + 1,
              endLineNumber: ln,
              endColumn: m.index + 1 + raw.length,
            },
            url: raw,
            tooltip: `Follow link (${raw})`,
          },
        });
        nextMap.set(ln, arr);
      }
    }

    // 2. Registered LinkProviders
    const providers = languageFeatures.getLinkProviders(model.getLanguageId());
    if (providers.length) {
      const modelLike = this.host.modelAsFeatureLike();
      const token = { isCancellationRequested: false };
      for (const p of providers) {
        try {
          const res = await Promise.resolve(p.provideLinks(modelLike, token));
          if (my !== this.seq || this.host.isDisposed()) return;
          const links = Array.isArray(res) ? res : (res?.links ?? []);
          for (const link of links) {
            const ln = link.range.startLineNumber;
            const arr = nextMap.get(ln) ?? [];
            arr.push({ link, provider: p });
            nextMap.set(ln, arr);
          }
        } catch (e) {
          console.warn('[mono links]', e);
        }
      }
    }

    if (my !== this.seq || this.host.isDisposed()) return;
    this.byLine = nextMap;
    this.host.view.schedulePaint();
  }
}
