import type { MonoEditorTheme } from '../../common/config/themeTypes';
import type { SelectionState } from '../../common/core/SelectionState';
import type { IMarker } from '../../common/decorations/types';
import {
  deleteLines,
  duplicateLines,
  insertLine,
  moveLines,
  toggleBlockComment,
  toggleLineComment,
} from '../../common/editOperations/EditOperations';
import { getLanguageConfiguration } from '../../common/languages/languageConfigurationRegistry';
import type { TextModel } from '../../common/model/TextModel';
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
  getLanguageIdAtPosition?: (lineNumber: number, column: number) => string;
  syncTextarea(): void;
  emitContent(): void;
  emitCursorEvents(source: string): void;
  applyStackSelection(entry: StackEntrySelectionInfo | null, mode: 'undo' | 'redo'): void;
}

export function registerCoreKeybindingsAndActions(host: CoreKeybindingHost): void {
  const runAfter = () => {
    host.view.ensureCaretVisible();
    host.syncTextarea();
    host.view.paint();
    host.emitContent();
  };

  /**
   * Resolve effective language at the START position of the primary selection.
   * For multi-line selections spanning embedded boundaries (e.g. HTML `<style>` / `<script>`),
   * comment toggle consistently uses the language at the selection start position.
   */
  const languageAtSelectionStart = (): string => {
    const model = host.getModel();
    if (!host.getLanguageIdAtPosition) return model.getLanguageId();
    const a = host.selection.anchor;
    const b = host.selection.active;
    const aFirst = a.lineNumber < b.lineNumber || (a.lineNumber === b.lineNumber && a.column <= b.column);
    const start = aFirst ? a : b;
    return host.getLanguageIdAtPosition(start.lineNumber, start.column);
  };

  const selectionText = (): string => {
    const model = host.getModel();
    const sel = host.selection;
    if (sel.hasMultipleCursors) {
      const val = model.getValue();
      return sel.selections
        .map((s) => {
          const aOff = model.getOffsetAt(s.anchor.lineNumber, s.anchor.column);
          const bOff = model.getOffsetAt(s.active.lineNumber, s.active.column);
          return val.slice(Math.min(aOff, bOff), Math.max(aOff, bOff));
        })
        .join('\n');
    }
    if (sel.isEmpty) return '';
    const aOff = model.getOffsetAt(sel.anchor.lineNumber, sel.anchor.column);
    const bOff = model.getOffsetAt(sel.active.lineNumber, sel.active.column);
    return model.getValue().slice(Math.min(aOff, bOff), Math.max(aOff, bOff));
  };

  const writeClipboard = async (text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
  };

  const doCopy = () => { void writeClipboard(selectionText()); };

  const doCut = () => {
    const text = selectionText();
    if (!text) return;
    void writeClipboard(text);
    const model = host.getModel();
    const sel = host.selection;
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
        const it = sortedAsc[i]!;
        finalOffsets[i] = it.start - removed;
        removed += it.end - it.start;
      }
      model.transact(() => {
        for (let i = sortedAsc.length - 1; i >= 0; i--) {
          const it = sortedAsc[i]!;
          if (it.end > it.start) model.delete(it.start, it.end, 'other');
        }
      });
      const nextSels = sortedAsc.map((it, i) => {
        const p = model.getPositionAt(finalOffsets[i]!);
        return { origIdx: it.idx, range: { anchor: p, active: { ...p } } };
      });
      nextSels.sort((a, b) => a.origIdx - b.origIdx);
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
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch { return; }
    if (!text) return;
    const model = host.getModel();
    const sel = host.selection;
    if (sel.hasMultipleCursors) {
      const items = sel.selections.map((s, idx) => {
        const aOff = model.getOffsetAt(s.anchor.lineNumber, s.anchor.column);
        const bOff = model.getOffsetAt(s.active.lineNumber, s.active.column);
        return { idx, start: Math.min(aOff, bOff), end: Math.max(aOff, bOff) };
      });
      const sortedAsc = [...items].sort((x, y) => x.start - y.start);
      const lines = text.split('\n');
      const perCursor = lines.length === sortedAsc.length && lines.length > 1;
      const textFor = (i: number) => (perCursor ? lines[i]! : text);
      const finalOffsets = new Array<number>(sortedAsc.length);
      let delta = 0;
      for (let i = 0; i < sortedAsc.length; i++) {
        const it = sortedAsc[i]!;
        const norm = model.normalizeEol(textFor(i));
        finalOffsets[i] = it.start + delta + norm.length;
        delta += norm.length - (it.end - it.start);
      }
      model.transact(() => {
        for (let i = sortedAsc.length - 1; i >= 0; i--) {
          const it = sortedAsc[i]!;
          model.replaceRange(it.start, it.end, textFor(i), undefined, 'other');
        }
      });
      const nextSels = sortedAsc.map((it, i) => {
        const p = model.getPositionAt(finalOffsets[i]!);
        return { origIdx: it.idx, range: { anchor: p, active: { ...p } } };
      });
      nextSels.sort((a, b) => a.origIdx - b.origIdx);
      sel.setSelections(nextSels.map((x) => x.range));
      runAfter();
      return;
    }
    if (!sel.isEmpty) {
      const aOff = model.getOffsetAt(sel.anchor.lineNumber, sel.anchor.column);
      const bOff = model.getOffsetAt(sel.active.lineNumber, sel.active.column);
      const start = Math.min(aOff, bOff);
      model.replaceRange(start, Math.max(aOff, bOff), text);
      const pos = model.getPositionAt(start + model.normalizeEol(text).length);
      sel.setCaret(pos.lineNumber, pos.column);
    } else {
      const off = model.getOffsetAt(sel.active.lineNumber, sel.active.column);
      model.insert(off, text);
      const pos = model.getPositionAt(off + model.normalizeEol(text).length);
      sel.setCaret(pos.lineNumber, pos.column);
    }
    runAfter();
  };

  host.keybindings.addMany([
    {
      id: MonoCommands.Undo,
      primary: 'ctrl+z',
      weight: 5,
      handler: () => {
        const entry = host.getModel().undoEntry();
        if (entry) { host.applyStackSelection(entry, 'undo'); runAfter(); }
      },
    },
    {
      id: MonoCommands.Redo,
      primary: 'ctrl+shift+z',
      weight: 5,
      handler: () => {
        const entry = host.getModel().redoEntry();
        if (entry) { host.applyStackSelection(entry, 'redo'); runAfter(); }
      },
    },
    {
      id: MonoCommands.Redo + '.y',
      primary: 'ctrl+y',
      weight: 5,
      handler: () => {
        const entry = host.getModel().redoEntry();
        if (entry) { host.applyStackSelection(entry, 'redo'); runAfter(); }
      },
    },
    { id: MonoCommands.Copy, primary: 'ctrl+c', weight: 5, handler: () => doCopy() },
    { id: MonoCommands.Cut, primary: 'ctrl+x', weight: 5, handler: () => doCut() },
    { id: MonoCommands.Paste, primary: 'ctrl+v', weight: 5, handler: () => { void doPaste(); } },
    {
      id: MonoCommands.SelectAll,
      primary: 'ctrl+a',
      weight: 5,
      handler: () => {
        const model = host.getModel();
        const last = model.getLineCount();
        const lastCol = model.getLineContent(last).length + 1;
        host.selection.anchor = { lineNumber: 1, column: 1 };
        host.selection.active = { lineNumber: last, column: lastCol };
        host.view.paint();
      },
    },
    {
      id: MonoCommands.CommentLine,
      primary: 'ctrl+/',
      weight: 5,
      handler: () => {
        if (host.isReadOnly()) return;
        const model = host.getModel();
        const cfg = getLanguageConfiguration(languageAtSelectionStart());
        if (toggleLineComment(model, host.selection, cfg)) { runAfter(); host.emitCursorEvents('commentLine'); }
      },
    },
    {
      id: MonoCommands.BlockComment,
      primary: 'shift+alt+a',
      weight: 5,
      handler: () => {
        if (host.isReadOnly()) return;
        const model = host.getModel();
        const cfg = getLanguageConfiguration(languageAtSelectionStart());
        if (toggleBlockComment(model, host.selection, cfg)) { runAfter(); host.emitCursorEvents('blockComment'); }
      },
    },
    {
      id: MonoCommands.MoveLinesUp,
      primary: 'alt+up',
      weight: 5,
      handler: () => {
        if (host.isReadOnly()) return;
        if (moveLines(host.getModel(), host.selection, 'up')) { runAfter(); host.emitCursorEvents('moveLines'); }
      },
    },
    {
      id: MonoCommands.MoveLinesDown,
      primary: 'alt+down',
      weight: 5,
      handler: () => {
        if (host.isReadOnly()) return;
        if (moveLines(host.getModel(), host.selection, 'down')) { runAfter(); host.emitCursorEvents('moveLines'); }
      },
    },
    {
      id: MonoCommands.CopyLinesUp,
      primary: 'shift+alt+up',
      weight: 5,
      handler: () => {
        if (host.isReadOnly()) return;
        if (duplicateLines(host.getModel(), host.selection, 'up')) { runAfter(); host.emitCursorEvents('copyLines'); }
      },
    },
    {
      id: MonoCommands.CopyLinesDown,
      primary: 'shift+alt+down',
      weight: 5,
      handler: () => {
        if (host.isReadOnly()) return;
        if (duplicateLines(host.getModel(), host.selection, 'down')) { runAfter(); host.emitCursorEvents('copyLines'); }
      },
    },
    {
      id: MonoCommands.DeleteLines,
      primary: 'ctrl+shift+k',
      weight: 5,
      handler: () => {
        if (host.isReadOnly()) return;
        if (deleteLines(host.getModel(), host.selection)) { runAfter(); host.emitCursorEvents('deleteLines'); }
      },
    },
    {
      id: MonoCommands.InsertLineAfter,
      primary: 'ctrl+enter',
      weight: 5,
      handler: () => {
        if (host.isReadOnly()) return;
        const model = host.getModel();
        const cfg = getLanguageConfiguration(languageAtSelectionStart());
        if (insertLine(model, host.selection, 'below', cfg, host.getTabSize())) { runAfter(); host.emitCursorEvents('insertLine'); }
      },
    },
    {
      id: MonoCommands.InsertLineBefore,
      primary: 'ctrl+shift+enter',
      weight: 5,
      handler: () => {
        if (host.isReadOnly()) return;
        const model = host.getModel();
        const cfg = getLanguageConfiguration(languageAtSelectionStart());
        if (insertLine(model, host.selection, 'above', cfg, host.getTabSize())) { runAfter(); host.emitCursorEvents('insertLine'); }
      },
    },
    {
      id: 'workbench.action.showCommands',
      primary: 'ctrl+shift+p',
      handler: () => { window.dispatchEvent(new CustomEvent('mono:showCommands')); },
    },
  ]);

  host.commands.registerCommand('workbench.action.showCommands', () => {
    window.dispatchEvent(new CustomEvent('mono:showCommands'));
  });

  const coreTitles: Record<string, { title: string; category: string; precondition?: string }> = {
    undo: { title: 'Undo', category: 'Edit' },
    redo: { title: 'Redo', category: 'Edit' },
    'editor.action.clipboardCopyAction': { title: 'Copy', category: 'Edit', precondition: 'editorHasSelection' },
    'editor.action.clipboardCutAction': { title: 'Cut', category: 'Edit', precondition: 'editorHasSelection' },
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
  };

  for (const [id, meta] of Object.entries(coreTitles)) {
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
    const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    isDark = lum < 0.5;
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
