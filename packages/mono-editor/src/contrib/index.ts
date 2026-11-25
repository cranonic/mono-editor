import { registerEditorContribution } from '../browser/editor/editorContributions';
import { ContributionIds } from '../browser/editor/editorTypes';
import { CodeActionController } from './codeAction/CodeActionController';
import { CodeLensController } from './codeLens/CodeLensController';
import { ColorDecoratorController } from './colorPicker/ColorDecoratorController';
import { ContextMenuContribution } from './contextMenu/ContextMenuContribution';
import { DefinitionController } from './definition/DefinitionController';
import { DocumentHighlightController } from './documentHighlight/DocumentHighlightController';
import { DocumentSymbolsController } from './documentSymbols/DocumentSymbolsController';
import { FindContribution } from './find/FindContribution';
import { FoldingController } from './folding/FoldingController';
import { FormatController } from './format/FormatController';
import { HoverContribution } from './hover/HoverContribution';
import { InlayHintsController } from './inlayHints/InlayHintsController';
import { InlineSuggestController } from './inlineSuggest/InlineSuggestController';
import { LinkedEditingController } from './linkedEditing/LinkedEditingController';
import { LinksController } from './links/LinksController';
import { MobileController } from './mobile/MobileController';
import { MultiCursorController } from './multiCursor/MultiCursorController';
import { PasteEditController } from './pasteEdit/PasteEditController';
import { QuickNavController } from './quickNav/QuickNavController';
import { ReferencesController } from './referencesPeek/ReferencesController';
import { RenameController } from './rename/RenameController';
import { SelectionRangeController } from './selectionRange/SelectionRangeController';
import { SemanticTokensController } from './semanticTokens/SemanticTokensController';
import { SignatureHelpContribution } from './signatureHelp/SignatureHelpContribution';
import { SuggestContribution } from './suggest/SuggestContribution';

let registered = false;

/**
 * Registers all built-in optional editor contributions (idempotent).
 * Order matches Escape / keydown priority:
 * QuickNav -> ColorPicker -> ReferencesPeek -> Definition(Peek) -> CodeAction -> Suggest -> SignatureHelp -> InlineSuggest -> remaining features.
 */
export function registerBuiltInContributions(): void {
  if (registered) return;
  registered = true;
  registerEditorContribution(ContributionIds.QuickNav, (h) => new QuickNavController(h));
  registerEditorContribution(ContributionIds.ColorDecorator, (h) => new ColorDecoratorController(h));
  registerEditorContribution(ContributionIds.ReferencesPeek, (h) => new ReferencesController(h));
  registerEditorContribution(ContributionIds.Definition, (h) => new DefinitionController(h));
  registerEditorContribution(ContributionIds.CodeAction, (h) => new CodeActionController(h));
  registerEditorContribution(ContributionIds.Suggest, (h) => new SuggestContribution(h));
  registerEditorContribution(ContributionIds.SignatureHelp, (h) => new SignatureHelpContribution(h));
  registerEditorContribution(ContributionIds.InlineSuggest, (h) => new InlineSuggestController(h));
  registerEditorContribution(ContributionIds.Find, (h) => new FindContribution(h));
  registerEditorContribution(ContributionIds.Hover, (h) => new HoverContribution(h));
  registerEditorContribution(ContributionIds.ContextMenu, (h) => new ContextMenuContribution(h));
  registerEditorContribution(ContributionIds.Folding, (h) => new FoldingController(h));
  registerEditorContribution(ContributionIds.MultiCursor, (h) => new MultiCursorController(h));
  registerEditorContribution(ContributionIds.Format, (h) => new FormatController(h));
  registerEditorContribution(ContributionIds.Rename, (h) => new RenameController(h));
  registerEditorContribution(ContributionIds.InlayHints, (h) => new InlayHintsController(h));
  registerEditorContribution(ContributionIds.SemanticTokens, (h) => new SemanticTokensController(h));
  registerEditorContribution(ContributionIds.DocumentHighlight, (h) => new DocumentHighlightController(h));
  registerEditorContribution(ContributionIds.DocumentSymbols, (h) => new DocumentSymbolsController(h));
  registerEditorContribution(ContributionIds.Links, (h) => new LinksController(h));
  registerEditorContribution(ContributionIds.SelectionRange, (h) => new SelectionRangeController(h));
  registerEditorContribution(ContributionIds.PasteEdit, (h) => new PasteEditController(h));
  registerEditorContribution(ContributionIds.LinkedEditing, (h) => new LinkedEditingController(h));
  registerEditorContribution(ContributionIds.CodeLens, (h) => new CodeLensController(h));
  registerEditorContribution(ContributionIds.MobileAccessory, (h) => new MobileController(h));
}
