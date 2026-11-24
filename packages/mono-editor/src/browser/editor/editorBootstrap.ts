import {
  BracketColorizer,
  DEFAULT_RAINBOW_BRACKET_COLORS,
  DEFAULT_UNEXPECTED_BRACKET_COLOR,
} from '../../common/brackets';
import type { MonoEditorOptions, RenderMetrics } from '../../common/config/editorOptions';
import { DEFAULT_THEME } from '../../common/config/themeTypes';
import type { SelectionState } from '../../common/core/SelectionState';
import type { DecorationsCollection } from '../../common/decorations/DecorationsCollection';
import type { MarkerService } from '../../common/decorations/MarkerService';
import type { Location, TextEdit, WorkspaceEdit } from '../../common/languages/providers/types';
import type { TokenizationSupport } from '../../common/languages/tokenization/TokenizationSupport';
import type { TextModel } from '../../common/model/TextModel';
import type { FoldingModel } from '../../common/viewModel/FoldingModel';
import type { CommandService } from '../../platform/commands/CommandService';
import type { KeybindingService } from '../../platform/keybindings/KeybindingService';
import { monoThemeService } from '../../platform/theme';
import { InputController } from '../input/InputController';
import { CanvasRenderer } from '../render/CanvasRenderer';
import { ViewController } from '../view/ViewController';
import { HandleVisibility } from '../view/viewParts/HandleVisibility';
import { MinimapController } from '../view/viewParts/MinimapController';
import { OverlayScrollbar } from '../view/viewParts/OverlayScrollbar';
import { jumpEditorToLocation, type EditorOptionState } from './editorLifecycle';
import {
  ContributionIds,
  type IEditorContribution,
  type IEditorContributionHost,
  type IFindContribution,
  type IMonoEditor,
} from './editorTypes';
import type { ModelController } from './modelController';

export function createInitialOptionState(options: MonoEditorOptions): EditorOptionState {
  const fontSize = options.fontSize ?? 14;
  return {
    fontFamily: options.fontFamily ?? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize,
    lineHeight: options.lineHeight ?? Math.round(fontSize * 1.45),
    lineNumbers: (options.lineNumbers ?? 'on') === 'on',
    lineNumbersMinChars: options.lineNumbersMinChars != null ? Math.max(1, Math.floor(options.lineNumbersMinChars)) : 2,
    tabSize: options.tabSize ?? 2,
    readOnly: !!options.readOnly,
    foldingEnabled: options.folding !== false,
    theme: { ...DEFAULT_THEME, ...monoThemeService.toPartialEditorTheme(), ...options.theme },
  };
}

export function createRootDom(host: HTMLElement, background: string): { root: HTMLDivElement; canvas: HTMLCanvasElement } {
  const root = document.createElement('div');
  Object.assign(root.style, {
    position: 'relative', width: '100%', height: '100%', overflow: 'hidden', outline: 'none',
    background, touchAction: 'none', userSelect: 'none',
  });
  root.style.setProperty('-webkit-user-select', 'none');
  root.style.setProperty('-webkit-touch-callout', 'none');
  root.tabIndex = -1;

  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none' });
  root.appendChild(canvas);
  host.appendChild(root);
  return { root, canvas };
}

