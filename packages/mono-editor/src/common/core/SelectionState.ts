/**
 * Which side of an inline virtual block (inlay hint, ghost text, colour swatch) anchored at this
 * column a caret / selection edge is drawn on. The model column is the same either way; this is a
 * display-only hint, set by teardrop drags and dropped whenever the position object is replaced.
 */
export type VirtualSide = 'before' | 'after';

export interface MonoPosition {
  lineNumber: number;
  column: number;
  virtualSide?: VirtualSide;
}

export interface MonoSelectionRange {
  anchor: MonoPosition;
  active: MonoPosition;
}

function comparePos(a: MonoPosition, b: MonoPosition): number {
  if (a.lineNumber !== b.lineNumber) return a.lineNumber - b.lineNumber;
  return a.column - b.column;
}

export function orderedRange(s: MonoSelectionRange): { start: MonoPosition; end: MonoPosition } {
  return comparePos(s.anchor, s.active) <= 0
    ? { start: s.anchor, end: s.active }
    : { start: s.active, end: s.anchor };
}

export class SelectionState {
  /**
   * Ordered list of active selections (index 0 is always the primary cursor/selection).
   * `anchor` and `active` getters/setters map directly to index 0 for 100% backward compatibility.
   */
  selections: MonoSelectionRange[] = [
    { anchor: { lineNumber: 1, column: 1 }, active: { lineNumber: 1, column: 1 } },
  ];
  private maxCursors = 10000;

  getMaxCursors(): number {
    return this.maxCursors;
  }

  setMaxCursors(limit: number): void {
    const clamped = Math.max(1, Math.min(100000, Math.round(limit)));
    this.maxCursors = clamped;
    if (this.selections.length > clamped) {
      this.selections = this.selections.slice(0, clamped);
    }
  }

  get anchor(): MonoPosition {
    return this.selections[0]!.anchor;
  }

  set anchor(pos: MonoPosition) {
    this.selections[0]!.anchor = pos;
  }

  get active(): MonoPosition {
    return this.selections[0]!.active;
  }

  set active(pos: MonoPosition) {
    this.selections[0]!.active = pos;
  }

  get isEmpty(): boolean {
    const p = this.selections[0]!;
    return (
      p.anchor.lineNumber === p.active.lineNumber &&
      p.anchor.column === p.active.column
    );
  }

  get hasMultipleCursors(): boolean {
    return this.selections.length > 1;
  }

  get secondarySelections(): MonoSelectionRange[] {
    return this.selections.slice(1);
  }

  setCaret(lineNumber: number, column: number): void {
    this.selections = [
      { anchor: { lineNumber, column }, active: { lineNumber, column } },
    ];
  }

  moveActive(lineNumber: number, column: number, extend: boolean): void {
    const p = this.selections[0]!;
    p.active = { lineNumber, column };
    if (!extend) p.anchor = { lineNumber, column };
    this.selections = [p];
  }

  /** Add a new cursor or selection (toggles off if an identical caret already exists). */
  addSelection(anchor: MonoPosition, active: MonoPosition = anchor, toggleExisting = false): void {
    if (toggleExisting && this.selections.length > 1) {
      const dupIdx = this.selections.findIndex(
        (s) =>
          s.anchor.lineNumber === anchor.lineNumber &&
          s.anchor.column === anchor.column &&
          s.active.lineNumber === active.lineNumber &&
          s.active.column === active.column,
      );
      if (dupIdx >= 0) {
        this.selections.splice(dupIdx, 1);
        return;
      }
    }
    if (this.selections.length >= this.maxCursors) return;
    this.selections.push({
      anchor: { ...anchor },
      active: { ...active },
    });
    this.normalizeAndMerge();
  }

  setSelections(ranges: MonoSelectionRange[]): void {
    if (!ranges.length) return;
    this.selections = ranges.map((r) => ({
      anchor: { ...r.anchor },
      active: { ...r.active },
    }));
    this.normalizeAndMerge();
  }

  collapseToPrimary(): void {
    const p = this.selections[0]!;
    this.selections = [
      { anchor: { ...p.anchor }, active: { ...p.active } },
    ];
  }

  /**
   * Merges overlapping or duplicate selections while preserving the primary selection identity.
   */
  normalizeAndMerge(): void {
    if (this.selections.length <= 1) return;
    const primary = this.selections[0]!;
    const tagged = this.selections.map((s, idx) => ({
      s,
      ord: orderedRange(s),
      isPrimary: idx === 0,
    }));
    tagged.sort((a, b) => {
      const c = comparePos(a.ord.start, b.ord.start);
      return c !== 0 ? c : comparePos(a.ord.end, b.ord.end);
    });

    const merged: typeof tagged = [];
    for (const item of tagged) {
      const prev = merged[merged.length - 1];
      if (!prev) {
        merged.push(item);
        continue;
      }
      const sameCaret =
        comparePos(prev.ord.start, prev.ord.end) === 0 &&
        comparePos(item.ord.start, item.ord.end) === 0 &&
        comparePos(prev.ord.start, item.ord.start) === 0;
      const overlaps =
        sameCaret ||
        comparePos(item.ord.start, prev.ord.end) < 0 ||
        (comparePos(item.ord.start, prev.ord.end) === 0 &&
          (comparePos(prev.ord.start, prev.ord.end) !== 0 ||
            comparePos(item.ord.start, item.ord.end) !== 0));
      if (overlaps) {
        const end = comparePos(item.ord.end, prev.ord.end) > 0 ? item.ord.end : prev.ord.end;
        prev.ord = { start: prev.ord.start, end };
        prev.s = { anchor: { ...prev.ord.start }, active: { ...end } };
        if (item.isPrimary) prev.isPrimary = true;
      } else {
        merged.push(item);
      }
    }

    // Keep primary at index 0
    const pIdx = merged.findIndex((m) => m.isPrimary);
    if (pIdx > 0) {
      const [p] = merged.splice(pIdx, 1);
      merged.unshift(p!);
    }
    this.selections = merged.length
      ? merged.map((m) => m.s)
      : [{ anchor: { ...primary.anchor }, active: { ...primary.active } }];
    if (this.selections.length > this.maxCursors) {
      this.selections = this.selections.slice(0, this.maxCursors);
    }
  }

  clone(): SelectionState {
    const s = new SelectionState();
    s.maxCursors = this.maxCursors;
    s.selections = this.selections.map((r) => ({
      anchor: { ...r.anchor },
      active: { ...r.active },
    }));
    return s;
  }
}
