import type { MonoSelectionRange, VirtualSide } from '../../common/core/SelectionState';

export interface SelectionSides {
  /** Side of the caret / active edge. */
  caret?: VirtualSide;
  /** Side of the document-order start edge. */
  start?: VirtualSide;
  /** Side of the document-order end edge. */
  end?: VirtualSide;
}

/**
 * Display-only before/after-virtual-block hints carried on a selection's anchor / active
 * positions (set by teardrop drags), mapped to document order.
 */
export function selectionSides(range: MonoSelectionRange | undefined): SelectionSides {
  if (!range) return {};
  const a = range.anchor;
  const b = range.active;
  const aBefore = a.lineNumber < b.lineNumber || (a.lineNumber === b.lineNumber && a.column <= b.column);
  return {
    caret: b.virtualSide,
    start: aBefore ? a.virtualSide : b.virtualSide,
    end: aBefore ? b.virtualSide : a.virtualSide,
  };
}
