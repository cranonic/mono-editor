import type { ColorFormat, RgbaColor } from './colorTypes';
import { CSS_NAMED_COLORS } from './namedColors';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function hexToRgba(hex: string): RgbaColor | null {
  const raw = hex.startsWith('#') ? hex.slice(1) : hex;
  if (raw.length === 3 || raw.length === 4) {
    const r = parseInt(raw[0]! + raw[0]!, 16);
    const g = parseInt(raw[1]! + raw[1]!, 16);
    const b = parseInt(raw[2]! + raw[2]!, 16);
    const a = raw.length === 4 ? parseInt(raw[3]! + raw[3]!, 16) / 255 : 1;
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b) || Number.isNaN(a)) return null;
    return { r, g, b, a };
  }
  if (raw.length === 6 || raw.length === 8) {
    const r = parseInt(raw.slice(0, 2), 16);
    const g = parseInt(raw.slice(2, 4), 16);
    const b = parseInt(raw.slice(4, 6), 16);
    const a = raw.length === 8 ? parseInt(raw.slice(6, 8), 16) / 255 : 1;
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b) || Number.isNaN(a)) return null;
    return { r, g, b, a };
  }
  return null;
}

export function hslToRgba(h: number, sPct: number, lPct: number, a = 1): RgbaColor {
  const hue = (((h % 360) + 360) % 360) / 360;
  const s = clamp(sPct, 0, 100) / 100;
  const l = clamp(lPct, 0, 100) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue2rgb = (t0: number) => {
      let t = t0;
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    r = hue2rgb(hue + 1 / 3);
    g = hue2rgb(hue);
    b = hue2rgb(hue - 1 / 3);
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
    a: clamp(a, 0, 1),
  };
}

export function rgbaToHsl(c: RgbaColor): { h: number; s: number; l: number; a: number } {
  const r = clamp(c.r, 0, 255) / 255;
  const g = clamp(c.g, 0, 255) / 255;
  const b = clamp(c.b, 0, 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100), a: clamp(c.a, 0, 1) };
}

export function rgbaToHsv(c: RgbaColor): { h: number; s: number; v: number; a: number } {
  const r = clamp(c.r, 0, 255) / 255;
  const g = clamp(c.g, 0, 255) / 255;
  const b = clamp(c.b, 0, 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max, a: clamp(c.a, 0, 1) };
}

export function hsvToRgba(h: number, s: number, v: number, a = 1): RgbaColor {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 1);
  const val = clamp(v, 0, 1);
  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hue < 60) [r1, g1, b1] = [c, x, 0];
  else if (hue < 120) [r1, g1, b1] = [x, c, 0];
  else if (hue < 180) [r1, g1, b1] = [0, c, x];
  else if (hue < 240) [r1, g1, b1] = [0, x, c];
  else if (hue < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
    a: clamp(a, 0, 1),
  };
}

function parseAlpha(raw?: string): number {
  if (!raw) return 1;
  const trimmed = raw.trim();
  if (trimmed.endsWith('%')) return clamp(parseFloat(trimmed) / 100, 0, 1);
  const v = parseFloat(trimmed);
  return Number.isNaN(v) ? 1 : clamp(v, 0, 1);
}

function parseRgbChannel(raw: string): number | null {
  const t = raw.trim();
  if (t.endsWith('%')) {
    const p = parseFloat(t);
    return Number.isNaN(p) ? null : clamp(Math.round((p / 100) * 255), 0, 255);
  }
  const n = parseFloat(t);
  return Number.isNaN(n) ? null : clamp(Math.round(n), 0, 255);
}

export function parseColorLiteral(raw: string): { rgba: RgbaColor; format: ColorFormat } | null {
  const s = raw.trim();
  if (!s) return null;
  if (s.startsWith('#')) {
    const rgba = hexToRgba(s);
    return rgba ? { rgba, format: 'hex' } : null;
  }
  const rgbMatch = /^rgba?\(\s*([^,\s/]+)\s*[,\s]\s*([^,\s/]+)\s*[,\s]\s*([^,\s/)]+)(?:\s*[,/]\s*([^)]+))?\s*\)$/i.exec(s);
  if (rgbMatch) {
    const r = parseRgbChannel(rgbMatch[1]!);
    const g = parseRgbChannel(rgbMatch[2]!);
    const b = parseRgbChannel(rgbMatch[3]!);
    if (r == null || g == null || b == null) return null;
    return { rgba: { r, g, b, a: parseAlpha(rgbMatch[4]) }, format: 'rgb' };
  }
  const hslMatch = /^hsla?\(\s*([+-]?\d*\.?\d+)(?:deg)?\s*[,\s]\s*(\d*\.?\d+)%\s*[,\s]\s*(\d*\.?\d+)%(?:\s*[,/]\s*([^)]+))?\s*\)$/i.exec(s);
  if (hslMatch) {
    const h = parseFloat(hslMatch[1]!);
    const sat = parseFloat(hslMatch[2]!);
    const lit = parseFloat(hslMatch[3]!);
    if (Number.isNaN(h) || Number.isNaN(sat) || Number.isNaN(lit)) return null;
    return { rgba: hslToRgba(h, sat, lit, parseAlpha(hslMatch[4])), format: 'hsl' };
  }
  // Own-property lookup: plain-object access would match inherited keys such as `constructor` / `toString`
  // (identifiers that appear in ordinary code) and hand a function to hexToRgba.
  const lower = s.toLowerCase();
  const namedHex = Object.prototype.hasOwnProperty.call(CSS_NAMED_COLORS, lower) ? CSS_NAMED_COLORS[lower] : undefined;
  if (namedHex) {
    const rgba = hexToRgba(namedHex);
    if (rgba) return { rgba, format: 'named' };
  }
  return null;
}
