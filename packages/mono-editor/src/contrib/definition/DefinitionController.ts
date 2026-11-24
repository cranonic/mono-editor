import {
  ContributionIds,
  type IEditorContribution,
  type IEditorContributionHost,
} from '../../browser/editor/editorTypes';
import { languageFeatures } from '../../common/languages/languageFeaturesService';
import type { Location } from '../../common/languages/providers/types';
import { MonoCommands } from '../../platform/keybindings/KeybindingService';

export class DefinitionController implements IEditorContribution {
  readonly id = ContributionIds.Definition;
  private readonly host: IEditorContributionHost;

  constructor(host: IEditorContributionHost) {
    this.host = host;

    host.keybindings.add({
      id: MonoCommands.RevealDefinition,
      primary: 'f12',
      weight: 5,
      handler: () => { void this.runRevealDefinition(); },
    });

    host.commands.registerCommand(
      MonoCommands.RevealDefinition,
      () => this.runRevealDefinition(),
      { title: 'Go to Definition', category: 'Go' },
    );
  }

  async runRevealDefinition(): Promise<boolean> {
    const pos = this.host.getPosition();
    const langId = this.host.getLanguageIdAtPosition(pos.lineNumber, pos.column);
    const providers = languageFeatures.getDefinitionProviders(langId);
    if (!providers.length) return false;
    const modelLike = this.host.modelAsFeatureLike();
    const token = { isCancellationRequested: false };
    const locs: Location[] = [];
    for (const p of providers) {
      try {
        const res = await Promise.resolve(p.provideDefinition(modelLike, pos, token));
        if (!res) continue;
        const arr = Array.isArray(res) ? res : [res];
        for (const item of arr) {
          if ('range' in item) {
            locs.push(item);
          } else {
            locs.push({
              uri: item.targetUri,
              range: item.targetSelectionRange ?? item.targetRange,
            });
          }
        }
      } catch (e) {
        console.warn('[mono definition]', e);
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
