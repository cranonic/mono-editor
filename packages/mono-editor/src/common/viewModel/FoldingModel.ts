import type { FoldingStrategy } from '../config/editorOptions';
import type { FoldingRange, ModelLike } from '../languages';
import { languageFeatures } from '../languages';
import { getLanguageConfiguration } from '../languages/languageConfigurationRegistry';
import type { TextModel } from '../model/TextModel';
import {
  buildStructureTree,
  structureTreeToFoldingRanges,
} from '../structure/StructureBuilder';
import { DEFAULT_STRUCTURE_MAX_LINES } from '../structure/types';

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

function normalizeFoldingKind(kind: unknown): string | undefined {
  if (typeof kind === 'string') return kind;
  if (kind && typeof kind === 'object' && 'value' in kind && typeof (kind as { value: unknown }).value === 'string') {
    return (kind as { value: string }).value;
  }
  return undefined;
}

function normalizeProviderRanges(raw: readonly FoldingRange[], lineCount: number): FoldingRange[] {
  const out: FoldingRange[] = [];
  for (const r of raw) {
    if (!r || typeof r.start !== 'number' || typeof r.end !== 'number') continue;
    const start = Math.max(1, Math.min(lineCount, Math.floor(r.start)));
    const end = Math.max(1, Math.min(lineCount, Math.floor(r.end)));
    if (end <= start) continue;
    const kind = normalizeFoldingKind(r.kind);
    out.push(kind ? { start, end, kind } : { start, end });
  }
  out.sort((a, b) => a.start - b.start || b.end - a.end);
  return out;
}

function rangesEqual(a: readonly FoldingRange[], b: readonly FoldingRange[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.start !== y.start || x.end !== y.end || x.kind !== y.kind) return false;
  }
  return true;
}

export class FoldingModel {
  private model: TextModel;
  private ranges: FoldingRange[] = [];
  private rangeByStart = new Map<number, FoldingRange>();
  /** collapsed: start line → end line */
  private collapsed = new Map<number, number>();
  private version = 1;
  private strategy: FoldingStrategy = 'auto';
  private maxLines = DEFAULT_STRUCTURE_MAX_LINES;
  private structureRangesProvider: (() => FoldingRange[]) | null = null;
  private updateSeq = 0;
  private activeToken: { isCancellationRequested: boolean } | null = null;

  constructor(model: TextModel) {
    this.model = model;
    this.updateSync();
  }

  getVersion(): number {
    return this.version;
  }

  setStrategy(strategy: FoldingStrategy): void {
    if (strategy !== this.strategy) {
      this.strategy = strategy;
      this.updateSync();
    }
  }

  getStrategy(): FoldingStrategy {
    return this.strategy;
  }

  setMaxLines(maxLines: number): void {
    if (maxLines > 0 && maxLines !== this.maxLines) {
      this.maxLines = maxLines;
      this.updateSync();
    }
  }

  setStructureRangesProvider(provider: (() => FoldingRange[]) | null): void {
    this.structureRangesProvider = provider;
  }

  private computeBuiltinRanges(): FoldingRange[] {
    if (this.strategy === 'indentation') {
      return computeIndentFoldingRanges(this.model);
    }
    if (this.model.getLineCount() > this.maxLines) {
      return computeIndentFoldingRanges(this.model);
    }
    if (this.structureRangesProvider) {
      const fromService = this.structureRangesProvider();
      if (fromService.length > 0) return fromService;
    }
    const lang = this.model.getLanguageId().toLowerCase();
    if (lang === 'plaintext' || lang === 'text' || lang === '') {
      return computeIndentFoldingRanges(this.model);
    }
    const tree = buildStructureTree(this.model, { maxLines: this.maxLines });
    const ranges = structureTreeToFoldingRanges(tree);
    return ranges.length > 0 ? ranges : computeIndentFoldingRanges(this.model);
  }

