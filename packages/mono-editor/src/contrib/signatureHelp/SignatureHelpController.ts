import type { ViewController } from '../../browser/view/ViewController';
import type { SelectionState } from '../../common/core/SelectionState';
import { analyzeCallContext } from '../../common/languages/callContext';
import { languageFeatures } from '../../common/languages/languageFeaturesService';
import type {
  SignatureHelp,
  SignatureHelpContext,
  SignatureHelpResult,
} from '../../common/languages/providers/types';
import type { TextModel } from '../../common/model/TextModel';
import type { ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';
import { SignatureHelpWidget } from './SignatureHelpWidget';

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
  private getLanguageIdAtPosition?: (lineNumber: number, column: number) => string;

  constructor(
    host: HTMLElement,
    model: TextModel,
    selection: SelectionState,
    view: ViewController,
    getLanguageIdAtPosition?: (lineNumber: number, column: number) => string,
  ) {
    this.model = model;
    this.selection = selection;
    this.view = view;
    this.getLanguageIdAtPosition = getLanguageIdAtPosition;
    this.widget = new SignatureHelpWidget(host, {
      onPrev: () => this.prevSignature(),
      onNext: () => this.nextSignature(),
    });
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
          // Prefer provider's activeParameter; fall back to live multi-line call context index
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
      // If we are still inside an outer nested call, retrigger for the outer call!
      const modelLike = this.buildModelLike(this.model.getLanguageId());
      const outer = analyzeCallContext(modelLike, this.selection.active);
      if (outer) {
        await this.trigger(undefined, false);
      } else {
        this.hide();
      }
      return;
    }
    const triggers = this.collectTriggerCharacters();
    if (triggers.has(ch)) {
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
    // Multi-line function call: stay open and reposition at new line!
    await this.trigger(undefined, false);
  }

  /**
   * Live parameter tracking on cursor movement (arrows, Home/End, tap inside arguments):
   * keeps popup open across multi-line calls and updates active parameter immediately.
   */
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

  prevSignature(): void {
    if (!this.activeHelp || this.activeHelp.signatures.length <= 1) return;
    const len = this.activeHelp.signatures.length;
    this.activeHelp = {
      ...this.activeHelp,
      activeSignature: ((this.activeHelp.activeSignature ?? 0) - 1 + len) % len,
    };
    this.renderAtCaret();
  }

  nextSignature(): void {
    if (!this.activeHelp || this.activeHelp.signatures.length <= 1) return;
    const len = this.activeHelp.signatures.length;
    this.activeHelp = {
      ...this.activeHelp,
      activeSignature: ((this.activeHelp.activeSignature ?? 0) + 1) % len,
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
    if ((this.activeHelp?.signatures.length ?? 0) > 1) {
      if (e.key === 'ArrowUp' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        this.prevSignature();
        return true;
      }
      if (e.key === 'ArrowDown' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        this.nextSignature();
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

  private buildModelLike(lang: string) {
    return {
      getValue: () => this.model.getValue(),
      getLineContent: (n: number) => this.model.getLineContent(n),
      getLineCount: () => this.model.getLineCount(),
      getOffsetAt: (l: number, c: number) => this.model.getOffsetAt(l, c),
      getPositionAt: (o: number) => this.model.getPositionAt(o),
      getLanguageId: () => lang,
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
