/**
 * Sticky scroll — Acode canvas-view / VS Code rules.
 *
 * Source of truth: https://github.com/Acode-Foundation/canvas-view
 *   src/view/sticky.ts  (ScopeFinder.headers + indentChain)
 *   src/view/view.ts    (buildSticky: probe + push px)
 *
 * Slot i shows the scope at depth i whose header scrolled above the
 * slot and whose body still reaches below it. When a scope's last line
 * passes under the slot, that header is *pushed up* with that line
 * (not instantly hidden).
 */

import type { TextModel } from '../model/TextModel';

export interface MonoStickyScrollOptions {
  enabled?: boolean;
  maxLineCount?: number;
  defaultModel?: 'indentationModel' | 'outlineModel';
  scrollWithEditor?: boolean;
  /**
   * When the active (caret) line scrolls above the top sticky region,
   * pin it as an extra sticky row (shows caret column). Default true.
   */
  activeLineSticky?: boolean;
  /**
   * When the active line sits at/under the bottom of the viewport,
   * show a bottom sticky bar (status-bar above). Default true.
   */
  bottomActiveSticky?: boolean;
}

export const DEFAULT_STICKY_SCROLL: Required<MonoStickyScrollOptions> = {
  enabled: true,
  maxLineCount: 5,
  defaultModel: 'indentationModel',
  scrollWithEditor: true,
  activeLineSticky: false,
  bottomActiveSticky: true,
};

export interface Scope {
  header: number;
  end: number;
}

export interface StickyHeaders {
  /** Header line numbers, outermost first */
  lines: readonly number[];
  /** Index of the line being pushed, or -1 */
  pushed: number;
}

export interface IScopeFinder {
  chain(lineNumber: number): readonly Scope[];
  headers(probeLine: number, maxLines: number): StickyHeaders;
  headersForRows(
    probeRow: number,
    maxLines: number,
    rowToModelLine: (visualRow: number) => number,
    isLineHidden?: (lineNumber: number) => boolean,
  ): StickyHeaders;
}

export interface StickyRenderLine {
  lineNumber: number;
  /** CSS y inside the sticky region (may be negative for the pushed line) */
  y: number;
  /** 1 = full, <1 when partially pushed off */
  visibility: number;
  /** Active-line sticky: show caret at this 1-based column */
  caretColumn?: number;
  /** 'scope' | 'active' */
  kind?: 'scope' | 'active';
}

const MAX_DEPTH = 32;
const INDENT_SCAN = 1500;
const BLANK_SCAN = 200;

function indentWidth(text: string, tabSize: number): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === ' ') w++;
    else if (ch === '\t') w += tabSize - (w % tabSize);
    else return w;
  }
  return -1; // blank
}

/**
 * Indentation scopes for line `n` (1-based), outermost first.
 * Same idea as Acode ScopeFinder.indentChain.
 */
export class IndentScopeFinder implements IScopeFinder {
  private model: TextModel;
  private tabSize: number;
  private parents = new Map<number, number>();
  private chains = new Map<number, readonly Scope[]>();

  constructor(model: TextModel, tabSize = 2) {
    this.model = model;
    this.tabSize = tabSize;
  }

  sync(model: TextModel, tabSize = 2): void {
    if (model !== this.model || tabSize !== this.tabSize) {
      this.model = model;
      this.tabSize = tabSize;
      this.parents.clear();
      this.chains.clear();
    }
  }

  invalidate(): void {
    this.parents.clear();
    this.chains.clear();
  }

  private indent(n: number): number {
    return indentWidth(this.model.getLineContent(n), this.tabSize);
  }

  private nextIndent(n: number): number {
    const lines = this.model.getLineCount();
    const end = Math.min(lines, n + BLANK_SCAN);
    for (let k = n + 1; k <= end; k++) {
      const i = this.indent(k);
      if (i >= 0) return i;
    }
    return -1;
  }

  private parentBelow(n: number, ind: number): number {
    const same: number[] = [];
    let k = n - 1;
    let found = 0;
    let steps = 0;
    for (; k >= 1 && steps < INDENT_SCAN; steps++) {
      const i = this.indent(k);
      if (i < 0) {
        k--;
        continue;
      }
      if (i < ind) {
        found = k;
        break;
      }
      if (i === ind) same.push(k);
      const p = this.parents.get(k);
      k = p ?? k - 1;
    }
    if (found || k < 1) {
      for (const s of same) if (!this.parents.has(s)) this.parents.set(s, found);
    }
    return found;
  }

