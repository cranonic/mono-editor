// src/core/extensionAPI/registry/ProductIconRegistry.ts
// Product (App) Icon Theme Registry supporting:
//   1. Built-in & extension TTF/WOFF/WOFF2 product icon fonts (VS Code productIconThemes spec)
//   2. Extension SVG / PNG image overrides (iconPath via ms-storage:// or HTTP/data URLs)
//   3. Inline SVG string overrides
//   4. Safe fallback to Codicons so no icon ever breaks

import { fs } from '@/core/fileSystem';

export interface ProductIconFontSource {
  path: string;
  format?: string;
}

export interface ProductIconFontDefinition {
  id: string;
  src: ProductIconFontSource[];
  weight?: string;
  style?: string;
  size?: string;
}

export interface ProductIconDefinitionEntry {
  /** Unicode character or escaped hex code (e.g. "\\e001" or "\ue001") */
  fontCharacter?: string;
  /** Optional font ID referencing `fonts[]` (defaults to the first font in the theme) */
  fontId?: string;
  /** Optional color override */
  fontColor?: string;
  /** Optional relative/absolute font size (e.g. "110%") */
  fontSize?: string;
  /** Optional image asset path (SVG/PNG, resolved relative to basePath) */
  iconPath?: string;
  /** Optional inline SVG markup */
  svg?: string;
}

export interface ProductIconThemeMap {
  /** Font declarations (@font-face) for TTF/WOFF/WOFF2 product icon themes */
  fonts?: ProductIconFontDefinition[];
  /** Mapping of semantic icon IDs (e.g. 'files', 'search', 'settings', 'git-branch') to glyph/image defs */
  iconDefinitions: Record<string, ProductIconDefinitionEntry>;
  /** Base path used to resolve extension relative font/image paths */
  basePath?: string;
}

export type ResolvedProductIcon =
  | {
      type: 'font';
      fontFamily: string;
      character: string;
      color?: string;
      fontSize?: string;
      fontWeight?: string;
      fontStyle?: string;
    }
  | {
      type: 'image';
      value: string;
    }
  | {
      type: 'svg';
      value: string;
    }
  | {
      type: 'codicon';
      name: string;
    };

const STYLE_TAG_ID = 'ms-product-icon-fonts';
const fontDataUriCache = new Map<string, string>();

// Normalize common MSCode semantic names to canonical VS Code product icon IDs as fallback lookups
const SEMANTIC_ALIASES: Record<string, string[]> = {
  settings: ['settings-gear', 'gear'],
  'settings-gear': ['settings', 'gear'],
  more: ['ellipsis'],
  ellipsis: ['more'],
  'more-vertical': ['kebab-vertical', 'more'],
  'kebab-vertical': ['more-vertical'],
  undo: ['discard'],
  add: ['plus'],
  plus: ['add'],
  'folder-active': ['folder-opened'],
  'root-folder-opened': ['folder-opened', 'folder'],
  'folder-android': ['device-mobile', 'folder'],
  'folder-linux': ['terminal-linux', 'terminal', 'folder'],
  'source-control': ['git-branch'],
  'debug-alt': ['debug'],
};

function decodeFontCharacter(raw: string): string {
  if (!raw) return '';
  if (raw.startsWith('\\')) {
    const hex = raw.slice(1).replace(/^u/i, '');
    const cp = parseInt(hex, 16);
    if (!Number.isNaN(cp)) return String.fromCodePoint(cp);
  }
  return raw;
}

function guessFontFormat(path: string, explicit?: string): { format: string; mime: string } {
  const lower = (explicit || path.split('.').pop() || '').toLowerCase();
  if (lower === 'woff2') return { format: 'woff2', mime: 'font/woff2' };
  if (lower === 'woff') return { format: 'woff', mime: 'font/woff' };
  if (lower === 'otf' || lower === 'opentype') return { format: 'opentype', mime: 'font/otf' };
  return { format: 'truetype', mime: 'font/ttf' };
}

