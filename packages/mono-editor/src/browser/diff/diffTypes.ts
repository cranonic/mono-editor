import type { MonoEditorOptions } from '../../common/config/editorOptions';
import type {
  IContentSizeChangedEvent,
  IDimension,
  IEditorViewState,
  IMonoTextModel,
  MonoDisposable,
} from '../../common/core/types';
import type { IDiffComputationResult, ILineChange, LineDiffResult } from '../../common/diff/myersDiff';
import type { IMonoEditor } from '../editor/editorTypes';

export interface IDiffEditorModel {
  original: IMonoTextModel;
  modified: IMonoTextModel;
}

export interface IHideUnchangedRegionsOptions {
  enabled?: boolean;
  revealLineCount?: number;
  minimumLineCount?: number;
  contextLineCount?: number;
}

export interface IDiffEditorViewState {
  original: IEditorViewState | null;
  modified: IEditorViewState | null;
}

export interface MonoDiffEditorOptions extends Partial<MonoEditorOptions> {
  /** Force side-by-side (`true`) or inline unified (`false`). Default: auto-responsive (`width >= 900`). */
  renderSideBySide?: boolean;
  /** Viewport width breakpoint (px) below which auto mode switches to inline diff (Monaco default `900`). */
  renderSideBySideInlineBreakpoint?: number;
  /** Back-compat alias for `renderSideBySideInlineBreakpoint`. */
  inlineBreakpointPx?: number;
  /** Automatically switch to inline view when container width is below breakpoint. Default `true`. */
  useInlineViewWhenSpaceIsLimited?: boolean;
  /** Allow dragging the split divider between panes. Default `true`. */
  enableSplitViewResizing?: boolean;
  /** Ignore leading and trailing whitespace differences. Default `true`. */
  ignoreTrimWhitespace?: boolean;
  /** Show `+` / `−` gutter indicators on changed lines. Default `true`. */
  renderIndicators?: boolean;
  /** Allow editing the original (left) editor. Default `false`. */
  originalEditable?: boolean;
  /** Make modified (right) editor read-only. Default `false` (editable by default). */
  readOnly?: boolean;
  /** Show overview ruler diff ticks. Default `true`. */
  renderOverviewRuler?: boolean;
  /** Show margin revert arrows to revert individual hunks into modified editor. Default `true`. */
  renderMarginRevertIcon?: boolean;
  /** Max diff computation time in ms before setting `quitEarly`. Default `5000`. */
  maxComputationTime?: number;
  /** Max file size in MB before skipping full diff. Default `50`. */
  maxFileSize?: number;
  /** Diff algorithm selector. Default `'advanced'`. */
  diffAlgorithm?: 'legacy' | 'advanced';
  /** Collapse long unchanged regions (Monaco-compatible). Default disabled. */
  hideUnchangedRegions?: IHideUnchangedRegionsOptions;
  /** Experimental diff features (e.g. move detection). */
  experimental?: {
    showMoves?: boolean;
  };
  /** Word wrap mode for diff editors. */
  diffWordWrap?: 'off' | 'on' | 'inherit';
  /** Hint that diff editor is embedded in a smaller widget. */
  isInEmbeddedEditor?: boolean;
  /** Compact UI mode. */
  compactMode?: boolean;
  /** Show touch-friendly Prev / Next / Inline toolbar header. Default `true`. */
  toolbar?: boolean;
  /** Extra editor options applied exclusively to the original (left) MonoEditor. */
  originalEditorOptions?: Partial<MonoEditorOptions>;
  /** Extra editor options applied exclusively to the modified (right) MonoEditor. */
  modifiedEditorOptions?: Partial<MonoEditorOptions>;
}

export interface IDiffEditorModelChangedEvent {
  readonly oldModel: IDiffEditorModel | null;
  readonly newModel: IDiffEditorModel | null;
}

export interface IDiffNavigatorOptions {
  readonly followsCaret?: boolean;
  readonly ignoreCharChanges?: boolean;
  readonly alwaysRevealFirst?: boolean;
}

export interface IDiffNavigator extends MonoDisposable {
  canNavigate(): boolean;
  next(): void;
  previous(): void;
}

export type DiffUpdateEvent = IDiffComputationResult & LineDiffResult;

export interface IMonoDiffEditor {
  getId(): string;
  getEditorType(): string;
  getContainerDomNode(): HTMLElement;
  getOriginalEditor(): IMonoEditor;
  getModifiedEditor(): IMonoEditor;
  setModel(model: IDiffEditorModel | null): void;
  getModel(): IDiffEditorModel | null;
  getLineChanges(): ILineChange[] | null;
  getDiffComputationResult(): IDiffComputationResult | null;
  updateOptions(options: Partial<MonoDiffEditorOptions>): void;
  layout(dimension?: IDimension): void;
  focus(): void;
  hasTextFocus(): boolean;
  saveViewState(): IDiffEditorViewState | null;
  restoreViewState(state: IDiffEditorViewState | null): void;
  goToDiff(target: 'next' | 'previous'): void;
  revealFirstDiff(): void;
  accessibleDiffViewerNext(): void;
  accessibleDiffViewerPrev(): void;
  onDidUpdateDiff(listener: (result: DiffUpdateEvent) => void): MonoDisposable;
  onDidChangeModel(listener: (e: IDiffEditorModelChangedEvent) => void): MonoDisposable;
  onDidContentSizeChange(listener: (e: IContentSizeChangedEvent) => void): MonoDisposable;
  onDidDispose(listener: () => void): MonoDisposable;
  dispose(): void;
}
