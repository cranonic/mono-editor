import type { ColorMatch } from '../color/colorTypes';
import { nextGraphemeOffset } from '../util/grapheme';
import type { InlineGhostRun, ResolvedInlayHint, VirtualGhostRow } from './ghostTextTypes';

export const INLAY_CHIP_PAD_X = 4;
export const INLAY_OUTER_MARGIN = 4;

export interface InlineVirtualElement {
  /** 1-based column at which this virtual element is anchored */
  readonly column: number;
  /** Ordering priority when multiple elements share the exact same column */
  readonly order: number;
  /** Horizontal pixel advance occupied by this element */
  readonly widthPx: number;
  readonly kind: 'swatch' | 'inlay' | 'ghost';
}

export interface LineVirtualInputs {
  readonly colors?: readonly ColorMatch[];
  readonly inlayHints?: readonly ResolvedInlayHint[];
  readonly ghostRuns?: readonly InlineGhostRun[];
  readonly swatchAdvancePx: number;
  readonly measureText: (text: string) => number;
}

/**
 * Builds a sorted list of all inline virtual elements (color swatches, inlay hints,
 * and inline ghost text runs) anchored on a single line.
 *
 * Rendering order at the same column:
 *   0 = color swatch (before literal)
 *   1 = inlay hint (before parameter/type token)
 *   2 = inline ghost text (at cursor / arbitrary anchor column)
 */
export function collectInlineVirtualElements(inputs: LineVirtualInputs): InlineVirtualElement[] {
  const out: InlineVirtualElement[] = [];

  if (inputs.colors?.length) {
    for (const c of inputs.colors) {
      out.push({
        column: c.startColumn,
        order: 0,
        widthPx: inputs.swatchAdvancePx,
        kind: 'swatch',
      });
    }
  }

  if (inputs.inlayHints?.length) {
    for (const h of inputs.inlayHints) {
      if (h.totalAdvancePx > 0) {
        out.push({
          column: h.column,
          order: 1,
          widthPx: h.totalAdvancePx,
          kind: 'inlay',
        });
      }
    }
  }

  if (inputs.ghostRuns?.length) {
    for (const g of inputs.ghostRuns) {
      if (!g.text) continue;
      const w = Math.max(0, inputs.measureText(g.text));
      if (w > 0) {
        out.push({
          column: g.column,
          order: 2,
          widthPx: w,
          kind: 'ghost',
        });
      }
    }
  }

  if (out.length > 1) {
    out.sort((a, b) => a.column - b.column || a.order - b.order);
  }
  return out;
}

/**
 * Computes total horizontal pixel shift applied to real text at `column` (1-based)
 * caused by inline virtual elements anchored at `<= column`.
 *
 * Note: For `kind === 'ghost'`, if `includeGhostAtSameColumn` is false, a caret sitting
 * AT the ghost text anchor stays to the LEFT of the ghost text (matching VS Code/Monaco),
 * while real characters at `>= ghost.column` shift to the RIGHT of the ghost text!
 */
export function virtualAdvanceBeforeColumn(
  elements: readonly InlineVirtualElement[],
  column: number,
  includeGhostAtSameColumn = true,
): number {
  if (!elements.length) return 0;
  let shift = 0;
  for (const el of elements) {
    if (el.column < column) {
      shift += el.widthPx;
    } else if (el.column === column) {
      if (el.kind === 'ghost' && !includeGhostAtSameColumn) continue;
      shift += el.widthPx;
    } else {
      break;
    }
  }
  return shift;
}

/**
 * Computes pixel X for a specific inline element (swatch / inlay hint / ghost run)
 * anchored at `column` with priority `order`.
 */
