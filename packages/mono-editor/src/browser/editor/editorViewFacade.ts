import { computeGutterLayout, type MonoEditorOptions, type RenderMetrics } from '../../common/config/editorOptions';
import type { BracketColorizer } from '../../common/brackets';
import type { SelectionState } from '../../common/core/SelectionState';
import type {
  IContextKey,
  IEditorLayoutInfo,
  IEditorMouseEvent,
  IEditorViewState,
  IMouseTarget,
  IPosition,
  IRange,
  MonoDisposable,
} from '../../common/core/types';
import type { DecorationsCollection } from '../../common/decorations/DecorationsCollection';
import type { IEditorDecorationsCollection, IModelDeltaDecoration } from '../../common/decorations/types';
import type { TokenizationSupport } from '../../common/languages/tokenization/TokenizationSupport';
import type { TextModel } from '../../common/model/TextModel';
import type { DocumentStructureService } from '../../common/structure/StructureBuilder';
import type { FoldingModel } from '../../common/viewModel/FoldingModel';
import type { CommandService } from '../../platform/commands/CommandService';
import type { CanvasRenderer } from '../render/CanvasRenderer';
import type { ViewController } from '../view/ViewController';
import { clampPosition } from './cursorApi';
import type { EditorEventBus } from './editorEvents';
import type { EditorOptionState } from './editorLifecycle';
import type { IEditorContribution, IMonoEditor, IMonoEditorAction } from './editorTypes';

export interface ICodeEditorOpener {
  openCodeEditor(
    source: IMonoEditor,
    resource: { toString(): string },
    selectionOrPosition?: IRange | IPosition,
  ): boolean | Promise<boolean>;
}

const createEditorListeners = new Set<(editor: IMonoEditor) => void>();
const editorOpeners = new Set<ICodeEditorOpener>();

export function onDidCreateMonoEditor(listener: (editor: IMonoEditor) => void): MonoDisposable {
  createEditorListeners.add(listener);
  return { dispose: () => createEditorListeners.delete(listener) };
}

export function notifyMonoEditorCreated(editor: IMonoEditor): void {
  for (const l of createEditorListeners) {
    try { l(editor); } catch { /* */ }
  }
}

export function registerMonoEditorOpener(opener: ICodeEditorOpener): MonoDisposable {
  editorOpeners.add(opener);
  return { dispose: () => editorOpeners.delete(opener) };
}

export async function tryOpenWithRegisteredOpeners(
  source: IMonoEditor,
  resource: { toString(): string },
  selectionOrPosition?: IRange | IPosition,
): Promise<boolean> {
  for (const opener of editorOpeners) {
    try {
      const handled = await opener.openCodeEditor(source, resource, selectionOrPosition);
      if (handled) return true;
    } catch { /* */ }
  }
  return false;
}

export function computeEditorLayoutInfo(params: {
  width: number;
  height: number;
  metrics: RenderMetrics;
  minimapWidth: number;
  glyphMargin: boolean;
  showLineNumbers: boolean;
}): IEditorLayoutInfo {
  const glyphW = params.glyphMargin ? (params.metrics.glyphMarginWidth ?? 20) : 0;
  const lineNumsW = params.showLineNumbers
    ? Math.max(0, params.metrics.gutterWidth - glyphW - params.metrics.foldGutterWidth)
    : 0;
  const decW = params.metrics.foldGutterWidth;
  const contentLeft = params.showLineNumbers || params.glyphMargin ? params.metrics.gutterWidth : 0;
  const contentWidth = Math.max(0, params.width - contentLeft - params.minimapWidth);
  return {
    width: params.width,
    height: params.height,
    glyphMarginLeft: 0,
    glyphMarginWidth: glyphW,
    lineNumbersLeft: glyphW,
    lineNumbersWidth: lineNumsW,
    decorationsLeft: glyphW + lineNumsW,
    decorationsWidth: decW,
    contentLeft,
    contentWidth,
    contentHeight: params.height,
    minimapWidth: params.minimapWidth,
    verticalScrollbarWidth: 10,
    horizontalScrollbarHeight: 10,
  };
}

