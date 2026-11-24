import type { TextModel } from '../../common/model/TextModel';
import type { SelectionState } from '../../common/core/SelectionState';
import type { ViewController } from '../../browser/view/ViewController';
import { languageFeatures } from '../../common/languages/languageFeaturesService';
import { HoverWidget, type HoverWidgetOptions } from './HoverWidget';
import type { ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';

export class HoverController {
  private model: TextModel;
  private selection: SelectionState;
  private view: ViewController;
  private widget: HoverWidget;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private getLanguageIdAtPosition?: (lineNumber: number, column: number) => string;

  constructor(
    host: HTMLElement,
    model: TextModel,
    selection: SelectionState,
    view: ViewController,
    options?: HoverWidgetOptions,
    getLanguageIdAtPosition?: (lineNumber: number, column: number) => string,
  ) {
    this.model = model;
    this.selection = selection;
    this.view = view;
    this.widget = new HoverWidget(host, options);
    this.getLanguageIdAtPosition = getLanguageIdAtPosition;
  }

  setModel(model: TextModel): void {
    this.hide();
    this.model = model;
  }

  setWidgetOptions(o: HoverWidgetOptions): void {
    this.widget.setOptions(o);
  }

  applyTheme(theme: ResolvedWidgetTheme): void {
    this.widget.applyTheme(theme);
  }

  /** Long-press / dwell at position */
  schedule(line: number, column: number, delayMs = 400): void {
    this.cancelTimer();
    this.timer = setTimeout(() => {
      void this.showAt(line, column);
    }, delayMs);
  }

  cancelTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  isOpen(): boolean {
    return this.widget.isVisible();
  }

  hide(): void {
    ++this.seq;
    this.cancelTimer();
    this.widget.hide();
  }

  async showAt(line: number, column: number): Promise<void> {
    const my = ++this.seq;
    const lang = this.getLanguageIdAtPosition?.(line, column) ?? this.model.getLanguageId();
    const providers = languageFeatures.getHoverProviders(lang);
    const modelLike = {
      getValue: () => this.model.getValue(),
      getLineContent: (n: number) => this.model.getLineContent(n),
      getLineCount: () => this.model.getLineCount(),
      getOffsetAt: (l: number, c: number) => this.model.getOffsetAt(l, c),
      getPositionAt: (o: number) => this.model.getPositionAt(o),
      getLanguageId: () => lang,
    };
    const token = { isCancellationRequested: false };
    const parts: string[] = [];
    for (const p of providers) {
      try {
        const h = await Promise.resolve(
          p.provideHover(modelLike, { lineNumber: line, column }, token),
        );
        if (my !== this.seq) return;
        if (!h?.contents) continue;
        const raw = h.contents;
        const arr = Array.isArray(raw) ? raw : [raw];
        if (!arr.length) continue;
        for (const c of arr) {
          parts.push(typeof c === 'string' ? c : (c as any).value || '');
        }
      } catch (e) {
        console.warn('[mono hover]', e);
      }
    }
    if (!parts.length) {
      this.widget.hide();
      return;
    }
    const pos = this.view.screenPosOf(line, column);
    this.widget.show(parts, { x: Math.max(0, pos.x), y: Math.max(0, pos.y + pos.h) });
  }

  dispose(): void {
    this.hide();
    this.widget.dispose();
  }
}