export function createEditorSubsystems(params: {
  root: HTMLDivElement;
  canvas: HTMLCanvasElement;
  options: MonoEditorOptions;
  opts: EditorOptionState;
  overscan: number;
  isPeekEditor: boolean;
  modelCtrl: ModelController;
  selection: SelectionState;
  tokenization: TokenizationSupport;
  folding: FoldingModel;
  decorations: DecorationsCollection;
  markers: MarkerService;
  contributions: Map<string, IEditorContribution>;
  /** Receives the renderer being built — `MonoEditor.renderer` is not assigned yet while subsystems are constructed. */
  getMetrics: (renderer: CanvasRenderer) => RenderMetrics;
  onScrollCommit: (topChanged: boolean, leftChanged: boolean) => void;
  onSyncScrollbar: (activeScroll: boolean) => void;
  onInputComplete: (ev: import('../input/InputController').InputChangeEvent) => void;
}) {
  const renderer = new CanvasRenderer(params.canvas);
  const view = new ViewController(
    params.modelCtrl.model, params.selection, renderer, () => params.getMetrics(renderer), () => params.opts.theme,
    () => params.opts.lineNumbers, params.overscan, params.tokenization,
    params.options.stickyScroll, params.options.scrollBeyondLastLine !== false,
  );
  view.setTokenTypeProvider((ln, col) => params.modelCtrl.getTokenTypeAt(params.tokenization, ln, col));
  view.setFoldingModel(params.folding);
  view.setFoldingEnabled(params.opts.foldingEnabled);
  view.setTabSize(params.opts.tabSize);
  view.setDynamicCaretColor(params.options.dynamicCaretColor !== false);
  if (params.options.wordWrap || params.options.wrappingIndent) {
    view.setWordWrap(params.options.wordWrap ?? 'off', params.options.wrappingIndent ?? 'same');
  }
  if (params.options.guides) view.setIndentGuides(params.options.guides);
  if (params.options.matchBrackets) view.setMatchBrackets(params.options.matchBrackets);
  if (params.options.occurrencesHighlight !== undefined) {
    view.setOccurrencesHighlight(params.options.occurrencesHighlight);
  }
  if (params.options.maxTokenizationLineLength != null) {
    params.tokenization.setLimits({ maxTokenizationLineLength: params.options.maxTokenizationLineLength });
  }
  const bracketColorizer = new BracketColorizer(
    params.options.bracketPairColorization,
    params.modelCtrl.model.getLanguageId(),
  );
  view.setLineBracketsProvider(
    (ln) =>
      bracketColorizer.getLineBrackets(params.modelCtrl.model, ln, (lineNo) =>
        params.tokenization.getLineTokens(params.modelCtrl.model, lineNo),
      ),
    (entry) =>
      bracketColorizer.resolveColor(
        entry,
        params.opts.theme.rainbowBrackets ?? DEFAULT_RAINBOW_BRACKET_COLORS,
        params.opts.theme.unexpectedBracketColor ?? DEFAULT_UNEXPECTED_BRACKET_COLOR,
      ),
  );
  view.setDecorationRenderProvider(() => [
    ...params.markers.toRenderItems(),
    ...params.decorations.toRenderItems(),
  ]);

  const scrollbar = new OverlayScrollbar(
    params.root,
    (scrollTop, scrollLeft) => {
      const topChanged = scrollTop !== null && Math.abs(scrollTop - view.scrollTop) > 0.01;
      const leftChanged = scrollLeft !== null && Math.abs(scrollLeft - view.scrollLeft) > 0.01;
      if (scrollTop !== null) view.scrollTop = scrollTop;
      if (scrollLeft !== null) view.scrollLeft = scrollLeft;
      view.clampScrollPublic();
      view.paint();
      if (topChanged || leftChanged) params.onScrollCommit(topChanged, leftChanged);
    },
    params.options.scrollbar,
  );

  const minimap = new MinimapController(
    params.root, params.modelCtrl.model, params.selection, view, params.tokenization, () => params.opts.theme,
    () => ({
      findMatches: (params.contributions.get(ContributionIds.Find) as IFindContribution | undefined)?.getMatches() ?? [],
      diagnostics: params.markers.getModelMarkers().map((mk) => ({
        startLineNumber: mk.startLineNumber,
        color: mk.severity >= 8 ? '#ef4444' : mk.severity >= 4 ? '#f59e0b' : '#38bdf8',
      })),
    }),
    params.isPeekEditor ? { enabled: false } : params.options.minimap,
    () => params.onScrollCommit(true, false),
  );
  view.setRightInset(minimap.getWidth());
  view.setOnPaint(() => {
    params.onSyncScrollbar(false);
    minimap.paint();
    for (const c of params.contributions.values()) c.onPaint?.();
  });

  const handleVis = new HandleVisibility((state, alpha) => {
    view.handlesVisible = state !== 'hidden';
    view.handleAlpha = alpha;
    view.schedulePaint();
  });

  const input = new InputController(
    params.root, params.modelCtrl.model, params.selection,
    (ev) => {
      handleVis.onType();
      params.onInputComplete(ev);
    },
    {
      tabSize: params.opts.tabSize, readOnly: params.opts.readOnly, pageSize: 40,
      bracketEnterIndent: params.options.bracketEnterIndent !== false,
      autoClosingBrackets: params.options.autoClosingBrackets,
      autoClosingQuotes: params.options.autoClosingQuotes,
      autoSurround: params.options.autoSurround,
      autoIndent: params.options.autoIndent,
      getTokenTypeAt: (ln, col) => params.modelCtrl.getTokenTypeAt(params.tokenization, ln, col),
      onCompositionChange: (range) => { view.compositionRange = range; view.paint(); },
    },
  );

  return { renderer, view, scrollbar, minimap, handleVis, input, bracketColorizer };
}

