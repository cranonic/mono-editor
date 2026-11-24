import type { SelectionState } from '../../common/core/SelectionState';
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
import type { KeybindingService } from '../../platform/keybindings/KeybindingService';
import { CompositionHandler, type CompositionRange } from './compositionHandler';
import { handleEditorKeyDown, type KeyboardChangeEvent } from './keyboardHandler';
import { TextAreaBridge } from './textAreaBridge';

export type { CompositionRange };
export type InputChangeEvent = KeyboardChangeEvent;

export interface InputControllerOptions {
  tabSize?: number;
  readOnly?: boolean;
  pageSize?: number;
  bracketEnterIndent?: boolean;
  autoClosingBrackets?: AutoClosingBehavior;
  autoClosingQuotes?: AutoClosingBehavior;
  autoSurround?: AutoSurroundBehavior;
  autoIndent?: AutoIndentBehavior;
  getTokenTypeAt?: (lineNumber: number, column: number) => string | null;
  onCompositionChange?: (range: CompositionRange | null) => void;
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
  private readOnly = false;
  private pageSize = 40;
  private bracketEnterIndent = true;
  private autoClosingBrackets: AutoClosingBehavior = 'languageDefined';
  private autoClosingQuotes: AutoClosingBehavior = 'languageDefined';
  private autoSurround: AutoSurroundBehavior = 'languageDefined';
  private autoIndent: AutoIndentBehavior = 'full';
  private getTokenTypeAt?: (lineNumber: number, column: number) => string | null;
  private goalColumn: number | null = null;
  private preKeyHandler: ((e: KeyboardEvent) => boolean) | null = null;

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
    if (options?.readOnly != null) this.readOnly = options.readOnly;
    if (options?.pageSize != null) this.pageSize = Math.max(1, options.pageSize);
    if (options?.bracketEnterIndent != null) this.bracketEnterIndent = options.bracketEnterIndent;
    if (options?.autoClosingBrackets != null) this.autoClosingBrackets = options.autoClosingBrackets;
    if (options?.autoClosingQuotes != null) this.autoClosingQuotes = options.autoClosingQuotes;
    if (options?.autoSurround != null) this.autoSurround = options.autoSurround;
    if (options?.autoIndent != null) this.autoIndent = options.autoIndent;
    this.getTokenTypeAt = options?.getTokenTypeAt;

    this.bridge = new TextAreaBridge(host, this.readOnly);
    this.textarea = this.bridge.textarea;
    this.composition = new CompositionHandler(options?.onCompositionChange);

    const ta = this.textarea;
    ta.addEventListener('keydown', this.onKeyDown);
    ta.addEventListener('input', this.onInput);
    ta.addEventListener('compositionstart', this.onCompositionStart);
    ta.addEventListener('compositionupdate', this.onCompositionUpdate);
    ta.addEventListener('compositionend', this.onCompositionEnd);
  }

  setTabSize(n: number): void { this.tabSize = Math.max(1, n | 0); }
  setReadOnly(v: boolean): void { this.readOnly = v; this.bridge.setReadOnly(v); }
  setPageSize(n: number): void { this.pageSize = Math.max(1, n | 0); }
  setBracketEnterIndent(v: boolean): void { this.bracketEnterIndent = v; }
  setAutoClosingBrackets(v: AutoClosingBehavior): void { this.autoClosingBrackets = v; }
  setAutoClosingQuotes(v: AutoClosingBehavior): void { this.autoClosingQuotes = v; }
  setAutoSurround(v: AutoSurroundBehavior): void { this.autoSurround = v; }
  setAutoIndent(v: AutoIndentBehavior): void { this.autoIndent = v; }
  isComposing(): boolean { return this.composition.isComposing(); }
  moveTo(x: number, y: number, h: number): void { this.bridge.moveTo(x, y, h); }
  focus(): void { this.bridge.focus(); }
  blur(): void { this.bridge.blur(); }
  setKeybindingService(kb: KeybindingService | null): void { this.keybindings = kb; }
  setPreKeyHandler(fn: ((e: KeyboardEvent) => boolean) | null): void { this.preKeyHandler = fn; }

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
    ta.removeEventListener('input', this.onInput);
    ta.removeEventListener('compositionstart', this.onCompositionStart);
    ta.removeEventListener('compositionupdate', this.onCompositionUpdate);
    ta.removeEventListener('compositionend', this.onCompositionEnd);
    this.bridge.dispose();
  }

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
    this.onChange(res.committed ? { kind: 'type', text: res.text } : { kind: 'composition', text: '' });
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

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.disposed) return;
    if (this.composition.isComposing() || e.isComposing || e.keyCode === 229) return;
    if (this.preKeyHandler?.(e)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (this.keybindings?.dispatch(e)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    handleEditorKeyDown(e, {
      model: this.model,
      selection: this.selection,
      readOnly: this.readOnly,
      tabSize: this.tabSize,
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
