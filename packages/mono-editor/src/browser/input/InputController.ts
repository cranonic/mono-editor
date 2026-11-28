import type { MultiCursorPasteMode } from '../../common/config/editorOptions';
import type { SelectionState } from '../../common/core/SelectionState';
import type { IRange } from '../../common/core/types';
import {
  replaceSelectionText,
  tryAutoSurroundSelection,
  tryOvertypeOrAutoCloseChar,
  type TypingPolicy,
} from '../../common/editOperations/typeOperations';
import type {
  AutoClosingBehavior,
  AutoIndentBehavior,
  AutoSurroundBehavior,
} from '../../common/languages/languageConfigurationTypes';
import type { TextModel } from '../../common/model/TextModel';
import { setLastCopiedText } from '../../platform/clipboard/clipboard';
import type { KeybindingService } from '../../platform/keybindings/KeybindingService';
import { CompositionHandler, type CompositionRange } from './compositionHandler';
import { handleEditorKeyDown, type KeyboardChangeEvent } from './keyboardHandler';
import { TextAreaBridge } from './textAreaBridge';

export type { CompositionRange };
export type InputChangeEvent = KeyboardChangeEvent;

export interface InputControllerOptions {
  tabSize?: number;
  insertSpaces?: boolean;
  stickyTabStops?: boolean;
  trimAutoWhitespace?: boolean;
  readOnly?: boolean;
  ariaLabel?: string;
  pageSize?: number;
  multiCursorPaste?: MultiCursorPasteMode;
  bracketEnterIndent?: boolean;
  autoClosingBrackets?: AutoClosingBehavior;
  autoClosingQuotes?: AutoClosingBehavior;
  autoSurround?: AutoSurroundBehavior;
  autoIndent?: AutoIndentBehavior;
  getTokenTypeAt?: (lineNumber: number, column: number) => string | null;
  onCompositionChange?: (range: CompositionRange | null) => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
  onDidPaste?: (range: IRange) => void;
  onKeyDownEvent?: (e: KeyboardEvent) => void;
  onKeyUpEvent?: (e: KeyboardEvent) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

export class InputController {
  readonly textarea: HTMLTextAreaElement;
  private bridge: TextAreaBridge;
  private composition: CompositionHandler;
  private model: TextModel;
  private selection: SelectionState;
  private onChange: (ev: InputChangeEvent) => void;
  private keybindings: KeybindingService | null = null;
  private disposed = false;
  private tabSize = 2;
  private insertSpaces = true;
  private stickyTabStops = false;
  private trimAutoWhitespace = true;
  private readOnly = false;
  private pageSize = 40;
  private multiCursorPaste: MultiCursorPasteMode = 'spread';
  private bracketEnterIndent = true;
  private autoClosingBrackets: AutoClosingBehavior = 'languageDefined';
  private autoClosingQuotes: AutoClosingBehavior = 'languageDefined';
  private autoSurround: AutoSurroundBehavior = 'languageDefined';
  private autoIndent: AutoIndentBehavior = 'full';
  private getTokenTypeAt?: (lineNumber: number, column: number) => string | null;
  private onCompStartCb?: () => void;
  private onCompEndCb?: () => void;
  private onPasteCb?: (range: IRange) => void;
  private onKeyDownCb?: (e: KeyboardEvent) => void;
  private onKeyUpCb?: (e: KeyboardEvent) => void;
  private onFocusCb?: () => void;
  private onBlurCb?: () => void;
  private goalColumn: number | null = null;
  private nativePasteSeq = 0;
  private preKeyHandler: ((e: KeyboardEvent) => boolean) | null = null;
  private pasteInterceptor: ((text: string) => Promise<boolean> | boolean) | null = null;

