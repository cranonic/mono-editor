import {
  ContributionIds,
  type IEditorContribution,
  type IEditorContributionHost,
} from '../../browser/editor/editorTypes';
import type { InputChangeEvent } from '../../browser/input/InputController';
import type { PointerInteractKind } from '../../browser/input/pointer/PointerController';
import type { ColorHit } from '../../browser/render/CanvasRenderer';
import type { TextModel } from '../../common/model/TextModel';
import type { ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';
import { HoverController } from './HoverController';

export class HoverContribution implements IEditorContribution {
  readonly id = ContributionIds.Hover;
  private readonly host: IEditorContributionHost;
  private readonly hover: HoverController;
  private diagHover: HTMLDivElement | null = null;
  private diagHoverTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(host: IEditorContributionHost) {
    this.host = host;
    this.hover = new HoverController(
      host.root,
      host.getModel(),
      host.selection,
      host.view,
      undefined,
      (ln, col) => host.getLanguageIdAtPosition(ln, col),
    );

    this.diagHover = document.createElement('div');
    Object.assign(this.diagHover.style, {
      position: 'absolute',
      display: 'none',
      zIndex: '100',
      maxWidth: '360px',
      padding: '6px 8px',
      borderRadius: '4px',
      fontSize: '12px',
      lineHeight: '1.4',
      pointerEvents: 'none',
      background: '#252526',
      color: '#cccccc',
      border: '1px solid #454545',
      boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
      whiteSpace: 'pre-wrap',
    });
    host.root.appendChild(this.diagHover);
  }

  onInputChange(ev: InputChangeEvent): void {
    this.hover.hide();
    this.hideDiagHover();
    if (ev.kind !== 'composition') this.scheduleDiagHover();
  }

  onCursorChange(source: string): void {
    // Fix 1: Hide hover immediately whenever the cursor or selection changes
    this.hover.hide();
    this.hideDiagHover();
    if (source === 'api') this.scheduleDiagHover();
  }

  onScroll(): void {
    // Fix 1: Hide hover immediately on any scroll
    this.hover.hide();
    this.hideDiagHover();
  }

  onPointerInteract(kind: PointerInteractKind): void {
    if (kind === 'tap' || kind === 'handle' || kind === 'handleTap' || kind === 'select') {
      this.hover.hide();
      this.hideDiagHover();
    }
    if (kind === 'tap') {
      const p = this.host.selection.active;
      this.hover.schedule(p.lineNumber, p.column, 600);
      this.scheduleDiagHover();
    }
  }

  onColorSwatchClick(_hit: ColorHit): void {
    this.hover.hide();
    this.hideDiagHover();
  }

  onModelChange(model: TextModel): void {
    this.hover.hide();
    this.hideDiagHover();
    this.hover.setModel(model);
  }

  onThemeChange(wt: ResolvedWidgetTheme): void {
    this.hover.applyTheme(wt);
    if (this.diagHover) {
      this.diagHover.style.background = wt.background;
      this.diagHover.style.color = wt.foreground;
      this.diagHover.style.border = `1px solid ${wt.border}`;
      this.diagHover.style.boxShadow = wt.shadow;
    }
  }

  dispose(): void {
    this.hideDiagHover();
    this.hover.dispose();
    this.diagHover?.remove();
    this.diagHover = null;
  }

  private hideDiagHover(): void {
    if (this.diagHoverTimer) {
      clearTimeout(this.diagHoverTimer);
      this.diagHoverTimer = null;
    }
    if (this.diagHover) this.diagHover.style.display = 'none';
  }

  private scheduleDiagHover(): void {
    if (this.diagHoverTimer) clearTimeout(this.diagHoverTimer);
    this.diagHoverTimer = setTimeout(() => this.updateDiagHover(), 400);
  }

  private updateDiagHover(): void {
    if (!this.diagHover || this.host.isDisposed()) return;
    const pos = this.host.selection.active;
    const markers = this.host.getMarkers();
    const hit = markers.find(
      (m) =>
        pos.lineNumber >= m.startLineNumber &&
        pos.lineNumber <= m.endLineNumber &&
        (pos.lineNumber !== m.startLineNumber || pos.column >= m.startColumn) &&
        (pos.lineNumber !== m.endLineNumber || pos.column <= m.endColumn),
    );
    if (!hit) {
      this.diagHover.style.display = 'none';
      return;
    }
    const sev = hit.severity >= 8 ? 'Error' : hit.severity >= 4 ? 'Warning' : hit.severity >= 2 ? 'Info' : 'Hint';
    this.diagHover.textContent = `${sev}: ${hit.message}`;
    this.diagHover.style.display = 'block';
    const screen = this.host.view.caretScreenPos();
    this.diagHover.style.left = `${Math.max(4, screen.x)}px`;
    this.diagHover.style.top = `${Math.max(4, screen.y - 28)}px`;
  }
}
