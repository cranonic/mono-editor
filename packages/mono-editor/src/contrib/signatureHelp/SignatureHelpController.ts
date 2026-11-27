import type { WidgetBoxRect } from '../../browser/editor/editorTypes';
import type { ViewController } from '../../browser/view/ViewController';
import type { SelectionState } from '../../common/core/SelectionState';
import { analyzeCallContext } from '../../common/languages/callContext';
import { languageFeatures } from '../../common/languages/languageFeaturesService';
import type {
  ModelLike,
  SignatureHelp,
  SignatureHelpContext,
  SignatureHelpResult,
} from '../../common/languages/providers/types';
import type { TextModel } from '../../common/model/TextModel';
import type { ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';
import { SignatureHelpWidget } from './SignatureHelpWidget';

export interface SignatureHelpControllerOptions {
  enabled?: boolean;
  trigger?: 'auto' | 'manual';
  cycle?: boolean;
  fontSize?: number;
  fontFamily?: string;
  getLanguageIdAtPosition?: (lineNumber: number, column: number) => string;
  getModelLike?: (effectiveLang?: string) => ModelLike;
  getAvoidRect?: () => WidgetBoxRect | null;
  isSuggestVisible?: () => boolean;
}

function isSignatureHelpResult(
  res: SignatureHelp | SignatureHelpResult | null | undefined,
): res is SignatureHelpResult {
  return Boolean(res && typeof res === 'object' && 'value' in res);
}

export class SignatureHelpController {
  private model: TextModel;
  private selection: SelectionState;
  private view: ViewController;
  private widget: SignatureHelpWidget;
  private activeHelp: SignatureHelp | null = null;
  private openParenKey: string | null = null;
  private activeLangId = 'typescript';
  private seq = 0;
  private disposed = false;
  private enabled = true;
  private triggerMode: 'auto' | 'manual' = 'auto';
  private cycle = false;
  private getLanguageIdAtPosition?: (lineNumber: number, column: number) => string;
  private getModelLike?: (effectiveLang?: string) => ModelLike;
  private getAvoidRect?: () => WidgetBoxRect | null;
  private isSuggestVisible?: () => boolean;

  constructor(
    host: HTMLElement,
    model: TextModel,
    selection: SelectionState,
    view: ViewController,
    optionsOrLangGetter?: SignatureHelpControllerOptions | ((lineNumber: number, column: number) => string),
  ) {
    this.model = model;
    this.selection = selection;
    this.view = view;
    this.widget = new SignatureHelpWidget(
      host,
      {
        onPrev: () => this.prevSignature(),
        onNext: () => this.nextSignature(),
      },
      typeof optionsOrLangGetter === 'object'
        ? { fontSize: optionsOrLangGetter.fontSize, fontFamily: optionsOrLangGetter.fontFamily }
        : undefined,
    );
    if (typeof optionsOrLangGetter === 'function') {
      this.getLanguageIdAtPosition = optionsOrLangGetter;
    } else if (optionsOrLangGetter) {
      this.setOptions(optionsOrLangGetter);
    }
  }

  setOptions(opts: SignatureHelpControllerOptions): void {
    if (opts.enabled !== undefined) {
      this.enabled = opts.enabled;
      if (!this.enabled) this.hide();
    }
    if (opts.trigger !== undefined) this.triggerMode = opts.trigger;
    if (opts.cycle !== undefined) this.cycle = opts.cycle;
    if (opts.fontSize !== undefined || opts.fontFamily !== undefined) {
      this.widget.setOptions({ fontSize: opts.fontSize, fontFamily: opts.fontFamily });
    }
    if (opts.getLanguageIdAtPosition !== undefined) this.getLanguageIdAtPosition = opts.getLanguageIdAtPosition;
    if (opts.getModelLike !== undefined) this.getModelLike = opts.getModelLike;
    if (opts.getAvoidRect !== undefined) this.getAvoidRect = opts.getAvoidRect;
    if (opts.isSuggestVisible !== undefined) this.isSuggestVisible = opts.isSuggestVisible;
  }

  setModel(model: TextModel): void {
    this.hide();
    this.model = model;
  }

  applyTheme(theme: ResolvedWidgetTheme): void {
    this.widget.applyTheme(theme);
  }

  isOpen(): boolean {
    return this.activeHelp !== null && this.widget.isVisible();
  }

  containsNode(node: Node | null): boolean {
    return this.widget.containsNode(node);
  }

  getActiveHelp(): SignatureHelp | null {
    return this.activeHelp;
  }

  async trigger(triggerCharacter?: string, manual = true): Promise<boolean> {
    if (this.disposed) return false;
    const my = ++this.seq;
    const pos = {
      lineNumber: this.selection.active.lineNumber,
      column: this.selection.active.column,
    };
    const lang = this.getLanguageIdAtPosition?.(pos.lineNumber, pos.column) ?? this.model.getLanguageId();
    const providers = languageFeatures.getSignatureHelpProviders(lang);
    if (!providers.length) {
      this.hide();
      return false;
    }

    const modelLike = this.buildModelLike(lang);
    const callCtx = analyzeCallContext(modelLike, pos);

    const context: SignatureHelpContext = {
      triggerKind: manual ? 1 : triggerCharacter ? 2 : 3,
      triggerCharacter,
      isRetrigger: this.isOpen(),
      activeSignatureHelp: this.activeHelp ?? undefined,
    };
    const token = { isCancellationRequested: false };

    for (const p of providers) {
      try {
        const res = await Promise.resolve(p.provideSignatureHelp(modelLike, pos, token, context));
        if (my !== this.seq || this.disposed) return false;
        const help = isSignatureHelpResult(res) ? res.value : res;
        if (help && help.signatures.length > 0) {
          const resolvedParam = help.activeParameter ?? callCtx?.activeParameter ?? 0;
          this.activeHelp = {
            signatures: help.signatures,
            activeSignature: help.activeSignature ?? 0,
            activeParameter: resolvedParam,
          };
          this.openParenKey = callCtx
            ? `${callCtx.openParenLine}:${callCtx.openParenColumn}`
            : `${pos.lineNumber}:${pos.column}`;
          this.activeLangId = lang;
          this.renderAtCaret();
          return true;
        }
      } catch (e) {
        console.warn('[mono signature help]', e);
      }
    }

    this.hide();
    return false;
  }

  async onType(typedText: string): Promise<void> {
    if (this.disposed || !typedText) return;
    const ch = typedText[typedText.length - 1]!;
    if (ch === ')') {
      const modelLike = this.buildModelLike(this.model.getLanguageId());
      const outer = analyzeCallContext(modelLike, this.selection.active);
      if (outer && (this.isOpen() || (this.enabled && this.triggerMode === 'auto'))) {
        await this.trigger(undefined, false);
      } else {
        this.hide();
      }
      return;
    }
    const autoAllowed = this.enabled && this.triggerMode === 'auto';
    const triggers = this.collectTriggerCharacters();
    if (triggers.has(ch) && (autoAllowed || this.isOpen())) {
      await this.trigger(ch, false);
      return;
    }
    if (this.isOpen()) {
      await this.trigger(undefined, false);
    }
  }

  async onBackspace(): Promise<void> {
    if (!this.isOpen()) return;
    const modelLike = this.buildModelLike(this.model.getLanguageId());
    const callCtx = analyzeCallContext(modelLike, this.selection.active);
    if (!callCtx) {
      this.hide();
      return;
    }
    await this.trigger(undefined, false);
  }

  async onEnter(): Promise<void> {
    if (!this.isOpen()) return;
    const modelLike = this.buildModelLike(this.model.getLanguageId());
    const callCtx = analyzeCallContext(modelLike, this.selection.active);
    if (!callCtx) {
      this.hide();
      return;
    }
    await this.trigger(undefined, false);
  }

  /**
   * Auto-triggers Signature Help when accepting a completion (e.g. call snippet like `greetAll("Mono", "bn")`)
   * lands the caret inside a function call argument list.
   */
  async onCompletionAccepted(): Promise<void> {
    if (this.disposed || !this.enabled || this.triggerMode !== 'auto') return;
    const pos = this.selection.active;
    const lang = this.getLanguageIdAtPosition?.(pos.lineNumber, pos.column) ?? this.model.getLanguageId();
    const modelLike = this.buildModelLike(lang);
    const callCtx = analyzeCallContext(modelLike, pos);
    if (!callCtx) {
      if (this.isOpen()) this.hide();
      return;
    }
    await this.trigger('(', false);
  }

  syncCursor(): void {
    if (!this.isOpen()) return;
    const modelLike = this.buildModelLike(this.model.getLanguageId());
    const callCtx = analyzeCallContext(modelLike, this.selection.active);
    if (!callCtx) {
      this.hide();
      return;
    }
    const key = `${callCtx.openParenLine}:${callCtx.openParenColumn}`;
    if (key !== this.openParenKey || callCtx.activeParameter !== this.activeHelp?.activeParameter) {
      void this.trigger(undefined, false);
    } else {
      this.renderAtCaret();
    }
  }

  prevSignature(closeOnBoundary = false): void {
    if (!this.activeHelp || this.activeHelp.signatures.length <= 1) return;
    const len = this.activeHelp.signatures.length;
    const cur = this.activeHelp.activeSignature ?? 0;
    if (!this.cycle && cur <= 0) {
      if (closeOnBoundary) this.hide();
      return;
    }
    this.activeHelp = {
      ...this.activeHelp,
      activeSignature: (cur - 1 + len) % len,
    };
    this.renderAtCaret();
  }

  nextSignature(closeOnBoundary = false): void {
    if (!this.activeHelp || this.activeHelp.signatures.length <= 1) return;
    const len = this.activeHelp.signatures.length;
    const cur = this.activeHelp.activeSignature ?? 0;
    if (!this.cycle && cur >= len - 1) {
      if (closeOnBoundary) this.hide();
      return;
    }
    this.activeHelp = {
      ...this.activeHelp,
      activeSignature: (cur + 1) % len,
    };
    this.renderAtCaret();
  }

  handleKey(e: KeyboardEvent): boolean {
    if (!this.isOpen()) return false;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.hide();
      return true;
    }
    // Completion list retains Up/Down ownership whenever both widgets are open
    if (this.isSuggestVisible?.()) return false;
    if ((this.activeHelp?.signatures.length ?? 0) > 1) {
      if (e.key === 'ArrowUp' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        this.prevSignature(true);
        return true;
      }
      if (e.key === 'ArrowDown' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        this.nextSignature(true);
        return true;
      }
    }
    return false;
  }

  updatePosition(): void {
    if (!this.isOpen()) return;
    this.renderAtCaret();
  }

  hide(): void {
    this.seq++;
    this.activeHelp = null;
    this.openParenKey = null;
    this.widget.hide();
  }

  dispose(): void {
    this.disposed = true;
    this.hide();
    this.widget.dispose();
  }

  private buildModelLike(lang: string): ModelLike {
    if (this.getModelLike) return this.getModelLike(lang);
    return {
      getValue: () => this.model.getValue(),
      getLineContent: (n: number) => this.model.getLineContent(n),
      getLineCount: () => this.model.getLineCount(),
      getOffsetAt: (l: number, c: number) => this.model.getOffsetAt(l, c),
      getPositionAt: (o: number) => this.model.getPositionAt(o),
      getLanguageId: () => lang,
      getVersionId: () => this.model.getVersionId(),
      getWordAtPosition: (p) => this.model.getWordAtPosition(p),
      getWordUntilPosition: (p) => this.model.getWordUntilPosition(p),
    };
  }

  private renderAtCaret(): void {
    if (!this.activeHelp) return;
    const pos = this.selection.active;
    const scr = this.view.screenPosOf(pos.lineNumber, pos.column);
    this.widget.show(this.activeHelp, {
      x: scr.x,
      y: scr.y + scr.h,
      top: scr.y,
      languageId: this.activeLangId,
      avoidRect: this.getAvoidRect?.() ?? null,
    });
  }

  private collectTriggerCharacters(): Set<string> {
    const triggers = new Set<string>(['(', ',']);
    const pos = this.selection.active;
    const lang = this.getLanguageIdAtPosition?.(pos.lineNumber, pos.column) ?? this.model.getLanguageId();
    const providers = languageFeatures.getSignatureHelpProviders(lang);
    for (const p of providers) {
      for (const t of p.signatureHelpTriggerCharacters ?? []) triggers.add(t);
      for (const t of p.signatureHelpRetriggerCharacters ?? []) triggers.add(t);
    }
    return triggers;
  }
}