  constructor(
    host: HTMLElement,
    model: TextModel,
    selection: SelectionState,
    onChange: (ev: InputChangeEvent) => void,
    options?: InputControllerOptions,
  ) {
    this.model = model;
    this.selection = selection;
    this.onChange = onChange;
    if (options?.tabSize != null) this.tabSize = Math.max(1, options.tabSize);
    if (options?.insertSpaces != null) this.insertSpaces = options.insertSpaces;
    if (options?.stickyTabStops != null) this.stickyTabStops = options.stickyTabStops;
    if (options?.trimAutoWhitespace != null) this.trimAutoWhitespace = options.trimAutoWhitespace;
    if (options?.readOnly != null) this.readOnly = options.readOnly;
    if (options?.pageSize != null) this.pageSize = Math.max(1, options.pageSize);
    if (options?.multiCursorPaste != null) this.multiCursorPaste = options.multiCursorPaste;
    if (options?.bracketEnterIndent != null) this.bracketEnterIndent = options.bracketEnterIndent;
    if (options?.autoClosingBrackets != null) this.autoClosingBrackets = options.autoClosingBrackets;
    if (options?.autoClosingQuotes != null) this.autoClosingQuotes = options.autoClosingQuotes;
    if (options?.autoSurround != null) this.autoSurround = options.autoSurround;
    if (options?.autoIndent != null) this.autoIndent = options.autoIndent;
    this.getTokenTypeAt = options?.getTokenTypeAt;
    this.onCompStartCb = options?.onCompositionStart;
    this.onCompEndCb = options?.onCompositionEnd;
    this.onPasteCb = options?.onDidPaste;
    this.onKeyDownCb = options?.onKeyDownEvent;
    this.onKeyUpCb = options?.onKeyUpEvent;
    this.onFocusCb = options?.onFocus;
    this.onBlurCb = options?.onBlur;

    this.bridge = new TextAreaBridge(host, this.readOnly, options?.ariaLabel);
    this.textarea = this.bridge.textarea;
    this.composition = new CompositionHandler(options?.onCompositionChange);

    const ta = this.textarea;
    ta.addEventListener('keydown', this.onKeyDown);
    ta.addEventListener('keyup', this.onKeyUp);
    ta.addEventListener('input', this.onInput);
    ta.addEventListener('paste', this.onPaste);
    ta.addEventListener('focus', this.onTextFocus);
    ta.addEventListener('blur', this.onTextBlur);
    ta.addEventListener('compositionstart', this.onCompositionStart);
    ta.addEventListener('compositionupdate', this.onCompositionUpdate);
    ta.addEventListener('compositionend', this.onCompositionEnd);
  }

  setTabSize(n: number): void { this.tabSize = Math.max(1, n | 0); }
  setInsertSpaces(v: boolean): void { this.insertSpaces = v; }
  setStickyTabStops(v: boolean): void { this.stickyTabStops = v; }
  setTrimAutoWhitespace(v: boolean): void { this.trimAutoWhitespace = v; }
  setReadOnly(v: boolean): void { this.readOnly = v; this.bridge.setReadOnly(v); }
  setAriaLabel(label: string): void { this.bridge.setAriaLabel(label); }
  announce(message: string): void { this.bridge.announce(message); }
  setPageSize(n: number): void { this.pageSize = Math.max(1, n | 0); }
  setMultiCursorPaste(v: MultiCursorPasteMode): void { this.multiCursorPaste = v; }
  setBracketEnterIndent(v: boolean): void { this.bracketEnterIndent = v; }
  setAutoClosingBrackets(v: AutoClosingBehavior): void { this.autoClosingBrackets = v; }
  setAutoClosingQuotes(v: AutoClosingBehavior): void { this.autoClosingQuotes = v; }
  setAutoSurround(v: AutoSurroundBehavior): void { this.autoSurround = v; }
  setAutoIndent(v: AutoIndentBehavior): void { this.autoIndent = v; }
  isComposing(): boolean { return this.composition.isComposing(); }
  getNativePasteSeq(): number { return this.nativePasteSeq; }
  moveTo(x: number, y: number, h: number): void { this.bridge.moveTo(x, y, h); }
  focus(): void { this.bridge.focus(); }
  blur(): void { this.bridge.blur(); }
  setKeybindingService(kb: KeybindingService | null): void { this.keybindings = kb; }
  setPreKeyHandler(fn: ((e: KeyboardEvent) => boolean) | null): void { this.preKeyHandler = fn; }
  setPasteInterceptor(fn: ((text: string) => Promise<boolean> | boolean) | null): void { this.pasteInterceptor = fn; }