export function virtualElementStartX(
  baseRealX: number,
  elements: readonly InlineVirtualElement[],
  column: number,
  order: number,
  indexWithinSame = 0,
): number {
  let shift = 0;
  let sameSeen = 0;
  for (const el of elements) {
    if (el.column < column || (el.column === column && el.order < order)) {
      shift += el.widthPx;
    } else if (el.column === column && el.order === order) {
      if (sameSeen < indexWithinSame) {
        shift += el.widthPx;
        sameSeen++;
      } else {
        break;
      }
    } else {
      break;
    }
  }
  return baseRealX + shift;
}

/**
 * Exact inverse of `virtualAdvanceBeforeColumn` for pointer/tap hit-testing:
 * converts a line-local visual pixel X (which includes swatches, inlay hints, and inline
 * ghost text) back into the real text pixel X and optional snapped column if the user
 * tapped directly on top of a virtual element.
 */
export function mapVirtualXToRealX(
  lineContent: string,
  visualX: number,
  elements: readonly InlineVirtualElement[],
  measureColumnX: (line: string, col: number) => number,
): { realX: number; snappedColumn?: number } {
  if (!elements.length || visualX <= 0) {
    return { realX: Math.max(0, visualX) };
  }

  let adjustedX = visualX;
  let accumulated = 0;
  for (const el of elements) {
    const elLeft = measureColumnX(lineContent, el.column) + accumulated;
    if (visualX >= elLeft + el.widthPx) {
      adjustedX -= el.widthPx;
      accumulated += el.widthPx;
    } else if (visualX >= elLeft) {
      return { realX: Math.max(0, elLeft - accumulated), snappedColumn: el.column };
    } else {
      break;
    }
  }
  return { realX: Math.max(0, adjustedX) };
}

/**
 * Wraps multiline ghost text continuation lines cleanly when Word Wrap is active,
 * preserving leading indentation and grapheme boundaries.
 */
export function buildWrappedGhostRows(params: {
  itemId: string;
  extraLines: readonly string[];
  italic?: boolean;
  kind: VirtualGhostRow['kind'];
  effectiveWrap: boolean;
  wrapWidthPx: number;
  charWidth: number;
  measureText: (text: string) => number;
}): VirtualGhostRow[] {
  const { itemId, extraLines, italic, kind, effectiveWrap, wrapWidthPx, charWidth, measureText } = params;
  const rows: VirtualGhostRow[] = [];

  for (const rawLine of extraLines) {
    if (!effectiveWrap || !rawLine.length || wrapWidthPx <= charWidth * 4) {
      rows.push({ itemId, text: rawLine, indentPx: 0, italic, kind });
      continue;
    }

    if (measureText(rawLine) <= wrapWidthPx) {
      rows.push({ itemId, text: rawLine, indentPx: 0, italic, kind });
      continue;
    }

    // Leading whitespace indent for wrapped continuation sub-rows
    const wsMatch = /^[ \t]*/.exec(rawLine)?.[0] ?? '';
    const contIndentPx = Math.min(Math.floor(wrapWidthPx * 0.4), measureText(wsMatch));

    let pos = 0;
    let firstSeg = true;
    while (pos < rawLine.length) {
      const indentPx = firstSeg ? 0 : contIndentPx;
      const avail = Math.max(charWidth * 2, wrapWidthPx - indentPx);

      let lo = pos;
      let hi = rawLine.length;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (measureText(rawLine.slice(pos, mid)) <= avail) lo = mid;
        else hi = mid - 1;
      }

      let end = lo <= pos ? nextGraphemeOffset(rawLine, pos) : lo;
      if (end < rawLine.length) {
        // Prefer clean word/punctuation break
        const minBreak = pos + Math.floor((end - pos) * 0.55);
        for (let k = end; k > minBreak; k--) {
          const ch = rawLine[k - 1]!;
          if (ch === ' ' || ch === '\t' || ch === ',' || ch === '.' || ch === '(' || ch === ';') {
            end = k;
            break;
          }
        }
      }

      rows.push({
        itemId,
        text: rawLine.slice(pos, end),
        indentPx,
        italic,
        kind,
      });
      pos = end;
      firstSeg = false;
    }
  }

  return rows;
}
