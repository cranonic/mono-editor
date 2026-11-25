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
  private explicitDiagnosticsPopup: HoverTriggerMode | undefined;
  private delayMs: number;
  private lastMousePosKey = '';

  constructor(host: IEditorContributionHost) {
    this.host = host;
    const resolved = resolveHoverAndDiagnosticsTriggers(host.initialOptions, detectCoarsePointer());
    this.hoverTrigger = resolved.hoverTrigger;
    this.diagnosticsPopup = resolved.diagnosticsPopup;
    this.explicitDiagnosticsPopup = host.initialOptions.diagnostics?.popup;
    this.delayMs = host.initialOptions.hover?.delay ?? 300;

    this.hover = new HoverController(
      host.root,
      host.getModel(),
      host.selection,
      host.view,
      undefined,
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

    host.root.addEventListener('pointermove', this.onPointerMove, { passive: true });
    host.root.addEventListener('pointerleave', this.onPointerLeave);
  }

  showAtCaret(): Promise<boolean> {
    const p = this.host.getPosition();
    return this.hover.showAt(p.lineNumber, p.column, { includeHover: true, includeDiagnostics: true });
  }

  onKeyDown(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' && this.hover.isOpen()) {
      this.hover.hide();
      return true;
    }
    return false;
  }

  shouldAllowWheelTarget(target: Node): boolean {
    return this.hover.isOpen() && this.hover.containsNode(target);
  }

  onInputChange(_ev: InputChangeEvent): void {
    this.hover.hide();
  }

  onCursorChange(_source: string): void {
    this.hover.hide();
  }

  onScroll(): void {
    this.hover.hide();
  }

  onOutsidePointerDown(): void {
    this.hover.hide();
  }

  onPointerInteract(kind: PointerInteractKind): void {
    if (kind === 'tap' || kind === 'handle' || kind === 'handleTap' || kind === 'select') {
      this.hover.hide();
    }
    if (kind === 'tap') {
      const includeHover = this.hoverTrigger === 'click';
      const includeDiagnostics = this.diagnosticsPopup === 'click';
      if (includeHover || includeDiagnostics) {
        const p = this.host.selection.active;
        this.hover.schedule(p.lineNumber, p.column, Math.max(250, this.delayMs), {
          includeHover,
          includeDiagnostics,
        });
      }
    }
  }

  onColorSwatchClick(_hit: ColorHit): void {
    this.hover.hide();
  }

  onModelChange(model: TextModel): void {
    this.hover.hide();
    this.hover.setModel(model);
  }

  onOptionsChange(patch: Partial<MonoEditorOptions>): void {
    if (!patch.hover && !patch.diagnostics) return;
    if (patch.hover) {
      if (patch.hover.trigger !== undefined) {
        this.hoverTrigger = patch.hover.trigger;
      } else if (patch.hover.enabled === false) {
        this.hoverTrigger = 'off';
      } else if (patch.hover.enabled === true && this.hoverTrigger === 'off') {
        this.hoverTrigger = detectCoarsePointer() ? 'click' : 'hover';
      } else if (patch.hover.openOnMouseHover === true) {
        this.hoverTrigger = 'hover';
      } else if (patch.hover.openOnMouseHover === false) {
        this.hoverTrigger = 'click';
      }
      if (patch.hover.delay !== undefined) this.delayMs = Math.max(0, patch.hover.delay);
      if (patch.hover.sticky !== undefined) this.hover.setSticky(patch.hover.sticky);
    }
    if (patch.diagnostics?.popup !== undefined) {
      this.explicitDiagnosticsPopup = patch.diagnostics.popup;
      this.diagnosticsPopup = patch.diagnostics.popup;
    } else if (this.explicitDiagnosticsPopup === undefined) {
      this.diagnosticsPopup = this.hoverTrigger;
    }
    if (this.hoverTrigger === 'off' && this.diagnosticsPopup === 'off') {
      this.hover.hide();
    }
  }

  onThemeChange(wt: ResolvedWidgetTheme): void {
    this.hover.applyTheme(wt);
  }

  dispose(): void {
    this.host.root.removeEventListener('pointermove', this.onPointerMove);
    this.host.root.removeEventListener('pointerleave', this.onPointerLeave);
    this.host.view.setHoverRangeProvider(null);
    this.hover.dispose();
  }

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

  private onPointerLeave = (): void => {
    this.lastMousePosKey = '';
    this.hover.cancelTimer();
    if (this.hover.isOpen()) this.hover.scheduleHide(180);
  };
}
