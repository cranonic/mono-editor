import type { RenderMetrics } from '../../common/config/editorOptions';
import type { SelectionState } from '../../common/core/SelectionState';
import type { IPosition, IRange, ISelection } from '../../common/core/types';
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

function commitScroll(ctx: CursorRevealContext, prevTop: number, prevLeft: number): void {
  ctx.view.clampScrollPublic();
  const topChanged = Math.abs(ctx.view.scrollTop - prevTop) > 0.01;
  const leftChanged = Math.abs(ctx.view.scrollLeft - prevLeft) > 0.01;
  if (topChanged || leftChanged) ctx.onScrollChanged(topChanged, leftChanged);
  ctx.view.paint();
}

export function revealLineInCenterImpl(ctx: CursorRevealContext, lineNumber: number): void {
  const m = ctx.metrics();
  const line = Math.max(1, Math.min(ctx.model.getLineCount(), lineNumber));
  if (ctx.folding.isLineHidden(line)) ctx.folding.unfoldContaining(line);
  ctx.view.syncProjection();
  const topInset = ctx.view.getTopInset();
  const availH = Math.max(m.lineHeight, ctx.view.cssHeight - topInset - ctx.view.getBottomInset());
  const docY = ctx.view.getTopForLineNumber(line);
  const prevTop = ctx.view.scrollTop;
  const prevLeft = ctx.view.scrollLeft;
  ctx.view.scrollTop = Math.max(0, docY - availH / 2 + m.lineHeight / 2);
  commitScroll(ctx, prevTop, prevLeft);
}

export function revealPositionImpl(ctx: CursorRevealContext, position: IPosition): void {
  const m = ctx.metrics();
  const line = Math.max(1, Math.min(ctx.model.getLineCount(), position.lineNumber));
  if (ctx.folding.isLineHidden(line)) ctx.folding.unfoldContaining(line);
  ctx.view.syncProjection();
  const maxCol = ctx.model.getLineContent(line).length + 1;
  const col = Math.max(1, Math.min(maxCol, position.column));
  const topInset = ctx.view.getTopInset();
  const availH = Math.max(m.lineHeight, ctx.view.cssHeight - topInset - ctx.view.getBottomInset());
  const docY = ctx.view.getTopForLineNumber(line);
  const prevTop = ctx.view.scrollTop;
  const prevLeft = ctx.view.scrollLeft;

  if (docY < ctx.view.scrollTop + topInset + m.paddingTop) {
    ctx.view.scrollTop = Math.max(0, docY - topInset - m.paddingTop);
  } else if (docY + m.lineHeight > ctx.view.scrollTop + availH) {
    ctx.view.scrollTop = docY + m.lineHeight - availH;
  }

  if (ctx.view.getWordWrap() === 'on') {
    ctx.view.scrollLeft = 0;
  } else {
    const contentLeft = ctx.view.contentLeft;
    const x = contentLeft + m.paddingLeft + ctx.view.measureColumnX(line, col);
    const viewW = Math.max(40, ctx.view.cssWidth - ctx.view.getRightInset());
    if (x - ctx.view.scrollLeft < contentLeft + m.paddingLeft) {
      ctx.view.scrollLeft = Math.max(0, x - contentLeft - m.paddingLeft - 40);
    } else if (x - ctx.view.scrollLeft > viewW - 40) {
      ctx.view.scrollLeft = Math.max(0, x - viewW + 80);
    }
  }
  commitScroll(ctx, prevTop, prevLeft);
}

export function revealLinesImpl(ctx: CursorRevealContext, startLineNumber: number, endLineNumber: number): void {
  const m = ctx.metrics();
  const maxLine = ctx.model.getLineCount();
  const sLine = Math.max(1, Math.min(maxLine, Math.min(startLineNumber, endLineNumber)));
  const eLine = Math.max(1, Math.min(maxLine, Math.max(startLineNumber, endLineNumber)));
  if (ctx.folding.isLineHidden(sLine)) ctx.folding.unfoldContaining(sLine);
  if (ctx.folding.isLineHidden(eLine)) ctx.folding.unfoldContaining(eLine);
  ctx.view.syncProjection();
  const topInset = ctx.view.getTopInset();
  const availH = Math.max(m.lineHeight, ctx.view.cssHeight - topInset - ctx.view.getBottomInset());
  const startTop = ctx.view.getTopForLineNumber(sLine);
  const endBottom = ctx.view.getBottomForLineNumber(eLine);
  const prevTop = ctx.view.scrollTop;
  const prevLeft = ctx.view.scrollLeft;

  if (endBottom - startTop > availH) {
    ctx.view.scrollTop = Math.max(0, startTop - topInset - m.paddingTop);
  } else if (startTop < ctx.view.scrollTop + topInset + m.paddingTop) {
    ctx.view.scrollTop = Math.max(0, startTop - topInset - m.paddingTop);
  } else if (endBottom > ctx.view.scrollTop + availH) {
    ctx.view.scrollTop = Math.max(0, endBottom - availH);
  }
  commitScroll(ctx, prevTop, prevLeft);
}