  private parentOf(n: number): number {
    let found = this.parents.get(n);
    if (found == null) {
      const ind = this.indent(n);
      found = ind <= 0 ? 0 : this.parentBelow(n, ind);
      this.parents.set(n, found);
    }
    return found;
  }

  /** Scopes containing line n, outermost first. */
  chain(n: number): readonly Scope[] {
    const cached = this.chains.get(n);
    if (cached) return cached;
    const ind = this.indent(n);
    const next = this.nextIndent(n);
    let header =
      ind < 0 ? (next <= 0 ? 0 : this.parentBelow(n, next)) : this.parentOf(n);
    const out: Scope[] = [];
    for (let k = header; k > 0 && out.length < MAX_DEPTH; k = this.parentOf(k)) {
      out.push({
        header: k,
        end: next <= this.indent(k) ? n : Math.min(this.model.getLineCount(), n + 1),
      });
    }
    out.reverse();
    const result = out.length ? out : [];
    this.chains.set(n, result);
    return result;
  }

  /**
   * VS Code / Acode slot rule over visual rows (supports folded blocks and wrapped lines).
   * `probeRow` is 0-based visual row at `scrollTop + lineHeight - ε`.
   * `rowToModelLine` maps 0-based visual row → 1-based model line (or 0 if out of bounds).
   */
  headersForRows(
    probeRow: number,
    maxLines: number,
    rowToModelLine: (visualRow: number) => number,
    isLineHidden?: (lineNumber: number) => boolean,
  ): StickyHeaders {
    if (maxLines <= 0 || probeRow < 0) return { lines: [], pushed: -1 };

    const visibleChain = (lineNumber: number): readonly Scope[] => {
      if (lineNumber < 1) return [];
      const raw = this.chain(lineNumber);
      if (!isLineHidden || !raw.length) return raw;
      return raw.filter((s) => !isLineHidden(s.header));
    };

    const matches = (chain: readonly Scope[], i: number, scopes: Scope[]) => {
      if (chain.length <= i) return false;
      for (let j = 0; j < i; j++) {
        if (chain[j]!.header !== scopes[j]!.header) return false;
      }
      return true;
    };

    const lines: number[] = [];
    const scopes: Scope[] = [];
    let pushed = -1;
    let below = rowToModelLine(probeRow - 1);

    for (let i = 0; i < maxLines; i++) {
      const at = rowToModelLine(probeRow + i);
      const above = below;
      below = at;

      // Visual row above ends a scope at this depth → push that header with it
      if (above && above !== at) {
        const prev = visibleChain(above);
        const cur = at ? visibleChain(at) : [];
        const scopeEnded =
          matches(prev, i, scopes) &&
          (prev[i]!.end <= above || !matches(cur, i, scopes) || cur[i]!.header !== prev[i]!.header);
        if (scopeEnded) {
          scopes.push(prev[i]!);
          pushed = i;
          break;
        }
      }

      if (!at) break;
      const chain = visibleChain(at);
      if (!matches(chain, i, scopes)) break;
      scopes.push(chain[i]!);
    }

    for (const s of scopes) lines.push(s.header);
    return { lines, pushed };
  }

  /**
   * VS Code / Acode slot rule (identity 1-based line mapping).
   * `probeLine` = 1-based line at scrollTop + lineHeight - epsilon
   */
  headers(probeLine: number, maxLines: number): StickyHeaders {
    if (maxLines <= 0 || probeLine < 1) return { lines: [], pushed: -1 };
    const lineCount = this.model.getLineCount();
    return this.headersForRows(probeLine - 1, maxLines, (row) => {
      if (row < 0) return 0;
      return Math.min(row + 1, lineCount);
    });
  }
}

export interface StickyLayoutResult {
  lines: StickyRenderLine[];
  /** Total sticky region height (includes negative push) */
  height: number;
  pushPx: number;
  pushed: number;
}

/**
 * Full layout for current scrollTop (supports folded blocks and wrapped lines via optional projection).
 * probe = visual row at (scrollTop + lineHeight - ε)  — Acode buildSticky
 * pushPx = min(0, docY(probeRow+pushed) - (scrollTop + (pushed+1)*lh))
 */
