import type { IPosition, IRange } from './types';
import { Position } from './position';

/**
 * A 1-based range in the editor (Monaco-compatible).
 */
export class Range implements IRange {
  readonly startLineNumber: number;
  readonly startColumn: number;
  readonly endLineNumber: number;
  readonly endColumn: number;

  constructor(
    startLineNumber: number,
    startColumn: number,
    endLineNumber: number,
    endColumn: number,
  ) {
    if (
      startLineNumber > endLineNumber ||
      (startLineNumber === endLineNumber && startColumn > endColumn)
    ) {
      this.startLineNumber = endLineNumber;
      this.startColumn = endColumn;
      this.endLineNumber = startLineNumber;
      this.endColumn = startColumn;
    } else {
      this.startLineNumber = startLineNumber;
      this.startColumn = startColumn;
      this.endLineNumber = endLineNumber;
      this.endColumn = endColumn;
    }
  }

  isEmpty(): boolean {
    return Range.isEmpty(this);
  }

  containsPosition(position: IPosition): boolean {
    return Range.containsPosition(this, position);
  }

  containsRange(range: IRange): boolean {
    return Range.containsRange(this, range);
  }

  strictContainsRange(range: IRange): boolean {
    return Range.strictContainsRange(this, range);
  }

  plusRange(range: IRange): Range {
    return Range.plusRange(this, range);
  }

  intersectRanges(range: IRange): Range | null {
    return Range.intersectRanges(this, range);
  }

  equalsRange(other: IRange | null | undefined): boolean {
    return Range.equalsRange(this, other);
  }

  getEndPosition(): Position {
    return new Position(this.endLineNumber, this.endColumn);
  }

  getStartPosition(): Position {
    return new Position(this.startLineNumber, this.startColumn);
  }

  setEndPosition(endLineNumber: number, endColumn: number): Range {
    return new Range(this.startLineNumber, this.startColumn, endLineNumber, endColumn);
  }

  setStartPosition(startLineNumber: number, startColumn: number): Range {
    return new Range(startLineNumber, startColumn, this.endLineNumber, this.endColumn);
  }

  collapseToStart(): Range {
    return new Range(
      this.startLineNumber,
      this.startColumn,
      this.startLineNumber,
      this.startColumn,
    );
  }

  collapseToEnd(): Range {
    return new Range(this.endLineNumber, this.endColumn, this.endLineNumber, this.endColumn);
  }

  toString(): string {
    return `[${this.startLineNumber},${this.startColumn} -> ${this.endLineNumber},${this.endColumn}]`;
  }

  static isEmpty(range: IRange): boolean {
    return range.startLineNumber === range.endLineNumber && range.startColumn === range.endColumn;
  }

  static containsPosition(range: IRange, position: IPosition): boolean {
    if (position.lineNumber < range.startLineNumber || position.lineNumber > range.endLineNumber) {
      return false;
    }
    if (position.lineNumber === range.startLineNumber && position.column < range.startColumn) {
      return false;
    }
    if (position.lineNumber === range.endLineNumber && position.column > range.endColumn) {
      return false;
    }
    return true;
  }

  static containsRange(range: IRange, otherRange: IRange): boolean {
    if (
      otherRange.startLineNumber < range.startLineNumber ||
      otherRange.endLineNumber < range.startLineNumber
    ) {
      return false;
    }
    if (
      otherRange.startLineNumber > range.endLineNumber ||
      otherRange.endLineNumber > range.endLineNumber
    ) {
      return false;
    }
    if (
      otherRange.startLineNumber === range.startLineNumber &&
      otherRange.startColumn < range.startColumn
    ) {
      return false;
    }
    if (
      otherRange.endLineNumber === range.endLineNumber &&
      otherRange.endColumn > range.endColumn
    ) {
      return false;
    }
    return true;
  }

  static strictContainsRange(range: IRange, otherRange: IRange): boolean {
    if (!Range.containsRange(range, otherRange)) return false;
    return !Range.equalsRange(range, otherRange);
  }

