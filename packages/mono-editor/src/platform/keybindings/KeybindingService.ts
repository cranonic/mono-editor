/**
 * Monaco-inspired keybinding layer.
 * Chord strings: "ctrl+z", "ctrl+shift+z", "ctrl+y", ...
 */

export type KeybindingWhen = () => boolean;

export interface MonoKeybinding {
  id: string;
  primary: string;
  handler: (e: KeyboardEvent) => void;
  when?: KeybindingWhen;
  weight?: number;
  /** When false, matching does not call `e.preventDefault()` (e.g. allow native browser `paste` event on Ctrl+V). */
  preventDefault?: boolean;
}

export interface KeybindingDispatchResult {
  matched: boolean;
  preventDefault: boolean;
}

const MODIFIER_ONLY_KEYS = new Set([
  'control',
  'ctrl',
  'shift',
  'alt',
  'meta',
  'altgraph',
  'capslock',
  'numlock',
  'scrolllock',
  'os',
  'fn',
  'fnlock',
]);

const SHIFTED_SYMBOL_TO_BASE: Record<string, string> = {
  '{': '[',
  '}': ']',
  '|': '\\',
  '?': '/',
  '<': ',',
  '>': '.',
  '~': '`',
  ':': ';',
  '"': "'",
  '_': '-',
  '+': '=',
};

const KEY_ALIASES: Record<string, string> = {
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
  ' ': 'space',
  spacebar: 'space',
  space: 'space',
  esc: 'escape',
  escape: 'escape',
  del: 'delete',
  delete: 'delete',
  return: 'enter',
  enter: 'enter',
  backspace: 'backspace',
  tab: 'tab',
  home: 'home',
  end: 'end',
  pageup: 'pageup',
  pagedown: 'pagedown',
  insert: 'insert',
};

function tokenFromKeyCode(kc: number): string {
  if (kc >= 65 && kc <= 90) return String.fromCharCode(kc + 32);
  if (kc >= 48 && kc <= 57) return String.fromCharCode(kc);
  if (kc >= 96 && kc <= 105) return String.fromCharCode(kc - 48);
  if (kc >= 112 && kc <= 135) return `f${kc - 111}`;
  switch (kc) {
    case 8: return 'backspace';
    case 9: return 'tab';
    case 13: return 'enter';
    case 27: return 'escape';
    case 32: return 'space';
    case 33: return 'pageup';
    case 34: return 'pagedown';
    case 35: return 'end';
    case 36: return 'home';
    case 37: return 'left';
    case 38: return 'up';
    case 39: return 'right';
    case 40: return 'down';
    case 45: return 'insert';
    case 46: return 'delete';
    case 186: return ';';
    case 187: return '=';
    case 188: return ',';
    case 189: return '-';
    case 190: return '.';
    case 191: return '/';
    case 192: return '`';
    case 219: return '[';
    case 220: return '\\';
    case 221: return ']';
    case 222: return "'";
    default: return '';
  }
}

function keyTokenFromEvent(e: KeyboardEvent): string {
  const code = e.code || '';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code.toLowerCase();
  switch (code) {
    case 'Space':
      return 'space';
    case 'ArrowUp':
    case 'ArrowDown':
    case 'ArrowLeft':
    case 'ArrowRight':
      return code.replace('Arrow', '').toLowerCase();
    case 'Enter':
    case 'NumpadEnter':
      return 'enter';
    case 'Tab':
    case 'Backspace':
    case 'Delete':
    case 'Escape':
    case 'Home':
    case 'End':
    case 'PageUp':
    case 'PageDown':
    case 'Insert':
      return code.toLowerCase();
    case 'Slash':
    case 'NumpadDivide':
      return '/';
    case 'Period':
    case 'NumpadDecimal':
      return '.';
    case 'Comma':
      return ',';
    case 'Semicolon':
      return ';';
    case 'Quote':
      return "'";
    case 'Backquote':
      return '`';
    case 'Minus':
    case 'NumpadSubtract':
      return '-';
    case 'Equal':
      return '=';
    case 'BracketLeft':
      return '[';
    case 'BracketRight':
      return ']';
    case 'Backslash':
      return '\\';
    default:
      break;
  }

  const rawKey = e.key || '';
  const lower = rawKey.toLowerCase();
  const kc = e.keyCode || e.which || 0;
  const hasMod = e.ctrlKey || e.metaKey || e.altKey;

  if (MODIFIER_ONLY_KEYS.has(lower)) return '';

  // Mobile soft keyboards (Hacker's Keyboard, Unexpected Keyboard) often leave `e.code === ""`
  // and send `e.key === "ArrowUp"` / `"Unidentified"` / ASCII control chars (`\x01`..`\x1a`).
  if (lower && lower !== 'unidentified' && lower !== 'process' && lower !== 'dead') {
    const alias = KEY_ALIASES[lower];
    if (alias) return alias;

    if (rawKey.length === 1) {
      const cc = rawKey.charCodeAt(0);
      // ASCII control characters emitted by Android IMEs when Ctrl is held (e.g. Ctrl+K -> \x0b)
      if (cc >= 1 && cc <= 26 && (e.ctrlKey || e.metaKey)) {
        // Disambiguate real Backspace/Tab/Enter from Ctrl+H/I/M via keyCode when available
        if (kc === 8) return 'backspace';
        if (kc === 9) return 'tab';
        if (kc === 13) return 'enter';
        return String.fromCharCode(96 + cc);
      }
      if (hasMod && SHIFTED_SYMBOL_TO_BASE[rawKey]) {
        return SHIFTED_SYMBOL_TO_BASE[rawKey]!;
      }
      // If Alt/Ctrl produced a non-ASCII composed character (e.g. Alt+letter), prefer keyCode
      if (hasMod && cc > 127 && kc) {
        const fromKc = tokenFromKeyCode(kc);
        if (fromKc) return fromKc;
      }
      return lower;
    }

    if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return lower;
  }

  // Fallback to legacy keyCode / which (critical on Android Chrome when e.key === 'Unidentified')
  if (kc && kc !== 229) {
    const fromKc = tokenFromKeyCode(kc);
    if (fromKc) return fromKc;
  }

  if (!lower || lower === 'unidentified' || lower === 'process' || lower === 'dead') {
    return '';
  }
  return lower;
}

