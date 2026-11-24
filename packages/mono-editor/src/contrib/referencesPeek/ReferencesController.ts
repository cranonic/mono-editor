import {
  ContributionIds,
  type IEditorContribution,
  type IEditorContributionHost,
} from '../../browser/editor/editorTypes';
import type { ColorDecoratorRules } from '../../common/color/colorTypes';
import type { MonoEditorOptions } from '../../common/config/editorOptions';
import type { MonoEditorTheme } from '../../common/config/themeTypes';
import { languageFeatures } from '../../common/languages/languageFeaturesService';
import type { Location } from '../../common/languages/providers/types';
import type { TextModel } from '../../common/model/TextModel';
import { getRegisteredStandaloneModel } from '../../common/model/modelRegistry';
import { MonoCommands } from '../../platform/keybindings/KeybindingService';
import type { ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';
import { ReferencesPeekView, type PeekReferenceItem } from './ReferencesPeekView';

export class ReferencesController implements IEditorContribution {
  readonly id = ContributionIds.ReferencesPeek;
  private readonly host: IEditorContributionHost;
  private readonly peek: ReferencesPeekView;
  private colorDecoratorsEnabled: boolean;
  private colorDecoratorsRules: ColorDecoratorRules | undefined;

  constructor(host: IEditorContributionHost) {
    this.host = host;
    this.peek = new ReferencesPeekView(host.root);
    this.colorDecoratorsEnabled = host.initialOptions.colorDecorators !== false;
    this.colorDecoratorsRules = host.initialOptions.colorDecoratorsRules;

    host.keybindings.add({
      id: MonoCommands.ReferenceSearch,
      primary: 'shift+f12',
      weight: 5,
      handler: () => { void this.runFindReferences(); },
    });

    host.commands.registerCommand(
      MonoCommands.ReferenceSearch,
      () => this.runFindReferences(),
      { title: 'Find All References', category: 'Go' },
    );
  }

  onKeyDown(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' && this.peek.isVisible()) {
      this.peek.close(true);
      return true;
    }
    return false;
  }

  shouldAllowWheelTarget(target: Node): boolean {
    return Boolean(this.peek.getElement()?.contains(target));
  }

  onScroll(): void { this.syncPosition(); }
  onPaint(): void { this.syncPosition(); }
  onLayout(): void { this.syncPosition(); }

  onModelChange(_model: TextModel): void {
    this.peek.close(false);
    this.host.view.setViewZone(null);
  }

  onThemeChange(wt: ResolvedWidgetTheme, editorTheme: MonoEditorTheme): void {
    this.peek.applyTheme(wt);
    this.peek.getPeekEditor()?.setTheme?.({ ...editorTheme });
  }

  onOptionsChange(patch: Partial<MonoEditorOptions>): void {
    if (patch.colorDecorators !== undefined) this.colorDecoratorsEnabled = patch.colorDecorators;
    if (patch.colorDecoratorsRules !== undefined) this.colorDecoratorsRules = patch.colorDecoratorsRules;
  }

  async runFindReferences(): Promise<boolean> {
    if (this.host.isPeekEditor) return false;
    const model = this.host.getModel();
    const pos = this.host.getPosition();
    const langId = this.host.getLanguageIdAtPosition(pos.lineNumber, pos.column);
    const providers = languageFeatures.getReferenceProviders(langId);
    if (!providers.length) return false;
    const word = this.host.wordAtPosition(pos.lineNumber, pos.column);
    const modelLike = this.host.modelAsFeatureLike();
    const token = { isCancellationRequested: false };
    const locs: Location[] = [];
    for (const p of providers) {
      try {
        const res = await Promise.resolve(
          p.provideReferences(modelLike, pos, { includeDeclaration: true }, token),
        );
        if (res?.length) locs.push(...res);
      } catch (e) {
        console.warn('[mono references]', e);
      }
    }
    if (!locs.length) return false;

    const currentUriKey = this.host.getModelUriKey();
    const splitUriLabel = (uriStr: string): { fileName: string; dirPath: string } => {
      const cleaned = uriStr.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '').replace(/^\/+/, '');
      const parts = cleaned.split('/').filter(Boolean);
      const fileName = parts.pop() || 'untitled';
      const dirPath = parts.join('/');
      return { fileName, dirPath };
    };

    const items: PeekReferenceItem[] = locs.map((location) => {
      const uriStr = location.uri?.toString() ?? currentUriKey;
      const other = uriStr !== currentUriKey ? getRegisteredStandaloneModel(uriStr) : null;
      const ln = location.range.startLineNumber;
      let lineText = '';
      if (other) {
        lineText = other.getLineContent(Math.max(1, Math.min(other.getLineCount(), ln)));
      } else if (ln >= 1 && ln <= model.getLineCount()) {
        lineText = model.getLineContent(ln);
      }
      const { fileName, dirPath } = splitUriLabel(uriStr);
      return {
        location,
        lineNumber: ln,
        startColumn: location.range.startColumn,
        endColumn: location.range.endColumn,
        lineText,
        fileName,
        dirPath,
        uriString: uriStr,
      };
    });

    const peekHeight = 232;
    this.host.view.setViewZone({
      id: 'references-peek',
      afterLineNumber: pos.lineNumber,
      heightPx: peekHeight,
    });

    this.peek.open({
      anchorLine: pos.lineNumber,
      anchorColumn: word?.startColumn ?? pos.column,
      anchorEndColumn: word?.endColumn ?? pos.column + 1,
      items,
      model,
      heightPx: peekHeight,
      callbacks: {
        createPeekEditor: (container, sharedModel) =>
          this.host.createNestedEditor(container, sharedModel, {
            theme: { ...this.host.getTheme() },
            fontFamily: this.host.getFontFamily(),
            fontSize: Math.max(11, this.host.getFontSize() - 1),
            lineHeight: Math.max(17, this.host.getLineHeight() - 2),
            tabSize: this.host.getTabSize(),
            stickyScroll: { enabled: true, maxLineCount: 2 },
            minimap: { enabled: false },
            colorDecorators: this.colorDecoratorsEnabled,
            colorDecoratorsRules: this.colorDecoratorsRules,
            scrollbar: {
              vertical: 'auto',
              horizontal: 'auto',
              hideVerticalOnScrollEnd: true,
              hideHorizontalOnScrollEnd: true,
            },
          }),
        onJumpMainEditor: (loc) => { this.host.jumpToLocation(loc); },
        onClose: () => {
          this.host.view.setViewZone(null);
          this.host.view.paint();
          this.host.focus();
        },
      },
    });
    this.host.view.paint();
    this.syncPosition();
    return true;
  }

  dispose(): void { this.peek.dispose(); }

  private syncPosition(): void {
    if (!this.peek.isVisible()) return;
    const zoneRect = this.host.view.getViewZoneScreenRect();
    if (!zoneRect) return;
    const anchor = this.peek.getAnchor();
    const startScr = this.host.view.screenPosOf(anchor.lineNumber, anchor.column);
    const endScr = this.host.view.screenPosOf(
      anchor.lineNumber,
      Math.max(anchor.column + 1, anchor.endColumn),
    );
    const pointerX = (startScr.x + endScr.x) / 2;
    this.peek.syncPosition({
      top: zoneRect.top,
      height: zoneRect.height,
      pointerX,
      rightInset: this.host.getMinimapWidth(),
      viewportHeight: this.host.view.cssHeight,
      topInset: this.host.view.getTopInset(),
    });
  }
}