export function layoutStickyForScroll(
  finder: IScopeFinder,
  scrollTop: number,
  metrics: { lineHeight: number; paddingTop: number },
  maxLineCount: number,
  scrollWithEditor: boolean,
  activeLine?: number,
  activeColumn?: number,
  activeLineSticky?: boolean,
  projection?: import('./ViewLineProjection').ViewLineProjection,
  isLineHidden?: (lineNumber: number) => boolean,
): StickyLayoutResult {
  const { lineHeight, paddingTop } = metrics;
  if (maxLineCount <= 0) return { lines: [], height: 0, pushPx: 0, pushed: -1 };

  const probeY = scrollTop + lineHeight - 0.01;
  const probeRow = Math.max(0, Math.floor((probeY - paddingTop) / lineHeight));

  let headers: StickyHeaders;
  if (projection && !projection.isIdentity()) {
    const totalRows = projection.getVisualLineCount();
    const rowToModelLine = (row: number): number => {
      if (row < 0 || totalRows <= 0) return 0;
      const clamped = Math.min(row, totalRows - 1);
      return projection.getVisualLine(clamped).modelLine;
    };
    headers = finder.headersForRows(probeRow, maxLineCount, rowToModelLine, isLineHidden);
  } else {
    headers = finder.headers(probeRow + 1, maxLineCount);
  }

  let pushPx = 0;
  if (headers.lines.length && scrollWithEditor && headers.pushed >= 0) {
    const row = probeRow + headers.pushed;
    const docY = paddingTop + row * lineHeight;
    pushPx = Math.min(0, docY - (scrollTop + (headers.pushed + 1) * lineHeight));
  }

  const out: StickyRenderLine[] = headers.lines.map((lineNumber, i) => {
    const isPushed = scrollWithEditor && headers.pushed === i;
    const y = i * lineHeight + (isPushed ? pushPx : 0);
    const visibility = isPushed
      ? Math.max(0, Math.min(1, (lineHeight + pushPx) / lineHeight))
      : 1;
    return { lineNumber, y, visibility, kind: 'scope' as const };
  });

  // Active line sticky: caret line scrolled above the sticky stack → pin as extra row
  if (
    activeLineSticky &&
    activeLine != null &&
    activeLine >= 1 &&
    !(isLineHidden && isLineHidden(activeLine))
  ) {
    const activeRow =
      projection && !projection.isIdentity()
        ? projection.modelToVisual(activeLine, activeColumn ?? 1).visualRow
        : activeLine - 1;
    const activeDocY = paddingTop + activeRow * lineHeight;
    const stackH = out.length * lineHeight;
    // Active line is above the viewport content area (under sticky stack)
    if (activeDocY + lineHeight <= scrollTop + stackH + 0.5) {
      const already = out.some((l) => l.lineNumber === activeLine);
      if (!already && out.length < maxLineCount) {
        out.push({
          lineNumber: activeLine,
          y: out.length * lineHeight,
          visibility: 1,
          kind: 'active',
          caretColumn: activeColumn,
        });
      } else if (already) {
        const row = out.find((l) => l.lineNumber === activeLine);
        if (row) {
          row.kind = 'active';
          row.caretColumn = activeColumn;
        }
      }
    }
  }

  const height = out.length
    ? Math.max(...out.map((l) => l.y + lineHeight), out.length * lineHeight)
    : 0;
  return { lines: out, height, pushPx, pushed: headers.pushed };
}

// ---- legacy names used by ViewController (thin wrappers) ----

export type StickyLine = { lineNumber: number; depth: number };
export type StickyRenderLineLegacy = StickyRenderLine;

/** @deprecated use IndentScopeFinder + layoutStickyForScroll */
export function computeIndentationStickyLines(
  model: TextModel,
  firstVisibleLine: number,
  maxLineCount: number,
): StickyLine[] {
  const f = new IndentScopeFinder(model);
  // Approximate: probe ≈ firstVisibleLine
  const h = f.headers(firstVisibleLine, maxLineCount);
  return h.lines.map((lineNumber, depth) => ({ lineNumber, depth }));
}

/** @deprecated */
export function layoutStickyLines(
  stickies: StickyLine[],
  scrollTop: number,
  metrics: { lineHeight: number },
  scrollWithEditor: boolean,
): StickyRenderLine[] {
  const f = new IndentScopeFinder(
    // reconstruct is impossible without model — treat stickies as fixed slots
    { getLineCount: () => 1, getLineContent: () => '' } as unknown as TextModel,
  );
  void f;
  void scrollTop;
  void scrollWithEditor;
  return stickies.map((s, i) => ({
    lineNumber: s.lineNumber,
    y: i * metrics.lineHeight,
    visibility: 1,
  }));
}