export function revealLinesInCenterImpl(ctx: CursorRevealContext, startLineNumber: number, endLineNumber: number): void {
  const m = ctx.metrics();
  const maxLine = ctx.model.getLineCount();
  const sLine = Math.max(1, Math.min(maxLine, Math.min(startLineNumber, endLineNumber)));
  const eLine = Math.max(1, Math.min(maxLine, Math.max(startLineNumber, endLineNumber)));
  if (ctx.folding.isLineHidden(sLine)) ctx.folding.unfoldContaining(sLine);
  if (ctx.folding.isLineHidden(eLine)) ctx.folding.unfoldContaining(eLine);
  ctx.view.syncProjection();
  const topInset = ctx.view.getTopInset();
  const availH = Math.max(m.lineHeight, ctx.view.cssHeight - topInset - ctx.view.getBottomInset());
  const startTop = ctx.view.getTopForLineNumber(sLine);
  const endBottom = ctx.view.getBottomForLineNumber(eLine);
  const prevTop = ctx.view.scrollTop;
  const prevLeft = ctx.view.scrollLeft;
  const mid = (startTop + endBottom) / 2;
  ctx.view.scrollTop = Math.max(0, mid - availH / 2);
  commitScroll(ctx, prevTop, prevLeft);
}

export function revealRangeImpl(ctx: CursorRevealContext, range: IRange): void {
  revealLinesImpl(ctx, range.startLineNumber, range.endLineNumber);
  if (range.startLineNumber === range.endLineNumber) {
    revealPositionImpl(ctx, { lineNumber: range.startLineNumber, column: range.startColumn });
  }
}

export function revealRangeInCenterImpl(ctx: CursorRevealContext, range: IRange): void {
  revealLinesInCenterImpl(ctx, range.startLineNumber, range.endLineNumber);
  if (range.startLineNumber === range.endLineNumber) {
    revealPositionImpl(ctx, { lineNumber: range.startLineNumber, column: range.startColumn });
  }
}

export function setScrollPositionImpl(
  ctx: CursorRevealContext,
  pos: { scrollTop?: number; scrollLeft?: number },
): void {
  const prevTop = ctx.view.scrollTop;
  const prevLeft = ctx.view.scrollLeft;
  if (pos.scrollTop != null) ctx.view.scrollTop = Math.max(0, pos.scrollTop);
  if (pos.scrollLeft != null) ctx.view.scrollLeft = Math.max(0, pos.scrollLeft);
  commitScroll(ctx, prevTop, prevLeft);
}

export function setSelectionsImpl(
  ctx: CursorRevealContext,
  sels: readonly {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
    selectionStartLineNumber?: number;
    selectionStartColumn?: number;
    positionLineNumber?: number;
    positionColumn?: number;
  }[],
): boolean {
  if (!sels.length) return false;
  const next = sels.map((sel) => {
    const a = clampPosition(ctx.model, sel.selectionStartLineNumber ?? sel.startLineNumber, sel.selectionStartColumn ?? sel.startColumn);
    const b = clampPosition(ctx.model, sel.positionLineNumber ?? sel.endLineNumber, sel.positionColumn ?? sel.endColumn);
    if (ctx.folding.isLineHidden(a.lineNumber)) ctx.folding.unfoldContaining(a.lineNumber);
    if (ctx.folding.isLineHidden(b.lineNumber)) ctx.folding.unfoldContaining(b.lineNumber);
    return { anchor: a, active: b };
  });
  ctx.view.projection.invalidate();
  if (next.length === 1) {
    ctx.selection.anchor = next[0]!.anchor;
    ctx.selection.active = next[0]!.active;
  } else {
    ctx.selection.setSelections(next);
  }
  ctx.view.ensureCaretVisible();
  return true;
}