  /** Synchronous recompute (structure engine or indentation) for instant paint. */
  updateSync(): boolean {
    return this.applyRanges(this.computeBuiltinRanges());
  }

  /**
   * Async recompute that queries registered `FoldingRangeProvider`s when strategy === 'auto'.
   * Non-empty provider result for the current model version replaces the built-in set;
   * empty / error / stale / timeout keeps the built-in set.
   */
  async update(
    modelLike?: ModelLike,
    opts?: { timeoutMs?: number },
  ): Promise<boolean> {
    if (this.strategy !== 'auto') {
      return this.updateSync();
    }
    const lang = this.model.getLanguageId();
    const providers = languageFeatures.getFoldingProviders(lang);
    if (!providers.length) {
      return this.updateSync();
    }

    if (this.activeToken) this.activeToken.isCancellationRequested = true;
    const token = { isCancellationRequested: false };
    this.activeToken = token;
    const seq = ++this.updateSeq;
    const expectedModel = this.model;
    const expectedVersion = this.model.getVersionId();
    const timeoutMs = opts?.timeoutMs ?? 1500;

    const effectiveModelLike: ModelLike = modelLike ?? {
      getValue: () => expectedModel.getValue(),
      getLineContent: (n: number) => expectedModel.getLineContent(n),
      getLineCount: () => expectedModel.getLineCount(),
      getOffsetAt: (l: number, c: number) => expectedModel.getOffsetAt(l, c),
      getPositionAt: (o: number) => expectedModel.getPositionAt(o),
      getLanguageId: () => expectedModel.getLanguageId(),
      getVersionId: () => expectedModel.getVersionId(),
    };

    const collected: FoldingRange[] = [];
    for (const p of providers) {
      if (token.isCancellationRequested || seq !== this.updateSeq) return false;
      try {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const providerPromise = Promise.resolve(p.provideFoldingRanges(effectiveModelLike, {}, token));
        const res = await Promise.race([
          providerPromise,
          new Promise<null>((resolve) => {
            timer = setTimeout(() => {
              token.isCancellationRequested = true;
              resolve(null);
            }, timeoutMs);
          }),
        ]);
        if (timer) clearTimeout(timer);
        if (token.isCancellationRequested || seq !== this.updateSeq) return false;
        if (this.model !== expectedModel || this.model.getVersionId() !== expectedVersion) return false;
        if (res?.length) collected.push(...res);
      } catch {
        /* provider error: keep built-in ranges */
      }
    }

    if (token.isCancellationRequested || seq !== this.updateSeq) return false;
    if (this.model !== expectedModel || this.model.getVersionId() !== expectedVersion) return false;

    const normalized = normalizeProviderRanges(collected, expectedModel.getLineCount());
    if (!normalized.length) {
      // Keep built-in ranges when providers return empty / error / timeout
      return false;
    }
    return this.applyRanges(normalized);
  }

  private applyRanges(nextRanges: FoldingRange[]): boolean {
    const changedRanges = !rangesEqual(this.ranges, nextRanges);
    this.ranges = nextRanges;
    this.rangeByStart.clear();
    for (const r of nextRanges) {
      if (!this.rangeByStart.has(r.start)) {
        this.rangeByStart.set(r.start, r);
      }
    }
    let changedCollapsed = false;
    for (const [s, e] of [...this.collapsed]) {
      const match = this.rangeByStart.get(s);
      if (!match) {
        this.collapsed.delete(s);
        changedCollapsed = true;
      } else if (match.end !== e) {
        this.collapsed.set(s, match.end);
        changedCollapsed = true;
      }
    }
    if (changedCollapsed || changedRanges) this.version++;
    return changedRanges || changedCollapsed;
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
    if (this.activeToken) this.activeToken.isCancellationRequested = true;
    this.updateSeq++;
    this.model = model;
    this.collapsed.clear();
    this.updateSync();
    if (collapsedLines?.length) {
      this.restoreCollapsedLines(collapsedLines);
    }
    this.version++;
  }
}
