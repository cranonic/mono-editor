// src/core/theme/service/productIconThemeService.ts
// Manages built-in & extension-contributed Product (App) Icon Themes.

import {
  productIconRegistry,
  type ProductIconThemeMap,
} from '@/core/extensionAPI/registry/ProductIconRegistry';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { configRegistry } from '@/core/extensionAPI/registry/configurationRegistry';
import { msEvents } from '@/core/extensionAPI/events/EventManager';
import {
  codiconsProductIconTheme,
  lucideProductIconTheme,
  remixProductIconTheme,
} from '../productIcons/builtinProductIconThemes';

export interface ProductIconThemeDefinition {
  id: string;
  name: string;
  themeMap: ProductIconThemeMap;
  source?: 'builtin' | 'extension';
}

const DEFAULT_PRODUCT_ICON_THEME_ID = 'mscode-codicons';
const BUILTIN_IDS = new Set(['mscode-codicons', 'mscode-lucide', 'mscode-remix']);

class ProductIconThemeService {
  private registry = new Map<string, ProductIconThemeDefinition>();
  private activeId = DEFAULT_PRODUCT_ICON_THEME_ID;
  private pendingThemeId: string | null = null;
  private settingsSubscribed = false;

  constructor() {
    this.registry.set('mscode-codicons', {
      id: 'mscode-codicons',
      name: 'Codicons (Default TTF)',
      themeMap: codiconsProductIconTheme,
      source: 'builtin',
    });
    this.registry.set('mscode-lucide', {
      id: 'mscode-lucide',
      name: 'Lucide (Minimal TTF)',
      themeMap: lucideProductIconTheme,
      source: 'builtin',
    });
    this.registry.set('mscode-remix', {
      id: 'mscode-remix',
      name: 'Remix (Modern TTF)',
      themeMap: remixProductIconTheme,
      source: 'builtin',
    });
  }

  public init(): void {
    this._updateSettingsOptions();

    if (!this.settingsSubscribed) {
      this.settingsSubscribed = true;
      useSettingsStore.subscribe((state: any) => {
        const nextId = state.settings['workbench.productIconTheme'];
        if (nextId && nextId !== this.activeId && this.registry.has(nextId)) {
          this.applyTheme(nextId, false);
        }
      });
    }

    const savedId = useSettingsStore.getState().settings['workbench.productIconTheme'];
    if (savedId && !this.registry.has(savedId)) {
      this.pendingThemeId = savedId;
      this.applyTheme(DEFAULT_PRODUCT_ICON_THEME_ID, false);
    } else {
      this.applyTheme(savedId || DEFAULT_PRODUCT_ICON_THEME_ID, false);
    }
  }

  public applyTheme(id: string, persist = true): void {
    const theme = this.registry.get(id) || this.registry.get(DEFAULT_PRODUCT_ICON_THEME_ID);
    if (!theme) return;

    this.activeId = theme.id;
    productIconRegistry.loadProductIconTheme(theme.themeMap);

    if (persist) {
      useSettingsStore.getState().updateSetting('workbench.productIconTheme', theme.id);
    }

    msEvents.emit('onDidChangeProductIconTheme', theme.id);
  }

  public registerProductIconTheme(def: ProductIconThemeDefinition): void {
    this.registry.set(def.id, { ...def, source: def.source ?? 'extension' });
    this._updateSettingsOptions();

    if (this.pendingThemeId === def.id || this.activeId === def.id) {
      this.applyTheme(def.id, false);
      this.pendingThemeId = null;
    }
  }

  public unregisterProductIconTheme(id: string): void {
    if (BUILTIN_IDS.has(id)) return;
    this.registry.delete(id);
    this._updateSettingsOptions();

    if (this.activeId === id) {
      this.applyTheme(DEFAULT_PRODUCT_ICON_THEME_ID);
    }
  }

  public getAllThemes(): ProductIconThemeDefinition[] {
    return Array.from(this.registry.values());
  }

  public getActiveThemeId(): string {
    return this.activeId;
  }

  private _updateSettingsOptions(): void {
    configRegistry.registerConfiguration({
      id: 'workbench_product_icon_theme_update',
      title: 'Workbench',
      properties: {
        'workbench.productIconTheme': {
          title: 'Product Icon Theme',
          category: 'Workbench',
          subCategory: 'Appearance',
          type: 'select',
          defaultValue: DEFAULT_PRODUCT_ICON_THEME_ID,
          markdownDescription:
            'Specifies the product (app UI) icon theme used across the activity bar, menus, toolbars, and panels.\n\n> **Tip:** Extensions can also contribute custom TTF/WOFF or SVG product icon themes via `contributes.productIconThemes` or `mscode.themes.productIcon`.',
          options: this.getAllThemes().map((t) => ({ label: t.name, value: t.id })),
        },
      },
    });
  }
}

export const productIconThemeService = new ProductIconThemeService();
