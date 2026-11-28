import {
  BracketColorizer,
  DEFAULT_RAINBOW_BRACKET_COLORS,
  DEFAULT_UNEXPECTED_BRACKET_COLOR,
} from '../../common/brackets';
import {
  DEFAULT_MONO_FONT_FAMILY,
  type MonoEditorOptions,
  type RenderMetrics,
} from '../../common/config/editorOptions';
import { DEFAULT_THEME } from '../../common/config/themeTypes';
import type { SelectionState } from '../../common/core/SelectionState';
import type { IRange } from '../../common/core/types';
import type { DecorationsCollection } from '../../common/decorations/DecorationsCollection';
import type { MarkerService } from '../../common/decorations/MarkerService';
import type { Location, TextEdit, WorkspaceEdit } from '../../common/languages/providers/types';
import type { TokenizationSupport } from '../../common/languages/tokenization/TokenizationSupport';
import type { TextModel } from '../../common/model/TextModel';
import type { DocumentStructureService } from '../../common/structure/StructureBuilder';
import type { FoldingModel } from '../../common/viewModel/FoldingModel';
import type { CommandService } from '../../platform/commands/CommandService';
import type { KeybindingService } from '../../platform/keybindings/KeybindingService';
import { monoThemeService } from '../../platform/theme';
import { InputController, type InputChangeEvent } from '../input/InputController';
import { PointerController } from '../input/pointer/PointerController';
import { CanvasRenderer } from '../render/CanvasRenderer';
import { ViewController } from '../view/ViewController';
import { EditorWidgetManager } from '../view/WidgetManagers';
import { HandleVisibility } from '../view/viewParts/HandleVisibility';
import { MinimapController } from '../view/viewParts/MinimapController';
import { OverlayScrollbar } from '../view/viewParts/OverlayScrollbar';
import type { EditorEventBus } from './editorEvents';
import { dispatchPointerInteraction, jumpEditorToLocation, type EditorOptionState } from './editorLifecycle';
import { wrapEditorMouseEvent } from './editorViewFacade';
import {
  ContributionIds,
  type IEditorContribution,
  type IEditorContributionHost,
  type IFindContribution,
  type IMonoEditor,
  type WidgetBoxRect,
} from './editorTypes';
import type { ModelController } from './modelController';

