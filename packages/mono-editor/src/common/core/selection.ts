import type { IPosition, ISelection } from './types';
import { SelectionDirection } from './enums';
import { Position } from './position';
import { Range } from './range';

/**
 * A directed selection in the editor (Monaco-compatible).
 */
export class Selection extends Range implements ISelection {
  readonly selectionStartLineNumber: number;
  readonly selectionStartColumn: number;
  readonly positionLineNumber: number;
  readonly positionColumn: number;

  constructor(
    selectionStartLineNumber: number,
    selectionStartColumn: number,
    positionLineNumber: number,
    positionColumn: number,
  ) {
    super(selectionStartLineNumber, selectionStartColumn, positionLineNumber, positionColumn);
    this.selectionStartLineNumber = selectionStartLineNumber;
    this.selectionStartColumn = selectionStartColumn;
    this.positionLineNumber = positionLineNumber;
    this.positionColumn = positionColumn;
  }

  getSelectionStart(): Position {
    return new Position(this.selectionStartLineNumber, this.selectionStartColumn);
  }

  getPosition(): Position {
    return new Position(this.positionLineNumber, this.positionColumn);
  }

  getDirection(): SelectionDirection {
    if (
      this.selectionStartLineNumber === this.startLineNumber &&
      this.selectionStartColumn === this.startColumn
    ) {
      return SelectionDirection.LTR;
    }
    return SelectionDirection.RTL;
  }

  override setEndPosition(endLineNumber: number, endColumn: number): Selection {
    if (this.getDirection() === SelectionDirection.LTR) {
      return new Selection(this.startLineNumber, this.startColumn, endLineNumber, endColumn);
    }
    return new Selection(endLineNumber, endColumn, this.startLineNumber, this.startColumn);
  }

  override setStartPosition(startLineNumber: number, startColumn: number): Selection {
    if (this.getDirection() === SelectionDirection.LTR) {
      return new Selection(startLineNumber, startColumn, this.endLineNumber, this.endColumn);
    }
    return new Selection(this.endLineNumber, this.endColumn, startLineNumber, startColumn);
  }

  equalsSelection(other: ISelection | null | undefined): boolean {
    return Selection.selectionsEqual(this, other);
  }

  override toString(): string {
    return `[${this.selectionStartLineNumber},${this.selectionStartColumn} -> ${this.positionLineNumber},${this.positionColumn}]`;
  }

  static createWithDirection(
    startLineNumber: number,
    startColumn: number,
    endLineNumber: number,
    endColumn: number,
    direction: SelectionDirection,
  ): Selection {
    if (direction === SelectionDirection.LTR) {
      return new Selection(startLineNumber, startColumn, endLineNumber, endColumn);
    }
    return new Selection(endLineNumber, endColumn, startLineNumber, startColumn);
  }

  static override fromPositions(start: IPosition, end: IPosition = start): Selection {
    return new Selection(start.lineNumber, start.column, end.lineNumber, end.column);
  }

  static liftSelection(sel: ISelection): Selection {
    const sLine = sel.selectionStartLineNumber ?? sel.startLineNumber;
    const sCol = sel.selectionStartColumn ?? sel.startColumn;
    const pLine = sel.positionLineNumber ?? sel.endLineNumber;
    const pCol = sel.positionColumn ?? sel.endColumn;
    return new Selection(sLine, sCol, pLine, pCol);
  }

  static isISelection(obj: unknown): obj is ISelection {
    return (
      Range.isIRange(obj) &&
      typeof (obj as ISelection).selectionStartLineNumber === 'number' &&
      typeof (obj as ISelection).selectionStartColumn === 'number' &&
      typeof (obj as ISelection).positionLineNumber === 'number' &&
      typeof (obj as ISelection).positionColumn === 'number'
    );
  }

  static selectionsEqual(
    a: ISelection | null | undefined,
    b: ISelection | null | undefined,
  ): boolean {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return (
      (a.selectionStartLineNumber ?? a.startLineNumber) ===
        (b.selectionStartLineNumber ?? b.startLineNumber) &&
      (a.selectionStartColumn ?? a.startColumn) === (b.selectionStartColumn ?? b.startColumn) &&
      (a.positionLineNumber ?? a.endLineNumber) === (b.positionLineNumber ?? b.endLineNumber) &&
      (a.positionColumn ?? a.endColumn) === (b.positionColumn ?? b.endColumn)
    );
  }
}