export function saveEditorViewState(
  selection: SelectionState,
  view: ViewController,
  folding: FoldingModel,
): IEditorViewState {
  const firstVisible = view.getVisibleLineRange().startLineNumber;
  return {
    cursorState: selection.selections.map((s) => ({
      inSelectionMode:
        s.anchor.lineNumber !== s.active.lineNumber || s.anchor.column !== s.active.column,
      selectionStart: { ...s.anchor },
      position: { ...s.active },
    })),
    viewState: {
      scrollLeft: view.scrollLeft,
      scrollTop: view.scrollTop,
      firstPosition: { lineNumber: firstVisible, column: 1 },
    },
    contributionsState: {
      'editor.contrib.folding': { collapsedLines: folding.getCollapsedLines() },
    },
  };
}

export function restoreEditorViewState(
  state: IEditorViewState | null,
  model: TextModel,
  selection: SelectionState,
  view: ViewController,
  folding: FoldingModel,
): void {
  if (!state) return;
  const foldState = state.contributionsState?.['editor.contrib.folding'] as
    | { collapsedLines?: number[] }
    | undefined;
  if (foldState?.collapsedLines) {
    folding.restoreCollapsedLines(foldState.collapsedLines);
    view.projection.invalidate();
  }
  if (state.cursorState?.length) {
    const next = state.cursorState.map((c) => ({
      anchor: clampPosition(model, c.selectionStart.lineNumber, c.selectionStart.column),
      active: clampPosition(model, c.position.lineNumber, c.position.column),
    }));
    if (next.length === 1) {
      selection.anchor = next[0]!.anchor;
      selection.active = next[0]!.active;
    } else {
      selection.setSelections(next);
    }
  }
  if (state.viewState) {
    view.scrollTop = Math.max(0, state.viewState.scrollTop ?? 0);
    view.scrollLeft = Math.max(0, state.viewState.scrollLeft ?? 0);
    view.clampScrollPublic();
  }
}

export function createEditorDecorationsCollection(
  decorations: DecorationsCollection,
  onMutated: () => void,
  initial?: IModelDeltaDecoration[],
): IEditorDecorationsCollection {
  let ids: string[] = initial?.length ? decorations.deltaDecorations([], initial) : [];
  if (ids.length) onMutated();
  return {
    get length(): number { return ids.length; },
    set(newDecorations: IModelDeltaDecoration[]): string[] {
      ids = decorations.deltaDecorations(ids, newDecorations);
      onMutated();
      return [...ids];
    },
    append(newDecorations: IModelDeltaDecoration[]): string[] {
      const added = decorations.deltaDecorations([], newDecorations);
      ids = [...ids, ...added];
      onMutated();
      return added;
    },
    clear(): void {
      if (!ids.length) return;
      decorations.deltaDecorations(ids, []);
      ids = [];
      onMutated();
    },
    getRange(index: number): IRange | null {
      const id = ids[index];
      return id ? (decorations.getDecoration(id)?.range ?? null) : null;
    },
    getRanges(): IRange[] {
      const out: IRange[] = [];
      for (const id of ids) {
        const r = decorations.getDecoration(id)?.range;
        if (r) out.push(r);
      }
      return out;
    },
    has(decoration: { id: string }): boolean {
      return ids.includes(decoration.id);
    },
  };
}

export function createEditorContextKey<T = boolean | string | number>(
  commands: CommandService,
  key: string,
  defaultValue: T,
): IContextKey<T> {
  let current: T | undefined = defaultValue;
  commands.setContext(key, defaultValue as boolean | string | number);
  return {
    set(value: T | undefined): void {
      current = value;
      commands.setContext(key, (value ?? false) as boolean | string | number);
    },
    reset(): void {
      current = defaultValue;
      commands.setContext(key, defaultValue as boolean | string | number);
    },
    get(): T | undefined {
      return current;
    },
  };
}

export function wrapEditorMouseEvent(e: MouseEvent, target: IMouseTarget): IEditorMouseEvent {
  return {
    event: {
      clientX: e.clientX,
      clientY: e.clientY,
      button: e.button,
      buttons: e.buttons,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
      preventDefault: () => e.preventDefault(),
      stopPropagation: () => e.stopPropagation(),
    },
    target,
  };
}

