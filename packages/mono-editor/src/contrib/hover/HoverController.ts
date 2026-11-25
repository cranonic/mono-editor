import type { ViewController } from '../../browser/view/ViewController';
import type { SelectionState } from '../../common/core/SelectionState';
import type { IRange } from '../../common/core/types';
import type { IMarker } from '../../common/decorations/types';
import { languageFeatures } from '../../common/languages/languageFeaturesService';
import type { TextModel } from '../../common/model/TextModel';
import { MonoCommands } from '../../platform/keybindings/KeybindingService';
import type { ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';
import { HoverWidget, type HoverActionItem, type HoverWidgetOptions } from './HoverWidget';

export type HoverTriggerMode = 'click' | 'hover' | 'off';

export interface HoverShowScope {
  includeHover?: boolean;
  includeDiagnostics?: boolean;
}

export interface HoverControllerCallbacks {
  getLanguageIdAtPosition?: (lineNumber: number, column: number) => string;
  getMarkers?: () => IMarker[];
  onRangeChange?: (range: IRange | null) => void;
  executeCommand?: (id: string, ...args: unknown[]) => Promise<unknown>;
  setCaret?: (lineNumber: number, column: number) => void;
}

/**
 * Pure marker range matcher: inclusive of both start and end columns (including zero-width markers).
 */
export function markersAtPosition(markers: readonly IMarker[], line: number, column: number): IMarker[] {
  return markers.filter((m) => {
    if (line < m.startLineNumber || line > m.endLineNumber) return false;
    if (m.startLineNumber === m.endLineNumber) {
      return column >= m.startColumn && column <= m.endColumn;
    }
    if (line === m.startLineNumber) return column >= m.startColumn;
    if (line === m.endLineNumber) return column <= m.endColumn;
    return true;
  });
}

export class HoverController {
  private model: TextModel;
  private selection: SelectionState;
  private view: ViewController;
  private widget: HoverWidget;
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private activeRange: IRange | null = null;
  private sticky = true;
  private cb: HoverControllerCallbacks;

  constructor(
    host: HTMLElement,
    model: TextModel,
    selection: SelectionState,
    view: ViewController,
    options?: HoverWidgetOptions,
    callbacks?: HoverControllerCallbacks | ((lineNumber: number, column: number) => string),
  ) {
    this.model = model;
    this.selection = selection;
    this.view = view;
    this.cb =
      typeof callbacks === 'function'
        ? { getLanguageIdAtPosition: callbacks }
        : (callbacks ?? {});
    this.widget = new HoverWidget(host, {
      ...options,
      onMouseEnter: () => this.cancelHideTimer(),
      onMouseLeave: () => {
        if (this.sticky) this.scheduleHide(180);
      },
    });
  }

  setModel(model: TextModel): void {
    this.hide();
    this.model = model;
  }

  setSticky(sticky: boolean): void {
    this.sticky = sticky;
  }

  setWidgetOptions(o: HoverWidgetOptions): void {
    this.widget.setOptions(o);
  }

  applyTheme(theme: ResolvedWidgetTheme): void {
    this.widget.applyTheme(theme);
  }

  getActiveRange(): IRange | null {
    return this.activeRange;
  }

  isPointerInside(): boolean {
    return this.widget.isPointerInside();
  }

  containsNode(node: Node | null): boolean {
    return this.widget.containsNode(node);
  }

  hasDiagnosticsAt(line: number, column: number): boolean {
    const markers = this.cb.getMarkers?.() ?? [];
    return markersAtPosition(markers, line, column).length > 0;
  }

  /** Dwell / tap-delayed hover & diagnostics trigger. */
  schedule(line: number, column: number, delayMs = 300, scope?: HoverShowScope): void {
    this.cancelTimer();
    this.showTimer = setTimeout(() => {
      this.showTimer = null;
      void this.showAt(line, column, scope);
    }, delayMs);
  }

  scheduleHide(delayMs = 180): void {
    this.cancelHideTimer();
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      if (this.sticky && this.widget.isPointerInside()) return;
      this.hide();
    }, delayMs);
  }

  cancelTimer(): void {
    if (this.showTimer) {
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }
  }

  cancelHideTimer(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  isOpen(): boolean {
    return this.widget.isVisible();
  }

  hide(): void {
    ++this.seq;
    this.cancelTimer();
    this.cancelHideTimer();
    this.widget.hide();
    if (this.activeRange !== null) {
      this.activeRange = null;
      this.cb.onRangeChange?.(null);
    }
  }

  async showAt(line: number, column: number, scope?: HoverShowScope): Promise<boolean> {
    const includeHover = scope?.includeHover ?? true;
    const includeDiagnostics = scope?.includeDiagnostics ?? true;
    if (!includeHover && !includeDiagnostics) {
      this.hide();
      return false;
    }

    const my = ++this.seq;
    this.cancelTimer();
    this.cancelHideTimer();

    const lang = this.cb.getLanguageIdAtPosition?.(line, column) ?? this.model.getLanguageId();
    const modelLike = {
      getValue: () => this.model.getValue(),
      getLineContent: (n: number) => this.model.getLineContent(n),
      getLineCount: () => this.model.getLineCount(),
      getOffsetAt: (l: number, c: number) => this.model.getOffsetAt(l, c),
      getPositionAt: (o: number) => this.model.getPositionAt(o),
      getLanguageId: () => lang,
    };

    // 1. Collect overlapping diagnostics at (line, column) if enabled for this trigger
    const markers = includeDiagnostics ? (this.cb.getMarkers?.() ?? []) : [];
    const diagnostics = includeDiagnostics ? markersAtPosition(markers, line, column) : [];

    // 2. Collect HoverProvider contents & hover.range if enabled for this trigger
    const parts: string[] = [];
    let resolvedRange: IRange | null = null;
    if (includeHover) {
      const providers = languageFeatures.getHoverProviders(lang);
      const token = { isCancellationRequested: false };
      for (const p of providers) {
        try {
          const h = await Promise.resolve(
            p.provideHover(modelLike, { lineNumber: line, column }, token),
          );
          if (my !== this.seq) return false;
          if (!h?.contents) continue;
          if (!resolvedRange && h.range) resolvedRange = h.range;
          const raw = h.contents;
          const arr = Array.isArray(raw) ? raw : [raw];
          for (const c of arr) {
            const val = typeof c === 'string' ? c : (c as { value?: string }).value || '';
            if (val) parts.push(val);
          }
        } catch (e) {
          console.warn('[mono hover]', e);
        }
      }
    }

    if (!diagnostics.length && !parts.length) {
      this.hide();
      return false;
    }

    if (!resolvedRange && diagnostics.length > 0) {
      const m0 = diagnostics[0]!;
      resolvedRange = {
        startLineNumber: m0.startLineNumber,
        startColumn: m0.startColumn,
        endLineNumber: m0.endLineNumber,
        endColumn: m0.endColumn,
      };
    }

    // 3. Build footer actions: when only diagnostics are active, expose only Quick Fix
    const actions: HoverActionItem[] = [];
    if (this.cb.executeCommand) {
      const runAtHoverPos = (cmdId: string) => {
        this.hide();
        this.cb.setCaret?.(line, column);
        void this.cb.executeCommand?.(cmdId);
      };
      if (diagnostics.length > 0 || (includeHover && languageFeatures.getCodeActionProviders(lang).length > 0)) {
        actions.push({
          label: 'Quick Fix...',
          title: 'Show Code Actions / Quick Fixes (Ctrl+.)',
          run: () => runAtHoverPos(MonoCommands.QuickFix),
        });
      }
      if (includeHover && parts.length > 0) {
        if (languageFeatures.getDefinitionProviders(lang).length > 0) {
          actions.push({
            label: 'Go to Definition',
            title: 'Go to Definition (F12)',
            run: () => runAtHoverPos(MonoCommands.RevealDefinition),
          });
        }
        if (languageFeatures.getReferenceProviders(lang).length > 0) {
          actions.push({
            label: 'Peek References',
            title: 'Find All References (Shift+F12)',
            run: () => runAtHoverPos(MonoCommands.ReferenceSearch),
          });
        }
      }
    }

    this.activeRange = resolvedRange;
    this.cb.onRangeChange?.(resolvedRange);

    const anchorCol = resolvedRange ? resolvedRange.startColumn : column;
    const anchorLine = resolvedRange ? resolvedRange.startLineNumber : line;
    const pos = this.view.screenPosOf(anchorLine, anchorCol);
    this.widget.showCard(
      { diagnostics, contents: parts, actions },
      { x: Math.max(0, pos.x), y: Math.max(0, pos.y + pos.h), top: Math.max(0, pos.y) },
    );
    return true;
  }

  dispose(): void {
    this.hide();
    this.widget.dispose();
  }
}
