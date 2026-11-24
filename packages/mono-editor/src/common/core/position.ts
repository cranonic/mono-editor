import type { IPosition } from './types';

/**
 * A 1-based position in the editor (Monaco-compatible).
 */
export class Position implements IPosition {
  readonly lineNumber: number;
  readonly column: number;

  constructor(lineNumber: number, column: number) {
    this.lineNumber = lineNumber;
    this.column = column;
  }

  with(newLineNumber = this.lineNumber, newColumn = this.column): Position {
    if (newLineNumber === this.lineNumber && newColumn === this.column) return this;
    return new Position(newLineNumber, newColumn);
  }

  delta(deltaLineNumber = 0, deltaColumn = 0): Position {
    return this.with(this.lineNumber + deltaLineNumber, this.column + deltaColumn);
  }

  equals(other: IPosition | null | undefined): boolean {
    return Position.equals(this, other);
  }

  isBefore(other: IPosition): boolean {
    return Position.isBefore(this, other);
  }

  isBeforeOrEqual(other: IPosition): boolean {
    return Position.isBeforeOrEqual(this, other);
  }

  clone(): Position {
    return new Position(this.lineNumber, this.column);
  }

  toString(): string {
    return `(${this.lineNumber},${this.column})`;
  }

  static equals(a: IPosition | null | undefined, b: IPosition | null | undefined): boolean {
    if (!a && !b) return true;
    return !!a && !!b && a.lineNumber === b.lineNumber && a.column === b.column;
  }

  static isBefore(a: IPosition, b: IPosition): boolean {
    if (a.lineNumber < b.lineNumber) return true;
    if (b.lineNumber < a.lineNumber) return false;
    return a.column < b.column;
  }

  static isBeforeOrEqual(a: IPosition, b: IPosition): boolean {
    if (a.lineNumber < b.lineNumber) return true;
    if (b.lineNumber < a.lineNumber) return false;
    return a.column <= b.column;
  }

  static compare(a: IPosition, b: IPosition): number {
    const lineDiff = (a.lineNumber | 0) - (b.lineNumber | 0);
    if (lineDiff !== 0) return lineDiff;
    return (a.column | 0) - (b.column | 0);
  }

  static lift(pos: IPosition): Position {
    return new Position(pos.lineNumber, pos.column);
  }

  static isIPosition(obj: unknown): obj is IPosition {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      typeof (obj as IPosition).lineNumber === 'number' &&
      typeof (obj as IPosition).column === 'number'
    );
  }
}