function normalizeKey(e: KeyboardEvent): string {
  const token = keyTokenFromEvent(e);
  if (!token) return '';

  const ctrl = e.ctrlKey || e.metaKey;
  const altGraph = typeof e.getModifierState === 'function' ? e.getModifierState('AltGraph') : false;
  const alt = e.altKey || (!ctrl && altGraph);
  let shift = e.shiftKey;

  // On Android soft keyboards (Hacker's Keyboard, Unexpected Keyboard), pressing Ctrl+Shift+K
  // can emit uppercase `e.key === 'K'` (or shifted punctuation like '{') with `e.shiftKey === false`.
  if (!shift && (ctrl || alt) && e.key && e.key.length === 1) {
    const capsLock = typeof e.getModifierState === 'function' ? e.getModifierState('CapsLock') : false;
    if (e.key >= 'A' && e.key <= 'Z' && !capsLock) {
      shift = true;
    } else if (SHIFTED_SYMBOL_TO_BASE[e.key]) {
      shift = true;
    }
  }

  const parts: string[] = [];
  if (ctrl) parts.push('ctrl');
  if (shift) parts.push('shift');
  if (alt) parts.push('alt');
  parts.push(token);
  return parts.join('+');
}

function canonicalizeChord(chord: string): string {
  const rawParts = chord.toLowerCase().split('+').filter(Boolean);
  let ctrl = false;
  let shift = false;
  let alt = false;
  let key = '';
  for (const p of rawParts) {
    if (p === 'ctrl' || p === 'cmd' || p === 'meta' || p === 'ctrlcmd') ctrl = true;
    else if (p === 'shift') shift = true;
    else if (p === 'alt' || p === 'option') alt = true;
    else key = KEY_ALIASES[p] ?? p;
  }
  const out: string[] = [];
  if (ctrl) out.push('ctrl');
  if (shift) out.push('shift');
  if (alt) out.push('alt');
  if (key) out.push(key);
  return out.join('+');
}

function prettyChord(chord: string): string {
  return chord
    .split('+')
    .map((p) => {
      const x = p.toLowerCase();
      if (x === 'ctrl') return 'Ctrl';
      if (x === 'shift') return 'Shift';
      if (x === 'alt') return 'Alt';
      if (x === 'space') return 'Space';
      return x.length === 1 ? x.toUpperCase() : x[0]!.toUpperCase() + x.slice(1);
    })
    .join('+');
}

export class KeybindingService {
  private bindings: MonoKeybinding[] = [];

  add(binding: MonoKeybinding): () => void {
    const normalized: MonoKeybinding = {
      ...binding,
      primary: canonicalizeChord(binding.primary),
    };
    this.bindings.push(normalized);
    this.bindings.sort((a, b) => (a.weight ?? 100) - (b.weight ?? 100));
    return () => {
      this.bindings = this.bindings.filter((b) => b !== normalized);
    };
  }

  addMany(list: MonoKeybinding[]): () => void {
    const disposers = list.map((b) => this.add(b));
    return () => disposers.forEach((d) => d());
  }

  remove(id: string): void {
    this.bindings = this.bindings.filter((b) => b.id !== id);
  }

  clear(): void {
    this.bindings = [];
  }

  list(): MonoKeybinding[] {
    return this.bindings.map((b) => ({ ...b }));
  }

  /** First primary chord label for command id (palette shortcut column). */
  getShortcutLabel(commandId: string): string | undefined {
    const b = this.bindings.find((x) => x.id === commandId);
    return b ? prettyChord(b.primary) : undefined;
  }

  chordOf(e: KeyboardEvent): string {
    return normalizeKey(e);
  }

  dispatchDetailed(e: KeyboardEvent): KeybindingDispatchResult {
    const chord = normalizeKey(e);
    if (!chord) return { matched: false, preventDefault: false };
    for (const b of this.bindings) {
      if (b.primary !== chord) continue;
      if (b.when && !b.when()) continue;
      b.handler(e);
      return { matched: true, preventDefault: b.preventDefault !== false };
    }
    return { matched: false, preventDefault: false };
  }

