import {
  ContributionIds,
  type IEditorContribution,
  type IEditorContributionHost,
} from '../../browser/editor/editorTypes';
import type { InputChangeEvent } from '../../browser/input/InputController';
import type { PointerInteractKind } from '../../browser/input/pointer/PointerController';
import type { ColorHit } from '../../browser/render/CanvasRenderer';
import type { MonoEditorOptions } from '../../common/config/editorOptions';
import type { TextModel } from '../../common/model/TextModel';
import { MonoCommands } from '../../platform/keybindings/KeybindingService';
import type { ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';
import { HoverController, type HoverTriggerMode } from './HoverController';

function detectCoarsePointer(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(window.matchMedia?.('(pointer: coarse)').matches);
  } catch {
    return false;
  }
}

export function resolveHoverAndDiagnosticsTriggers(
  options: Pick<MonoEditorOptions, 'hover' | 'diagnostics'>,
  isCoarsePointer: boolean,
): { hoverTrigger: HoverTriggerMode; diagnosticsPopup: HoverTriggerMode } {
  const h = options.hover;
  let hoverTrigger: HoverTriggerMode;
  if (h?.trigger !== undefined) {
    hoverTrigger = h.trigger;
  } else if (h?.enabled === false) {
    hoverTrigger = 'off';
  } else if (h?.openOnMouseHover === true) {
    hoverTrigger = 'hover';
  } else if (h?.openOnMouseHover === false) {
    hoverTrigger = 'click';
  } else {
    hoverTrigger = isCoarsePointer ? 'click' : 'hover';
  }

  const diagnosticsPopup: HoverTriggerMode =
    options.diagnostics?.popup !== undefined ? options.diagnostics.popup : hoverTrigger;

  return { hoverTrigger, diagnosticsPopup };
}

export class HoverContribution implements IEditorContribution {
  readonly id = ContributionIds.Hover;
  private readonly host: IEditorContributionHost;
  private readonly hover: HoverController;
  private hoverTrigger: HoverTriggerMode;
  private diagnosticsPopup: HoverTriggerMode;
  private explicitHoverTrigger: HoverTriggerMode | undefined;
  private explicitDiagnosticsPopup: HoverTriggerMode | undefined;
  private delayMs: number;
  private lastMousePosKey = '';
  private lastTapPointerType = 'mouse';
  private tapScheduleGuardUntil = 0;
  private tapScheduledKey = '';

  constructor(host: IEditorContributionHost) {
    this.host = host;
    const resolved = resolveHoverAndDiagnosticsTriggers(host.initialOptions, detectCoarsePointer());
    this.hoverTrigger = resolved.hoverTrigger;
    this.diagnosticsPopup = resolved.diagnosticsPopup;
    this.explicitHoverTrigger = host.initialOptions.hover?.trigger;
    this.explicitDiagnosticsPopup = host.initialOptions.diagnostics?.popup;
    this.delayMs = host.initialOptions.hover?.delay ?? 300;

    this.hover = new HoverController(
      host.root,
      host.getModel(),
      host.selection,
      host.view,
      {
        fontSize: host.getFontSize(),
        fontFamily: host.getFontFamily(),
      },
      {
        getLanguageIdAtPosition: (ln, col) => host.getLanguageIdAtPosition(ln, col),
        getMarkers: () => host.getMarkers(),
        onRangeChange: () => host.view.schedulePaint(),
        executeCommand: (id, ...args) => host.executeCommand(id, ...args),
        setCaret: (ln, col) => host.setPosition(ln, col),
      },
    );
    this.hover.setSticky(host.initialOptions.hover?.sticky !== false);

    host.view.setHoverRangeProvider(() => this.hover.getActiveRange());

    host.keybindings.add({
      id: MonoCommands.ShowHover,
      primary: 'ctrl+k',
      weight: 4,
      handler: () => {
        const p = this.host.getPosition();
        void this.hover.showAt(p.lineNumber, p.column, { includeHover: true, includeDiagnostics: true });
      },
    });
    host.commands.registerCommand(
      MonoCommands.ShowHover,
      () => {
        const p = this.host.getPosition();
        return this.hover.showAt(p.lineNumber, p.column, { includeHover: true, includeDiagnostics: true });
      },
      { title: 'Show Hover Docs', category: 'View' },
    );

    host.root.addEventListener('pointerdown', this.onRootPointerDown, { passive: true });
    host.root.addEventListener('pointermove', this.onPointerMove, { passive: true });
    host.root.addEventListener('pointerleave', this.onPointerLeave);
  }