export function buildContributionHost(params: {
  editor: IMonoEditor;
  root: HTMLDivElement;
  view: ViewController;
  input: InputController;
  selection: SelectionState;
  commands: CommandService;
  keybindings: KeybindingService;
  folding: FoldingModel;
  tokenization: TokenizationSupport;
  markers: MarkerService;
  minimap: MinimapController;
  modelCtrl: ModelController;
  opts: EditorOptionState;
  isPeekEditor: boolean;
  initialOptions: MonoEditorOptions;
  contributions: Map<string, IEditorContribution>;
  isDisposed: () => boolean;
  getMetrics: () => RenderMetrics;
  syncTextarea: () => void;
  emitContent: () => void;
  emitCursorEvents: (source: string, keepSuggest?: boolean) => void;
  createNestedEditor: (container: HTMLElement, sharedModel: TextModel, extra?: Partial<MonoEditorOptions>) => IMonoEditor;
}): IEditorContributionHost {
  return {
    root: params.root, view: params.view, input: params.input, selection: params.selection,
    commands: params.commands, keybindings: params.keybindings, folding: params.folding,
    tokenization: params.tokenization, isPeekEditor: params.isPeekEditor, initialOptions: params.initialOptions,
    isDisposed: params.isDisposed, isReadOnly: () => params.opts.readOnly,
    isFoldingEnabled: () => params.opts.foldingEnabled, getTabSize: () => params.opts.tabSize,
    getFontFamily: () => params.opts.fontFamily, getFontSize: () => params.opts.fontSize,
    getLineHeight: () => params.opts.lineHeight, showLineNumbers: () => params.opts.lineNumbers,
    getTheme: () => params.opts.theme, getMinimapWidth: () => params.minimap.getWidth(),
    getHandlesShown: () => params.view.handlesVisible && params.view.handleAlpha > 0.01,
    getModel: () => params.modelCtrl.model, getModelUriKey: () => params.modelCtrl.modelUriKey,
    getMarkers: (filter) => params.markers.getModelMarkers(filter), getMetrics: params.getMetrics,
    getPosition: () => params.editor.getPosition(), getSelection: () => params.editor.getSelection(),
    focus: () => params.editor.focus(), syncTextarea: params.syncTextarea,
    emitContent: params.emitContent, emitCursorEvents: params.emitCursorEvents,
    setPosition: (p, c) => params.editor.setPosition(p, c),
    revealPosition: (p) => params.editor.revealPosition(p),
    revealPositionInCenter: (p) => params.editor.revealPositionInCenter(p),
    executeEdits: (s, e) => params.editor.executeEdits(s, e),
    applyTextEditsAtomic: (edits: TextEdit[], src: string) =>
      params.opts.readOnly || !edits.length
        ? false
        : params.editor.executeEdits(src, edits.map((ed) => ({ range: ed.range, text: ed.text }))),
    applyWorkspaceEdit: (edit: WorkspaceEdit, src: string) =>
      params.modelCtrl.applyWorkspaceEdit(edit, (te) =>
        params.editor.executeEdits(src, te.map((ed) => ({ range: ed.range, text: ed.text }))),
      ),
    jumpToLocation: (loc: Location) =>
      jumpEditorToLocation(
        loc, params.modelCtrl.modelUriKey, (m) => params.editor.setModel?.(m ?? null),
        (p) => params.editor.setPosition(p), (p) => params.editor.revealPositionInCenter(p), () => params.editor.focus(),
      ),
    executeCommand: (id, ...args) => params.editor.executeCommand!(id, ...args),
    getTokenTypeAt: (ln, col) => params.modelCtrl.getTokenTypeAt(params.tokenization, ln, col),
    getLanguageIdAtPosition: (ln, col) =>
      params.tokenization.getLanguageIdAtPosition(params.modelCtrl.model, ln, col),
    modelAsFeatureLike: () => params.modelCtrl.asFeatureLike(),
    wordAtPosition: (ln, col) => params.modelCtrl.wordAtPosition(ln, col),
    createNestedEditor: params.createNestedEditor,
    notifyLayoutChange: () => {
      params.syncTextarea();
      for (const c of params.contributions.values()) c.onLayout?.();
    },
  };
}
