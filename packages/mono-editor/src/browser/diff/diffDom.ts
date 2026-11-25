import type { MonoEditorOptions } from '../../common/config/editorOptions';
import { DEFAULT_THEME } from '../../common/config/themeTypes';
import type { ILineChange } from '../../common/diff/myersDiff';
import { monoThemeService, resolveWidgetTheme, type ResolvedWidgetTheme } from '../../platform/theme';
import type { MonoEditor } from '../editor/MonoEditor';
import type {
  IDiffNavigator,
  IDiffNavigatorOptions,
  IMonoDiffEditor,
  MonoDiffEditorOptions,
} from './diffTypes';

const DIFF_ONLY_KEYS = new Set<string>([
  'renderSideBySide',
  'renderSideBySideInlineBreakpoint',
  'inlineBreakpointPx',
  'useInlineViewWhenSpaceIsLimited',
  'enableSplitViewResizing',
  'ignoreTrimWhitespace',
  'renderIndicators',
  'originalEditable',
  'renderOverviewRuler',
  'renderMarginRevertIcon',
  'maxComputationTime',
  'maxFileSize',
  'diffAlgorithm',
  'hideUnchangedRegions',
  'experimental',
  'diffWordWrap',
  'isInEmbeddedEditor',
  'compactMode',
  'toolbar',
  'originalEditorOptions',
  'modifiedEditorOptions',
]);

export function extractBaseEditorOptions(opts: MonoDiffEditorOptions): Partial<MonoEditorOptions> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(opts)) {
    if (!DIFF_ONLY_KEYS.has(k) && v !== undefined) out[k] = v;
  }
  if (opts.diffWordWrap === 'on') out.wordWrap = 'on';
  else if (opts.diffWordWrap === 'off') out.wordWrap = 'off';
  return out as Partial<MonoEditorOptions>;
}

export function createMonoDiffNavigator(
  diffEditor: IMonoDiffEditor,
  opts?: IDiffNavigatorOptions,
): IDiffNavigator {
  let disposed = false;
  const sub =
    opts?.alwaysRevealFirst
      ? diffEditor.onDidUpdateDiff(() => {
          if (!disposed) diffEditor.revealFirstDiff();
        })
      : null;
  if (opts?.alwaysRevealFirst) diffEditor.revealFirstDiff();
  return {
    canNavigate: () => !disposed && (diffEditor.getLineChanges()?.length ?? 0) > 0,
    next: () => { if (!disposed) diffEditor.goToDiff('next'); },
    previous: () => { if (!disposed) diffEditor.goToDiff('previous'); },
    dispose: () => {
      disposed = true;
      sub?.dispose();
    },
  };
}

export interface DiffDomNodes {
  root: HTMLDivElement;
  header: HTMLDivElement;
  summaryEl: HTMLSpanElement;
  prevBtn: HTMLButtonElement;
  nextBtn: HTMLButtonElement;
  modeBtn: HTMLButtonElement;
  panesWrap: HTMLDivElement;
  origPane: HTMLDivElement;
  splitter: HTMLDivElement;
  revertGutter: HTMLDivElement;
  modPane: HTMLDivElement;
}

export function resolveDiffColors(): {
  editorTheme: typeof DEFAULT_THEME;
  wt: ResolvedWidgetTheme;
} {
  const editorTheme = { ...DEFAULT_THEME, ...monoThemeService.toPartialEditorTheme() };
  let colors: Record<string, string> = {};
  try { colors = monoThemeService.resolve().colors; } catch { /* */ }
  const wt = resolveWidgetTheme(editorTheme, colors);
  return { editorTheme, wt };
}

function makeToolbarButton(label: string, ariaLabel: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.setAttribute('aria-label', ariaLabel);
  Object.assign(btn.style, {
    minHeight: '30px',
    minWidth: '38px',
    padding: '0 10px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '500',
  });
  btn.addEventListener('click', onClick);
  return btn;
}

