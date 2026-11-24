import type { RgbaColor } from './colorTypes';
import { rgbaToHsl } from './colorParse';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function toHex2(n: number): string {
  return clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
}

export function rgbaToHex(c: RgbaColor, includeAlpha = c.a < 0.999): string {
  const base = `#${toHex2(c.r)}${toHex2(c.g)}${toHex2(c.b)}`;
  if (!includeAlpha) return base;
  return base + toHex2(c.a * 255);
}

export function rgbaToRgbString(c: RgbaColor): string {
  const r = clamp(Math.round(c.r), 0, 255);
  const g = clamp(Math.round(c.g), 0, 255);
  const b = clamp(Math.round(c.b), 0, 255);
  if (c.a >= 0.999) return `rgb(${r}, ${g}, ${b})`;
  const aStr = Number(clamp(c.a, 0, 1).toFixed(2)).toString();
  return `rgba(${r}, ${g}, ${b}, ${aStr})`;
}

export function rgbaToHslString(c: RgbaColor): string {
  const { h, s, l, a } = rgbaToHsl(c);
  if (a >= 0.999) return `hsl(${h}, ${s}%, ${l}%)`;
  const aStr = Number(clamp(a, 0, 1).toFixed(2)).toString();
  return `hsla(${h}, ${s}%, ${l}%, ${aStr})`;
}

export function rgbaToCss(c: RgbaColor): string {
  return rgbaToRgbString(c);
}

export function formatColorPresentation(c: RgbaColor, format: 'hex' | 'rgb' | 'hsl'): string {
  if (format === 'rgb') return rgbaToRgbString(c);
  if (format === 'hsl') return rgbaToHslString(c);
  return rgbaToHex(c);
}