export function createInitialOptionState(options: MonoEditorOptions): EditorOptionState {
  const fontSize = options.fontSize ?? 14;
  const lineNumbersMode = options.lineNumbers ?? 'on';
  return {
    fontFamily: options.fontFamily ?? DEFAULT_MONO_FONT_FAMILY,
    fontSize,
    lineHeight: options.lineHeight ?? Math.round(fontSize * 1.45),
    lineNumbers: lineNumbersMode !== 'off',
    lineNumbersMode,
    lineNumbersMinChars: options.lineNumbersMinChars != null ? Math.max(1, Math.floor(options.lineNumbersMinChars)) : 2,
    tabSize: options.tabSize ?? 2,
    insertSpaces: options.insertSpaces ?? true,
    detectIndentation: options.detectIndentation ?? false,
    trimAutoWhitespace: options.trimAutoWhitespace ?? true,
    stickyTabStops: options.stickyTabStops ?? false,
    emptySelectionClipboard: options.emptySelectionClipboard ?? true,
    formatOnPaste: options.formatOnPaste ?? false,
    readOnly: !!options.readOnly,
    foldingEnabled: typeof options.folding === 'boolean' ? options.folding : options.folding?.enabled !== false,
    foldingStrategy: options.foldingStrategy ?? (typeof options.folding === 'object' ? options.folding?.strategy : undefined) ?? 'auto',
    glyphMargin: !!options.glyphMargin,
    renderWhitespace: options.renderWhitespace ?? 'none',
    rulers: options.rulers ? [...options.rulers] : [],
    renderLineHighlight: options.renderLineHighlight ?? 'line',
    cursorStyle: options.cursorStyle ?? 'line',
    cursorWidth: Math.max(1, Math.min(10, Math.round(options.cursorWidth ?? 2))),
    cursorBlinking: options.cursorBlinking ?? 'blink',
    cursorSurroundingLines: Math.max(0, options.cursorSurroundingLines ?? 0),
    cursorSurroundingLinesStyle: options.cursorSurroundingLinesStyle ?? 'default',
    cursorSmoothCaretAnimation: options.cursorSmoothCaretAnimation ?? 'off',
    multiCursorModifier: options.multiCursorModifier ?? 'alt',
    multiCursorPaste: options.multiCursorPaste ?? 'spread',
    multiCursorLimit: Math.max(1, Math.min(100000, Math.round(options.multiCursorLimit ?? 10000))),
    linkedEditing: options.linkedEditing !== false,
    codeLens: options.codeLens !== false,
    errorLens: options.errorLens ?? false,
    pinchZoom: options.pinchZoom !== false,
    mobileQuickKeys: options.mobileQuickKeys ?? false,
    ariaLabel: options.ariaLabel ?? 'Mono Code Editor',
    accessibilitySupport: options.accessibilitySupport ?? 'auto',
    theme: { ...DEFAULT_THEME, ...monoThemeService.toPartialEditorTheme(), ...options.theme },
    rawOptions: { ...options },
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
  getMetrics: (renderer: CanvasRenderer) => RenderMetrics;
  onScrollCommit: (topChanged: boolean, leftChanged: boolean) => void;
  onSyncScrollbar: (activeScroll: boolean) => void;
  onInputComplete: (ev: InputChangeEvent) => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
  onDidPaste?: (range: IRange) => void;
  onKeyDownEvent?: (e: KeyboardEvent) => void;
  onKeyUpEvent?: (e: KeyboardEvent) => void;
  onTextFocus?: () => void;
  onTextBlur?: () => void;
}) {
  const renderer = new CanvasRenderer(params.canvas);
  const view = new ViewController(
    params.modelCtrl.model, params.selection, renderer, () => params.getMetrics(renderer), () => params.opts.theme,
    () => params.opts.lineNumbers, params.overscan, params.tokenization,
    params.options.stickyScroll, params.options.scrollBeyondLastLine !== false,
  );
  params.selection.setMaxCursors(params.opts.multiCursorLimit);
  view.setTokenTypeProvider((ln, col) => params.modelCtrl.getTokenTypeAt(params.tokenization, ln, col));
  view.setFoldingModel(params.folding);
  view.setFoldingEnabled(params.opts.foldingEnabled);
  view.setTabSize(params.opts.tabSize);
  view.setDynamicCaretColor(params.options.dynamicCaretColor !== false);
  view.setDisplayOptions({
    lineNumbersMode: params.opts.lineNumbersMode,
    glyphMargin: params.opts.glyphMargin,
    renderWhitespace: params.opts.renderWhitespace,
    rulers: params.opts.rulers,
    renderLineHighlight: params.opts.renderLineHighlight,
    cursorStyle: params.opts.cursorStyle,
    cursorWidth: params.opts.cursorWidth,
    cursorBlinking: params.opts.cursorBlinking,
    cursorSurroundingLines: params.opts.cursorSurroundingLines,
    cursorSurroundingLinesStyle: params.opts.cursorSurroundingLinesStyle,
    cursorSmoothCaretAnimation: params.opts.cursorSmoothCaretAnimation,
    errorLens: params.opts.errorLens,
  });
  view.setMarkersProvider(() => params.markers.getModelMarkers());
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
    (ln) => bracketColorizer.getLineBrackets(params.modelCtrl.model, ln, (lineNo) => params.tokenization.getLineTokens(params.modelCtrl.model, lineNo)),
    (entry) => bracketColorizer.resolveColor(entry, params.opts.theme.rainbowBrackets ?? DEFAULT_RAINBOW_BRACKET_COLORS, params.opts.theme.unexpectedBracketColor ?? DEFAULT_UNEXPECTED_BRACKET_COLOR),
  );
  view.setDecorationRenderProvider(() => [
    ...params.markers.toRenderItems(),
    ...params.decorations.toRenderItems(),
  ]);

  const widgets = new EditorWidgetManager({
    root: params.root,
    getLineHeight: () => params.opts.lineHeight,
    getContentLeft: () => view.contentLeft,
    getCssWidth: () => view.cssWidth,
    getCssHeight: () => view.cssHeight,
    screenPosOf: (ln, col) => view.screenPosOf(ln, col),
    getZoneTopForLine: (afterLn, zoneId) => view.getZoneTopForLine(afterLn, zoneId),
    onZonesChanged: (specs) => view.setExtraViewZones(specs),
  });

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
    widgets.layoutAll();
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
      if (ev.kind !== 'composition') {
        view.notifyCaretActivity(ev.kind === 'move' ? 'explicit' : 'edit');
      }
      params.onInputComplete(ev);
    },
    {
      tabSize: params.opts.tabSize,
      insertSpaces: params.opts.insertSpaces,
      stickyTabStops: params.opts.stickyTabStops,
      trimAutoWhitespace: params.opts.trimAutoWhitespace,
      readOnly: params.opts.readOnly,
      ariaLabel: params.opts.ariaLabel,
      pageSize: 40,
      multiCursorPaste: params.opts.multiCursorPaste,
      bracketEnterIndent: params.options.bracketEnterIndent !== false,
      autoClosingBrackets: params.options.autoClosingBrackets,
      autoClosingQuotes: params.options.autoClosingQuotes,
      autoSurround: params.options.autoSurround,
      autoIndent: params.options.autoIndent,
      getTokenTypeAt: (ln, col) => params.modelCtrl.getTokenTypeAt(params.tokenization, ln, col),
      onCompositionChange: (range) => { view.compositionRange = range; view.paint(); },
      onCompositionStart: params.onCompositionStart,
      onCompositionEnd: params.onCompositionEnd,
      onDidPaste: params.onDidPaste,
      onKeyDownEvent: params.onKeyDownEvent,
      onKeyUpEvent: params.onKeyUpEvent,
      onFocus: () => {
        view.setCursorFocused(true);
        params.onTextFocus?.();
      },
      onBlur: () => {
        setTimeout(() => {
          const active = document.activeElement;
          if (
            active &&
            active !== input.textarea &&
            active !== document.body &&
            active !== document.documentElement &&
            (!params.root.contains(active) ||
              Boolean((active as HTMLElement).closest?.('input, textarea, select, [contenteditable="true"], [data-mono-focusable="true"]')))
          ) {
            view.setCursorFocused(false);
          }
        }, 0);
        params.onTextBlur?.();
      },
    },
  );

  return { renderer, view, widgets, scrollbar, minimap, handleVis, input, bracketColorizer };
}