  static plusRange(a: IRange, b: IRange): Range {
    let startLineNumber: number;
    let startColumn: number;
    if (b.startLineNumber < a.startLineNumber) {
      startLineNumber = b.startLineNumber;
      startColumn = b.startColumn;
    } else if (b.startLineNumber === a.startLineNumber) {
      startLineNumber = b.startLineNumber;
      startColumn = Math.min(b.startColumn, a.startColumn);
    } else {
      startLineNumber = a.startLineNumber;
      startColumn = a.startColumn;
    }

    let endLineNumber: number;
    let endColumn: number;
    if (b.endLineNumber > a.endLineNumber) {
      endLineNumber = b.endLineNumber;
      endColumn = b.endColumn;
    } else if (b.endLineNumber === a.endLineNumber) {
      endLineNumber = b.endLineNumber;
      endColumn = Math.max(b.endColumn, a.endColumn);
    } else {
      endLineNumber = a.endLineNumber;
      endColumn = a.endColumn;
    }
    return new Range(startLineNumber, startColumn, endLineNumber, endColumn);
  }

  static intersectRanges(a: IRange, b: IRange): Range | null {
    let resultStartLineNumber = a.startLineNumber;
    let resultStartColumn = a.startColumn;
    let resultEndLineNumber = a.endLineNumber;
    let resultEndColumn = a.endColumn;

    if (resultStartLineNumber < b.startLineNumber) {
      resultStartLineNumber = b.startLineNumber;
      resultStartColumn = b.startColumn;
    } else if (resultStartLineNumber === b.startLineNumber) {
      resultStartColumn = Math.max(resultStartColumn, b.startColumn);
    }

    if (resultEndLineNumber > b.endLineNumber) {
      resultEndLineNumber = b.endLineNumber;
      resultEndColumn = b.endColumn;
    } else if (resultEndLineNumber === b.endLineNumber) {
      resultEndColumn = Math.min(resultEndColumn, b.endColumn);
    }

    if (resultStartLineNumber > resultEndLineNumber) return null;
    if (resultStartLineNumber === resultEndLineNumber && resultStartColumn > resultEndColumn) {
      return null;
    }
    return new Range(
      resultStartLineNumber,
      resultStartColumn,
      resultEndLineNumber,
      resultEndColumn,
    );
  }

  static equalsRange(a: IRange | null | undefined, b: IRange | null | undefined): boolean {
    if (!a && !b) return true;
    return (
      !!a &&
      !!b &&
      a.startLineNumber === b.startLineNumber &&
      a.startColumn === b.startColumn &&
      a.endLineNumber === b.endLineNumber &&
      a.endColumn === b.endColumn
    );
  }

  static fromPositions(start: IPosition, end: IPosition = start): Range {
    return new Range(start.lineNumber, start.column, end.lineNumber, end.column);
  }

  static lift(range: IRange | null | undefined): Range | null {
    if (!range) return null;
    return new Range(
      range.startLineNumber,
      range.startColumn,
      range.endLineNumber,
      range.endColumn,
    );
  }

  static isIRange(obj: unknown): obj is IRange {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      typeof (obj as IRange).startLineNumber === 'number' &&
      typeof (obj as IRange).startColumn === 'number' &&
      typeof (obj as IRange).endLineNumber === 'number' &&
      typeof (obj as IRange).endColumn === 'number'
    );
  }

  static compareRangesUsingStarts(a: IRange | null | undefined, b: IRange | null | undefined): number {
    if (a && b) {
      if (a.startLineNumber !== b.startLineNumber) return a.startLineNumber - b.startLineNumber;
      if (a.startColumn !== b.startColumn) return a.startColumn - b.startColumn;
      if (a.endLineNumber !== b.endLineNumber) return a.endLineNumber - b.endLineNumber;
      return a.endColumn - b.endColumn;
    }
    return (a ? 1 : 0) - (b ? 1 : 0);
  }

  static compareRangesUsingEnds(a: IRange, b: IRange): number {
    if (a.endLineNumber !== b.endLineNumber) return a.endLineNumber - b.endLineNumber;
    if (a.endColumn !== b.endColumn) return a.endColumn - b.endColumn;
    if (a.startLineNumber !== b.startLineNumber) return a.startLineNumber - b.startLineNumber;
    return a.startColumn - b.startColumn;
  }
}