  showAtCaret(): Promise<boolean> {
    const p = this.host.getPosition();
    return this.hover.showAt(p.lineNumber, p.column, { includeHover: true, includeDiagnostics: true });
  }

  onKeyDown(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' && this.hover.isOpen()) {
      this.clearTapGuard();
      this.hover.hide();
      return true;
    }
    return false;
  }

  shouldAllowWheelTarget(target: Node): boolean {
    return this.hover.isOpen() && this.hover.containsNode(target);
  }

  onInputChange(_ev: InputChangeEvent): void {
    this.clearTapGuard();
    this.hover.hide();
  }

  onCursorChange(source: string): void {
    const p = this.host.selection.active;
    const key = `${p.lineNumber}:${p.column}`;
    if (Date.now() < this.tapScheduleGuardUntil && key === this.tapScheduledKey) {
      return;
    }
    if (source !== 'mouse') this.clearTapGuard();
    this.hover.hide();
  }

  onScroll(): void {
    // Soft-keyboard open or layout resize right after a tap can trigger programmatic scroll/ensureCaretVisible;
    // keep the tap-triggered hover alive and aligned during the guard window (user drag/wheel scrolls go through onPointerInteract('scroll')).
    if (Date.now() < this.tapScheduleGuardUntil) {
      if (this.hover.isOpen()) this.hover.reposition();
      return;
    }
    this.hover.hide();
  }

  onLayout(): void {
    if (this.hover.isOpen()) this.hover.reposition();
  }

  onOutsidePointerDown(): void {
    this.clearTapGuard();
    this.hover.hide();
  }

  onPointerTapMeta(info: { clientX: number; clientY: number; pointerType: string }): void {
    this.lastTapPointerType = info.pointerType || 'mouse';
  }

  onPointerInteract(kind: PointerInteractKind): void {
    if (kind === 'scroll' || kind === 'handleTap' || kind === 'select') {
      this.clearTapGuard();
      this.hover.hide();
      return;
    }
    if (kind === 'handle') {
      this.hover.hide();
      if (!this.host.selection.isEmpty) {
        this.clearTapGuard();
        return;
      }
      const scope = this.resolveTapScope();
      if (scope.includeHover || scope.includeDiagnostics) {
        const p = this.host.selection.active;
        this.tapScheduledKey = `${p.lineNumber}:${p.column}`;
        this.tapScheduleGuardUntil = Date.now() + 900;
        this.hover.schedule(p.lineNumber, p.column, 160, scope);
      }
      return;
    }
    if (kind === 'tap') {
      this.hover.hide();
      const scope = this.resolveTapScope();
      if (scope.includeHover || scope.includeDiagnostics) {
        const p = this.host.selection.active;
        this.tapScheduledKey = `${p.lineNumber}:${p.column}`;
        this.tapScheduleGuardUntil = Date.now() + 900;
        void this.hover.showAt(p.lineNumber, p.column, scope);
      }
    }
  }

  onColorSwatchClick(_hit: ColorHit): void {
    this.clearTapGuard();
    this.hover.hide();
  }

  onModelChange(model: TextModel): void {
    this.clearTapGuard();
    this.hover.hide();
    this.hover.setModel(model);
  }

  onOptionsChange(patch: Partial<MonoEditorOptions>): void {
    if (patch.fontSize != null || patch.fontFamily != null) {
      this.hover.setWidgetOptions({
        fontSize: this.host.getFontSize(),
        fontFamily: this.host.getFontFamily(),
      });
    }
    if (!patch.hover && !patch.diagnostics) return;
    if (patch.hover) {
      if ('trigger' in patch.hover) {
        this.explicitHoverTrigger = patch.hover.trigger;
      }
      if (patch.hover.trigger !== undefined) {
        this.hoverTrigger = patch.hover.trigger;
      } else if (patch.hover.enabled === false) {
        this.hoverTrigger = 'off';
      } else if (patch.hover.openOnMouseHover === true) {
        this.hoverTrigger = 'hover';
      } else if (patch.hover.openOnMouseHover === false) {
        this.hoverTrigger = 'click';
      } else if ('trigger' in patch.hover || patch.hover.enabled === true) {
        this.hoverTrigger = detectCoarsePointer() ? 'click' : 'hover';
      }
      if (patch.hover.delay !== undefined) this.delayMs = Math.max(0, patch.hover.delay);
      if (patch.hover.sticky !== undefined) this.hover.setSticky(patch.hover.sticky);
    }
    if (patch.diagnostics && 'popup' in patch.diagnostics) {
      this.explicitDiagnosticsPopup = patch.diagnostics.popup;
    }
    if (this.explicitDiagnosticsPopup !== undefined) {
      this.diagnosticsPopup = this.explicitDiagnosticsPopup;
    } else {
      this.diagnosticsPopup = this.hoverTrigger;
    }
    if (this.hoverTrigger === 'off' && this.diagnosticsPopup === 'off') {
      this.clearTapGuard();
      this.hover.hide();
    }
  }

  onThemeChange(wt: ResolvedWidgetTheme): void {
    this.hover.applyTheme(wt);
  }

  dispose(): void {
    this.host.root.removeEventListener('pointerdown', this.onRootPointerDown);
    this.host.root.removeEventListener('pointermove', this.onPointerMove);
    this.host.root.removeEventListener('pointerleave', this.onPointerLeave);
    this.host.view.setHoverRangeProvider(null);
    this.hover.dispose();
  }

  private resolveTapScope(): { includeHover: boolean; includeDiagnostics: boolean } {
    const isTouchTap = this.lastTapPointerType === 'touch' || this.lastTapPointerType === 'pen';
    const autoHoverOnTouch =
      this.explicitHoverTrigger === undefined && this.hoverTrigger !== 'off' && isTouchTap;
    const autoDiagOnTouch =
      this.explicitDiagnosticsPopup === undefined && this.diagnosticsPopup !== 'off' && isTouchTap;
    return {
      includeHover: this.hoverTrigger === 'click' || autoHoverOnTouch,
      includeDiagnostics: this.diagnosticsPopup === 'click' || autoDiagOnTouch,
    };
  }

  private clearTapGuard(): void {
    this.tapScheduleGuardUntil = 0;
    this.tapScheduledKey = '';
  }

  private onRootPointerDown = (e: PointerEvent): void => {
    if (this.host.isDisposed()) return;
    if (e.pointerType) this.lastTapPointerType = e.pointerType;
    const target = e.target as Node | null;
    if (this.hover.containsNode(target)) return;
    // Cancel any pending tap-hover if a second tap (double-tap) or new gesture starts
    this.clearTapGuard();
    this.hover.cancelTimer();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse' || this.host.isDisposed()) return;
    const includeHover = this.hoverTrigger === 'hover';
    const includeDiagnostics = this.diagnosticsPopup === 'hover';
    if (!includeHover && !includeDiagnostics) return;

    const target = e.target as Node | null;
    if (this.hover.containsNode(target)) {
      this.hover.cancelHideTimer();
      return;
    }
    const rect = this.host.root.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    if (localX < this.host.view.contentLeft) {
      this.hover.cancelTimer();
      if (this.hover.isOpen()) this.hover.scheduleHide(150);
      return;
    }

    const pos = this.host.view.positionAtPoint(localX, localY, false);
    const key = `${pos.lineNumber}:${pos.column}`;
    if (key === this.lastMousePosKey) return;
    this.lastMousePosKey = key;

    const active = this.hover.getActiveRange();
    if (active && this.hover.isOpen()) {
      const insideRange =
        pos.lineNumber >= active.startLineNumber &&
        pos.lineNumber <= active.endLineNumber &&
        (pos.lineNumber !== active.startLineNumber || pos.column >= active.startColumn) &&
        (pos.lineNumber !== active.endLineNumber || pos.column <= active.endColumn);
      if (!insideRange) this.hover.scheduleHide(220);
      else return;
    }

    const hasDiag = includeDiagnostics && this.hover.hasDiagnosticsAt(pos.lineNumber, pos.column);
    const hasWord = includeHover && Boolean(this.host.wordAtPosition(pos.lineNumber, pos.column));
    if (!hasWord && !hasDiag) {
      this.hover.cancelTimer();
      return;
    }
    this.hover.schedule(pos.lineNumber, pos.column, this.delayMs, {
      includeHover,
      includeDiagnostics,
    });
  };

  private onPointerLeave = (e: PointerEvent): void => {
    // Touch browsers emit pointerleave immediately after every touch pointerup — never cancel tap hover on touch!
    if (e.pointerType !== 'mouse') return;
    this.lastMousePosKey = '';
    if (this.hoverTrigger !== 'hover' && this.diagnosticsPopup !== 'hover') return;
    this.hover.cancelTimer();
    if (this.hover.isOpen()) this.hover.scheduleHide(180);
  };
}
