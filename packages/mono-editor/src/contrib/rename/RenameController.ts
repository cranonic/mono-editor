import {
  ContributionIds,
  type IEditorContribution,
  type IEditorContributionHost,
} from '../../browser/editor/editorTypes';
import type { PointerInteractKind } from '../../browser/input/pointer/PointerController';
import { languageFeatures } from '../../common/languages/languageFeaturesService';
import type { TextModel } from '../../common/model/TextModel';
import { MonoCommands } from '../../platform/keybindings/KeybindingService';
import type { ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';
import { InlineRenameWidget } from './InlineRenameWidget';

export class RenameController implements IEditorContribution {
  readonly id = ContributionIds.Rename;
  private readonly host: IEditorContributionHost;
  private readonly widget: InlineRenameWidget;
  private anchorPos: { lineNumber: number; column: number } | null = null;

  constructor(host: IEditorContributionHost) {
    this.host = host;
    this.widget = new InlineRenameWidget(host.root);

    host.keybindings.add({
      id: MonoCommands.Rename,
      primary: 'f2',
      weight: 5,
      handler: () => { void this.runRenameSymbol(); },
    });

    host.commands.registerCommand(
      MonoCommands.Rename,
      () => this.runRenameSymbol(),
      { title: 'Rename Symbol', category: 'Refactor' },
    );
  }

  isOpen(): boolean {
    return this.widget.isOpen();
  }

  getWidget(): InlineRenameWidget {
    return this.widget;
  }

  onModelChange(_model: TextModel): void {
    this.closeDismiss();
  }

  onThemeChange(wt: ResolvedWidgetTheme): void {
    this.widget.applyTheme(wt);
  }

  /**
   * Scroll events (including mobile soft-keyboard open scroll) NEVER dismiss the rename popup —
   * they smoothly reposition it or hide it visually while preserving draft state if out of view.
   */
  onScroll(): void {
    this.syncPosition();
  }

  onLayout(): void {
    this.syncPosition();
  }

  onPaint(): void {
    this.syncPosition();
  }

  /** Dismiss whenever the editor cursor moves (e.g. tapping editor canvas or keyboard navigation). */
  onCursorChange(_source: string): void {
    if (this.widget.isOpen()) {
      this.closeDismiss();
    }
  }

  /** Dismiss on direct editor canvas tap / selection — NEVER on scroll or scrollEnd. */
  onPointerInteract(kind: PointerInteractKind): void {
    if (!this.widget.isOpen()) return;
    if (kind === 'scroll' || kind === 'scrollEnd') return;
    this.closeDismiss();
  }

  onOutsidePointerDown(): void {
    if (this.widget.isOpen()) {
      this.closeDismiss();
    }
  }

  async runRenameSymbol(): Promise<boolean> {
    if (this.host.isReadOnly()) return false;
    const pos = this.host.getPosition();
    const langId = this.host.getLanguageIdAtPosition(pos.lineNumber, pos.column);
    const providers = languageFeatures.getRenameProviders(langId);
    if (!providers.length) return false;
    const modelLike = this.host.modelAsFeatureLike();
    const token = { isCancellationRequested: false };

    let initialText = this.host.wordAtPosition(pos.lineNumber, pos.column)?.word ?? '';
    for (const p of providers) {
      if (p.resolveRenameLocation) {
        try {
          const loc = await Promise.resolve(p.resolveRenameLocation(modelLike, pos, token));
          if (loc?.rejectReason) return false;
          if (loc?.text) {
            initialText = loc.text;
            break;
          }
        } catch (e) {
          console.warn('[mono rename resolve]', e);
        }
      }
    }
    if (!initialText) return false;

    this.anchorPos = { lineNumber: pos.lineNumber, column: pos.column };
    const scr = this.host.view.screenPosOf(pos.lineNumber, pos.column);
    this.widget.open(
      initialText,
      scr,
      {
        onSubmit: (newName) => {
          this.anchorPos = null;
          void (async () => {
            for (const p of providers) {
              try {
                const edit = await Promise.resolve(
                  p.provideRenameEdits(modelLike, pos, newName, token),
                );
                if (edit?.edits?.length) {
                  this.host.applyWorkspaceEdit(edit, 'rename');
                  break;
                }
              } catch (e) {
                console.warn('[mono rename]', e);
              }
            }
            this.host.focus();
          })();
        },
        onCancel: () => {
          this.anchorPos = null;
          this.host.focus();
        },
      },
      {
        width: this.host.view.cssWidth || this.host.root.clientWidth || 600,
        height: this.host.view.cssHeight || this.host.root.clientHeight || 400,
        topInset: this.host.view.getTopInset(),
      },
    );
    return true;
  }

  private syncPosition(): void {
    if (!this.widget.isOpen() || !this.anchorPos) return;
    const scr = this.host.view.screenPosOf(this.anchorPos.lineNumber, this.anchorPos.column);
    this.widget.updatePosition(scr, {
      width: this.host.view.cssWidth || this.host.root.clientWidth || 600,
      height: this.host.view.cssHeight || this.host.root.clientHeight || 400,
      topInset: this.host.view.getTopInset(),
    });
  }

  private closeDismiss(): void {
    this.anchorPos = null;
    this.widget.close(false);
  }

  dispose(): void {
    this.anchorPos = null;
    this.widget.dispose();
  }
}