export function buildContributionHost(params: {
  editor: IMonoEditor;
  root: HTMLDivElement;
  view: ViewController;
  widgets: EditorWidgetManager;
  input: InputController;
  selection: SelectionState;
  commands: CommandService;
  keybindings: KeybindingService;
  folding: FoldingModel;
  structure: DocumentStructureService;
  tokenization: TokenizationSupport;
  markers: MarkerService;
  minimap: MinimapController;
  modelCtrl: ModelController;
  opts: EditorOptionState;
  isPeekEditor: boolean;
  initialOptions: MonoEditorOptions;
  contributions: Map<string, IEditorContribution>;
  events: EditorEventBus;
  isDisposed: () => boolean;
  getMetrics: () => RenderMetrics;
  syncTextarea: () => void;
  emitContent: () => void;
  emitCursorEvents: (source: string, keepSuggest?: boolean) => void;
  createNestedEditor: (container: HTMLElement, sharedModel: TextModel, extra?: Partial<MonoEditorOptions>) => IMonoEditor;
}): IEditorContributionHost {
  let suggestRect: WidgetBoxRect | null = null;
  return {
    root: params.root, view: params.view, input: params.input, selection: params.selection,
    commands: params.commands, keybindings: params.keybindings, folding: params.folding,
    tokenization: params.tokenization, isPeekEditor: params.isPeekEditor, initialOptions: params.initialOptions,
    isDisposed: params.isDisposed, isReadOnly: () => params.opts.readOnly,
    isFoldingEnabled: () => params.opts.foldingEnabled, getTabSize: () => params.opts.tabSize,
    getMultiCursorLimit: () => params.opts.multiCursorLimit,
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
        loc, params.modelCtrl.modelUriKey, (m) => params.editor.setModel(m ?? null),
        (p) => params.editor.setPosition(p), (p) => params.editor.revealPositionInCenter(p), () => params.editor.focus(),
      ),
    executeCommand: (id, ...args) => params.editor.executeCommand(id, ...args),
    getTokenTypeAt: (ln, col) => params.modelCtrl.getTokenTypeAt(params.tokenization, ln, col),
    getLanguageIdAtPosition: (ln, col) => params.tokenization.getLanguageIdAtPosition(params.modelCtrl.model, ln, col),
    modelAsFeatureLike: () => params.modelCtrl.asFeatureLike(),
    wordAtPosition: (ln, col) => params.modelCtrl.wordAtPosition(ln, col),
    createNestedEditor: params.createNestedEditor,
    notifyLayoutChange: () => {
      params.syncTextarea();
      params.widgets.layoutAll();
      for (const c of params.contributions.values()) c.onLayout?.();
    },
    changeViewZones: (cb) => params.widgets.changeViewZones(cb),
    addContentWidget: (w) => params.widgets.addContentWidget(w),
    layoutContentWidget: (w) => params.widgets.layoutContentWidget(w),
    removeContentWidget: (w) => params.widgets.removeContentWidget(w),
    addOverlayWidget: (w) => params.widgets.addOverlayWidget(w),
    layoutOverlayWidget: (w) => params.widgets.layoutOverlayWidget(w),
    removeOverlayWidget: (w) => params.widgets.removeOverlayWidget(w),
    announce: (msg) => params.input.announce(msg),
    getDocumentSymbols: () => params.editor.getDocumentSymbols(),
    getStructure: () => params.structure,
    setExternalStructureSymbols: (syms) => params.structure.setExternalSymbols(syms),
    emitInlayHintClick: (e) => params.events.emitInlayHintClick(e),
    emitRequestGoToLine: (e) => params.events.emitRequestGoToLine(e),
    emitRequestGoToSymbol: () => params.events.emitRequestGoToSymbol(),
    setContext: (k, v) => params.commands.setContext(k, v),
    getContext: (k) => params.commands.getContext(k),
    setSuggestWidgetRect: (r) => {
      suggestRect = r;
      params.commands.setContext('suggestWidgetVisible', r !== null);
    },
    getSuggestWidgetRect: () => suggestRect,
    isSuggestVisible: () => suggestRect !== null,
    setGhostTexts: (items) => params.editor.setGhostTexts(items),
    clearGhostTexts: (owner) => params.editor.clearGhostTexts(owner),
    getGhostTexts: (owner) => params.editor.getGhostTexts(owner),
    showContextMenu: () => params.editor.showContextMenu(),
    hideContextMenu: () => params.editor.hideContextMenu(),
  };
}

