import type { MultiCursorPasteMode } from '../../common/config/editorOptions';
import type { MonoEditorTheme } from '../../common/config/themeTypes';
import type { SelectionState } from '../../common/core/SelectionState';
import type { IRange } from '../../common/core/types';
import type { IMarker } from '../../common/decorations/types';
import {
  deleteLines,
  duplicateLines,
  insertLine,
  moveLines,
  toggleBlockComment,
  toggleLineComment,
} from '../../common/editOperations/EditOperations';
import {
  convertIndentation,
  deleteDuplicateLines,
  joinLines,
  sortLines,
  transformCase,
  transposeCharacters,
  trimTrailingWhitespace,
  type LineTransformResult,
} from '../../common/editOperations/lineTransforms';
import { getLanguageConfiguration } from '../../common/languages/languageConfigurationRegistry';
import type { TextModel } from '../../common/model/TextModel';
import { readClipboardText, writeClipboardText } from '../../platform/clipboard/clipboard';
import type { CommandService } from '../../platform/commands/CommandService';
import { KeybindingService, MonoCommands } from '../../platform/keybindings/KeybindingService';
import type { ViewController } from '../view/ViewController';
import type { OverlayScrollbar, OverviewTick } from '../view/viewParts/OverlayScrollbar';
import type { StackEntrySelectionInfo } from './modelController';

export interface CoreKeybindingHost {
  getModel(): TextModel;
  selection: SelectionState;
  view: ViewController;
  keybindings: KeybindingService;
  commands: CommandService;
  isReadOnly(): boolean;
  getTabSize(): number;
  getInsertSpaces?(): boolean;
  getEmptySelectionClipboard?(): boolean;
  getMultiCursorPaste?(): MultiCursorPasteMode;
  getNativePasteSeq?(): number;
  getLanguageIdAtPosition?: (lineNumber: number, column: number) => string;
  onBeforePaste?: (text: string) => Promise<boolean>;
  onAfterPaste?: (range: IRange) => void;
  onSyncIndentOptions?: (insertSpaces: boolean, tabSize: number) => void;
  syncTextarea(): void;
  emitContent(): void;
  emitCursorEvents(source: string): void;
  applyStackSelection(entry: StackEntrySelectionInfo | null, mode: 'undo' | 'redo'): void;
}