function resolveAssetPath(rawPath: string, basePath?: string): string {
  if (
    rawPath.startsWith('/') ||
    rawPath.startsWith('http://') ||
    rawPath.startsWith('https://') ||
    rawPath.startsWith('data:') ||
    rawPath.startsWith('ms-storage://') ||
    rawPath.startsWith('file://')
  ) {
    return rawPath;
  }
  const clean = rawPath.replace(/^\.\//, '');
  return basePath ? `${basePath.replace(/\/$/, '')}/${clean}` : `/${clean}`;
}

class ProductIconRegistry {
  private theme: ProductIconThemeMap = { iconDefinitions: {} };
  private fontMap = new Map<string, ProductIconFontDefinition>();
  private defaultFontId: string | null = null;
  private listeners = new Set<() => void>();
  private version = 0;

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getVersion(): number {
    return this.version;
  }

  private notify(): void {
    this.version++;
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch {
        /* ignore */
      }
    });
  }

  loadProductIconTheme(newTheme: ProductIconThemeMap | null): void {
    this.theme = newTheme
      ? { ...newTheme, iconDefinitions: { ...(newTheme.iconDefinitions || {}) } }
      : { iconDefinitions: {} };
    this.fontMap.clear();
    this.defaultFontId = null;

    const fonts = this.theme.fonts ?? [];
    for (const f of fonts) {
      if (!f?.id) continue;
      this.fontMap.set(f.id, f);
      if (!this.defaultFontId) this.defaultFontId = f.id;
    }

    void this.injectFontFaces(fonts, this.theme.basePath);
    this.notify();
  }

  private async injectFontFaces(fonts: ProductIconFontDefinition[], basePath?: string): Promise<void> {
    if (typeof document === 'undefined') return;
    let styleEl = document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = STYLE_TAG_ID;
      document.head.appendChild(styleEl);
    }

    if (!fonts.length) {
      styleEl.textContent = '';
      return;
    }

    const rules: string[] = [];
    for (const font of fonts) {
      const srcParts: string[] = [];
      for (const s of font.src ?? []) {
        const resolved = resolveAssetPath(s.path, basePath);
        const { format, mime } = guessFontFormat(s.path, s.format);

        if (resolved.startsWith('ms-storage://')) {
          let dataUri = fontDataUriCache.get(resolved);
          if (!dataUri) {
            try {
              const raw = await fs.readFile(resolved);
              dataUri = raw.startsWith('data:') ? raw : `data:${mime};base64,${raw}`;
              fontDataUriCache.set(resolved, dataUri);
            } catch (err) {
              console.warn(`[ProductIconRegistry] Failed to load extension font: ${resolved}`, err);
              continue;
            }
          }
          srcParts.push(`url("${dataUri}") format("${format}")`);
        } else {
          srcParts.push(`url("${resolved}") format("${format}")`);
        }
      }

      if (srcParts.length > 0) {
        rules.push(
          `@font-face { font-family: "${font.id}"; src: ${srcParts.join(', ')}; font-weight: ${font.weight || 'normal'}; font-style: ${font.style || 'normal'}; font-display: block; }`,
        );
      }
    }

    styleEl.textContent = rules.join('\n');
    this.notify();
  }

  getIcon(name: string): ResolvedProductIcon {
    const defs = this.theme.iconDefinitions || {};
    let def = defs[name];

    if (!def) {
      const aliases = SEMANTIC_ALIASES[name];
      if (aliases) {
        for (const alt of aliases) {
          if (defs[alt]) {
            def = defs[alt];
            break;
          }
        }
      }
    }

    if (def) {
      if (def.fontCharacter) {
        const fontId = def.fontId || this.defaultFontId;
        const fontMeta = fontId ? this.fontMap.get(fontId) : undefined;
        if (fontId) {
          return {
            type: 'font',
            fontFamily: `"${fontId}"`,
            character: decodeFontCharacter(def.fontCharacter),
            color: def.fontColor,
            fontSize: def.fontSize || fontMeta?.size,
            fontWeight: fontMeta?.weight,
            fontStyle: fontMeta?.style,
          };
        }
      }
      if (def.iconPath) {
        return { type: 'image', value: resolveAssetPath(def.iconPath, this.theme.basePath) };
      }
      if (def.svg) {
        return { type: 'svg', value: def.svg };
      }
    }

    // Safe universal codicon fallback
    const codiconFallback =
      name === 'settings'
        ? 'settings-gear'
        : name === 'more'
          ? 'ellipsis'
          : name === 'more-vertical'
            ? 'kebab-vertical'
            : name === 'undo'
              ? 'discard'
              : name;

    return { type: 'codicon', name: codiconFallback };
  }
}

export const productIconRegistry = new ProductIconRegistry();
