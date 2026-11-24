import type { TextModel } from '../model/TextModel';
import type { FoldingRange } from '../languages';
import { languageFeatures } from '../languages';
import { getLanguageConfiguration } from '../languages/languageConfigurationRegistry';

/**
 * Computes folding ranges using language folding markers (#region / #endregion)
 * plus indentation scopes (fallback strategy matching VS Code / Monaco).
 */
export function computeIndentFoldingRanges(model: TextModel): FoldingRange[] {
  const ranges: FoldingRange[] = [];
  const counts = model.getLineCount();
  const indents: number[] = [];
  const config = getLanguageConfiguration(model.getLanguageId());
  const markers = config?.folding?.markers;
  const markerStack: number[] = [];

  for (let i = 1; i <= counts; i++) {
    const line = model.getLineContent(i);
    if (markers) {
      if (markers.start.test(line)) {
        markerStack.push(i);
      } else if (markers.end.test(line) && markerStack.length > 0) {
        const start = markerStack.pop()!;
        if (i > start) ranges.push({ start, end: i, kind: 'region' });
      }
    }
    if (!line.trim()) {
      indents.push(-1);
      continue;
    }
    const m = line.match(/^(\s*)/);
    const spaces = m ? m[1]!.replace(/\t/g, '  ').length : 0;
    indents.push(spaces);
  }

  const seenStarts = new Set<number>(ranges.map((r) => r.start));

  for (let i = 0; i < indents.length; i++) {
    const ind = indents[i]!;
    if (ind < 0) continue;
    const startLine = i + 1;
    if (seenStarts.has(startLine)) continue;
    let j = i + 1;
    let max = i;
    while (j < indents.length) {
      const jInd = indents[j]!;
      if (jInd >= 0 && jInd <= ind) break;
      if (jInd > ind) max = j;
      j++;
    }
    if (max > i) {
      ranges.push({ start: startLine, end: max + 1 });
      seenStarts.add(startLine);
    }
  }

  ranges.sort((a, b) => a.start - b.start);
  return ranges;
}

export class FoldingModel {
  private model: TextModel;
  private ranges: FoldingRange[] = [];
  private rangeByStart = new Map<number, FoldingRange>();
  /** collapsed: start line → end line */
  private collapsed = new Map<number, number>();
  private version = 1;

  constructor(model: TextModel) {
    this.model = model;
    this.updateSync();
  }

  getVersion(): number {
    return this.version;
  }

  /** Synchronous recompute (indentation + language region markers) for instant paint. */
  updateSync(): void {
    this.applyRanges(computeIndentFoldingRanges(this.model));
  }

  /** Async recompute that also queries registered FoldingRangeProviders. */
  async update(): Promise<void> {
    const lang = this.model.getLanguageId();
    const providers = languageFeatures.getFoldingProviders(lang);
    const token = { isCancellationRequested: false };
    const modelLike = {
      getValue: () => this.model.getValue(),
      getLineContent: (n: number) => this.model.getLineContent(n),
      getLineCount: () => this.model.getLineCount(),
      getOffsetAt: (l: number, c: number) => this.model.getOffsetAt(l, c),
      getPositionAt: (o: number) => this.model.getPositionAt(o),
      getLanguageId: () => this.model.getLanguageId(),
    };
    let ranges: FoldingRange[] = [];
    if (providers.length) {
      for (const p of providers) {
        try {
          const r = await Promise.resolve(p.provideFoldingRanges(modelLike, {}, token));
          if (r?.length) ranges.push(...r);
        } catch {
          /* */
        }
      }
    }
    if (!ranges.length) ranges = computeIndentFoldingRanges(this.model);
    this.applyRanges(ranges);
  }

