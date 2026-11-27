// src/ui/components/FileIcon/DefaultIconTheme.tsx
// Renders File & Folder icons from TTF/WOFF font themes (built-in & extensions)
// as well as image-based (SVG/PNG) extension themes via ms-storage:// or HTTP URLs.

import React, { useState, useEffect } from 'react';
import { fileIconRegistry } from '@/core/extensionAPI/registry/FileIconRegistry';
import { setiFileIconTheme } from '@/core/theme/fileIcons/setiThemeData';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { fs } from '@/core/fileSystem';
import './FileIconTheme.css';

// Seed default TTF/WOFF theme immediately before first render
if (fileIconRegistry.getVersion() === 0) {
  fileIconRegistry.loadIconTheme(setiFileIconTheme);
}

const iconCache = new Map<string, string>();

export interface FileIconProps {
  /** Name of the target file or folder including extension (e.g., `'package.json'`, `'index.ts'`). */
  name: string;
  /** Flag forcing the layout resolver to search within the folder taxonomy instead of flat files. */
  isDir: boolean;
  /** Optional state indicator to alternate between `'open'` and `'closed'` folder glyph graphics. */
  isOpen?: boolean;
}

export const FileIcon: React.FC<FileIconProps> = ({ name, isDir, isOpen }) => {
  // Re-render when setting changes or when registry hot-swaps themes/fonts
  useSettingsStore((s) => s.settings['workbench.iconTheme']);
  const [, setRegVersion] = useState(() => fileIconRegistry.getVersion());

  useEffect(() => {
    return fileIconRegistry.subscribe(() => {
      setRegVersion(fileIconRegistry.getVersion());
    });
  }, []);

  const icon = fileIconRegistry.getFileIcon(name, isDir, isOpen);
  const [imgSrc, setImgSrc] = useState<string | null>(null);

  const imagePath = icon.type === 'image' ? icon.value : '';

  useEffect(() => {
    let isMounted = true;

    if (!imagePath) {
      setImgSrc(null);
      return;
    }

    if (imagePath.startsWith('ms-storage://')) {
      if (iconCache.has(imagePath)) {
        setImgSrc(iconCache.get(imagePath)!);
        return;
      }

      fs.readFile(imagePath)
        .then((content) => {
          if (!isMounted) return;
          const dataUri = imagePath.endsWith('.svg')
            ? `data:image/svg+xml;utf8,${encodeURIComponent(content)}`
            : content.startsWith('data:')
              ? content
              : `data:image/png;base64,${content}`;
          iconCache.set(imagePath, dataUri);
          setImgSrc(dataUri);
        })
        .catch((err) => {
          console.error(`[FileIcon] Failed to load extension icon asset: ${imagePath}`, err);
        });
    } else {
      setImgSrc(imagePath);
    }

    return () => {
      isMounted = false;
    };
  }, [imagePath]);

  // 1. TTF / WOFF Font Glyph Renderer (default for all 4 built-in themes + font extensions)
  if (icon.type === 'font') {
    return (
      <span
        className="ms-file-icon-glyph"
        aria-hidden="true"
        style={{
          fontFamily: icon.fontFamily,
          color: icon.color || 'inherit',
          fontSize: icon.fontSize || '16px',
          fontWeight: icon.fontWeight || 'normal',
          fontStyle: icon.fontStyle || 'normal',
        }}
      >
        {icon.character}
      </span>
    );
  }

  // 2. Image Renderer (SVG/PNG extension file icon themes)
  if (icon.type === 'image') {
    if (!imgSrc) {
      const fallbackClass = isDir
        ? isOpen
          ? 'ms-icon-default-folder-open'
          : 'ms-icon-default-folder'
        : 'ms-icon-default-file';
      return <div className={`ms-file-icon ${fallbackClass}`} style={{ width: 16, height: 16 }} />;
    }

    return (
      <img
        src={imgSrc}
        alt={name}
        className="ms-file-icon-img"
        style={{ width: 16, height: 16, objectFit: 'contain', flexShrink: 0, display: 'inline-block' }}
      />
    );
  }

  // 3. CSS class fallback
  return <div className={`ms-file-icon ${icon.value}`} style={{ width: 16, height: 16 }} />;
};