  setModel(model: TextModel): void {
    this.model = model;
    this.composition.reset();
    this.goalColumn = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.composition.reset();
    const ta = this.textarea;
    ta.removeEventListener('keydown', this.onKeyDown);
    ta.removeEventListener('keyup', this.onKeyUp);
    ta.removeEventListener('input', this.onInput);
    ta.removeEventListener('paste', this.onPaste);
    ta.removeEventListener('focus', this.onTextFocus);
    ta.removeEventListener('blur', this.onTextBlur);
    ta.removeEventListener('compositionstart', this.onCompositionStart);
    ta.removeEventListener('compositionupdate', this.onCompositionUpdate);
    ta.removeEventListener('compositionend', this.onCompositionEnd);
    this.bridge.dispose();
  }

  private onTextFocus = (): void => {
    if (!this.disposed) this.onFocusCb?.();
  };

  private onTextBlur = (): void => {
    if (!this.disposed) this.onBlurCb?.();
  };

  private getTypingPolicy(): TypingPolicy {
    return {
      autoClosingBrackets: this.autoClosingBrackets,
      autoClosingQuotes: this.autoClosingQuotes,
      autoSurround: this.autoSurround,
      getTokenTypeAt: this.getTokenTypeAt,
    };
  }

  private onCompositionStart = (): void => {
    if (this.readOnly || this.disposed) return;
    this.composition.handleStart(this.model, this.selection);
    this.onCompStartCb?.();
  };

  private onCompositionUpdate = (e: CompositionEvent): void => {
    if (this.readOnly || this.disposed) return;
    const data = e.data ?? this.textarea.value ?? '';
    this.composition.handleUpdate(this.model, this.selection, data);
    this.goalColumn = null;
    this.onChange({ kind: 'composition', text: data });
  };

  private onCompositionEnd = (e: CompositionEvent): void => {
    this.textarea.value = '';
    if (this.readOnly || this.disposed) {
      this.composition.reset();
      return;
    }
    const res = this.composition.handleEnd(this.model, this.selection, e.data, (fallback) => {
      replaceSelectionText(this.model, this.selection, fallback, 'typing');
    });
    this.goalColumn = null;
    this.onCompEndCb?.();
    this.onChange(res.committed ? { kind: 'type', text: res.text } : { kind: 'composition', text: '' });
  };

