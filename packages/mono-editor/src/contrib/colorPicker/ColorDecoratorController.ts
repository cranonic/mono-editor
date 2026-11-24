import {
  ContributionIds,
  type IEditorContribution,
  type IEditorContributionHost,
} from '../../browser/editor/editorTypes';
import type { ColorHit } from '../../browser/render/CanvasRenderer';
import { detectLineColors } from '../../common/color/colorDecoratorRules';
import type { ColorDecoratorRules, ColorMatch } from '../../common/color/colorTypes';
import type { MonoEditorOptions } from '../../common/config/editorOptions';
import { languageFeatures } from '../../common/languages/languageFeaturesService';
import type { TextModel } from '../../common/model/TextModel';
import type { ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';
import { ColorPickerWidget } from './ColorPickerWidget';

export class ColorDecoratorController implements IEditorContribution {
  readonly id = ContributionIds.ColorDecorator;
  private readonly host: IEditorContributionHost;
  private readonly picker: ColorPickerWidget;
  private enabled: boolean;
  private openOnHover: boolean;
  private rules: ColorDecoratorRules | undefined;
  private cacheVersion = -1;
  private lineCache = new Map<number, ColorMatch[]>();
  private providerColorsByLine = new Map<number, ColorMatch[]>();
  private providerTimer: ReturnType<typeof setTimeout> | null = null;
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  private lastHoverKey: string | null = null;

  constructor(host: IEditorContributionHost) {
    this.host = host;
    this.enabled = host.initialOptions.colorDecorators !== false;
    // Defaults strictly to `false` so mobile scrolling / resting fingers never accidentally open color palettes.
    this.openOnHover = host.initialOptions.colorDecoratorsOpenOnHover === true;
    this.rules = host.initialOptions.colorDecoratorsRules;
    this.picker = new ColorPickerWidget(host.root);

    host.view.setLineColorsProvider((ln) => this.getLineColorMatches(ln));
    host.root.addEventListener('pointermove', this.onRootPointerMove, { passive: true });
    host.root.addEventListener('pointerleave', this.onRootPointerLeave);
    this.scheduleProviderColors();
  }

  isOpenOnHover(): boolean {
    return this.openOnHover;
  }

  onKeyDown(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' && this.picker.isOpen()) {
      this.picker.close(true);
      return true;
    }
    return false;
  }

  shouldAllowWheelTarget(target: Node): boolean {
    return this.picker.isOpen() && Boolean((target as Element).closest?.('.mono-color-picker'));
  }

  onScroll(): void {
    this.cancelHoverTimer();
    if (this.picker.isOpen()) this.picker.close(true);
  }

  onModelChange(_model: TextModel): void {
    this.cancelHoverTimer();
    this.picker.close(false);
    this.invalidateCache();
  }

  onModelContentChange(versionId: number): void {
    this.lineCache.clear();
    this.cacheVersion = versionId;
    this.scheduleProviderColors();
  }

  onThemeChange(wt: ResolvedWidgetTheme): void {
    this.picker.applyTheme(wt);
  }

  onOptionsChange(patch: Partial<MonoEditorOptions>): void {
    let dirty = false;
    if (patch.colorDecorators !== undefined) {
      this.enabled = patch.colorDecorators;
      dirty = true;
    }
    if (patch.colorDecoratorsOpenOnHover !== undefined) {
      this.openOnHover = patch.colorDecoratorsOpenOnHover === true;
      if (!this.openOnHover) this.cancelHoverTimer();
    }
    if (patch.colorDecoratorsRules !== undefined) {
      this.rules = patch.colorDecoratorsRules;
      dirty = true;
    }
    if (dirty) this.invalidateCache();
  }

  onColorSwatchClick(hit: ColorHit): void {
    this.cancelHoverTimer();
    this.openPickerForHit(hit);
  }

  dispose(): void {
    this.cancelHoverTimer();
    this.host.root.removeEventListener('pointermove', this.onRootPointerMove);
    this.host.root.removeEventListener('pointerleave', this.onRootPointerLeave);
    this.host.view.setLineColorsProvider(null);
    if (this.providerTimer) clearTimeout(this.providerTimer);
    this.providerTimer = null;
    this.picker.dispose();
  }

  private onRootPointerMove = (e: PointerEvent): void => {
    // Opt-in desktop mouse hover only; never triggers on touch or when disabled (default).
    if (!this.enabled || !this.openOnHover || e.pointerType !== 'mouse' || this.host.isDisposed()) {
      return;
    }
    const target = e.target as Element | null;
    if (target?.closest?.('.mono-color-picker')) return;

    const rect = this.host.root.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    const hit = this.host.view
      .getColorHits()
      .find(
        (ch) =>
          localX >= ch.x - 3 &&
          localX <= ch.x + ch.w + 3 &&
          localY >= ch.y - 3 &&
          localY <= ch.y + ch.h + 3,
      );

    if (!hit) {
      this.cancelHoverTimer();
      this.lastHoverKey = null;
      return;
    }

    const key = `${hit.match.lineNumber}:${hit.match.startColumn}`;
    if (this.lastHoverKey === key && (this.picker.isOpen() || this.hoverTimer)) return;
    this.lastHoverKey = key;
    this.cancelHoverTimer();
    this.hoverTimer = setTimeout(() => {
      this.hoverTimer = null;
      if (!this.openOnHover || this.host.isDisposed()) return;
      this.openPickerForHit(hit);
    }, 260);
  };

  private onRootPointerLeave = (): void => {
    this.cancelHoverTimer();
    this.lastHoverKey = null;
  };

  private cancelHoverTimer(): void {
    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
  }

  private openPickerForHit(hit: ColorHit): void {
    const model = this.host.getModel();
    const { match } = hit;
    const initialStartOff = model.getOffsetAt(match.lineNumber, match.startColumn);
    const initialEndOff = model.getOffsetAt(match.lineNumber, match.endColumn);
    const initialText = model.getValue().slice(initialStartOff, initialEndOff);
    let currentEndOff = initialEndOff;
    let latestText = initialText;
    let changed = false;

    this.picker.open(
      match,
      { x: hit.x, y: hit.y + hit.h + 4, top: hit.y },
      {
        onColorChange: (newText) => {
          if (this.host.isReadOnly() || this.host.isDisposed()) return;
          if (newText === latestText) return;
          model.applyEdit({ startOffset: initialStartOff, endOffset: currentEndOff, text: newText }, false);
          currentEndOff = initialStartOff + newText.length;
          latestText = newText;
          changed = true;
          this.lineCache.clear();
          this.host.view.paint();
          this.host.emitContent();
        },
        onClose: () => {
          if (!changed || this.host.isReadOnly() || this.host.isDisposed()) return;
          model.applyEdit({ startOffset: initialStartOff, endOffset: currentEndOff, text: initialText }, false);
          if (latestText !== initialText) {
            model.replaceRange(initialStartOff, initialEndOff, latestText, undefined, 'other');
            this.lineCache.clear();
            this.host.view.paint();
            this.host.emitContent();
          }
        },
      },
    );
  }

  private invalidateCache(): void {
    this.lineCache.clear();
    this.providerColorsByLine.clear();
    this.scheduleProviderColors();
  }

  private getLineColorMatches(lineNumber: number): ColorMatch[] {
    if (!this.enabled) return [];
    const model = this.host.getModel();
    const ver = model.getVersionId();
    if (this.cacheVersion !== ver) {
      this.cacheVersion = ver;
      this.lineCache.clear();
    }
    const cached = this.lineCache.get(lineNumber);
    if (cached) return cached;

    const tokens = this.host.tokenization.getLineTokens(model, lineNumber);
    const extra = this.providerColorsByLine.get(lineNumber);
    const matches = detectLineColors(model, lineNumber, tokens, this.rules, extra);
    this.lineCache.set(lineNumber, matches);
    return matches;
  }

  private scheduleProviderColors(): void {
    if (!this.enabled || this.host.isDisposed()) return;
    const model = this.host.getModel();
    const providers = languageFeatures.getColorProviders(model.getLanguageId());
    if (!providers.length) return;
    if (this.providerTimer) clearTimeout(this.providerTimer);
    this.providerTimer = setTimeout(() => {
      if (this.host.isDisposed()) return;
      void (async () => {
        const modelLike = this.host.modelAsFeatureLike();
        const token = { isCancellationRequested: false };
        const nextMap = new Map<number, ColorMatch[]>();
        const activeModel = this.host.getModel();
        for (const p of providers) {
          try {
            const items = await Promise.resolve(p.provideDocumentColors(modelLike, token));
            if (!items?.length) continue;
            for (const info of items) {
              const ln = info.range.startLineNumber;
              if (ln < 1 || ln > activeModel.getLineCount()) continue;
              const line = activeModel.getLineContent(ln);
              const rawText = line.slice(info.range.startColumn - 1, info.range.endColumn - 1);
              const list = nextMap.get(ln) ?? [];
              list.push({
                lineNumber: ln,
                startColumn: info.range.startColumn,
                endColumn: info.range.endColumn,
                rawText,
                format: 'hex',
                rgba: {
                  r: Math.round(info.color.red * 255),
                  g: Math.round(info.color.green * 255),
                  b: Math.round(info.color.blue * 255),
                  a: info.color.alpha,
                },
              });
              nextMap.set(ln, list);
            }
          } catch (err) {
            console.warn('[mono color provider]', err);
          }
        }
        if (this.host.isDisposed()) return;
        this.providerColorsByLine = nextMap;
        this.lineCache.clear();
        this.host.view.paint();
      })();
    }, 120);
  }
}
