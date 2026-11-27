// src/core/extensionAPI/modules/themesModule.ts

import { themeService } from '@/core/theme/service/themeService';
import { useThemeStore } from '@/core/theme/store/themeStore';
import type { ThemeDefinition } from '@/core/theme/types';

import { iconThemeService, type IconThemeDefinition } from '@/core/theme/service/iconThemeService';
import { fileIconRegistry } from '@/core/extensionAPI/registry/FileIconRegistry';

import {
  productIconThemeService,
  type ProductIconThemeDefinition,
} from '@/core/theme/service/productIconThemeService';
import { productIconRegistry } from '@/core/extensionAPI/registry/ProductIconRegistry';

import { msEvents } from '@/core/extensionAPI/events/EventManager';

/**
 * ## Mono Studio Theme Extension API
 * Exposes Color Themes, File Icon Themes, and Product (App) Icon Themes to extensions.
 */
export const createThemesModule = (extId: string) => ({
  // COLOR THEMES API
  color: {
    register: (def: ThemeDefinition) => {
      const disposable = themeService.registerTheme(def, extId);
      useThemeStore.getState().sync();
      return disposable;
    },

    registerFromJson: (json: string | object) => {
      const parsed = typeof json === 'string' ? JSON.parse(json) : json;
      const disposable = themeService.registerFromJson(parsed, extId);
      useThemeStore.getState().sync();
      return disposable;
    },

    getActiveThemeId: () => themeService.getActiveThemeId(),

    setTheme: (id: string) => useThemeStore.getState().setTheme(id),

    getAll: () => themeService.getAllThemes(),

    onDidChangeColorTheme: (callback: (themeId: string) => void) => {
      return msEvents.on('onDidChangeColorTheme', callback);
    },
  },

  // FILE ICON THEMES API
  icon: {
    register: (def: IconThemeDefinition) => {
      iconThemeService.registerIconTheme(def);
      return { dispose: () => iconThemeService.unregisterIconTheme(def.id) };
    },

    registerFromJson: (json: string | object) => {
      const parsed = typeof json === 'string' ? JSON.parse(json) : json;
      const def = parsed as IconThemeDefinition;
      iconThemeService.registerIconTheme(def);
      return { dispose: () => iconThemeService.unregisterIconTheme(def.id) };
    },

    getActiveThemeId: () => iconThemeService.getActiveThemeId(),

    setTheme: (id: string) => iconThemeService.applyTheme(id),

    getAll: () => iconThemeService.getAllThemes(),

    getFileIcon: (fileName: string, isDirectory: boolean, isOpen: boolean = false) => {
      return fileIconRegistry.getFileIcon(fileName, isDirectory, isOpen);
    },

    getLanguageIcon: (langId: string) => {
      return fileIconRegistry.getLanguageIcon(langId);
    },

    onDidChangeIconTheme: (callback: (themeId: string) => void) => {
      return { dispose: msEvents.on('onDidChangeIconTheme', callback) };
    },
  },

  // PRODUCT (APP) ICON THEMES API
  productIcon: {
    /**
     * Registers a custom Product (App) Icon Theme backed by TTF/WOFF fonts or SVG/PNG assets.
     */
    register: (def: ProductIconThemeDefinition) => {
      productIconThemeService.registerProductIconTheme(def);
      return { dispose: () => productIconThemeService.unregisterProductIconTheme(def.id) };
    },

    /**
     * Registers a Product Icon Theme from a raw JSON string or object.
     */
    registerFromJson: (json: string | object) => {
      const parsed = typeof json === 'string' ? JSON.parse(json) : json;
      const def = parsed as ProductIconThemeDefinition;
      productIconThemeService.registerProductIconTheme(def);
      return { dispose: () => productIconThemeService.unregisterProductIconTheme(def.id) };
    },

    /** Returns the active Product Icon Theme ID. */
    getActiveThemeId: () => productIconThemeService.getActiveThemeId(),

    /** Switches the application UI to a registered Product Icon Theme. */
    setTheme: (id: string) => productIconThemeService.applyTheme(id),

    /** Lists all built-in and extension-contributed Product Icon Themes. */
    getAll: () => productIconThemeService.getAllThemes(),

    /** Resolves a semantic app icon token against the active Product Icon Theme. */
    getIcon: (name: string) => productIconRegistry.getIcon(name),

    /** Fires whenever the active Product Icon Theme changes. */
    onDidChangeProductIconTheme: (callback: (themeId: string) => void) => {
      return { dispose: msEvents.on('onDidChangeProductIconTheme', callback) };
    },
  },
});

export type ThemesModule = ReturnType<typeof createThemesModule>;