export function createDiffDom(params: {
  id: string;
  showToolbar: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToggleMode: () => void;
}): DiffDomNodes {
  const root = document.createElement('div');
  root.className = 'mono-diff-editor';
  root.setAttribute('data-mono-diff-editor', params.id);
  Object.assign(root.style, {
    position: 'relative',
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    boxSizing: 'border-box',
  });

  const header = document.createElement('div');
  header.className = 'mono-diff-toolbar';
  Object.assign(header.style, {
    display: params.showToolbar ? 'flex' : 'none',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '4px 10px',
    minHeight: '40px',
    flexShrink: '0',
    fontSize: '12px',
    boxSizing: 'border-box',
  });

  const summaryEl = document.createElement('span');
  summaryEl.style.fontVariantNumeric = 'tabular-nums';
  summaryEl.style.fontWeight = '600';

  const controls = document.createElement('div');
  Object.assign(controls.style, { display: 'flex', alignItems: 'center', gap: '6px' });
  const prevBtn = makeToolbarButton('Prev', 'Previous change (Shift+F7)', params.onPrev);
  const nextBtn = makeToolbarButton('Next', 'Next change (F7)', params.onNext);
  const modeBtn = makeToolbarButton('Inline', 'Toggle inline / side-by-side diff', params.onToggleMode);
  controls.append(prevBtn, nextBtn, modeBtn);
  header.append(summaryEl, controls);

  // Each pane strictly min-width: 0; overflow: hidden so text NEVER overlaps across split panes
  const panesWrap = document.createElement('div');
  panesWrap.className = 'mono-diff-panes';
  Object.assign(panesWrap.style, {
    flex: '1 1 auto',
    minHeight: '0',
    minWidth: '0',
    width: '100%',
    display: 'flex',
    flexDirection: 'row',
    position: 'relative',
    overflow: 'hidden',
  });

  const origPane = document.createElement('div');
  origPane.className = 'mono-diff-pane mono-diff-original';
  Object.assign(origPane.style, {
    position: 'relative',
    minWidth: '0',
    minHeight: '0',
    height: '100%',
    overflow: 'hidden',
    boxSizing: 'border-box',
  });

  const splitter = document.createElement('div');
  splitter.className = 'mono-diff-splitter';
  Object.assign(splitter.style, {
    width: '5px',
    flex: '0 0 5px',
    height: '100%',
    cursor: 'col-resize',
    position: 'relative',
    zIndex: '5',
    boxSizing: 'border-box',
    touchAction: 'none',
  });

  const revertGutter = document.createElement('div');
  revertGutter.className = 'mono-diff-revert-gutter';
  Object.assign(revertGutter.style, {
    position: 'relative',
    width: '20px',
    flex: '0 0 20px',
    height: '100%',
    overflow: 'hidden',
    boxSizing: 'border-box',
  });

  const modPane = document.createElement('div');
  modPane.className = 'mono-diff-pane mono-diff-modified';
  Object.assign(modPane.style, {
    position: 'relative',
    minWidth: '0',
    minHeight: '0',
    height: '100%',
    overflow: 'hidden',
    boxSizing: 'border-box',
  });

  panesWrap.append(origPane, splitter, revertGutter, modPane);
  root.append(header, panesWrap);
  return {
    root,
    header,
    summaryEl,
    prevBtn,
    nextBtn,
    modeBtn,
    panesWrap,
    origPane,
    splitter,
    revertGutter,
    modPane,
  };
}

export function applyDiffTheme(dom: DiffDomNodes): void {
  const { editorTheme, wt } = resolveDiffColors();
  dom.root.style.background = editorTheme.background;
  dom.root.style.color = editorTheme.foreground;
  dom.header.style.background = wt.background;
  dom.header.style.borderBottom = `1px solid ${wt.border}`;
  dom.header.style.color = wt.foreground;
  dom.splitter.style.background = wt.border;
  dom.revertGutter.style.background = editorTheme.gutterBackground;
  dom.revertGutter.style.borderRight = `1px solid ${wt.border}`;
  for (const btn of [dom.prevBtn, dom.nextBtn, dom.modeBtn]) {
    btn.style.background = wt.inputBackground;
    btn.style.color = wt.foreground;
    btn.style.border = `1px solid ${wt.border}`;
  }
}

export function renderDiffRevertArrows(params: {
  revertGutter: HTMLDivElement;
  modifiedEditor: MonoEditor;
  changes: readonly ILineChange[];
  visible: boolean;
  onRevert: (ch: ILineChange) => void;
}): void {
  const { revertGutter, modifiedEditor, changes, visible, onRevert } = params;
  revertGutter.textContent = '';
  if (!visible || !changes.length) return;
  const { wt } = resolveDiffColors();
  const scrollTop = modifiedEditor.getScrollTop();
  const h = revertGutter.clientHeight || 400;

  for (const ch of changes) {
    const targetLine = Math.max(1, ch.modifiedStartLineNumber || 1);
    const top = modifiedEditor.getTopForLineNumber(targetLine) - scrollTop;
    if (top < -24 || top > h + 24) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '→';
    btn.title = 'Revert this change';
    btn.setAttribute('aria-label', 'Revert this change');
    Object.assign(btn.style, {
      position: 'absolute',
      left: '1px',
      top: `${Math.round(top)}px`,
      width: '18px',
      height: '18px',
      padding: '0',
      border: 'none',
      borderRadius: '3px',
      background: 'transparent',
      color: wt.mutedForeground,
      fontSize: '12px',
      lineHeight: '18px',
      cursor: 'pointer',
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onRevert(ch);
    });
    revertGutter.appendChild(btn);
  }
}
