import {
  ContributionIds,
  type IEditorContribution,
  type IEditorContributionHost,
} from '../../browser/editor/editorTypes';
import { languageFeatures } from '../../common/languages/languageFeaturesService';
import type { Location, LocationLink } from '../../common/languages/providers/types';
import { MonoCommands } from '../../platform/keybindings/KeybindingService';

type NavKind = 'definition' | 'typeDefinition' | 'implementation' | 'declaration';

function normalizeLocations(
  res: Location | Location[] | LocationLink[] | null | undefined,
): Location[] {
  if (!res) return [];
  const arr = Array.isArray(res) ? res : [res];
  const out: Location[] = [];
  for (const item of arr) {
    if ('range' in item) {
      out.push(item);
    } else {
      out.push({
        uri: item.targetUri,
        range: item.targetSelectionRange ?? item.targetRange,
      });
    }
  }
  return out;
}

export class DefinitionController implements IEditorContribution {
  readonly id = ContributionIds.Definition;
  private readonly host: IEditorContributionHost;

  constructor(host: IEditorContributionHost) {
    this.host = host;

    host.keybindings.addMany([
      {
        id: MonoCommands.RevealDefinition,
        primary: 'f12',
        weight: 5,
        handler: () => { void this.runNavigation('definition'); },
      },
      {
        id: MonoCommands.GoToImplementation,
        primary: 'ctrl+f12',
        weight: 5,
        handler: () => { void this.runNavigation('implementation'); },
      },
    ]);

    host.commands.registerCommand(
      MonoCommands.RevealDefinition,
      () => this.runNavigation('definition'),
      { title: 'Go to Definition', category: 'Go' },
    );
    host.commands.registerCommand(
      MonoCommands.GoToTypeDefinition,
      () => this.runNavigation('typeDefinition'),
      { title: 'Go to Type Definition', category: 'Go' },
    );
    host.commands.registerCommand(
      MonoCommands.GoToImplementation,
      () => this.runNavigation('implementation'),
      { title: 'Go to Implementation', category: 'Go' },
    );
    host.commands.registerCommand(
      MonoCommands.GoToDeclaration,
      () => this.runNavigation('declaration'),
      { title: 'Go to Declaration', category: 'Go' },
    );
  }

  async runRevealDefinition(): Promise<boolean> {
    return this.runNavigation('definition');
  }

  async runNavigation(kind: NavKind): Promise<boolean> {
    const pos = this.host.getPosition();
    const langId = this.host.getLanguageIdAtPosition(pos.lineNumber, pos.column);
    const modelLike = this.host.modelAsFeatureLike();
    const token = { isCancellationRequested: false };
    const locs: Location[] = [];

    if (kind === 'definition') {
      for (const p of languageFeatures.getDefinitionProviders(langId)) {
        try {
          locs.push(...normalizeLocations(await Promise.resolve(p.provideDefinition(modelLike, pos, token))));
        } catch (e) {
          console.warn('[mono definition]', e);
        }
      }
    } else if (kind === 'typeDefinition') {
      for (const p of languageFeatures.getTypeDefinitionProviders(langId)) {
        try {
          locs.push(...normalizeLocations(await Promise.resolve(p.provideTypeDefinition(modelLike, pos, token))));
        } catch (e) {
          console.warn('[mono typeDefinition]', e);
        }
      }
    } else if (kind === 'implementation') {
      for (const p of languageFeatures.getImplementationProviders(langId)) {
        try {
          locs.push(...normalizeLocations(await Promise.resolve(p.provideImplementation(modelLike, pos, token))));
        } catch (e) {
          console.warn('[mono implementation]', e);
        }
      }
    } else if (kind === 'declaration') {
      for (const p of languageFeatures.getDeclarationProviders(langId)) {
        try {
          locs.push(...normalizeLocations(await Promise.resolve(p.provideDeclaration(modelLike, pos, token))));
        } catch (e) {
          console.warn('[mono declaration]', e);
        }
      }
    }

    if (!locs.length) return false;
    this.host.jumpToLocation(locs[0]!);
    return true;
  }

  dispose(): void {
    /* stateless */
  }
}