export function getResolvedEditorOptions(opts: EditorOptionState): Readonly<MonoEditorOptions> {
  return {
    ...opts.rawOptions,
    fontFamily: opts.fontFamily,
    fontSize: opts.fontSize,
    lineHeight: opts.lineHeight,
    lineNumbers: opts.lineNumbersMode,
    lineNumbersMinChars: opts.lineNumbersMinChars,
    tabSize: opts.tabSize,
    insertSpaces: opts.insertSpaces,
    detectIndentation: opts.detectIndentation,
    trimAutoWhitespace: opts.trimAutoWhitespace,
    stickyTabStops: opts.stickyTabStops,
    emptySelectionClipboard: opts.emptySelectionClipboard,
    formatOnPaste: opts.formatOnPaste,
    readOnly: opts.readOnly,
    folding: opts.foldingEnabled,
    foldingStrategy: opts.foldingStrategy,
    glyphMargin: opts.glyphMargin,
    renderWhitespace: opts.renderWhitespace,
    rulers: [...opts.rulers],
    renderLineHighlight: opts.renderLineHighlight,
    cursorStyle: opts.cursorStyle,
    cursorBlinking: opts.cursorBlinking,
    cursorSurroundingLines: opts.cursorSurroundingLines,
    linkedEditing: opts.linkedEditing,
    codeLens: opts.codeLens,
    errorLens: opts.errorLens,
    pinchZoom: opts.pinchZoom,
    mobileQuickKeys: opts.mobileQuickKeys,
    ariaLabel: opts.ariaLabel,
    accessibilitySupport: opts.accessibilitySupport,
  };
}

export function getEditorOptionByName<T = unknown>(opts: EditorOptionState, name: string): T | undefined {
  const resolved = getResolvedEditorOptions(opts) as Record<string, unknown>;
  return resolved[name] as T | undefined;
}

export function computeEditorMetrics(
  renderer: CanvasRenderer,
  opts: EditorOptionState,
  lineCount: number,
): RenderMetrics {
  const charWidth = renderer.measureCharWidth(`${opts.fontSize}px ${opts.fontFamily}`);
  const { gutterWidth, glyphMarginWidth, foldGutterWidth, gutterNumberPad } = computeGutterLayout({
    lineNumbers: opts.lineNumbers,
    glyphMargin: opts.glyphMargin,
    foldingEnabled: opts.foldingEnabled,
    lineNumbersMinChars: opts.lineNumbersMinChars,
    lineCount,
    charWidth,
  });
  return {
    fontFamily: opts.fontFamily,
    fontSize: opts.fontSize,
    lineHeight: opts.lineHeight,
    gutterWidth,
    glyphMarginWidth,
    foldGutterWidth,
    gutterNumberPad,
    charWidth,
    paddingLeft: 8,
    paddingTop: 4,
  };
}

export function subscribeActiveTextModel(params: {
  model: TextModel;
  events: EditorEventBus;
  tokenization: TokenizationSupport;
  bracketColorizer: BracketColorizer;
  folding: FoldingModel;
  structure: DocumentStructureService;
  selection: SelectionState;
  view: ViewController;
  contributions: Map<string, IEditorContribution>;
  onContentSizeCheck: () => void;
}): () => void {
  const { model, events, tokenization, bracketColorizer, folding, structure, selection, view, contributions, onContentSizeCheck } = params;
  const u1 = model.onDidChange((versionId, change) => {
    events.recordModelChange(change);
    tokenization.applyChange(change, versionId);
    if (!change || change.full) bracketColorizer.invalidateAll();
    else bracketColorizer.applyChange(change.startLine, change.newLineCount - change.oldLineCount, versionId);
    structure.invalidate();
    folding.updateSync();
    if (folding.isLineHidden(selection.active.lineNumber)) folding.unfoldContaining(selection.active.lineNumber);
    for (const c of contributions.values()) c.onModelContentChange?.(versionId, change);
    view.invalidateScopes();
    view.paint();
    onContentSizeCheck();
  });
  const u2 = model.onDidChangeLanguage((ev) => events.emitModelLanguage(ev));
  const u3 = model.onDidChangeOptions((ev) => events.emitModelOptions(ev));
  return () => { u1(); u2(); u3(); };
}

export function getEditorActionById(commands: CommandService, id: string): IMonoEditorAction | null {
  const cmd = commands.getCommands().find((c) => c.id === id);
  return cmd
    ? { id: cmd.id, label: cmd.title ?? cmd.id, run: async () => { await commands.executeCommand(cmd.id); }, isSupported: () => true }
    : null;
}

export function listSupportedEditorActions(commands: CommandService): IMonoEditorAction[] {
  return commands.getCommands().map((c) => ({
    id: c.id,
    label: c.title ?? c.id,
    run: async () => { await commands.executeCommand(c.id); },
    isSupported: () => true,
  }));
}