export function createEditorPointer(params: {
  root: HTMLDivElement;
  modelCtrl: ModelController;
  selection: SelectionState;
  view: ViewController;
  renderer: CanvasRenderer;
  input: InputController;
  commands: CommandService;
  handleVis: HandleVisibility;
  events: EditorEventBus;
  opts: EditorOptionState;
  contributions: Map<string, IEditorContribution>;
  getMetrics: () => RenderMetrics;
  syncTextarea: () => void;
  emitCursorEvents: (source: string) => void;
  onScrollDelta: () => void;
  toggleFoldAtLine: (ln: number) => void;
  updateFontSize: (fontSize: number) => void;
}): PointerController {
  return new PointerController(
    params.root,
    params.modelCtrl.model,
    params.selection,
    params.view,
    params.getMetrics,
    () => params.renderer.lastTeardrops,
    (kind) => dispatchPointerInteraction(kind, {
      view: params.view,
      input: params.input,
      selection: params.selection,
      commands: params.commands,
      handleVis: params.handleVis,
      contributions: params.contributions.values(),
      pushStackElement: () => params.modelCtrl.model.pushStackElement(),
      syncTextarea: params.syncTextarea,
      emitCursorEvents: params.emitCursorEvents,
      onScrollDelta: params.onScrollDelta,
    }),
    params.toggleFoldAtLine,
    (h) => { for (const c of params.contributions.values()) c.onColorSwatchClick?.(h); },
    (h, meta) => { for (const c of params.contributions.values()) c.onInlayHintClick?.(h, meta); },
    (h, ev) => { for (const c of params.contributions.values()) c.onLinkClick?.(h, ev); },
    {
      onMouseEvent: (k, e) => {
        const r = params.root.getBoundingClientRect();
        const target = params.view.getTargetAtLocalPoint(e.clientX - r.left, e.clientY - r.top, e.target);
        params.events.emitMouse(k, wrapEditorMouseEvent(e, target));
      },
      onTapMeta: (info) => {
        for (const c of params.contributions.values()) c.onPointerTapMeta?.(info);
      },
      onPinchZoom: (ratio) => {
        if (!params.opts.pinchZoom) return;
        const n = Math.max(10, Math.min(32, Math.round(params.opts.fontSize * ratio)));
        if (n !== params.opts.fontSize) params.updateFontSize(n);
      },
      getMultiCursorModifier: () => params.opts.multiCursorModifier,
    },
  );
}
