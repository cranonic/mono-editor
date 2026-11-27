// src/features/editor/components/BreadCrumb/pathProvider.ts
import type { IBreadcrumbItem, IBreadcrumbsPathProvider } from '@mono/editor';
import { fs } from '@/core/fileSystem';
import { useExplorerStore } from '@/features/explorer/store/exploreStore';
import { useTabStore } from '@/store/tabStore';
import { detectMediaMode } from '@/core/media/mediaKinds';

function normalizePath(p: string): string {
  if (!p) return '';
  const stripped = p.startsWith('file://') ? p.slice(7) : p;
  return stripped.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
}

function parentDirOf(p: string): string {
  const norm = normalizePath(p);
  const idx = norm.lastIndexOf('/');
  if (idx <= 0) return '/';
  return norm.slice(0, idx);
}

/** Reads sorted directory children (folders first, then files alphabetically) as breadcrumb items. */
export async function readBreadcrumbDirectory(dirPath: string): Promise<IBreadcrumbItem[]> {
  try {
    const entries = await fs.readDir(dirPath);
    if (!Array.isArray(entries)) return [];
    const sorted = [...entries].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    return sorted.map((entry) => ({
      id: `path:${entry.path}`,
      kind: entry.isDirectory ? 'folder' : 'file',
      label: entry.name,
      uri: entry.path,
      path: entry.path,
      isDirectory: entry.isDirectory,
    }));
  } catch {
    return [];
  }
}

/**
 * Builds an `IBreadcrumbsPathProvider` wired to MSCode's virtual/native FS,
 * explorer workspace root, and tab manager.
 */
export function createAppBreadcrumbsPathProvider(fallbackFilePath: string): IBreadcrumbsPathProvider {
  return {
    getPath(uri: string): IBreadcrumbItem[] {
      const raw = uri && !uri.startsWith('inmemory:') ? uri : fallbackFilePath;
      const fullPath = normalizePath(raw);
      if (!fullPath) return [];

      const wsRootRaw = useExplorerStore.getState().workspacePath;
      const wsRoot = wsRootRaw ? normalizePath(wsRootRaw) : '';

      let relPath = fullPath;
      let prefixBase = '';
      if (wsRoot && wsRoot !== '/' && (fullPath === wsRoot || fullPath.startsWith(wsRoot + '/'))) {
        relPath = fullPath.slice(wsRoot.length).replace(/^\/+/, '');
        prefixBase = wsRoot;
      } else {
        relPath = fullPath.replace(/^\/+/, '');
        prefixBase = '';
      }

      const parts = relPath.split('/').filter(Boolean);
      if (parts.length === 0) {
        return [
          {
            id: `path:${fullPath}`,
            kind: 'file',
            label: fullPath,
            uri: fullPath,
            path: fullPath,
            isDirectory: false,
          },
        ];
      }

      const items: IBreadcrumbItem[] = [];
      let accum = prefixBase;
      for (let i = 0; i < parts.length; i++) {
        const seg = parts[i]!;
        accum = accum ? `${accum}/${seg}` : `/${seg}`;
        const isLast = i === parts.length - 1;
        items.push({
          id: `path:${accum}`,
          kind: isLast ? 'file' : 'folder',
          label: seg,
          uri: accum,
          path: accum,
          isDirectory: !isLast,
        });
      }
      return items;
    },

    async getSiblings(item: IBreadcrumbItem): Promise<IBreadcrumbItem[]> {
      const target = item.path || item.uri || fallbackFilePath;
      if (!target) return [];
      const dir = parentDirOf(target);
      return readBreadcrumbDirectory(dir);
    },

    openItem(item: IBreadcrumbItem): void {
      if (item.isDirectory || item.kind === 'folder') return;
      const path = item.path || item.uri;
      if (!path) return;
      const isMedia = detectMediaMode(path) !== 'unknown';
      useTabStore.getState().addTab({
        id: path,
        type: 'code',
        title: item.label || path.split('/').pop() || path,
        filePath: path,
        ...(isMedia ? { showStatusBar: false, showBreadcrumb: false } : {}),
      });
    },
  };
}