  private applyRanges(nextRanges: FoldingRange[]): void {
    this.ranges = nextRanges;
    this.rangeByStart.clear();
    for (const r of nextRanges) {
      if (!this.rangeByStart.has(r.start)) {
        this.rangeByStart.set(r.start, r);
      }
    }
    let changed = false;
    for (const [s, e] of [...this.collapsed]) {
      const match = this.rangeByStart.get(s);
      if (!match) {
        this.collapsed.delete(s);
        changed = true;
      } else if (match.end !== e) {
        this.collapsed.set(s, match.end);
        changed = true;
      }
    }
    if (changed) this.version++;
  }

  getRanges(): FoldingRange[] {
    return this.ranges;
  }

  getRangeAt(startLine: number): FoldingRange | undefined {
    return this.rangeByStart.get(startLine);
  }

  isFoldable(startLine: number): boolean {
    return this.rangeByStart.has(startLine);
  }

  isCollapsed(startLine: number): boolean {
    return this.collapsed.has(startLine);
  }

  hasCollapsed(): boolean {
    return this.collapsed.size > 0;
  }

  getFoldedCount(): number {
    return this.collapsed.size;
  }

  toggle(startLine: number): boolean {
    const r = this.rangeByStart.get(startLine);
    if (!r) return false;
    if (this.collapsed.has(startLine)) this.collapsed.delete(startLine);
    else this.collapsed.set(startLine, r.end);
    this.version++;
    return true;
  }

  fold(startLine: number): boolean {
    const r = this.rangeByStart.get(startLine);
    if (!r || this.collapsed.has(startLine)) return false;
    this.collapsed.set(startLine, r.end);
    this.version++;
    return true;
  }

  unfold(startLine: number): boolean {
    if (!this.collapsed.has(startLine)) return false;
    this.collapsed.delete(startLine);
    this.version++;
    return true;
  }

  /** Fold the innermost range enclosing `lineNumber` (or starting on `lineNumber`). */
  foldAtLine(lineNumber: number): boolean {
    if (this.fold(lineNumber)) return true;
    let best: FoldingRange | null = null;
    for (const r of this.ranges) {
      if (lineNumber >= r.start && lineNumber <= r.end && !this.collapsed.has(r.start)) {
        if (!best || r.start > best.start) best = r;
      }
    }
    return best ? this.fold(best.start) : false;
  }

  /** Unfold any collapsed fold starting at or containing `lineNumber`. */
  unfoldContaining(lineNumber: number): boolean {
    let changed = false;
    for (const [s, e] of [...this.collapsed]) {
      if (lineNumber >= s && lineNumber <= e) {
        this.collapsed.delete(s);
        changed = true;
      }
    }
    if (changed) this.version++;
    return changed;
  }

  foldAll(): boolean {
    let changed = false;
    for (const r of this.ranges) {
      if (!this.collapsed.has(r.start)) {
        this.collapsed.set(r.start, r.end);
        changed = true;
      }
    }
    if (changed) this.version++;
    return changed;
  }

  unfoldAll(): boolean {
    if (this.collapsed.size === 0) return false;
    this.collapsed.clear();
    this.version++;
    return true;
  }

  /** Lines hidden by folds (exclusive of start header line). */
  isLineHidden(line: number): boolean {
    for (const [s, e] of this.collapsed) {
      if (line > s && line <= e) return true;
    }
    return false;
  }

  getCollapsed(): Map<number, number> {
    return new Map(this.collapsed);
  }

  getCollapsedLines(): number[] {
    return [...this.collapsed.keys()];
  }

  restoreCollapsedLines(startLines: readonly number[]): void {
    this.collapsed.clear();
    for (const s of startLines) {
      const r = this.rangeByStart.get(s);
      if (r) this.collapsed.set(s, r.end);
    }
    this.version++;
  }

  setModel(model: TextModel, collapsedLines?: readonly number[]): void {
    this.model = model;
    this.collapsed.clear();
    this.updateSync();
    if (collapsedLines?.length) {
      this.restoreCollapsedLines(collapsedLines);
    }
    this.version++;
  }
}
