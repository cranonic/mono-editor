// src/features/extensions/services/extensionLoader.ts
import { fs } from '@/core/fileSystem';
import { parseJSONC } from '@/utils/jsoncUtils';
import {
  isBuiltinStoreDir,
  loadBuiltinJson,
  loadBuiltinIcon,
} from '../builtin/builtinExtensions';

export const loadExtensionJsonSafely = async (storeDir: string, fileName: string) => {
  if (isBuiltinStoreDir(storeDir)) {
    const data = loadBuiltinJson(storeDir, fileName);
    if (data !== undefined) return data;
    throw new Error(`Built-in asset not found: ${fileName} in ${storeDir}`);
  }

  const targetPath = (storeDir.startsWith('/') || storeDir.startsWith('file://'))
    ? `${storeDir}/${fileName}`
    : `ms-storage://${storeDir}/${fileName}`;

  try {
    const fileContent = await fs.readFile(targetPath);

    if (!fileContent || fileContent.trim() === '') {
      throw new Error(`Empty file: ${fileName}`);
    }

    return parseJSONC(fileContent);
  } catch (error: any) {
    console.error(`❌ [ExtensionLoader] Failed to load '${fileName}' from '${storeDir}'`);
    throw error;
  }
};

/**
 * Loads an image from the virtual file system safely as a Blob URL (or bundled URL for built-ins).
 */
export const loadExtensionIconSafely = async (storeDir: string, iconPath: string): Promise<string> => {
  if (!iconPath) return '';

  if (isBuiltinStoreDir(storeDir)) {
    return loadBuiltinIcon(storeDir) || iconPath;
  }

  const targetPath = (storeDir.startsWith('/') || storeDir.startsWith('file://'))
    ? `${storeDir}/${iconPath}`
    : `ms-storage://${storeDir}/${iconPath}`;

  try {
    const fileData = await fs.readFile(targetPath);

    const ext = iconPath.split('.').pop()?.toLowerCase();
    const mimeType = ext === 'svg' ? 'image/svg+xml' : `image/${ext || 'png'}`;

    const blob = new Blob([fileData], { type: mimeType });

    return URL.createObjectURL(blob);
  } catch (error) {
    console.error(`❌ [ExtensionLoader] Failed to load icon: '${targetPath}'`, error);
    return '/assets/default-extension-icon.png';
  }
};

/**
 * Manifest Loader
 * Resolves the manifest file, prioritizing 'manifest.jsonc' over 'manifest.json'.
 */
export const loadManifestSafely = async (storeDir: string) => {
  if (isBuiltinStoreDir(storeDir)) {
    const data = loadBuiltinJson(storeDir, 'manifest.json');
    if (data !== undefined) return data;
  }
  try {
    return await loadExtensionJsonSafely(storeDir, 'manifest.jsonc');
  } catch {
    return await loadExtensionJsonSafely(storeDir, 'manifest.json');
  }
};