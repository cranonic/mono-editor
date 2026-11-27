// src/ui/components/Icon/IconRegistry.tsx
// Universal Product (App) Icon renderer backed by ProductIconRegistry.
// Dynamically switches across built-in TTF Product Icon Themes (Codicons, Lucide, Remix)
// and extension-contributed Product Icon Themes (TTF/WOFF fonts or SVG/PNG assets).

import React, { useEffect, useState } from 'react';
import { productIconRegistry } from '@/core/extensionAPI/registry/ProductIconRegistry';
import { codiconsProductIconTheme } from '@/core/theme/productIcons/builtinProductIconThemes';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { fs } from '@/core/fileSystem';

// Ensure default local TTF Product Icon Theme is loaded immediately before first paint
if (productIconRegistry.getVersion() === 0) {
  productIconRegistry.loadProductIconTheme(codiconsProductIconTheme);
}

const productIconImgCache = new Map<string, string>();

/**
 * Pre-registered semantic identity tokens used across the MS Code / Mono Studio UI.
 */
export type IconName =
  | 'files' | 'search' | 'settings' | 'close' | 'menu' | 'more' | 'more-vertical'
  | 'chevron-up' | 'chevron-down' | 'chevron-right' | 'chevron-left'
  | 'check' | 'refresh' | 'clear-all' | 'collapse-all'
  | 'case-sensitive' | 'whole-word' | 'regex'
  | 'replace' | 'replace-all'
  | 'new-file' | 'new-folder' | 'filter'
  | 'arrow-left' | 'arrow-up' | 'arrow-down' | 'arrow-right'
  | 'file' | 'folder' | 'folder-android' | 'folder-active' | 'folder-linux'
  | 'info' | 'keyboard' | 'undo' | 'redo' | 'save';

export interface IconProps {
  /**
   * Name of the target icon:
   * 1. Semantic product icon token resolved through the active Product Icon Theme.
   * 2. Direct HTTP/HTTPS URL or Base64 DataURI.
   * 3. Codicon fallback string if unmapped in the active theme.
   */
  name: IconName | string;
  size?: number;
  color?: string;
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
  style?: React.CSSProperties;
  title?: string;
}

export const Icon: React.FC<IconProps> = ({
  name,
  size = 16,
  color,
  className = '',
  onClick,
  style,
  title,
}) => {
  // React to product icon theme changes (Settings, Command Palette, or Extension registration)
  useSettingsStore((s) => s.settings['workbench.productIconTheme']);
  const [, setRegVersion] = useState(() => productIconRegistry.getVersion());

  useEffect(() => {
    return productIconRegistry.subscribe(() => {
      setRegVersion(productIconRegistry.getVersion());
    });
  }, []);

  const isDirectUrl =
    typeof name === 'string' &&
    (name.startsWith('http://') || name.startsWith('https://') || name.startsWith('data:'));

  const resolved = !isDirectUrl ? productIconRegistry.getIcon(String(name)) : null;
  const imgAssetPath = resolved?.type === 'image' ? resolved.value : '';
  const [resolvedImgSrc, setResolvedImgSrc] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!imgAssetPath) {
      setResolvedImgSrc(null);
      return;
    }

    if (imgAssetPath.startsWith('ms-storage://')) {
      if (productIconImgCache.has(imgAssetPath)) {
        setResolvedImgSrc(productIconImgCache.get(imgAssetPath)!);
        return;
      }
      fs.readFile(imgAssetPath)
        .then((content) => {
          if (!active) return;
          const dataUri = imgAssetPath.endsWith('.svg')
            ? `data:image/svg+xml;utf8,${encodeURIComponent(content)}`
            : content.startsWith('data:')
              ? content
              : `data:image/png;base64,${content}`;
          productIconImgCache.set(imgAssetPath, dataUri);
          setResolvedImgSrc(dataUri);
        })
        .catch((err) => {
          console.error(`[Icon] Failed to load extension product icon: ${imgAssetPath}`, err);
        });
    } else {
      setResolvedImgSrc(imgAssetPath);
    }

    return () => {
      active = false;
    };
  }, [imgAssetPath]);

  // ── 1. Direct URL / DataURI Image ────────────────────────────────────────
  if (isDirectUrl) {
    return (
      <span
        className={`ms-icon ms-img-icon ${className}`}
        onClick={onClick}
        title={title}
        style={{
          width: size,
          height: size,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          ...style,
        }}
      >
        <img
          src={name}
          alt={title ?? ''}
          draggable={false}
          style={{
            width: size,
            height: size,
            objectFit: 'contain',
            borderRadius: '2px',
            opacity: color ? undefined : 1,
          }}
        />
      </span>
    );
  }

  // ── 2. Active Product Icon Theme: TTF / WOFF Font Glyph ──────────────────
  if (resolved?.type === 'font') {
    return (
      <span
        className={`ms-icon ms-product-icon-glyph ${className}`}
        onClick={onClick}
        title={title}
        aria-hidden={title ? undefined : true}
        style={{
          fontFamily: resolved.fontFamily,
          fontSize: resolved.fontSize || `${size}px`,
          fontWeight: resolved.fontWeight || 'normal',
          fontStyle: resolved.fontStyle || 'normal',
          width: size,
          height: size,
          lineHeight: 1,
          color: color || resolved.color || 'inherit',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          userSelect: 'none',
          WebkitFontSmoothing: 'antialiased',
          ...style,
        }}
      >
        {resolved.character}
      </span>
    );
  }

  // ── 3. Active Product Icon Theme: Extension Image (SVG / PNG) ────────────
  if (resolved?.type === 'image') {
    return (
      <span
        className={`ms-icon ms-img-icon ${className}`}
        onClick={onClick}
        title={title}
        style={{
          width: size,
          height: size,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          ...style,
        }}
      >
        {resolvedImgSrc && (
          <img
            src={resolvedImgSrc}
            alt={title ?? ''}
            draggable={false}
            style={{
              width: size,
              height: size,
              objectFit: 'contain',
            }}
          />
        )}
      </span>
    );
  }

  // ── 4. Active Product Icon Theme: Inline SVG String ──────────────────────
  if (resolved?.type === 'svg') {
    const svgDataUri = `data:image/svg+xml;utf8,${encodeURIComponent(resolved.value)}`;
    return (
      <span
        className={`ms-icon ms-svg-icon ${className}`}
        onClick={onClick}
        title={title}
        style={{
          width: size,
          height: size,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          ...style,
        }}
      >
        <img
          src={svgDataUri}
          alt={title ?? ''}
          draggable={false}
          style={{ width: size, height: size, objectFit: 'contain' }}
        />
      </span>
    );
  }

  // ── 5. Codicon Universal Safe Fallback ───────────────────────────────────
  const fallbackName = resolved?.type === 'codicon' ? resolved.name : String(name);
  return (
    <i
      className={`codicon codicon-${fallbackName} ${className}`}
      onClick={onClick}
      title={title}
      style={{
        fontSize: `${size}px`,
        color: color || 'inherit',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...style,
      }}
    />
  );
};