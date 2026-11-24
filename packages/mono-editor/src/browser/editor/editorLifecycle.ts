import type { BracketColorizer } from '../../common/brackets';
import type { MonoEditorOptions } from '../../common/config/editorOptions';
import type { MonoEditorTheme } from '../../common/config/themeTypes';
import type { TokenizationSupport } from '../../common/languages/tokenization/TokenizationSupport';
import { getRegisteredStandaloneModel } from '../../common/model/modelRegistry';
import type { Location } from '../../common/languages/providers/types';
import { monoThemeService, registerBuiltinThemes, resolveWidgetTheme } from '../../platform/theme';
import type { ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';
import type { InputController } from '../input/InputController';
import type { ViewController } from '../view/ViewController';
import type { MinimapController } from '../view/viewParts/MinimapController';
import type { OverlayScrollbar } from '../view/viewParts/OverlayScrollbar';
import type { CommandService } from '../../platform/commands/CommandService';
import type { IEditorContribution } from './editorTypes';
import type { ModelController } from './modelController';

export interface EditorOptionState {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  lineNumbers: boolean;
  lineNumbersMinChars: number;
  tabSize: number;
  readOnly: boolean;
  foldingEnabled: boolean;
  theme: MonoEditorTheme;
}

export function resolveEditorWidgetTheme(editorTheme: MonoEditorTheme): ResolvedWidgetTheme {
  let colors: Record<string, string> = {};
  try {
    colors = monoThemeService.resolve().colors;
  } catch {
    /* no theme registered */
  }
  return resolveWidgetTheme(editorTheme, colors);
}

export function resolveNamedOrPartialTheme(
  current: MonoEditorTheme,
  theme: Partial<MonoEditorTheme> | string,
): MonoEditorTheme {
  if (typeof theme === 'string') {
    registerBuiltinThemes();
    if (monoThemeService.getTheme(theme)) {
      monoThemeService.setTheme(theme);
      return { ...current, ...monoThemeService.toPartialEditorTheme(theme) };
    }
    if (theme === 'vs' || theme === 'light') {
      monoThemeService.setTheme('mscode-light');
      return { ...current, ...monoThemeService.toPartialEditorTheme() };
    }
    if (theme === 'vs-dark' || theme === 'dark') {
      monoThemeService.setTheme('mscode-dark');
      return { ...current, ...monoThemeService.toPartialEditorTheme() };
    }
    console.warn(`[MonoEditor] Unknown theme id "${theme}"`);
    return current;
  }
  return { ...current, ...theme };
}

export function applyEditorOptionsPatch(
  state: EditorOptionState,
  options: Partial<MonoEditorOptions>,
  deps: {
    root: HTMLDivElement;
    modelCtrl: ModelController;
    view: ViewController;
    input: InputController;
    commands: CommandService;
    scrollbar: OverlayScrollbar;
    minimap: MinimapController;
    tokenization?: TokenizationSupport;
    bracketColorizer?: BracketColorizer;
    isPeekEditor: boolean;
    applyAllWidgetThemes: () => void;
    setLanguageId: (id: string) => void;
    setValue: (v: string) => void;
    notifyContributions: (patch: Partial<MonoEditorOptions>) => void;
  },
): void {
  if (options.undoGroupIdleMs != null) {
    deps.modelCtrl.model.editStack.groupIdleMs = Math.max(0, options.undoGroupIdleMs);
  }
  if (options.fontFamily != null) state.fontFamily = options.fontFamily;
  if (options.fontSize != null) {
    state.fontSize = options.fontSize;
    if (options.lineHeight == null) state.lineHeight = Math.round(state.fontSize * 1.45);
  }
  if (options.lineHeight != null) state.lineHeight = options.lineHeight;
  if (options.tabSize != null) {
    state.tabSize = options.tabSize;
    deps.input.setTabSize(options.tabSize);
    deps.view.setTabSize(options.tabSize);
  }
  if (options.lineNumbers != null) {
    state.lineNumbers = options.lineNumbers === 'on';
    deps.view.projection.invalidate();
  }
  if (options.lineNumbersMinChars != null) {
    state.lineNumbersMinChars = Math.max(1, Math.floor(options.lineNumbersMinChars));
    deps.view.projection.invalidate();
  }
  if (options.readOnly != null) {
    state.readOnly = options.readOnly;
    deps.input.setReadOnly(options.readOnly);
    deps.commands.setContext('editorReadonly', options.readOnly);
  }
  if (options.theme) {
    state.theme = { ...state.theme, ...options.theme };
    deps.root.style.background = state.theme.background;
    deps.applyAllWidgetThemes();
  }
  if (options.dynamicCaretColor !== undefined) deps.view.setDynamicCaretColor(options.dynamicCaretColor);
  if (options.stickyScroll) deps.view.setStickyScroll(options.stickyScroll);
  if (options.scrollBeyondLastLine != null) deps.view.setScrollBeyondLastLine(options.scrollBeyondLastLine);
  if (options.wordWrap !== undefined || options.wrappingIndent !== undefined) {
    deps.view.setWordWrap(options.wordWrap ?? deps.view.getWordWrap(), options.wrappingIndent);
  }
  if (options.folding !== undefined) {
    state.foldingEnabled = options.folding;
    deps.view.setFoldingEnabled(options.folding);
  }
  if (options.guides) deps.view.setIndentGuides(options.guides);
  if (options.matchBrackets !== undefined) deps.view.setMatchBrackets(options.matchBrackets);
  if (options.occurrencesHighlight !== undefined) deps.view.setOccurrencesHighlight(options.occurrencesHighlight);
  if (options.scrollbar) deps.scrollbar.setOptions(options.scrollbar);
  if (options.minimap && !deps.isPeekEditor) {
    deps.minimap.setOptions(options.minimap);
    deps.view.setRightInset(deps.minimap.getWidth());
  }
  if (options.bracketEnterIndent != null) deps.input.setBracketEnterIndent(options.bracketEnterIndent);
  if (options.autoClosingBrackets != null) deps.input.setAutoClosingBrackets(options.autoClosingBrackets);
  if (options.autoClosingQuotes != null) deps.input.setAutoClosingQuotes(options.autoClosingQuotes);
  if (options.autoSurround != null) deps.input.setAutoSurround(options.autoSurround);
  if (options.autoIndent != null) deps.input.setAutoIndent(options.autoIndent);
  if (options.maxTokenizationLineLength != null) {
    deps.tokenization?.setLimits({ maxTokenizationLineLength: options.maxTokenizationLineLength });
  }
  if (options.bracketPairColorization !== undefined) {
    deps.bracketColorizer?.setOptions(options.bracketPairColorization);
  }

  deps.notifyContributions(options);

  if (options.language) deps.setLanguageId(options.language);
  if (options.value != null) deps.setValue(options.value);
}

export function attachRootDomListeners(params: {
  root: HTMLDivElement;
  textarea: HTMLTextAreaElement;
  isDisposed: () => boolean;
  getContributions: () => Iterable<IEditorContribution>;
  dispatchKeybinding: (e: KeyboardEvent) => boolean;
  onOutsidePointerDown: () => void;
  onWheelScroll: (dx: number, dy: number) => void;
  onWheelEnd: () => void;
}): () => void {
  let wheelEndTimer: number | undefined;

  const onRootKeyDown = (e: KeyboardEvent) => {
    if (params.isDisposed()) return;
    const active = document.activeElement;
    const inEditor = active === params.textarea || (active != null && params.root.contains(active));
    if (!inEditor) return;

    if (
      active &&
      active !== params.textarea &&
      active instanceof HTMLElement &&
      active.closest('input, textarea, select, [contenteditable="true"], [data-mono-focusable="true"]')
    ) {
      return;
    }

    for (const c of params.getContributions()) {
      if (c.onKeyDown?.(e)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }
    if (params.dispatchKeybinding(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const onDocPointerDown = (e: PointerEvent) => {
    const target = e.target as Node | null;
    if (target && !params.root.contains(target)) {
      params.onOutsidePointerDown();
    }
  };

  const onWheel = (e: WheelEvent) => {
    const target = e.target as Node | null;
    if (target) {
      for (const c of params.getContributions()) {
        if (c.shouldAllowWheelTarget?.(target)) return;
      }
    }
    e.preventDefault();
    params.onWheelScroll(e.deltaX, e.deltaY);
    if (wheelEndTimer !== undefined) window.clearTimeout(wheelEndTimer);
    wheelEndTimer = window.setTimeout(() => params.onWheelEnd(), 150);
  };

  window.addEventListener('keydown', onRootKeyDown, true);
  document.addEventListener('pointerdown', onDocPointerDown, true);
  params.root.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    window.removeEventListener('keydown', onRootKeyDown, true);
    document.removeEventListener('pointerdown', onDocPointerDown, true);
    params.root.removeEventListener('wheel', onWheel);
    if (wheelEndTimer !== undefined) window.clearTimeout(wheelEndTimer);
  };
}

export function jumpEditorToLocation(
  loc: Location,
  currentUriKey: string,
  setModel: (m: ReturnType<typeof getRegisteredStandaloneModel>) => void,
  setPosition: (pos: { lineNumber: number; column: number }) => void,
  revealPositionInCenter: (pos: { lineNumber: number; column: number }) => void,
  focus: () => void,
): void {
  const targetKey = loc.uri?.toString();
  if (targetKey && targetKey !== currentUriKey) {
    const targetModel = getRegisteredStandaloneModel(targetKey);
    if (targetModel) setModel(targetModel);
  }
  const pos = { lineNumber: loc.range.startLineNumber, column: loc.range.startColumn };
  setPosition(pos);
  revealPositionInCenter(pos);
  focus();
}

export function restoreModelViewState(params: {
  saved: import('./modelController').SavedModelViewState | undefined;
  model: import('../../common/model/TextModel').TextModel;
  folding: import('../../common/viewModel/FoldingModel').FoldingModel;
  view: ViewController;
  selection: import('../../common/core/SelectionState').SelectionState;
  clampPos: (ln: number, col: number) => { lineNumber: number; column: number };
}): void {
  if (params.saved) {
    params.folding.restoreCollapsedLines(params.saved.collapsedLines);
    params.view.projection.invalidate();
    params.selection.anchor = params.clampPos(params.saved.anchor.lineNumber, params.saved.anchor.column);
    params.selection.active = params.clampPos(params.saved.active.lineNumber, params.saved.active.column);
    params.view.scrollTop = params.saved.scrollTop;
    params.view.scrollLeft = params.saved.scrollLeft;
  } else {
    params.folding.unfoldAll();
    params.view.projection.invalidate();
    params.selection.setCaret(1, 1);
    params.view.scrollTop = 0;
    params.view.scrollLeft = 0;
  }
}

export function dispatchPointerInteraction(
  kind: import('../input/pointer/PointerController').PointerInteractKind,
  deps: {
    view: ViewController;
    input: InputController;
    selection: import('../../common/core/SelectionState').SelectionState;
    commands: CommandService;
    handleVis: import('../view/viewParts/HandleVisibility').HandleVisibility;
    contributions: Iterable<IEditorContribution>;
    pushStackElement: () => void;
    syncTextarea: () => void;
    emitCursorEvents: (src: string) => void;
    onScrollDelta: () => void;
  },
): void {
  if (kind === 'scroll') {
    deps.handleVis.onScrollStart();
    for (const c of deps.contributions) c.onPointerInteract?.('scroll');
    deps.onScrollDelta();
    return;
  }
  if (kind === 'scrollEnd') {
    deps.handleVis.onScrollEnd();
    for (const c of deps.contributions) c.onScrollEnd?.();
    return;
  }
  deps.pushStackElement();
  deps.handleVis.onUserInteract();
  deps.syncTextarea();
  if (kind === 'tap' || kind === 'handleTap') deps.input.focus();
  deps.view.paint();
  if (kind === 'tap' || kind === 'handle' || kind === 'select') deps.emitCursorEvents('mouse');
  if (kind === 'handleTap' || kind === 'select') {
    deps.commands.setContext('editorHasSelection', !deps.selection.isEmpty);
  }
  for (const c of deps.contributions) c.onPointerInteract?.(kind);
}