  private onPaste = (e: ClipboardEvent): void => {
    if (this.readOnly || this.disposed) return;
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!text) return;
    this.nativePasteSeq++;
    setLastCopiedText(text);
    e.preventDefault();
    this.textarea.value = '';
    const runDefaultPaste = () => {
      if (this.disposed || this.readOnly) return;
      if (this.selection.hasMultipleCursors) {
        const items = this.selection.selections.map((s, idx) => {
          const aOff = this.model.getOffsetAt(s.anchor.lineNumber, s.anchor.column);
          const bOff = this.model.getOffsetAt(s.active.lineNumber, s.active.column);
          return { idx, start: Math.min(aOff, bOff), end: Math.max(aOff, bOff) };
        });
        const sortedAsc = [...items].sort((x, y) => x.start - y.start);
        const lines = text.split(/\r?\n/);
        const perCursor = this.multiCursorPaste !== 'full' && lines.length === sortedAsc.length && lines.length > 1;
        const textFor = (i: number) => (perCursor ? lines[i]! : text);
        const finalOffsets = new Array<number>(sortedAsc.length);
        let delta = 0;
        for (let i = 0; i < sortedAsc.length; i++) {
          const norm = this.model.normalizeEol(textFor(i));
          finalOffsets[i] = sortedAsc[i]!.start + delta + norm.length;
          delta += norm.length - (sortedAsc[i]!.end - sortedAsc[i]!.start);
        }
        this.model.transact(() => {
          for (let i = sortedAsc.length - 1; i >= 0; i--) {
            this.model.replaceRange(sortedAsc[i]!.start, sortedAsc[i]!.end, textFor(i), undefined, 'other');
          }
        });
        const nextSels = sortedAsc.map((it, i) => {
          const p = this.model.getPositionAt(finalOffsets[i]!);
          return { origIdx: it.idx, range: { anchor: p, active: { ...p } } };
        }).sort((a, b) => a.origIdx - b.origIdx);
        this.selection.setSelections(nextSels.map((x) => x.range));
        this.goalColumn = null;
        this.onChange({ kind: 'type', text });
        return;
      }
      const startOff = this.selection.isEmpty
        ? this.model.getOffsetAt(this.selection.active.lineNumber, this.selection.active.column)
        : Math.min(
            this.model.getOffsetAt(this.selection.anchor.lineNumber, this.selection.anchor.column),
            this.model.getOffsetAt(this.selection.active.lineNumber, this.selection.active.column),
          );
      const startPos = this.model.getPositionAt(startOff);
      replaceSelectionText(this.model, this.selection, text);
      const endPos = { ...this.selection.active };
      this.goalColumn = null;
      this.onPasteCb?.({
        startLineNumber: startPos.lineNumber,
        startColumn: startPos.column,
        endLineNumber: endPos.lineNumber,
        endColumn: endPos.column,
      });
      this.onChange({ kind: 'type', text });
    };
    if (!this.pasteInterceptor) {
      runDefaultPaste();
      return;
    }
    void Promise.resolve(this.pasteInterceptor(text)).then((handled) => {
      if (!handled) runDefaultPaste();
    });
  };

  private onInput = (e?: Event): void => {
    if (this.readOnly) {
      this.textarea.value = '';
      return;
    }
    if (this.composition.isComposing() || (e && (e as InputEvent).isComposing)) return;
    const data = this.textarea.value;
    this.textarea.value = '';
    if (!data) return;

    if (!this.selection.hasMultipleCursors && data.length === 1) {
      const policy = this.getTypingPolicy();
      if (!this.selection.isEmpty && tryAutoSurroundSelection(this.model, this.selection, data, policy)) {
        this.goalColumn = null;
        this.onChange({ kind: 'type', text: data });
        return;
      }
      if (this.selection.isEmpty) {
        const res = tryOvertypeOrAutoCloseChar(this.model, this.selection, data, policy);
        if (res === 'overtype') {
          this.goalColumn = null;
          this.onChange({ kind: 'move' });
          return;
        }
        if (res === 'autoclose') {
          this.goalColumn = null;
          this.onChange({ kind: 'type', text: data });
          return;
        }
      }
    }

    replaceSelectionText(this.model, this.selection, data);
    this.goalColumn = null;
    this.onChange({ kind: 'type', text: data });
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (this.disposed) return;
    this.onKeyUpCb?.(e);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.disposed) return;
    this.onKeyDownCb?.(e);
    if (this.composition.isComposing() || e.isComposing || e.keyCode === 229) return;
    if (this.preKeyHandler?.(e)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const kbRes = this.keybindings?.dispatchDetailed(e);
    if (kbRes?.matched) {
      if (kbRes.preventDefault) e.preventDefault();
      e.stopPropagation();
      return;
    }
    handleEditorKeyDown(e, {
      model: this.model,
      selection: this.selection,
      readOnly: this.readOnly,
      tabSize: this.tabSize,
      insertSpaces: this.insertSpaces,
      stickyTabStops: this.stickyTabStops,
      trimAutoWhitespace: this.trimAutoWhitespace,
      pageSize: this.pageSize,
      bracketEnterIndent: this.bracketEnterIndent,
      autoIndent: this.autoIndent,
      typingPolicy: this.getTypingPolicy(),
      goalColumn: this.goalColumn,
      setGoalColumn: (c) => { this.goalColumn = c; },
      onChange: this.onChange,
    });
  };
}
