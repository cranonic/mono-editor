import type { ViewController } from '../../view/ViewController';

export type ScrollAxis = 'none' | 'x' | 'y';

const FRICTION_PER_MS = 0.0028;
const MIN_FLING_START = 0.25;
const MIN_FLING_STOP = 0.03;
const MAX_FLING = 6.5;
export const AXIS_LOCK_RATIO = 1.25;

/**
 * Velocity sampler and exponential-damping fling physics for touch scrolling.
 */
export class TouchScrollPhysics {
  private samples: { t: number; x: number; y: number }[] = [];
  private flingRaf = 0;
  private flingVx = 0;
  private flingVy = 0;
  private flingLastT = 0;
  private disposed = false;

  get isFlinging(): boolean {
    return this.flingRaf !== 0;
  }

  resetSamples(): void {
    this.samples = [];
  }

  pushSample(x: number, y: number, t: number): void {
    const prev = this.samples[this.samples.length - 1];
    if (prev && t - prev.t < 2) return;
    this.samples.push({ t, x, y });
    while (this.samples.length > 2 && t - this.samples[0]!.t > 90) {
      this.samples.shift();
    }
  }

  computeVelocity(now: number): { vx: number; vy: number } {
    if (this.samples.length < 2) return { vx: 0, vy: 0 };
    const last = this.samples[this.samples.length - 1]!;
    if (now - last.t > 60) return { vx: 0, vy: 0 };
    const first = this.samples[0]!;
    const dt = last.t - first.t;
    if (dt < 8) return { vx: 0, vy: 0 };
    return {
      vx: (last.x - first.x) / dt,
      vy: (last.y - first.y) / dt,
    };
  }

  stop(): void {
    if (this.flingRaf) {
      cancelAnimationFrame(this.flingRaf);
      this.flingRaf = 0;
    }
    this.flingVx = 0;
    this.flingVy = 0;
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
  }

  startFling(
    vx: number,
    vy: number,
    axis: ScrollAxis,
    view: ViewController,
    onTick: () => void,
    onEnd: () => void,
  ): void {
    this.stop();
    let sx = axis === 'y' ? 0 : -vx;
    let sy = axis === 'x' ? 0 : -vy;
    const ax = Math.abs(sx);
    const ay = Math.abs(sy);
    if (ay > ax * AXIS_LOCK_RATIO) sx = 0;
    else if (ax > ay * AXIS_LOCK_RATIO) sy = 0;

    const clamp = (v: number) => Math.max(-MAX_FLING, Math.min(MAX_FLING, v));
    this.flingVx = clamp(sx);
    this.flingVy = clamp(sy);
    if (Math.abs(this.flingVx) < MIN_FLING_START && Math.abs(this.flingVy) < MIN_FLING_START) {
      return;
    }

    this.flingLastT = performance.now();
    const step = (now: number) => {
      if (this.disposed) return;
      const dt = Math.min(32, Math.max(0, now - this.flingLastT));
      this.flingLastT = now;
      if (dt <= 0) {
        this.flingRaf = requestAnimationFrame(step);
        return;
      }
      const damp = Math.exp(-FRICTION_PER_MS * dt);
      this.flingVx *= damp;
      this.flingVy *= damp;
      const prevTop = view.scrollTop;
      const prevLeft = view.scrollLeft;
      view.scrollLeft = Math.max(0, view.scrollLeft + this.flingVx * dt);
      view.scrollTop = Math.max(0, view.scrollTop + this.flingVy * dt);
      view.clampScrollPublic();
      view.paint();
      onTick();
      const moved =
        Math.abs(view.scrollTop - prevTop) > 0.01 ||
        Math.abs(view.scrollLeft - prevLeft) > 0.01;
      if (!moved || (Math.abs(this.flingVx) < MIN_FLING_STOP && Math.abs(this.flingVy) < MIN_FLING_STOP)) {
        this.flingRaf = 0;
        onEnd();
        return;
      }
      this.flingRaf = requestAnimationFrame(step);
    };
    this.flingRaf = requestAnimationFrame(step);
  }
}
