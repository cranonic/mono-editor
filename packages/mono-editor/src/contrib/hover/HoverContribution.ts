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
import { HoverController } from './HoverController';

export class HoverContribution implements IEditorContribution {
  readonly id = ContributionIds.Hover;
  private readonly host: IEditorContributionHost;
  private readonly hover: HoverController;
  private enabled: boolean;
  private delayMs: number;
  private openOnMouseHover: boolean;
  private lastMousePosKey = '';

  constructor(host: IEditorContributionHost) {
    this.host = host;
    const hOpts = host.initialOptions.hover;
    this.enabled = hOpts?.enabled !== false;
    this.delayMs = hOpts?.delay ?? 300;
    this.openOnMouseHover = hOpts?.openOnMouseHover !== false;

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
    this.hover.setSticky(hOpts?.sticky !== false);

    host.view.setHoverRangeProvider(() => this.hover.getActiveRange());

    host.keybindings.add({
      id: MonoCommands.ShowHover,
      primary: 'ctrl+k',
      weight: 4,
      handler: () => {
        const p = this.host.getPosition();
        void this.hover.showAt(p.lineNumber, p.column);
      },
    });
    host.commands.registerCommand(
      MonoCommands.ShowHover,
      () => {
        const p = this.host.getPosition();
        return this.hover.showAt(p.lineNumber, p.column);
      },
      { title: 'Show Hover Docs', category: 'View' },
    );

    host.root.addEventListener('pointermove', this.onPointerMove, { passive: true });
    host.root.addEventListener('pointerleave', this.onPointerLeave);
  }

  showAtCaret(): Promise<boolean> {
    const p = this.host.getPosition();
    return this.hover.showAt(p.lineNumber, p.column);
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
    if (kind === 'tap' && this.enabled) {
      const p = this.host.selection.active;
      this.hover.schedule(p.lineNumber, p.column, Math.max(350, this.delayMs));
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
    if (!patch.hover) return;
    if (patch.hover.enabled !== undefined) {
      this.enabled = patch.hover.enabled;
      if (!this.enabled) this.hover.hide();
    }
    if (patch.hover.delay !== undefined) this.delayMs = Math.max(0, patch.hover.delay);
    if (patch.hover.sticky !== undefined) this.hover.setSticky(patch.hover.sticky);
    if (patch.hover.openOnMouseHover !== undefined) {
      this.openOnMouseHover = patch.hover.openOnMouseHover;
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
    if (!this.enabled || !this.openOnMouseHover || e.pointerType !== 'mouse' || this.host.isDisposed()) {
      return;
    }
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

    // If moving outside the active hover range, schedule gentle hide so user can move mouse into sticky card
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

    const word = this.host.wordAtPosition(pos.lineNumber, pos.column);
    if (!word) {
      this.hover.cancelTimer();
      return;
    }
    this.hover.schedule(pos.lineNumber, pos.column, this.delayMs);
  };

  private onPointerLeave = (): void => {
    this.lastMousePosKey = '';
    this.hover.cancelTimer();
    if (this.hover.isOpen()) this.hover.scheduleHide(180);
  };
}
