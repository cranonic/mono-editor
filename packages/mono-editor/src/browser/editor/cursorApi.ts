import type { RenderMetrics } from '../../common/config/editorOptions';
import type { SelectionState } from '../../common/core/SelectionState';
import type { IPosition, ISelection } from '../../common/core/types';
import type { TextModel } from '../../common/model/TextModel';
import type { FoldingModel } from '../../common/viewModel/FoldingModel';
import type { ViewController } from '../view/ViewController';

export function rangeToISelection(a: IPosition, b: IPosition): ISelection {
  const forward =
    a.lineNumber < b.lineNumber ||
    (a.lineNumber === b.lineNumber && a.column <= b.column);
  const start = forward ? a : b;
  const end = forward ? b : a;
  return {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column,
    selectionStartLineNumber: a.lineNumber,
    selectionStartColumn: a.column,
    positionLineNumber: b.lineNumber,
    positionColumn: b.column,
  };
}

export function clampPosition(model: TextModel, ln: number, col: number): IPosition {
  const line = Math.max(1, Math.min(model.getLineCount(), ln | 0));
  const maxCol = model.getLineContent(line).length + 1;
  return { lineNumber: line, column: Math.max(1, Math.min(maxCol, col | 0)) };
}

export interface CursorRevealContext {
  model: TextModel;
  selection: SelectionState;
  folding: FoldingModel;
  view: ViewController;
  metrics: () => RenderMetrics;
  showLineNumbers: () => boolean;
  onScrollChanged: (topChanged: boolean, leftChanged: boolean) => void;
}

export function revealLineInCenterImpl(ctx: CursorRevealContext, lineNumber: number): void {
  const m = ctx.metrics();
  const line = Math.max(1, Math.min(ctx.model.getLineCount(), lineNumber));
  if (ctx.folding.isLineHidden(line)) {
    ctx.folding.unfoldContaining(line);
  }
  ctx.view.syncProjection();
  const row = ctx.view.projection.modelLineToFirstVisualRow(line);
  const topInset = ctx.view.getTopInset();
  const availH = Math.max(m.lineHeight, ctx.view.cssHeight - topInset);
  const docY = m.paddingTop + row * m.lineHeight;
  const prevTop = ctx.view.scrollTop;
  ctx.view.scrollTop = Math.max(0, docY - availH / 2 + m.lineHeight / 2);
  ctx.view.clampScrollPublic();
  if (Math.abs(ctx.view.scrollTop - prevTop) > 0.01) {
    ctx.onScrollChanged(true, false);
  }
  ctx.view.paint();
}

export function revealPositionImpl(ctx: CursorRevealContext, position: IPosition): void {
  const m = ctx.metrics();
  const line = Math.max(1, Math.min(ctx.model.getLineCount(), position.lineNumber));
  if (ctx.folding.isLineHidden(line)) {
    ctx.folding.unfoldContaining(line);
  }
  ctx.view.syncProjection();
  const maxCol = ctx.model.getLineContent(line).length + 1;
  const col = Math.max(1, Math.min(maxCol, position.column));
  const mapped = ctx.view.projection.modelToVisual(line, col);
  const topInset = ctx.view.getTopInset();
  const availH = Math.max(m.lineHeight, ctx.view.cssHeight - topInset);
  const docY = m.paddingTop + mapped.visualRow * m.lineHeight;
  const prevTop = ctx.view.scrollTop;
  const prevLeft = ctx.view.scrollLeft;

  if (docY < ctx.view.scrollTop + m.paddingTop) {
    ctx.view.scrollTop = Math.max(0, docY - m.paddingTop);
  } else if (docY + m.lineHeight > ctx.view.scrollTop + availH) {
    ctx.view.scrollTop = docY + m.lineHeight - availH;
  }

  if (ctx.view.getWordWrap() === 'on') {
    ctx.view.scrollLeft = 0;
  } else {
    const contentLeft = ctx.showLineNumbers() ? m.gutterWidth : 0;
    const x = contentLeft + m.paddingLeft + ctx.view.measureColumnX(line, col);
    const viewW = Math.max(40, ctx.view.cssWidth - ctx.view.getRightInset());
    if (x - ctx.view.scrollLeft < contentLeft + m.paddingLeft) {
      ctx.view.scrollLeft = Math.max(0, x - contentLeft - m.paddingLeft - 40);
    } else if (x - ctx.view.scrollLeft > viewW - 40) {
      ctx.view.scrollLeft = Math.max(0, x - viewW + 80);
    }
  }
  ctx.view.clampScrollPublic();
  const topChanged = Math.abs(ctx.view.scrollTop - prevTop) > 0.01;
  const leftChanged = Math.abs(ctx.view.scrollLeft - prevLeft) > 0.01;
  if (topChanged || leftChanged) {
    ctx.onScrollChanged(topChanged, leftChanged);
  }
  ctx.view.paint();
}
