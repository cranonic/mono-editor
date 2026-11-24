import type { ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';
import type { ColorMatch, RgbaColor } from '../../common/color/colorTypes';
import { formatColorPresentation, rgbaToCss } from '../../common/color/colorFormat';
import { hsvToRgba, rgbaToHsv } from '../../common/color/colorParse';

export interface ColorPickerHandlers {
  /** Called live whenever HSV/Alpha or format changes. */
  onColorChange: (newText: string, rgba: RgbaColor, format: 'hex' | 'rgb' | 'hsl') => void;
  /** Called when the picker closes (seal undo transaction). */
  onClose?: () => void;
}

const FORMAT_CYCLE: readonly ('hex' | 'rgb' | 'hsl')[] = ['hex', 'rgb', 'hsl'];

function contrastTextColor(c: RgbaColor): string {
  // Composite against mid-gray when translucent
  const bg = 128;
  const r = c.r * c.a + bg * (1 - c.a);
  const g = c.g * c.a + bg * (1 - c.a);
  const b = c.b * c.a + bg * (1 - c.a);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.58 ? '#111111' : '#ffffff';
}

/**
 * Exact Monaco-style Interactive Color Picker Popover:
 * - Clickable colored header bar that displays formatted value & cycles Hex / RGB / HSL
 * - 2D Saturation / Value field with smooth pointer reticle
 * - Vertical Hue rainbow slider
 * - Vertical Alpha / Opacity slider over checkerboard backdrop
 * - Focus-safe (`data-mono-focusable="true"`) & live theme synchronized
 */
export class ColorPickerWidget {
  private host: HTMLElement;
  private el: HTMLDivElement | null = null;
  private theme: ResolvedWidgetTheme | null = null;
  private hsv = { h: 210, s: 0.75, v: 0.95, a: 1 };
  private format: 'hex' | 'rgb' | 'hsl' = 'hex';
  private handlers: ColorPickerHandlers | null = null;
  private outsideListener: ((e: Event) => void) | null = null;
  private keyListener: ((e: KeyboardEvent) => void) | null = null;

  private headerEl: HTMLButtonElement | null = null;
  private svCanvas: HTMLCanvasElement | null = null;
  private svKnob: HTMLDivElement | null = null;
  private hueCanvas: HTMLCanvasElement | null = null;
  private hueKnob: HTMLDivElement | null = null;
  private alphaCanvas: HTMLCanvasElement | null = null;
  private alphaKnob: HTMLDivElement | null = null;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  applyTheme(theme: ResolvedWidgetTheme): void {
    this.theme = theme;
    if (!this.el) return;
    this.el.style.background = theme.background;
    this.el.style.border = `1px solid ${theme.border}`;
    this.el.style.boxShadow = theme.shadow;
    this.el.style.color = theme.foreground;
  }

  isOpen(): boolean {
    return this.el !== null;
  }

  open(
    match: ColorMatch,
    anchor: { x: number; y: number; top: number },
    handlers: ColorPickerHandlers,
  ): void {
    this.close(false);
    this.hsv = rgbaToHsv(match.rgba);
    this.format = match.format === 'named' ? 'hex' : match.format;
    this.handlers = handlers;

    const bg = this.theme?.background ?? '#252526';
    const border = this.theme?.border ?? '#454545';
    const fg = this.theme?.foreground ?? '#cccccc';
    const shadow = this.theme?.shadow ?? '0 8px 24px rgba(0,0,0,0.45)';

    const el = document.createElement('div');
    el.className = 'mono-color-picker';
    el.setAttribute('data-mono-focusable', 'true');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Color Picker');
    Object.assign(el.style, {
      position: 'absolute',
      zIndex: '55',
      width: '260px',
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: '4px',
      boxShadow: shadow,
      color: fg,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: '12px',
      overflow: 'hidden',
      pointerEvents: 'auto',
      userSelect: 'none',
      touchAction: 'none',
    });
    el.style.setProperty('-webkit-user-select', 'none');

    // Stop pointer events from propagating into the editor canvas
    const stopProp = (e: Event) => e.stopPropagation();
    el.addEventListener('pointerdown', stopProp);
    el.addEventListener('mousedown', stopProp);
    el.addEventListener('touchstart', stopProp, { passive: true });
    el.addEventListener('click', stopProp);

    // ── Header preview bar (click to cycle hex / rgb / hsl) ───────────────
    const headerWrap = document.createElement('div');
    Object.assign(headerWrap.style, {
      position: 'relative',
      height: '32px',
      borderBottom: `1px solid ${border}`,
      backgroundImage:
        'linear-gradient(45deg, #888 25%, transparent 25%), linear-gradient(-45deg, #888 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #888 75%), linear-gradient(-45deg, transparent 75%, #888 75%)',
      backgroundSize: '10px 10px',
      backgroundPosition: '0 0, 0 5px, 5px -5px, -5px 0',
      backgroundColor: '#cccccc',
    });

    const headerBtn = document.createElement('button');
    headerBtn.type = 'button';
    headerBtn.title = 'Click to switch color format (Hex / RGB / HSL)';
    headerBtn.setAttribute('data-mono-focusable', 'true');
    Object.assign(headerBtn.style, {
      width: '100%',
      height: '100%',
      border: 'none',
      margin: '0',
      padding: '0 10px',
      cursor: 'pointer',
      fontFamily: 'inherit',
      fontSize: '12px',
      fontWeight: '600',
      fontVariantNumeric: 'tabular-nums',
      textAlign: 'center',
      outline: 'none',
      transition: 'opacity 100ms ease',
    });
    headerBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const idx = FORMAT_CYCLE.indexOf(this.format);
      this.format = FORMAT_CYCLE[(idx + 1) % FORMAT_CYCLE.length]!;
      this.emitChange();
    });
    headerWrap.appendChild(headerBtn);
    el.appendChild(headerWrap);
    this.headerEl = headerBtn;

    // ── Body: 2D SV Box + Vertical Hue Bar + Vertical Alpha Bar ───────────
    const body = document.createElement('div');
    Object.assign(body.style, {
      display: 'flex',
      gap: '8px',
      padding: '8px',
      alignItems: 'stretch',
    });

    // 2D Saturation/Value box
    const svW = 192;
    const svH = 152;
    const svWrap = document.createElement('div');
    Object.assign(svWrap.style, {
      position: 'relative',
      width: `${svW}px`,
      height: `${svH}px`,
      flexShrink: '0',
      borderRadius: '2px',
      overflow: 'hidden',
      cursor: 'crosshair',
      border: `1px solid ${border}`,
    });
    const svCanvas = document.createElement('canvas');
    svCanvas.width = svW;
    svCanvas.height = svH;
    Object.assign(svCanvas.style, { width: `${svW}px`, height: `${svH}px`, display: 'block' });
    const svKnob = document.createElement('div');
    Object.assign(svKnob.style, {
      position: 'absolute',
      width: '12px',
      height: '12px',
      borderRadius: '50%',
      border: '2px solid #ffffff',
      boxShadow: '0 0 0 1px rgba(0,0,0,0.65)',
      transform: 'translate(-50%, -50%)',
      pointerEvents: 'none',
    });
    svWrap.appendChild(svCanvas);
    svWrap.appendChild(svKnob);
    body.appendChild(svWrap);
    this.svCanvas = svCanvas;
    this.svKnob = svKnob;

    // Vertical Alpha slider
    const barW = 16;
    const alphaWrap = document.createElement('div');
    Object.assign(alphaWrap.style, {
      position: 'relative',
      width: `${barW}px`,
      height: `${svH}px`,
      flexShrink: '0',
      borderRadius: '2px',
      overflow: 'hidden',
      cursor: 'ns-resize',
      border: `1px solid ${border}`,
      backgroundImage:
        'linear-gradient(45deg, #888 25%, transparent 25%), linear-gradient(-45deg, #888 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #888 75%), linear-gradient(-45deg, transparent 75%, #888 75%)',
      backgroundSize: '8px 8px',
      backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
      backgroundColor: '#cccccc',
    });
    const alphaCanvas = document.createElement('canvas');
    alphaCanvas.width = barW;
    alphaCanvas.height = svH;
    Object.assign(alphaCanvas.style, { width: `${barW}px`, height: `${svH}px`, display: 'block' });
    const alphaKnob = document.createElement('div');
    Object.assign(alphaKnob.style, {
      position: 'absolute',
      left: '0',
      right: '0',
      height: '4px',
      background: '#ffffff',
      border: '1px solid rgba(0,0,0,0.75)',
      transform: 'translateY(-50%)',
      pointerEvents: 'none',
    });
    alphaWrap.appendChild(alphaCanvas);
    alphaWrap.appendChild(alphaKnob);
    body.appendChild(alphaWrap);
    this.alphaCanvas = alphaCanvas;
    this.alphaKnob = alphaKnob;

    // Vertical Hue slider
    const hueWrap = document.createElement('div');
    Object.assign(hueWrap.style, {
      position: 'relative',
      width: `${barW}px`,
      height: `${svH}px`,
      flexShrink: '0',
      borderRadius: '2px',
      overflow: 'hidden',
      cursor: 'ns-resize',
      border: `1px solid ${border}`,
    });
    const hueCanvas = document.createElement('canvas');
    hueCanvas.width = barW;
    hueCanvas.height = svH;
    Object.assign(hueCanvas.style, { width: `${barW}px`, height: `${svH}px`, display: 'block' });
    const hueKnob = document.createElement('div');
    Object.assign(hueKnob.style, {
      position: 'absolute',
      left: '0',
      right: '0',
      height: '4px',
      background: '#ffffff',
      border: '1px solid rgba(0,0,0,0.75)',
      transform: 'translateY(-50%)',
      pointerEvents: 'none',
    });
    hueWrap.appendChild(hueCanvas);
    hueWrap.appendChild(hueKnob);
    body.appendChild(hueWrap);
    this.hueCanvas = hueCanvas;
    this.hueKnob = hueKnob;

    el.appendChild(body);

    // Wire smooth pointer drags on SV, Alpha, Hue
    this.bindDrag(svWrap, (nx, ny) => {
      this.hsv.s = nx;
      this.hsv.v = 1 - ny;
      this.emitChange();
    });
    this.bindDrag(alphaWrap, (_nx, ny) => {
      this.hsv.a = Number((1 - ny).toFixed(2));
      this.emitChange();
    });
    this.bindDrag(hueWrap, (_nx, ny) => {
      this.hsv.h = Math.min(359.9, ny * 360);
      this.emitChange();
    });

    this.host.appendChild(el);
    this.el = el;

    this.drawHueBar();
    this.syncVisuals();

    // Clamp position inside editor viewport
    const hostW = this.host.clientWidth || 640;
    const hostH = this.host.clientHeight || 400;
    const popW = 260;
    const popH = 204;
    let left = Math.max(8, anchor.x);
    if (left + popW > hostW - 8) left = Math.max(8, hostW - popW - 8);
    let top = anchor.y + 4;
    if (top + popH > hostH - 8 && anchor.top - popH - 4 >= 8) {
      top = anchor.top - popH - 4;
    } else if (top + popH > hostH - 8) {
      top = Math.max(8, hostH - popH - 8);
    }
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;

    // Close on outside click or Escape
    const onOutside = (e: Event) => {
      if (!this.el) return;
      const target = e.target as Node | null;
      if (target && this.el.contains(target)) return;
      this.close(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close(true);
      }
    };
    this.outsideListener = onOutside;
    this.keyListener = onKey;
    setTimeout(() => {
      if (!this.el) return;
      document.addEventListener('pointerdown', onOutside, true);
      document.addEventListener('keydown', onKey, true);
    }, 0);
  }

  close(notify = true): void {
    if (this.outsideListener) {
      document.removeEventListener('pointerdown', this.outsideListener, true);
      this.outsideListener = null;
    }
    if (this.keyListener) {
      document.removeEventListener('keydown', this.keyListener, true);
      this.keyListener = null;
    }
    const cb = this.handlers?.onClose;
    this.handlers = null;
    this.el?.remove();
    this.el = null;
    this.headerEl = null;
    this.svCanvas = null;
    this.svKnob = null;
    this.hueCanvas = null;
    this.hueKnob = null;
    this.alphaCanvas = null;
    this.alphaKnob = null;
    if (notify) cb?.();
  }

  dispose(): void {
    this.close(false);
  }

  private bindDrag(target: HTMLElement, onMove: (nx: number, ny: number) => void): void {
    const updateFromClient = (clientX: number, clientY: number) => {
      const r = target.getBoundingClientRect();
      const nx = Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width)));
      const ny = Math.max(0, Math.min(1, (clientY - r.top) / Math.max(1, r.height)));
      onMove(nx, ny);
    };
    let active = false;
    target.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      active = true;
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      updateFromClient(e.clientX, e.clientY);
    });
    target.addEventListener('pointermove', (e) => {
      if (!active) return;
      e.preventDefault();
      updateFromClient(e.clientX, e.clientY);
    });
    const finish = (e: PointerEvent) => {
      if (!active) return;
      active = false;
      try {
        target.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };
    target.addEventListener('pointerup', finish);
    target.addEventListener('pointercancel', finish);
  }

  private emitChange(): void {
    const rgba = hsvToRgba(this.hsv.h, this.hsv.s, this.hsv.v, this.hsv.a);
    this.syncVisuals();
    const formatted = formatColorPresentation(rgba, this.format);
    this.handlers?.onColorChange(formatted, rgba, this.format);
  }

  private drawHueBar(): void {
    const canvas = this.hueCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, '#ff0000');
    grad.addColorStop(1 / 6, '#ffff00');
    grad.addColorStop(2 / 6, '#00ff00');
    grad.addColorStop(3 / 6, '#00ffff');
    grad.addColorStop(4 / 6, '#0000ff');
    grad.addColorStop(5 / 6, '#ff00ff');
    grad.addColorStop(1, '#ff0000');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  private syncVisuals(): void {
    const rgba = hsvToRgba(this.hsv.h, this.hsv.s, this.hsv.v, this.hsv.a);
    const pureHue = hsvToRgba(this.hsv.h, 1, 1, 1);

    // Header
    if (this.headerEl) {
      this.headerEl.style.background = rgbaToCss(rgba);
      this.headerEl.style.color = contrastTextColor(rgba);
      this.headerEl.textContent = formatColorPresentation(rgba, this.format);
    }

    // 2D SV Canvas
    if (this.svCanvas) {
      const ctx = this.svCanvas.getContext('2d');
      if (ctx) {
        const w = this.svCanvas.width;
        const h = this.svCanvas.height;
        ctx.fillStyle = rgbaToCss(pureHue);
        ctx.fillRect(0, 0, w, h);

        const whiteGrad = ctx.createLinearGradient(0, 0, w, 0);
        whiteGrad.addColorStop(0, '#ffffff');
        whiteGrad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = whiteGrad;
        ctx.fillRect(0, 0, w, h);

        const blackGrad = ctx.createLinearGradient(0, 0, 0, h);
        blackGrad.addColorStop(0, 'rgba(0,0,0,0)');
        blackGrad.addColorStop(1, '#000000');
        ctx.fillStyle = blackGrad;
        ctx.fillRect(0, 0, w, h);
      }
    }
    if (this.svKnob && this.svCanvas) {
      this.svKnob.style.left = `${Math.round(this.hsv.s * this.svCanvas.width)}px`;
      this.svKnob.style.top = `${Math.round((1 - this.hsv.v) * this.svCanvas.height)}px`;
    }

    // Alpha Canvas
    if (this.alphaCanvas) {
      const ctx = this.alphaCanvas.getContext('2d');
      if (ctx) {
        const w = this.alphaCanvas.width;
        const h = this.alphaCanvas.height;
        ctx.clearRect(0, 0, w, h);
        const aGrad = ctx.createLinearGradient(0, 0, 0, h);
        aGrad.addColorStop(0, `rgba(${rgba.r},${rgba.g},${rgba.b},1)`);
        aGrad.addColorStop(1, `rgba(${rgba.r},${rgba.g},${rgba.b},0)`);
        ctx.fillStyle = aGrad;
        ctx.fillRect(0, 0, w, h);
      }
    }
    if (this.alphaKnob && this.alphaCanvas) {
      this.alphaKnob.style.top = `${Math.round((1 - this.hsv.a) * this.alphaCanvas.height)}px`;
    }

    if (this.hueKnob && this.hueCanvas) {
      this.hueKnob.style.top = `${Math.round((this.hsv.h / 360) * this.hueCanvas.height)}px`;
    }
  }
}