  dispatch(e: KeyboardEvent): boolean {
    return this.dispatchDetailed(e).matched;
  }
}

export const MonoCommands = {
  Undo: 'undo',
  Redo: 'redo',
  Copy: 'editor.action.clipboardCopyAction',
  Cut: 'editor.action.clipboardCutAction',
  Paste: 'editor.action.clipboardPasteAction',
  SelectAll: 'editor.action.selectAll',
  CommandPalette: 'workbench.action.showCommands',
  CommentLine: 'editor.action.commentLine',
  BlockComment: 'editor.action.blockComment',
  MoveLinesUp: 'editor.action.moveLinesUpAction',
  MoveLinesDown: 'editor.action.moveLinesDownAction',
  CopyLinesUp: 'editor.action.copyLinesUpAction',
  CopyLinesDown: 'editor.action.copyLinesDownAction',
  DeleteLines: 'editor.action.deleteLines',
  InsertLineAfter: 'editor.action.insertLineAfter',
  InsertLineBefore: 'editor.action.insertLineBefore',
  Fold: 'editor.fold',
  Unfold: 'editor.unfold',
  ToggleFold: 'editor.toggleFold',
  FoldAll: 'editor.foldAll',
  UnfoldAll: 'editor.unfoldAll',
  TriggerParameterHints: 'editor.action.triggerParameterHints',
  FormatDocument: 'editor.action.formatDocument',
  FormatSelection: 'editor.action.formatSelection',
  RevealDefinition: 'editor.action.revealDefinition',
  ReferenceSearch: 'editor.action.referenceSearch.trigger',
  Rename: 'editor.action.rename',
  QuickFix: 'editor.action.quickFix',
  AddSelectionToNextFindMatch: 'editor.action.addSelectionToNextFindMatch',
  SelectHighlights: 'editor.action.selectHighlights',
  InsertCursorAbove: 'editor.action.insertCursorAbove',
  InsertCursorBelow: 'editor.action.insertCursorBelow',
  ShowHover: 'editor.action.showHover',
  GoToTypeDefinition: 'editor.action.goToTypeDefinition',
  GoToImplementation: 'editor.action.goToImplementation',
  GoToDeclaration: 'editor.action.goToDeclaration',
  SmartSelectExpand: 'editor.action.smartSelect.expand',
  SmartSelectShrink: 'editor.action.smartSelect.shrink',
  InlineSuggestTrigger: 'editor.action.inlineSuggest.trigger',
  InlineSuggestAccept: 'editor.action.inlineSuggest.commit',
  InlineSuggestAcceptNextWord: 'editor.action.inlineSuggest.acceptNextWord',
  InlineSuggestAcceptNextLine: 'editor.action.inlineSuggest.acceptNextLine',
  InlineSuggestNext: 'editor.action.inlineSuggest.showNext',
  InlineSuggestPrev: 'editor.action.inlineSuggest.showPrevious',
  InlineSuggestHide: 'editor.action.inlineSuggest.hide',
  OpenLink: 'editor.action.openLink',
  JoinLines: 'editor.action.joinLines',
  SortLinesAscending: 'editor.action.sortLinesAscending',
  SortLinesDescending: 'editor.action.sortLinesDescending',
  DeleteDuplicateLines: 'editor.action.removeDuplicateLines',
  TransposeLetters: 'editor.action.transposeLetters',
  TransformToUppercase: 'editor.action.transformToUppercase',
  TransformToLowercase: 'editor.action.transformToLowercase',
  TransformToTitleCase: 'editor.action.transformToTitlecase',
  TrimTrailingWhitespace: 'editor.action.trimTrailingWhitespace',
  ConvertIndentationToSpaces: 'editor.action.indentationToSpaces',
  ConvertIndentationToTabs: 'editor.action.indentationToTabs',
  DetectIndentation: 'editor.action.detectIndentation',
  GoToLine: 'editor.action.gotoLine',
  GoToSymbol: 'editor.action.quickOutline',
  PeekDefinition: 'editor.action.peekDefinition',
  BreadcrumbsToggle: 'breadcrumbs.toggle',
  BreadcrumbsFocus: 'breadcrumbs.focus',
  BreadcrumbsFocusAndSelect: 'breadcrumbs.focusAndSelect',
  BreadcrumbsFocusNext: 'breadcrumbs.focusNext',
  BreadcrumbsFocusPrevious: 'breadcrumbs.focusPrevious',
  BreadcrumbsFocusNextWithPicker: 'breadcrumbs.focusNextWithPicker',
  BreadcrumbsFocusPreviousWithPicker: 'breadcrumbs.focusPreviousWithPicker',
  BreadcrumbsSelectFocused: 'breadcrumbs.selectFocused',
  BreadcrumbsRevealFocused: 'breadcrumbs.revealFocused',
  BreadcrumbsSelectEditor: 'breadcrumbs.selectEditor',
  BreadcrumbsCopyPath: 'breadcrumbs.copyPath',
} as const;
