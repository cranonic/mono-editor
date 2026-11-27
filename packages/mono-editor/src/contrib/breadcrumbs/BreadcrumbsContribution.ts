import {
  ContributionIds,
  type IBreadcrumbsContribution,
  type IEditorContributionHost,
} from '../../browser/editor/editorTypes';
import type { MonoEditorOptions } from '../../common/config/editorOptions';
import type { MonoDisposable } from '../../common/core/types';
import type { TextModel } from '../../common/model/TextModel';
import { MonoCommands } from '../../platform/keybindings/KeybindingService';
import { BreadcrumbsModel } from './BreadcrumbsModel';
import type { IBreadcrumbsModel, IBreadcrumbsSnapshot } from './breadcrumbsTypes';

/**
 * Editor contribution exposing `editor.getBreadcrumbs()` and VS Code breadcrumb
 * commands, keybindings (`Ctrl+Shift+;`, `Ctrl+Shift+.`), and context keys.
 */
export class BreadcrumbsContribution implements IBreadcrumbsContribution {
  readonly id = ContributionIds.Breadcrumbs;
  private readonly host: IEditorContributionHost;
  private readonly model: BreadcrumbsModel;
  private unsubStructure: MonoDisposable | null = null;

  constructor(host: IEditorContributionHost) {
    this.host = host;
    this.model = new BreadcrumbsModel(
      {
        getUri: () => host.getModelUriKey(),
        getPosition: () => host.getPosition(),
        getOutline: () => host.getStructure().getOutline(),
        setContext: (k, v) => host.setContext(k, v),
        revealSymbol: (item) => {
          const r = item.selectionRange ?? item.range;
          if (!r) return;
          const pos = { lineNumber: r.startLineNumber, column: r.startColumn };
          host.setPosition(pos);
          host.revealPositionInCenter(pos);
        },
        focusEditor: () => host.focus(),
      },
      host.initialOptions.breadcrumbs,
    );

    this.unsubStructure = host.getStructure().onDidChangeStructure(() => {
      this.model.refreshSymbols();
    });

    host.keybindings.addMany([
      {
        id: MonoCommands.BreadcrumbsFocus,
        primary: 'ctrl+shift+;',
        weight: 6,
        handler: () => this.model.focus(),
      },
      {
        id: MonoCommands.BreadcrumbsFocusAndSelect,
        primary: 'ctrl+shift+.',
        weight: 6,
        handler: () => this.model.focusAndSelect(),
      },
    ]);

    host.commands.registerCommand(MonoCommands.BreadcrumbsToggle, () => this.model.toggle(), {
      title: 'View: Toggle Breadcrumbs',
      category: 'Breadcrumbs',
    });
    host.commands.registerCommand(MonoCommands.BreadcrumbsFocus, () => this.model.focus(), {
      title: 'Breadcrumbs: Focus Breadcrumbs',
      category: 'Breadcrumbs',
    });
    host.commands.registerCommand(
      MonoCommands.BreadcrumbsFocusAndSelect,
      () => this.model.focusAndSelect(),
      { title: 'Breadcrumbs: Focus and Select Breadcrumbs', category: 'Breadcrumbs' },
    );
    host.commands.registerCommand(MonoCommands.BreadcrumbsFocusNext, () => this.model.focusNext(false), {
      title: 'Breadcrumbs: Focus Next',
      category: 'Breadcrumbs',
    });
    host.commands.registerCommand(
      MonoCommands.BreadcrumbsFocusPrevious,
      () => this.model.focusPrevious(false),
      { title: 'Breadcrumbs: Focus Previous', category: 'Breadcrumbs' },
    );
    host.commands.registerCommand(
      MonoCommands.BreadcrumbsFocusNextWithPicker,
      () => this.model.focusNext(true),
      { title: 'Breadcrumbs: Focus Next and Select', category: 'Breadcrumbs' },
    );
    host.commands.registerCommand(
      MonoCommands.BreadcrumbsFocusPreviousWithPicker,
      () => this.model.focusPrevious(true),
      { title: 'Breadcrumbs: Focus Previous and Select', category: 'Breadcrumbs' },
    );
    host.commands.registerCommand(MonoCommands.BreadcrumbsSelectFocused, () => this.model.selectFocused(), {
      title: 'Breadcrumbs: Select Focused',
      category: 'Breadcrumbs',
    });
    host.commands.registerCommand(MonoCommands.BreadcrumbsRevealFocused, () => this.model.revealFocused(), {
      title: 'Breadcrumbs: Reveal Focused',
      category: 'Breadcrumbs',
    });
    host.commands.registerCommand(MonoCommands.BreadcrumbsSelectEditor, () => this.model.selectEditor(), {
      title: 'Breadcrumbs: Select Editor',
      category: 'Breadcrumbs',
    });
    host.commands.registerCommand(
      MonoCommands.BreadcrumbsCopyPath,
      () => {
        const text = this.model.getCopyPath();
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(text).catch(() => {});
        }
        return text;
      },
      { title: 'Breadcrumbs: Copy Breadcrumbs Path', category: 'Breadcrumbs' },
    );
  }

  getBreadcrumbs(): IBreadcrumbsModel {
    return this.model;
  }

  onDidChangeBreadcrumbs(listener: (snapshot: IBreadcrumbsSnapshot) => void): MonoDisposable {
    return this.model.onDidChange(listener);
  }

  onModelChange(_model: TextModel): void {
    this.model.refresh();
  }

  onModelContentChange(_versionId: number): void {
    this.model.refreshSymbols();
  }

  onCursorChange(): void {
    this.model.refreshSymbols();
  }

  onOptionsChange(patch: Partial<MonoEditorOptions>): void {
    if (patch.breadcrumbs) {
      this.model.updateOptions(patch.breadcrumbs);
    }
  }

  dispose(): void {
    this.unsubStructure?.dispose();
    this.unsubStructure = null;
    this.model.dispose();
  }
}
