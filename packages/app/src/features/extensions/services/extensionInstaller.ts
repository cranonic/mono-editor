// src/features/extensions/services/extensionInstaller.ts

import { Filesystem } from '@capacitor/filesystem';
import JSZip from 'jszip';
import { fs } from '@/core/fileSystem';
import type { Extension, ExtensionManifest } from '../types';
import { parseJSONC } from '@/utils/jsoncUtils';

// -------- helper is binary ? ---------
function isBinary(relativePath: string) {
  return /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|wasm)$/i.test(relativePath);
}

/**
 * Locate manifest.json(c) either at zip root or inside a single top-level directory
 * (e.g. when a user zips the `ts/` folder directly into `ts.msxt`).
 */
function findManifestEntry(zip: JSZip): { entry: JSZip.JSZipObject; stripPrefix: string } | null {
  const direct = zip.file('manifest.jsonc') || zip.file('manifest.json');
  if (direct) return { entry: direct, stripPrefix: '' };

  for (const [relPath, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const normalized = relPath.replace(/^\/+/, '');
    const parts = normalized.split('/');
    if (parts.length === 2 && (parts[1] === 'manifest.jsonc' || parts[1] === 'manifest.json')) {
      return { entry, stripPrefix: `${parts[0]}/` };
    }
  }
  return null;
}

/**
 * Parses and extracts a local, packaged application extension archive file (.msxt / .zip)
 * directly into the sandbox system storage layer.
 *
 * @param localFilePath Source path pointing to the compressed asset bundle location.
 * @returns Resolves with the populated extension metadata and its isolated target storage directory.
 */
export const installExtensionFromLocal = async (
  localFilePath: string
): Promise<{ manifest: Extension; storeDir: string }> => {
  try {
    let base64Data: string;
    try {
      const fileResult = await Filesystem.readFile({ path: localFilePath });
      base64Data = fileResult.data as string;
    } catch {
      base64Data = await fs.readFile(localFilePath);
    }

    const zip = await JSZip.loadAsync(base64Data, { base64: true });

    const found = findManifestEntry(zip);
    if (!found) {
      throw new Error('Invalid .msxt package: manifest.json(c) is missing.');
    }

    const manifestStr = await found.entry.async('string');
    const rawManifest = parseJSONC(manifestStr) as ExtensionManifest;

    const storeDir = `extensions/${rawManifest.id}`;
    const internalBasePath = `ms-storage://${storeDir}`;

    for (const [rawPath, zipEntry] of Object.entries(zip.files)) {
      if (zipEntry.dir) {
        continue;
      }
      const normalized = rawPath.replace(/^\/+/, '');
      if (found.stripPrefix && !normalized.startsWith(found.stripPrefix)) {
        continue;
      }
      const relativePath = found.stripPrefix
        ? normalized.slice(found.stripPrefix.length)
        : normalized;
      if (!relativePath || relativePath.includes('..')) {
        continue;
      }

      // image/font/wasm → base64 & code/json/md → string
      const fileContent = await zipEntry.async(isBinary(relativePath) ? 'base64' : 'string');
      await fs.writeFile(`${internalBasePath}/${relativePath}`, fileContent);
    }

    // Hydrate raw manifest fields with contextual structural flags for internal catalog processing
    const completeExtension: Extension = {
      ...rawManifest,
      storeDir,
      downloads: 0,
      rating: 0,
      isBuiltIn: false,
      isVerified: false,
      zipSize: 'Local',
    };

    return { manifest: completeExtension, storeDir };
  } catch (error: any) {
    throw new Error(`Failed to install extension: ${error.message}`);
  }
};

/**
 * Fetches a remote compressed distribution package over the network, streams the binary data buffer 
 * into memory, and inflates the file records to the sandbox storage layer.
 *
 * @param extension Targeted package entry record structure holding cloud catalog metadata records.
 * @returns Target structural subdirectory folder location path mapping.
 */
export const installExtensionFromCloud = async (extension: Extension): Promise<string> => {
  try {
    if (!extension.fileUrl) {
      throw new Error('Download URL is missing for this extension.');
    }

    const response = await fetch(extension.fileUrl);
    if (!response.ok) {
      throw new Error(`Failed to download from server. Status: ${response.status}`);
    }

    const blob = await response.blob();
    const zip = await JSZip.loadAsync(blob);

    const storeDir = `extensions/${extension.id}`;
    const internalBasePath = `ms-storage://${storeDir}`;

    for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
      if (zipEntry.dir) {
        continue; 
      }
      
      let fileContent = await zipEntry.async(isBinary(relativePath) ? 'base64' : 'string');
      
      if (relativePath === 'manifest.json' || relativePath === 'manifest.jsonc') {
        try {
          const parsedManifest = parseJSONC(fileContent) as any;
          
          parsedManifest.id = extension.id; // Force ID to be 'user-xxx.code-runner'
          
          // Convert back to string to save in filesystem
          fileContent = JSON.stringify(parsedManifest, null, 2);
        } catch (parseError) {
          console.warn(`[Installer] Failed to patch manifest ID for ${extension.id}`, parseError);
        }
      }

      await fs.writeFile(`${internalBasePath}/${relativePath}`, fileContent);
    }

    return storeDir;

  } catch (error: any) {
    console.error('Cloud Installation Error:', error);
    throw new Error(`Failed to install from cloud: ${error.message}`);
  }
};