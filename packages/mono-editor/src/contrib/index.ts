import { registerEditorContribution } from '../browser/editor/editorContributions';
import { ContributionIds } from '../browser/editor/editorTypes';
import { CodeActionController } from './codeAction/CodeActionController';
import { ColorDecoratorController } from './colorPicker/ColorDecoratorController';
import { ContextMenuContribution } from './contextMenu/ContextMenuContribution';
import { DefinitionController } from './definition/DefinitionController';
import { FindContribution } from './find/FindContribution';
import { FoldingController } from './folding/FoldingController';
import { FormatController } from './format/FormatController';
import { HoverContribution } from './hover/HoverContribution';
import { MultiCursorController } from './multiCursor/MultiCursorController';
import { ReferencesController } from './referencesPeek/ReferencesController';
import { RenameController } from './rename/RenameController';
import { SignatureHelpContribution } from './signatureHelp/SignatureHelpContribution';
import { SuggestContribution } from './suggest/SuggestContribution';

let registered = false;

/**
 * Registers all built-in optional editor contributions (idempotent).
 * Order matches Escape / keydown priority:
 * ColorPicker -> ReferencesPeek -> CodeAction -> Suggest -> SignatureHelp -> remaining features.
 */
export function registerBuiltInContributions(): void {
  if (registered) return;
  registered = true;
  registerEditorContribution(ContributionIds.ColorDecorator, (h) => new ColorDecoratorController(h));
  registerEditorContribution(ContributionIds.ReferencesPeek, (h) => new ReferencesController(h));
  registerEditorContribution(ContributionIds.CodeAction, (h) => new CodeActionController(h));
  registerEditorContribution(ContributionIds.Suggest, (h) => new SuggestContribution(h));
  registerEditorContribution(ContributionIds.SignatureHelp, (h) => new SignatureHelpContribution(h));
  registerEditorContribution(ContributionIds.Find, (h) => new FindContribution(h));
  registerEditorContribution(ContributionIds.Hover, (h) => new HoverContribution(h));
  registerEditorContribution(ContributionIds.ContextMenu, (h) => new ContextMenuContribution(h));
  registerEditorContribution(ContributionIds.Folding, (h) => new FoldingController(h));
  registerEditorContribution(ContributionIds.MultiCursor, (h) => new MultiCursorController(h));
  registerEditorContribution(ContributionIds.Format, (h) => new FormatController(h));
  registerEditorContribution(ContributionIds.Definition, (h) => new DefinitionController(h));
  registerEditorContribution(ContributionIds.Rename, (h) => new RenameController(h));
}