export function registerCoreKeybindingsAndActions(host: CoreKeybindingHost): void {
  const runAfter = () => {
    host.view.notifyCaretActivity('edit');
    host.view.ensureCaretVisible();
    host.syncTextarea();
    host.view.paint();
    host.emitContent();
  };

  const primaryRange = (): IRange => {
    const a = host.selection.anchor;
    const b = host.selection.active;
    const aFirst = a.lineNumber < b.lineNumber || (a.lineNumber === b.lineNumber && a.column <= b.column);
    const s = aFirst ? a : b;
    const e = aFirst ? b : a;
    return { startLineNumber: s.lineNumber, startColumn: s.column, endLineNumber: e.lineNumber, endColumn: e.column };
  };

  const applyTransform = (res: LineTransformResult, src: string) => {
    if (!res.changed) return;
    if (res.caret) host.selection.setCaret(res.caret.lineNumber, res.caret.column);
    else if (res.selection) {
      host.selection.anchor = { lineNumber: res.selection.startLineNumber, column: res.selection.startColumn };
      host.selection.active = { lineNumber: res.selection.endLineNumber, column: res.selection.endColumn };
    }
    runAfter();
    host.emitCursorEvents(src);
  };

  const languageAtSelectionStart = (): string => {
    const model = host.getModel();
    if (!host.getLanguageIdAtPosition) return model.getLanguageId();
    const r = primaryRange();
    return host.getLanguageIdAtPosition(r.startLineNumber, r.startColumn);
  };

  const emptyLineClipboardRange = (): { text: string; startOff: number; endOff: number } | null => {
    if (host.getEmptySelectionClipboard?.() === false) return null;
    const model = host.getModel();
    const ln = host.selection.active.lineNumber;
    const eol = model.getEOL();
    const line = model.getLineContent(ln);
    const startOff = model.getOffsetAt(ln, 1);
    if (ln < model.getLineCount()) {
      return { text: line + eol, startOff, endOff: model.getOffsetAt(ln + 1, 1) };
    }
    if (ln > 1) {
      const prevEnd = model.getOffsetAt(ln - 1, model.getLineContent(ln - 1).length + 1);
      return { text: line + eol, startOff: prevEnd, endOff: model.getOffsetAt(ln, line.length + 1) };
    }
    return { text: line + eol, startOff: 0, endOff: line.length };
  };

  const selectionText = (): string => {
    const model = host.getModel();
    const sel = host.selection;
    if (sel.hasMultipleCursors) {
      const val = model.getValue();
      return sel.selections.map((s) => {
        const aOff = model.getOffsetAt(s.anchor.lineNumber, s.anchor.column);
        const bOff = model.getOffsetAt(s.active.lineNumber, s.active.column);
        return val.slice(Math.min(aOff, bOff), Math.max(aOff, bOff));
      }).join('\n');
    }
    if (sel.isEmpty) return emptyLineClipboardRange()?.text ?? '';
    const aOff = model.getOffsetAt(sel.anchor.lineNumber, sel.anchor.column);
    const bOff = model.getOffsetAt(sel.active.lineNumber, sel.active.column);
    return model.getValue().slice(Math.min(aOff, bOff), Math.max(aOff, bOff));
  };

  const writeClipboard = async (text: string) => {
    if (!text) return;
    await writeClipboardText(text);
  };

  const doCopy = () => writeClipboard(selectionText());

  const doCut = () => {
    if (host.isReadOnly()) return;
    const model = host.getModel();
    const sel = host.selection;
    if (!sel.hasMultipleCursors && sel.isEmpty) {
      const whole = emptyLineClipboardRange();
      if (!whole) return;
      void writeClipboard(whole.text);
      model.delete(whole.startOff, whole.endOff);
      const pos = model.getPositionAt(Math.min(whole.startOff, model.getValue().length));
      sel.setCaret(pos.lineNumber, 1);
      runAfter();
      host.emitCursorEvents('cut');
      return;
    }
    const text = selectionText();
    if (!text) return;
    void writeClipboard(text);
    if (sel.hasMultipleCursors) {
      const items = sel.selections.map((s, idx) => {
        const aOff = model.getOffsetAt(s.anchor.lineNumber, s.anchor.column);
        const bOff = model.getOffsetAt(s.active.lineNumber, s.active.column);
        return { idx, start: Math.min(aOff, bOff), end: Math.max(aOff, bOff) };
      });
      const sortedAsc = [...items].sort((x, y) => x.start - y.start);
      const finalOffsets = new Array<number>(sortedAsc.length);
      let removed = 0;
      for (let i = 0; i < sortedAsc.length; i++) {
        finalOffsets[i] = sortedAsc[i]!.start - removed;
        removed += sortedAsc[i]!.end - sortedAsc[i]!.start;
      }
      model.transact(() => {
        for (let i = sortedAsc.length - 1; i >= 0; i--) {
          if (sortedAsc[i]!.end > sortedAsc[i]!.start) model.delete(sortedAsc[i]!.start, sortedAsc[i]!.end, 'other');
        }
      });
      const nextSels = sortedAsc.map((it, i) => {
        const p = model.getPositionAt(finalOffsets[i]!);
        return { origIdx: it.idx, range: { anchor: p, active: { ...p } } };
      }).sort((a, b) => a.origIdx - b.origIdx);
      sel.setSelections(nextSels.map((x) => x.range));
      runAfter();
      return;
    }
    const aOff = model.getOffsetAt(sel.anchor.lineNumber, sel.anchor.column);
    const bOff = model.getOffsetAt(sel.active.lineNumber, sel.active.column);
    const start = Math.min(aOff, bOff);
    model.delete(start, Math.max(aOff, bOff));
    const pos = model.getPositionAt(start);
    sel.setCaret(pos.lineNumber, pos.column);
    runAfter();
  };

  const doPaste = async () => {
    if (host.isReadOnly()) return;
    const text = await readClipboardText();
    if (!text) return;
    if (host.onBeforePaste && (await host.onBeforePaste(text))) return;
    const model = host.getModel();
    const sel = host.selection;
    if (sel.hasMultipleCursors) {
      const items = sel.selections.map((s, idx) => {
        const aOff = model.getOffsetAt(s.anchor.lineNumber, s.anchor.column);
        const bOff = model.getOffsetAt(s.active.lineNumber, s.active.column);
        return { idx, start: Math.min(aOff, bOff), end: Math.max(aOff, bOff) };
      });
      const sortedAsc = [...items].sort((x, y) => x.start - y.start);
      const lines = text.split(/\r?\n/);
      const pasteMode = host.getMultiCursorPaste?.() ?? 'spread';
      const perCursor = pasteMode !== 'full' && lines.length === sortedAsc.length && lines.length > 1;
      const textFor = (i: number) => (perCursor ? lines[i]! : text);
      const finalOffsets = new Array<number>(sortedAsc.length);
      let delta = 0;
      for (let i = 0; i < sortedAsc.length; i++) {
        const norm = model.normalizeEol(textFor(i));
        finalOffsets[i] = sortedAsc[i]!.start + delta + norm.length;
        delta += norm.length - (sortedAsc[i]!.end - sortedAsc[i]!.start);
      }
      model.transact(() => {
        for (let i = sortedAsc.length - 1; i >= 0; i--) {
          model.replaceRange(sortedAsc[i]!.start, sortedAsc[i]!.end, textFor(i), undefined, 'other');
        }
      });
      const nextSels = sortedAsc.map((it, i) => {
        const p = model.getPositionAt(finalOffsets[i]!);
        return { origIdx: it.idx, range: { anchor: p, active: { ...p } } };
      }).sort((a, b) => a.origIdx - b.origIdx);
      sel.setSelections(nextSels.map((x) => x.range));
      runAfter();
      return;
    }
    const startOff = sel.isEmpty
      ? model.getOffsetAt(sel.active.lineNumber, sel.active.column)
      : Math.min(model.getOffsetAt(sel.anchor.lineNumber, sel.anchor.column), model.getOffsetAt(sel.active.lineNumber, sel.active.column));
    const endOff = sel.isEmpty
      ? startOff
      : Math.max(model.getOffsetAt(sel.anchor.lineNumber, sel.anchor.column), model.getOffsetAt(sel.active.lineNumber, sel.active.column));
    const startPos = model.getPositionAt(startOff);
    model.replaceRange(startOff, endOff, text);
    const endPos = model.getPositionAt(startOff + model.normalizeEol(text).length);
    sel.setCaret(endPos.lineNumber, endPos.column);
    runAfter();
    host.onAfterPaste?.({
      startLineNumber: startPos.lineNumber, startColumn: startPos.column,
      endLineNumber: endPos.lineNumber, endColumn: endPos.column,
    });
  };

  host.keybindings.addMany([
    { id: MonoCommands.Undo, primary: 'ctrl+z', weight: 5, handler: () => { const e = host.getModel().undoEntry(); if (e) { host.applyStackSelection(e, 'undo'); runAfter(); host.emitCursorEvents('undo'); } } },
    { id: MonoCommands.Redo, primary: 'ctrl+shift+z', weight: 5, handler: () => { const e = host.getModel().redoEntry(); if (e) { host.applyStackSelection(e, 'redo'); runAfter(); host.emitCursorEvents('redo'); } } },
    { id: MonoCommands.Redo + '.y', primary: 'ctrl+y', weight: 5, handler: () => { const e = host.getModel().redoEntry(); if (e) { host.applyStackSelection(e, 'redo'); runAfter(); host.emitCursorEvents('redo'); } } },
    { id: MonoCommands.Copy, primary: 'ctrl+c', weight: 5, handler: () => { void doCopy(); } },
    { id: MonoCommands.Cut, primary: 'ctrl+x', weight: 5, handler: () => doCut() },
    {
      id: MonoCommands.Paste,
      primary: 'ctrl+v',
      weight: 5,
      preventDefault: false,
      handler: (e) => {
        if (!e || !e.isTrusted) {
          void doPaste();
          return;
        }
        // Let the browser fire a native `paste` event on the focused textarea so real OS
        // clipboard data arrives via `e.clipboardData` without needing `clipboard-read` permission.
        // If native `paste` does not fire (e.g. mobile soft keyboard IME sendKeyEvent), fall back.
        const seqBefore = host.getNativePasteSeq?.() ?? 0;
        window.setTimeout(() => {
          if ((host.getNativePasteSeq?.() ?? 0) === seqBefore) {
            void doPaste();
          }
        }, 60);
      },
    },
    {
      id: MonoCommands.SelectAll, primary: 'ctrl+a', weight: 5,
      handler: () => {
        const model = host.getModel();
        const last = model.getLineCount();
        host.selection.anchor = { lineNumber: 1, column: 1 };
        host.selection.active = { lineNumber: last, column: model.getLineContent(last).length + 1 };
        host.view.paint();
      },
    },
    { id: MonoCommands.CommentLine, primary: 'ctrl+/', weight: 5, handler: () => { if (!host.isReadOnly() && toggleLineComment(host.getModel(), host.selection, getLanguageConfiguration(languageAtSelectionStart()))) { runAfter(); host.emitCursorEvents('commentLine'); } } },
    { id: MonoCommands.BlockComment, primary: 'shift+alt+a', weight: 5, handler: () => { if (!host.isReadOnly() && toggleBlockComment(host.getModel(), host.selection, getLanguageConfiguration(languageAtSelectionStart()))) { runAfter(); host.emitCursorEvents('blockComment'); } } },
    { id: MonoCommands.MoveLinesUp, primary: 'alt+up', weight: 5, handler: () => { if (!host.isReadOnly() && moveLines(host.getModel(), host.selection, 'up')) { runAfter(); host.emitCursorEvents('moveLines'); } } },
    { id: MonoCommands.MoveLinesDown, primary: 'alt+down', weight: 5, handler: () => { if (!host.isReadOnly() && moveLines(host.getModel(), host.selection, 'down')) { runAfter(); host.emitCursorEvents('moveLines'); } } },
    { id: MonoCommands.CopyLinesUp, primary: 'shift+alt+up', weight: 5, handler: () => { if (!host.isReadOnly() && duplicateLines(host.getModel(), host.selection, 'up')) { runAfter(); host.emitCursorEvents('copyLines'); } } },
    { id: MonoCommands.CopyLinesDown, primary: 'shift+alt+down', weight: 5, handler: () => { if (!host.isReadOnly() && duplicateLines(host.getModel(), host.selection, 'down')) { runAfter(); host.emitCursorEvents('copyLines'); } } },
    { id: MonoCommands.DeleteLines, primary: 'ctrl+shift+k', weight: 5, handler: () => { if (!host.isReadOnly() && deleteLines(host.getModel(), host.selection)) { runAfter(); host.emitCursorEvents('deleteLines'); } } },
    { id: MonoCommands.InsertLineAfter, primary: 'ctrl+enter', weight: 5, handler: () => { if (!host.isReadOnly() && insertLine(host.getModel(), host.selection, 'below', getLanguageConfiguration(languageAtSelectionStart()), host.getTabSize())) { runAfter(); host.emitCursorEvents('insertLine'); } } },
    { id: MonoCommands.InsertLineBefore, primary: 'ctrl+shift+enter', weight: 5, handler: () => { if (!host.isReadOnly() && insertLine(host.getModel(), host.selection, 'above', getLanguageConfiguration(languageAtSelectionStart()), host.getTabSize())) { runAfter(); host.emitCursorEvents('insertLine'); } } },
    { id: MonoCommands.TransposeLetters, primary: 'ctrl+t', weight: 5, handler: () => { if (!host.isReadOnly()) applyTransform(transposeCharacters(host.getModel(), host.selection.active), 'transpose'); } },
    { id: 'workbench.action.showCommands', primary: 'ctrl+shift+p', handler: () => { window.dispatchEvent(new CustomEvent('mono:showCommands')); } },
  ]);

  host.commands.registerCommand('workbench.action.showCommands', () => {
    window.dispatchEvent(new CustomEvent('mono:showCommands'));
  });

  // Phase 6 Line Transforms & Indentation Commands
  const transformCommands: { id: string; title: string; run: () => void }[] = [
    { id: MonoCommands.JoinLines, title: 'Join Lines', run: () => { if (!host.isReadOnly()) applyTransform(joinLines(host.getModel(), primaryRange()), 'joinLines'); } },
    { id: MonoCommands.SortLinesAscending, title: 'Sort Lines Ascending', run: () => { if (!host.isReadOnly()) applyTransform(sortLines(host.getModel(), primaryRange(), 'asc'), 'sortLines'); } },
    { id: MonoCommands.SortLinesDescending, title: 'Sort Lines Descending', run: () => { if (!host.isReadOnly()) applyTransform(sortLines(host.getModel(), primaryRange(), 'desc'), 'sortLines'); } },
    { id: MonoCommands.DeleteDuplicateLines, title: 'Delete Duplicate Lines', run: () => { if (!host.isReadOnly()) applyTransform(deleteDuplicateLines(host.getModel(), primaryRange()), 'deleteDuplicateLines'); } },
    { id: MonoCommands.TransformToUppercase, title: 'Transform to Uppercase', run: () => { if (!host.isReadOnly()) applyTransform(transformCase(host.getModel(), primaryRange(), 'upper'), 'transformCase'); } },
    { id: MonoCommands.TransformToLowercase, title: 'Transform to Lowercase', run: () => { if (!host.isReadOnly()) applyTransform(transformCase(host.getModel(), primaryRange(), 'lower'), 'transformCase'); } },
    { id: MonoCommands.TransformToTitleCase, title: 'Transform to Title Case', run: () => { if (!host.isReadOnly()) applyTransform(transformCase(host.getModel(), primaryRange(), 'title'), 'transformCase'); } },
    { id: MonoCommands.TrimTrailingWhitespace, title: 'Trim Trailing Whitespace', run: () => { if (!host.isReadOnly()) applyTransform(trimTrailingWhitespace(host.getModel()), 'trimTrailingWhitespace'); } },
    {
      id: MonoCommands.ConvertIndentationToSpaces, title: 'Convert Indentation to Spaces',
      run: () => {
        if (host.isReadOnly()) return;
        applyTransform(convertIndentation(host.getModel(), true, host.getTabSize()), 'convertIndentation');
        host.onSyncIndentOptions?.(true, host.getTabSize());
      },
    },
    {
      id: MonoCommands.ConvertIndentationToTabs, title: 'Convert Indentation to Tabs',
      run: () => {
        if (host.isReadOnly()) return;
        applyTransform(convertIndentation(host.getModel(), false, host.getTabSize()), 'convertIndentation');
        host.onSyncIndentOptions?.(false, host.getTabSize());
      },
    },
    {
      id: MonoCommands.DetectIndentation, title: 'Detect Indentation from Content',
      run: () => {
        const m = host.getModel();
        m.detectIndentation(host.getInsertSpaces?.() ?? true, host.getTabSize());
        const opts = m.getOptions();
        host.onSyncIndentOptions?.(opts.insertSpaces, opts.tabSize);
      },
    },
  ];
  for (const tc of transformCommands) {
    host.commands.registerCommand(tc.id, tc.run, { title: tc.title, category: 'Edit' });
  }

  const coreTitles: Record<string, { title: string; category: string; precondition?: string }> = {
    undo: { title: 'Undo', category: 'Edit' },
    redo: { title: 'Redo', category: 'Edit' },
    'editor.action.clipboardCopyAction': { title: 'Copy', category: 'Edit' },
    'editor.action.clipboardCutAction': { title: 'Cut', category: 'Edit' },
    'editor.action.clipboardPasteAction': { title: 'Paste', category: 'Edit' },
    'editor.action.selectAll': { title: 'Select All', category: 'Edit' },
    [MonoCommands.CommentLine]: { title: 'Toggle Line Comment', category: 'Edit' },
    [MonoCommands.BlockComment]: { title: 'Toggle Block Comment', category: 'Edit' },
    [MonoCommands.MoveLinesUp]: { title: 'Move Line Up', category: 'Edit' },
    [MonoCommands.MoveLinesDown]: { title: 'Move Line Down', category: 'Edit' },
    [MonoCommands.CopyLinesUp]: { title: 'Copy Line Up', category: 'Edit' },
    [MonoCommands.CopyLinesDown]: { title: 'Copy Line Down', category: 'Edit' },
    [MonoCommands.DeleteLines]: { title: 'Delete Line', category: 'Edit' },
    [MonoCommands.InsertLineAfter]: { title: 'Insert Line Below', category: 'Edit' },
    [MonoCommands.InsertLineBefore]: { title: 'Insert Line Above', category: 'Edit' },
    [MonoCommands.TransposeLetters]: { title: 'Transpose Characters', category: 'Edit' },
  };

  for (const [id, meta] of Object.entries(coreTitles)) {
    if (id === MonoCommands.Copy) {
      host.commands.registerCommand(id, () => doCopy(), { title: meta.title, category: meta.category, precondition: meta.precondition });
      continue;
    }
    if (id === MonoCommands.Cut) {
      host.commands.registerCommand(id, () => doCut(), { title: meta.title, category: meta.category, precondition: meta.precondition });
      continue;
    }
    if (id === MonoCommands.Paste) {
      host.commands.registerCommand(id, () => doPaste(), { title: meta.title, category: meta.category, precondition: meta.precondition });
      continue;
    }
    host.commands.registerCommand(
      id,
      () => {
        const kb = host.keybindings.list().find((b) => b.id === id);
        kb?.handler(new KeyboardEvent('keydown'));
      },
      { title: meta.title, category: meta.category, precondition: meta.precondition },
    );
  }
}

