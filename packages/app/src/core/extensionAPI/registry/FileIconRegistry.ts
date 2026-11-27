// src/core/extensionAPI/registry/FileIconRegistry.ts
// Full VS Code-compatible File Icon Registry supporting:
//   1. TTF / WOFF / WOFF2 font-based icon themes (built-in & extensions)
//   2. Image-based (SVG / PNG) extension icon themes (ms-storage://, http(s)://, data:)
//   3. CSS class fallbacks

import { fs } from '@/core/fileSystem';

export interface IconFontSource {
  path: string;
  format?: string;
}

export interface IconFontDefinition {
  id: string;
  src: IconFontSource[];
  weight?: string;
  style?: string;
  size?: string;
}

export interface IconDefinitionEntry {
  iconPath?: string;
  fontCharacter?: string;
  fontColor?: string;
  fontId?: string;
  fontSize?: string;
}

export interface IconThemeMap {
  /** Font definitions (@font-face) for TTF/WOFF/WOFF2 file icon themes */
  fonts?: IconFontDefinition[];
  /** Root catalog mapping abstract symbol identifiers to font glyphs or image asset paths */
  iconDefinitions?: Record<string, IconDefinitionEntry>;
  /** Primary map binding file extensions to icon definition keys */
  fileExtensions?: Record<string, string>;
  /** Alternative extension map key */
  extensions?: Record<string, string>;
  /** Exact filename dictionary (case-insensitive) */
  fileNames?: Record<string, string>;
  /** Exact folder name dictionary (closed state) */
  folderNames?: Record<string, string>;
  /** Exact folder name dictionary (open/expanded state) */
  folderNamesExpanded?: Record<string, string>;
  /** Default file icon definition ID */
  file?: string;
  /** Default closed folder icon definition ID */
  folder?: string;
  /** Default open folder icon definition ID */
  folderExpanded?: string;
  /** Language ID -> icon definition ID */
  languageIds?: Record<string, string>;
  /** Base path prefix for resolving relative extension icon/font paths */
  basePath?: string;
  /** Optional VS Code flag hiding tree chevrons */
  hidesExplorerArrows?: boolean;
}

export type ResolvedIcon =
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
      type: 'class';
      value: string;
    };

const STYLE_TAG_ID = 'ms-file-icon-fonts';
const fontDataUriCache = new Map<string, string>();

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

class IconThemeRegistry {
  private theme: IconThemeMap = {};
  private fontMap = new Map<string, IconFontDefinition>();
  private defaultFontId: string | null = null;
  private listeners = new Set<() => void>();
  private version = 0;

  private defaultFileClass = 'ms-icon-default-file';
  private defaultFolderClass = 'ms-icon-default-folder';
  private folderOpenClass = 'ms-icon-default-folder-open';

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

  loadIconTheme(newTheme: IconThemeMap | null): void {
    this.theme = newTheme ? { ...newTheme } : {};
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

  private async injectFontFaces(fonts: IconFontDefinition[], basePath?: string): Promise<void> {
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
              console.warn(`[FileIconRegistry] Failed to load extension font: ${resolved}`, err);
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

  private resolveIdToIcon(id: string, isDirectory = false, isOpen = false): ResolvedIcon {
    if (!id) {
      return {
        type: 'class',
        value: isDirectory
          ? isOpen
            ? this.folderOpenClass
            : this.defaultFolderClass
          : this.defaultFileClass,
      };
    }

    const def = this.theme.iconDefinitions?.[id];
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
        const resolvedPath = resolveAssetPath(def.iconPath, this.theme.basePath);
        return { type: 'image', value: resolvedPath };
      }
    }

    return { type: 'class', value: id };
  }

  getFileIcon(fileName: string, isDirectory: boolean, isOpen: boolean = false): ResolvedIcon {
    const lowerName = fileName.toLowerCase();

    // 1. Folder resolution
    if (isDirectory) {
      let folderId = '';
      const fNames = this.theme.folderNames || {};
      const fNamesExpanded = this.theme.folderNamesExpanded || {};

      if (isOpen && fNamesExpanded[lowerName]) folderId = fNamesExpanded[lowerName];
      else if (fNames[lowerName]) folderId = fNames[lowerName];
      else folderId = isOpen ? (this.theme.folderExpanded || 'folder-open') : (this.theme.folder || 'folder');

      if (!this.theme.iconDefinitions?.[folderId]) {
        if (folderId === 'folder-open') return { type: 'class', value: this.folderOpenClass };
        if (folderId === 'folder') return { type: 'class', value: this.defaultFolderClass };
      }
      return this.resolveIdToIcon(folderId, true, isOpen);
    }

    // 2. Exact filename match
    const fileNames = this.theme.fileNames || {};
    if (fileNames[lowerName]) return this.resolveIdToIcon(fileNames[lowerName]);

    // 3. Extension matching (multi-dot then single-dot)
    const exts = this.theme.fileExtensions || this.theme.extensions || {};
    const parts = lowerName.split('.');

    if (parts.length > 2) {
      const doubleExt = parts.slice(-2).join('.');
      if (exts[doubleExt]) return this.resolveIdToIcon(exts[doubleExt]);
    }

    const ext = parts.pop() || '';
    if (exts[ext]) return this.resolveIdToIcon(exts[ext]);
    if (exts['.' + ext]) return this.resolveIdToIcon(exts['.' + ext]);

    // 4. Language ID lookup
    const langIds = this.theme.languageIds || {};
    if (langIds[ext]) return this.resolveIdToIcon(langIds[ext]);

    // 5. Smart extension -> canonical language heuristic
    const smartMap: Record<string, string> = {
      js: 'javascript',
      mjs: 'javascript',
      cjs: 'javascript',
      jsx: 'javascriptreact',
      ts: 'typescript',
      mts: 'typescript',
      cts: 'typescript',
      tsx: 'typescriptreact',
      py: 'python',
      rb: 'ruby',
      html: 'html',
      css: 'css',
      scss: 'scss',
      json: 'json',
      md: 'markdown',
      sh: 'shellscript',
      bash: 'shellscript',
      yml: 'yaml',
      yaml: 'yaml',
      xml: 'xml',
      svg: 'svg',
      cpp: 'cpp',
      c: 'c',
      java: 'java',
      kt: 'kotlin',
      rs: 'rust',
      go: 'go',
    };

    const mappedLang = smartMap[ext];
    if (mappedLang) {
      if (langIds[mappedLang]) return this.resolveIdToIcon(langIds[mappedLang]);
      if (this.theme.iconDefinitions?.[mappedLang]) return this.resolveIdToIcon(mappedLang);
    }

    if (this.theme.iconDefinitions?.[ext]) {
      return this.resolveIdToIcon(ext);
    }

    // 6. Default file fallback
    const fileId = this.theme.file || 'file';
    if (!this.theme.iconDefinitions?.[fileId] && fileId === 'file') {
      return { type: 'class', value: this.defaultFileClass };
    }
    return this.resolveIdToIcon(fileId, false, false);
  }

  getLanguageIcon(langId: string): ResolvedIcon {
    const lowerLangId = langId.toLowerCase();
    const iconId = this.theme.languageIds?.[lowerLangId] || this.theme.file || 'file';
    if (!this.theme.iconDefinitions?.[iconId] && iconId === 'file') {
      return { type: 'class', value: this.defaultFileClass };
    }
    return this.resolveIdToIcon(iconId);
  }
}

export const fileIconRegistry = new IconThemeRegistry();
