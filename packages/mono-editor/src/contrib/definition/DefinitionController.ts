import {
  ContributionIds,
  type IEditorContribution,
  type IEditorContributionHost,
  type IMonoEditor,
} from '../../browser/editor/editorTypes';
import { languageFeatures } from '../../common/languages/languageFeaturesService';
import type { Location, LocationLink } from '../../common/languages/providers/types';
import { getBackingTextModel, getRegisteredStandaloneModel } from '../../common/model/modelRegistry';
import { MonoCommands } from '../../platform/keybindings/KeybindingService';
import type { ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';

type NavKind = 'definition' | 'typeDefinition' | 'implementation' | 'declaration';

function normalizeLocations(
  res: Location | Location[] | LocationLink[] | null | undefined,
): Location[] {
  if (!res) return [];
  const arr = Array.isArray(res) ? res : [res];
  const out: Location[] = [];
  for (const item of arr) {
    if ('range' in item) out.push(item);
    else out.push({ uri: item.targetUri, range: item.targetSelectionRange ?? item.targetRange });
  }
  return out;
}

export class DefinitionController implements IEditorContribution {
  readonly id = ContributionIds.Definition;
  private readonly host: IEditorContributionHost;
  private peekRoot: HTMLDivElement | null = null;
  private peekEditor: IMonoEditor | null = null;
  private peekZoneId: string | null = null;
  private theme: ResolvedWidgetTheme | null = null;

  constructor(host: IEditorContributionHost) {
    this.host = host;

    host.keybindings.addMany([
      { id: MonoCommands.RevealDefinition, primary: 'f12', weight: 5, handler: () => { void this.runNavigation('definition'); } },
      { id: MonoCommands.PeekDefinition, primary: 'alt+f12', weight: 5, handler: () => { void this.runPeekDefinition(); } },
      { id: MonoCommands.GoToImplementation, primary: 'ctrl+f12', weight: 5, handler: () => { void this.runNavigation('implementation'); } },
    ]);

    host.commands.registerCommand(MonoCommands.RevealDefinition, () => this.runNavigation('definition'), { title: 'Go to Definition', category: 'Go' });
    host.commands.registerCommand(MonoCommands.PeekDefinition, () => this.runPeekDefinition(), { title: 'Peek Definition', category: 'Go' });
    host.commands.registerCommand(MonoCommands.GoToTypeDefinition, () => this.runNavigation('typeDefinition'), { title: 'Go to Type Definition', category: 'Go' });
    host.commands.registerCommand(MonoCommands.GoToImplementation, () => this.runNavigation('implementation'), { title: 'Go to Implementation', category: 'Go' });
    host.commands.registerCommand(MonoCommands.GoToDeclaration, () => this.runNavigation('declaration'), { title: 'Go to Declaration', category: 'Go' });
  }

  async runRevealDefinition(): Promise<boolean> {
    return this.runNavigation('definition');
  }

  async runPeekDefinition(): Promise<boolean> {
    if (this.host.isPeekEditor) return this.runNavigation('definition');
    const locs = await this.queryLocations('definition');
    if (!locs.length) return false;
    this.openPeek(locs[0]!);
    return true;
  }

  closePeek(): void {
    if (this.peekEditor) {
      this.peekEditor.dispose();
      this.peekEditor = null;
    }
    if (this.peekZoneId) {
      const id = this.peekZoneId;
      this.peekZoneId = null;
      this.host.changeViewZones((acc) => acc.removeZone(id));
    }
    this.peekRoot = null;
  }

  onKeyDown(e: KeyboardEvent): boolean {
    if (this.peekZoneId && e.key === 'Escape') {
      this.closePeek();
      this.host.focus();
      return true;
    }
    return false;
  }

  onThemeChange(wt: ResolvedWidgetTheme): void {
    this.theme = wt;
  }

  shouldAllowWheelTarget(target: Node): boolean {
    return Boolean(this.peekRoot && this.peekRoot.contains(target));
  }

  async runNavigation(kind: NavKind): Promise<boolean> {
    const locs = await this.queryLocations(kind);
    if (!locs.length) return false;
    this.closePeek();
    this.host.jumpToLocation(locs[0]!);
    return true;
  }

  private async queryLocations(kind: NavKind): Promise<Location[]> {
    const pos = this.host.getPosition();
    const langId = this.host.getLanguageIdAtPosition(pos.lineNumber, pos.column);
    const modelLike = this.host.modelAsFeatureLike();
    const token = { isCancellationRequested: false };
    const locs: Location[] = [];

    if (kind === 'definition') {
      for (const p of languageFeatures.getDefinitionProviders(langId)) {
        try { locs.push(...normalizeLocations(await Promise.resolve(p.provideDefinition(modelLike, pos, token)))); } catch (e) { console.warn('[mono definition]', e); }
      }
    } else if (kind === 'typeDefinition') {
      for (const p of languageFeatures.getTypeDefinitionProviders(langId)) {
        try { locs.push(...normalizeLocations(await Promise.resolve(p.provideTypeDefinition(modelLike, pos, token)))); } catch (e) { console.warn('[mono typeDefinition]', e); }
      }
    } else if (kind === 'implementation') {
      for (const p of languageFeatures.getImplementationProviders(langId)) {
        try { locs.push(...normalizeLocations(await Promise.resolve(p.provideImplementation(modelLike, pos, token)))); } catch (e) { console.warn('[mono implementation]', e); }
      }
    } else if (kind === 'declaration') {
      for (const p of languageFeatures.getDeclarationProviders(langId)) {
        try { locs.push(...normalizeLocations(await Promise.resolve(p.provideDeclaration(modelLike, pos, token)))); } catch (e) { console.warn('[mono declaration]', e); }
      }
    }
    return locs;
  }

  private openPeek(loc: Location): void {
    this.closePeek();
    const anchorLine = this.host.getPosition().lineNumber;
    const bg = this.theme?.background ?? '#18181b';
    const fg = this.theme?.foreground ?? '#e4e4e7';
    const border = this.theme?.border ?? '#3f3f46';
    const accent = this.theme?.focusBorder ?? '#3b82f6';

    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: bg,
      color: fg,
      borderTop: `2px solid ${accent}`,
      borderBottom: `1px solid ${border}`,
      boxSizing: 'border-box',
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: '30px',
      padding: '0 10px',
      borderBottom: `1px solid ${border}`,
      fontSize: '12px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      flexShrink: '0',
    });

    const title = document.createElement('span');
    title.textContent = `Definition · ${loc.uri?.toString() ?? 'current'} :${loc.range.startLineNumber}`;
    title.style.fontWeight = '600';

    const actions = document.createElement('div');
    Object.assign(actions.style, { display: 'flex', gap: '6px' });

    const jumpBtn = document.createElement('button');
    jumpBtn.type = 'button';
    jumpBtn.textContent = 'Open';
    Object.assign(jumpBtn.style, { border: `1px solid ${border}`, background: 'transparent', color: fg, borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', fontSize: '11px' });
    jumpBtn.addEventListener('click', () => { this.closePeek(); this.host.jumpToLocation(loc); });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close peek definition');
    Object.assign(closeBtn.style, { border: 'none', background: 'transparent', color: fg, cursor: 'pointer', fontSize: '16px', padding: '0 6px' });
    closeBtn.addEventListener('click', () => { this.closePeek(); this.host.focus(); });

    actions.append(jumpBtn, closeBtn);
    header.append(title, actions);

    const editorHost = document.createElement('div');
    Object.assign(editorHost.style, { flex: '1', minHeight: '0', position: 'relative' });

    wrap.append(header, editorHost);
    this.peekRoot = wrap;

    this.host.changeViewZones((acc) => {
      this.peekZoneId = acc.addZone({
        afterLineNumber: anchorLine,
        heightInPx: 196,
        domNode: wrap,
      });
    });

    const targetKey = loc.uri?.toString();
    const standalone = targetKey ? getRegisteredStandaloneModel(targetKey) : undefined;
    const sharedModel = (standalone ? getBackingTextModel(standalone) : null) ?? this.host.getModel();

    this.peekEditor = this.host.createNestedEditor(editorHost, sharedModel, {
      fontSize: Math.max(12, this.host.getFontSize() - 1),
      readOnly: true,
      minimap: { enabled: false },
    });
    this.peekEditor.setPosition({ lineNumber: loc.range.startLineNumber, column: loc.range.startColumn });
    this.peekEditor.revealLineInCenter(loc.range.startLineNumber);
  }

  dispose(): void {
    this.closePeek();
  }
}
