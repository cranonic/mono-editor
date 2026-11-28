import {
  ContributionIds,
  type IEditorContribution,
  type IEditorContributionHost,
} from '../../browser/editor/editorTypes';
import type { IPosition } from '../../common/core/types';
import { MonoCommands } from '../../platform/keybindings/KeybindingService';

export class MultiCursorController implements IEditorContribution {
  readonly id = ContributionIds.MultiCursor;
  private readonly host: IEditorContributionHost;

  constructor(host: IEditorContributionHost) {
    this.host = host;

    host.keybindings.addMany([
      {
        id: MonoCommands.AddSelectionToNextFindMatch,
        primary: 'ctrl+d',
        weight: 5,
        handler: () => this.addSelectionToNextFindMatch(),
      },
      {
        id: MonoCommands.SelectHighlights,
        primary: 'ctrl+shift+l',
        weight: 5,
        handler: () => this.selectAllOccurrencesOfSelection(),
      },
      {
        id: MonoCommands.InsertCursorAbove,
        primary: 'ctrl+alt+up',
        weight: 5,
        handler: () => this.insertCursorVertical(-1),
      },
      {
        id: MonoCommands.InsertCursorBelow,
        primary: 'ctrl+alt+down',
        weight: 5,
        handler: () => this.insertCursorVertical(1),
      },
    ]);

    host.commands.registerCommand(
      MonoCommands.AddSelectionToNextFindMatch,
      () => this.addSelectionToNextFindMatch(),
      { title: 'Add Selection To Next Find Match', category: 'Selection' },
    );
    host.commands.registerCommand(
      MonoCommands.SelectHighlights,
      () => this.selectAllOccurrencesOfSelection(),
      { title: 'Select All Occurrences of Find Match', category: 'Selection' },
    );
    host.commands.registerCommand(
      MonoCommands.InsertCursorAbove,
      () => this.insertCursorVertical(-1),
      { title: 'Add Cursor Above', category: 'Selection' },
    );
    host.commands.registerCommand(
      MonoCommands.InsertCursorBelow,
      () => this.insertCursorVertical(1),
      { title: 'Add Cursor Below', category: 'Selection' },
    );
  }

  addSelectionToNextFindMatch(): void {
    const model = this.host.getModel();
    const sel = this.host.selection;
    const val = model.getValue();

    if (sel.isEmpty && !sel.hasMultipleCursors) {
      const p = sel.active;
      const w = this.host.wordAtPosition(p.lineNumber, p.column);
      if (!w) return;
      sel.anchor = { lineNumber: p.lineNumber, column: w.startColumn };
      sel.active = { lineNumber: p.lineNumber, column: w.endColumn };
      this.host.view.ensureCaretVisible();
      this.host.view.paint();
      this.host.emitCursorEvents('addSelection');
      return;
    }

    const lastSel = sel.selections[sel.selections.length - 1]!;
    const aOff = model.getOffsetAt(lastSel.anchor.lineNumber, lastSel.anchor.column);
    const bOff = model.getOffsetAt(lastSel.active.lineNumber, lastSel.active.column);
    const startOff = Math.min(aOff, bOff);
    const endOff = Math.max(aOff, bOff);
    const needle = val.slice(startOff, endOff);
    if (!needle) return;

    const existing = new Set(
      sel.selections.map((s) => {
        const x = model.getOffsetAt(s.anchor.lineNumber, s.anchor.column);
        const y = model.getOffsetAt(s.active.lineNumber, s.active.column);
        return `${Math.min(x, y)}:${Math.max(x, y)}`;
      }),
    );

    let searchFrom = endOff;
    let found = -1;
    for (let pass = 0; pass < 2; pass++) {
      let idx = val.indexOf(needle, searchFrom);
      while (idx !== -1) {
        const key = `${idx}:${idx + needle.length}`;
        if (!existing.has(key)) {
          found = idx;
          break;
        }
        idx = val.indexOf(needle, idx + needle.length);
      }
      if (found !== -1) break;
      searchFrom = 0;
    }

    if (found === -1) return;
    const limit = Math.max(1, this.host.getMultiCursorLimit?.() ?? sel.getMaxCursors());
    if (sel.selections.length >= limit) return;
    const sPos = model.getPositionAt(found);
    const ePos = model.getPositionAt(found + needle.length);
    sel.addSelection(sPos, ePos, false);
    this.host.revealPosition(ePos);
    this.host.syncTextarea();
    this.host.view.paint();
    this.host.emitCursorEvents('addSelection');
  }

  selectAllOccurrencesOfSelection(): void {
    const model = this.host.getModel();
    const sel = this.host.selection;
    const val = model.getValue();
    let needle = '';
    if (sel.isEmpty) {
      const p = sel.active;
      const w = this.host.wordAtPosition(p.lineNumber, p.column);
      if (!w) return;
      needle = w.word;
    } else {
      const aOff = model.getOffsetAt(sel.anchor.lineNumber, sel.anchor.column);
      const bOff = model.getOffsetAt(sel.active.lineNumber, sel.active.column);
      needle = val.slice(Math.min(aOff, bOff), Math.max(aOff, bOff));
    }
    if (!needle) return;

    const limit = Math.max(1, this.host.getMultiCursorLimit?.() ?? sel.getMaxCursors());
    const ranges: { anchor: IPosition; active: IPosition }[] = [];
    let idx = val.indexOf(needle, 0);
    while (idx !== -1 && ranges.length < limit) {
      ranges.push({
        anchor: model.getPositionAt(idx),
        active: model.getPositionAt(idx + needle.length),
      });
      idx = val.indexOf(needle, idx + needle.length);
    }
    if (!ranges.length) return;
    sel.setSelections(ranges);
    this.host.syncTextarea();
    this.host.view.paint();
    this.host.emitCursorEvents('selectHighlights');
  }

  insertCursorVertical(deltaLine: -1 | 1): void {
    const model = this.host.getModel();
    const sel = this.host.selection;
    const lineCount = model.getLineCount();
    const cur = sel.selections;
    const limit = Math.max(1, this.host.getMultiCursorLimit?.() ?? sel.getMaxCursors());
    if (cur.length >= limit) return;
    let target = cur[0]!.active;
    for (const s of cur) {
      if (deltaLine < 0 && s.active.lineNumber < target.lineNumber) target = s.active;
      if (deltaLine > 0 && s.active.lineNumber > target.lineNumber) target = s.active;
    }
    const nextLine = target.lineNumber + deltaLine;
    if (nextLine < 1 || nextLine > lineCount) return;
    const maxCol = model.getLineContent(nextLine).length + 1;
    const pos = { lineNumber: nextLine, column: Math.min(maxCol, target.column) };
    sel.addSelection(pos, pos, false);
    this.host.revealPosition(pos);
    this.host.syncTextarea();
    this.host.view.paint();
    this.host.emitCursorEvents('insertCursor');
  }

  dispose(): void {
    /* stateless */
  }
}