/** Syncs overlay scrollbar geometry and overview ticks (markers + find matches). */
export function syncEditorScrollbar(params: {
  scrollbar: OverlayScrollbar;
  theme: MonoEditorTheme;
  model: TextModel;
  view: ViewController;
  markers: IMarker[];
  findMatches: { startLineNumber: number }[];
  rightInset: number;
  activeScroll: boolean;
  activeAxes?: { vertical?: boolean; horizontal?: boolean };
}): void {
  const bg = params.theme.background || '#1e1e1e';
  const m = /^#?([0-9a-f]{6})$/i.exec(bg.trim());
  let isDark = true;
  if (m) {
    const n = parseInt(m[1]!, 16);
    isDark = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 < 0.5;
  }

  const totalLines = Math.max(1, params.model.getLineCount());
  const ticks: OverviewTick[] = [];
  for (const mk of params.markers) {
    const color = mk.severity >= 8 ? '#ef4444' : mk.severity >= 4 ? '#f59e0b' : '#38bdf8';
    ticks.push({ ratio: Math.max(0, Math.min(1, (mk.startLineNumber - 1) / totalLines)), color });
  }
  for (const fm of params.findMatches) {
    ticks.push({ ratio: Math.max(0, Math.min(1, (fm.startLineNumber - 1) / totalLines)), color: '#f97316' });
  }

  params.scrollbar.update(
    {
      scrollTop: params.view.scrollTop,
      scrollLeft: params.view.scrollLeft,
      scrollHeight: params.view.getScrollHeight(),
      scrollWidth: params.view.getScrollWidth(),
      viewportHeight: params.view.cssHeight,
      viewportWidth: params.view.cssWidth,
      contentLeft: params.view.contentLeft,
      rightInset: params.rightInset,
      isDark,
      ticks,
    },
    params.activeScroll,
    params.activeAxes,
  );
}
