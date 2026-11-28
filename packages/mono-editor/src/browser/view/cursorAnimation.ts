import type {
  CursorBlinkingMode,
  CursorSmoothCaretAnimationMode,
} from '../../common/config/editorOptions';

export type CaretMotionHint = 'explicit' | 'edit' | 'immediate';

export interface BlinkSample {
  opacity: number;
  scaleY: number;
}

const BLINK_HALF_PERIOD_MS = 530;
const SMOOTH_CYCLE_MS = 1000;
const PHASE_CYCLE_MS = 1200;
const CARET_GLIDE_MS = 85;

function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/**
 * Pure deterministic blink curve evaluator for all 5 Monaco cursorBlinking modes.
 */
export function computeBlinkSample(mode: CursorBlinkingMode, elapsedMs: number): BlinkSample {
  const t = Math.max(0, elapsedMs);
  switch (mode) {
    case 'solid':
      return { opacity: 1, scaleY: 1 };
    case 'blink': {
      const inOnHalf = (t % (BLINK_HALF_PERIOD_MS * 2)) < BLINK_HALF_PERIOD_MS;
      return { opacity: inOnHalf ? 1 : 0, scaleY: 1 };
    }
    case 'smooth': {
      if (t < 220) return { opacity: 1, scaleY: 1 };
      const phase = ((t - 220) % SMOOTH_CYCLE_MS) / SMOOTH_CYCLE_MS;
      const opacity = 0.54 + 0.46 * Math.cos(phase * Math.PI * 2);
      return { opacity, scaleY: 1 };
    }
    case 'phase': {
      if (t < 280) return { opacity: 1, scaleY: 1 };
      const p = ((t - 280) % PHASE_CYCLE_MS) / PHASE_CYCLE_MS;
      let opacity = 1;
      if (p < 0.35) {
        opacity = 1;
      } else if (p < 0.6) {
        opacity = 1 - 0.92 * smoothstep((p - 0.35) / 0.25);
      } else if (p < 0.78) {
        opacity = 0.08;
      } else {
        opacity = 0.08 + 0.92 * smoothstep((p - 0.78) / 0.22);
      }
      return { opacity, scaleY: 1 };
    }
    case 'expand': {
      if (t < 220) return { opacity: 1, scaleY: 1 };
      const phase = ((t - 220) % SMOOTH_CYCLE_MS) / SMOOTH_CYCLE_MS;
      const wave = 0.5 + 0.5 * Math.cos(phase * Math.PI * 2);
      return {
        opacity: 0.65 + 0.35 * wave,
        scaleY: 0.25 + 0.75 * wave,
      };
    }
  }
}

export class CursorAnimationController {
  private blinking: CursorBlinkingMode = 'blink';
  private smoothMode: CursorSmoothCaretAnimationMode = 'off';
  private focused = true;
  private pointerHeld = false;
  private hasSelection = false;
  private draggingHandle = false;
  private disposed = false;

  private blinkOriginMs: number;
  private blinkTimer: ReturnType<typeof setTimeout> | null = null;
  private rafId = 0;

  private caretFromX: number | null = null;
  private caretFromY: number | null = null;
  private caretToX: number | null = null;
  private caretToY: number | null = null;
  private caretCurX: number | null = null;
  private caretCurY: number | null = null;
  private caretAnimStartMs = 0;
  private caretAnimating = false;
  private lastCaretSig = '';
  private lastModelVersion = -1;
  private pendingHint: CaretMotionHint | null = null;

  private readonly onNeedPaint: () => void;
  private readonly nowFn: () => number;

  constructor(onNeedPaint: () => void, nowFn: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
    this.onNeedPaint = onNeedPaint;
    this.nowFn = nowFn;
    this.blinkOriginMs = this.nowFn();
    this.syncScheduler();
  }

  resetTracking(modelVersion: number): void {
    this.lastCaretSig = '';
    this.lastModelVersion = modelVersion;
    this.pendingHint = 'immediate';
    this.caretAnimating = false;
  }

  notifyActivity(hint: CaretMotionHint = 'explicit'): void {
    this.pendingHint = hint;
    this.resetBlink();
  }

  preparePaint(params: {
    hasSelection: boolean;
    hasMultipleCursors: boolean;
    freeHandleActive: boolean;
    caretLine: number;
    caretCol: number;
    virtualSide?: string;
    modelVersion: number;
    targetDocX: number;
    targetDocY: number;
    renderLeft: number;
    renderTop: number;
  }): { opacity: number; scaleY: number; animPos: { x: number; y: number } | null } {
    this.setSelectionState(params.hasSelection, params.freeHandleActive);
    const caretSig = `${params.caretLine}:${params.caretCol}:${params.virtualSide ?? ''}`;
    if (!params.hasSelection && !params.hasMultipleCursors && !params.freeHandleActive) {
      if (caretSig !== this.lastCaretSig || params.modelVersion !== this.lastModelVersion) {
        const hint: CaretMotionHint =
          this.pendingHint ?? (params.modelVersion !== this.lastModelVersion ? 'edit' : 'explicit');
        this.updateCaretTarget(params.targetDocX, params.targetDocY, hint);
        this.resetBlink();
      } else if (this.pendingHint !== null) {
        this.updateCaretTarget(params.targetDocX, params.targetDocY, this.pendingHint);
      }
    } else {
      this.updateCaretTarget(params.targetDocX, params.targetDocY, 'immediate');
    }
    this.lastCaretSig = caretSig;
    this.lastModelVersion = params.modelVersion;
    this.pendingHint = null;
    const animDoc = this.sampleCaretDocPos();
    const animPos = animDoc ? { x: animDoc.x - params.renderLeft, y: animDoc.y - params.renderTop } : null;
    const blink = this.getBlinkSample();
    return { opacity: blink.opacity, scaleY: blink.scaleY, animPos };
  }

  setBlinkingMode(mode: CursorBlinkingMode): void {
    if (this.blinking === mode) return;
    this.blinking = mode;
    this.blinkOriginMs = this.nowFn();
    this.syncScheduler();
  }

  getBlinkingMode(): CursorBlinkingMode {
    return this.blinking;
  }

  setSmoothCaretMode(mode: CursorSmoothCaretAnimationMode): void {
    if (this.smoothMode === mode) return;
    this.smoothMode = mode;
    if (mode === 'off') {
      this.caretAnimating = false;
      this.syncScheduler();
    }
  }

  getSmoothCaretMode(): CursorSmoothCaretAnimationMode {
    return this.smoothMode;
  }

  setFocused(focused: boolean): void {
    if (this.focused === focused) return;
    this.focused = focused;
    if (focused) this.blinkOriginMs = this.nowFn();
    this.syncScheduler();
  }

  setPointerHeld(held: boolean): void {
    if (this.pointerHeld === held) return;
    this.pointerHeld = held;
    this.blinkOriginMs = this.nowFn();
    this.syncScheduler();
  }

  setSelectionState(hasSelection: boolean, draggingHandle: boolean): void {
    const changed = this.hasSelection !== hasSelection || this.draggingHandle !== draggingHandle;
    this.hasSelection = hasSelection;
    this.draggingHandle = draggingHandle;
    if (changed) {
      if (hasSelection || draggingHandle) this.caretAnimating = false;
      this.blinkOriginMs = this.nowFn();
      this.syncScheduler();
    }
  }

  isBlinkPaused(): boolean {
    return (
      this.blinking === 'solid' ||
      !this.focused ||
      this.pointerHeld ||
      this.hasSelection ||
      this.draggingHandle
    );
  }

  resetBlink(): void {
    this.blinkOriginMs = this.nowFn();
    this.syncScheduler();
  }

  getBlinkSample(): BlinkSample {
    if (this.isBlinkPaused()) return { opacity: 1, scaleY: 1 };
    return computeBlinkSample(this.blinking, this.nowFn() - this.blinkOriginMs);
  }

  updateCaretTarget(docX: number, docY: number, hint: CaretMotionHint): void {
    const canAnimate =
      hint !== 'immediate' &&
      !this.hasSelection &&
      !this.draggingHandle &&
      this.caretCurX !== null &&
      this.caretCurY !== null &&
      (this.smoothMode === 'on' || (this.smoothMode === 'explicit' && hint === 'explicit')) &&
      Math.hypot(docX - this.caretCurX, docY - this.caretCurY) >= 0.75;

    if (canAnimate) {
      this.caretFromX = this.caretCurX;
      this.caretFromY = this.caretCurY;
      this.caretToX = docX;
      this.caretToY = docY;
      this.caretAnimStartMs = this.nowFn();
      this.caretAnimating = true;
      this.syncScheduler();
      return;
    }

    this.caretFromX = docX;
    this.caretFromY = docY;
    this.caretToX = docX;
    this.caretToY = docY;
    this.caretCurX = docX;
    this.caretCurY = docY;
    this.caretAnimating = false;
    this.syncScheduler();
  }

  sampleCaretDocPos(): { x: number; y: number } | null {
    if (
      !this.caretAnimating ||
      this.caretFromX === null ||
      this.caretFromY === null ||
      this.caretToX === null ||
      this.caretToY === null
    ) {
      return null;
    }
    const progress = Math.min(1, Math.max(0, (this.nowFn() - this.caretAnimStartMs) / CARET_GLIDE_MS));
    if (progress >= 1) {
      this.caretCurX = this.caretToX;
      this.caretCurY = this.caretToY;
      this.caretAnimating = false;
      this.syncScheduler();
      return null;
    }
    const eased = 1 - Math.pow(1 - progress, 3);
    this.caretCurX = this.caretFromX + (this.caretToX - this.caretFromX) * eased;
    this.caretCurY = this.caretFromY + (this.caretToY - this.caretFromY) * eased;
    return { x: this.caretCurX, y: this.caretCurY };
  }

  isAnimatingCaret(): boolean {
    return this.caretAnimating;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopTimers();
  }

  private stopTimers(): void {
    if (this.blinkTimer !== null) {
      clearTimeout(this.blinkTimer);
      this.blinkTimer = null;
    }
    if (this.rafId && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private syncScheduler(): void {
    this.stopTimers();
    if (this.disposed) return;

    const blinkPaused = this.isBlinkPaused();
    const needRaf =
      this.caretAnimating ||
      (!blinkPaused && (this.blinking === 'smooth' || this.blinking === 'phase' || this.blinking === 'expand'));

    if (needRaf) {
      if (typeof requestAnimationFrame === 'function') {
        const tick = () => {
          this.rafId = 0;
          if (this.disposed) return;
          this.onNeedPaint();
          this.syncScheduler();
        };
        this.rafId = requestAnimationFrame(tick);
      }
      return;
    }

    if (!blinkPaused && this.blinking === 'blink') {
      const elapsed = Math.max(0, this.nowFn() - this.blinkOriginMs);
      const waitMs = Math.max(16, BLINK_HALF_PERIOD_MS - (elapsed % BLINK_HALF_PERIOD_MS));
      this.blinkTimer = setTimeout(() => {
        this.blinkTimer = null;
        if (this.disposed || this.isBlinkPaused() || this.blinking !== 'blink') return;
        this.onNeedPaint();
        this.syncScheduler();
      }, waitMs);
    }
  }
}
