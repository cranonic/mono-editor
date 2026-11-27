// src/core/theme/service/iconThemeService.ts
// Manages 4 built-in TTF/WOFF File Icon Themes + dynamic extension-contributed file icon themes.

import { fileIconRegistry, type IconThemeMap } from '@/core/extensionAPI/registry/FileIconRegistry';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { configRegistry } from '@/core/extensionAPI/registry/configurationRegistry';
import { msEvents } from '@/core/extensionAPI/events/EventManager';
import { setiFileIconTheme } from '../fileIcons/setiThemeData';
import { deviconFileIconTheme } from '../fileIcons/deviconThemeData';
import {
  monoVividFileIconTheme,
  monoMinimalFileIconTheme,
} from '../fileIcons/codiconFileIconThemes';

export interface IconThemeDefinition {
  id: string;
  name: string;
  themeMap: Partial<IconThemeMap>;
  source?: 'builtin' | 'extension';
}

const DEFAULT_ICON_THEME_ID = 'mscode-icons';
const BUILTIN_IDS = new Set(['mscode-icons', 'mono-devicon', 'mono-vivid', 'mono-minimal']);

class IconThemeService {
  private registry = new Map<string, IconThemeDefinition>();
  private activeId = DEFAULT_ICON_THEME_ID;
  private pendingThemeId: string | null = null;
  private settingsSubscribed = false;

  constructor() {
    this.registry.set('mscode-icons', {
      id: 'mscode-icons',
      name: 'Seti (Mono Default)',
      themeMap: setiFileIconTheme,
      source: 'builtin',
    });
    this.registry.set('mono-devicon', {
      id: 'mono-devicon',
      name: 'Devicon (Vibrant TTF)',
      themeMap: deviconFileIconTheme,
      source: 'builtin',
    });
    this.registry.set('mono-vivid', {
      id: 'mono-vivid',
      name: 'Mono Vivid (Codicons Color TTF)',
      themeMap: monoVividFileIconTheme,
      source: 'builtin',
    });
    this.registry.set('mono-minimal', {
      id: 'mono-minimal',
      name: 'Minimal (Codicons Monochrome TTF)',
      themeMap: monoMinimalFileIconTheme,
      source: 'builtin',
    });
  }

  public init() {
    this._updateSettingsOptions();

    if (!this.settingsSubscribed) {
      this.settingsSubscribed = true;
      useSettingsStore.subscribe((state: any) => {
        const nextId = state.settings['workbench.iconTheme'];
        if (nextId && nextId !== this.activeId && this.registry.has(nextId)) {
          this.applyTheme(nextId, false);
        }
      });
    }

    const savedId = useSettingsStore.getState().settings['workbench.iconTheme'];
    if (savedId && !this.registry.has(savedId)) {
      this.pendingThemeId = savedId;
      this.applyTheme(DEFAULT_ICON_THEME_ID, false);
    } else {
      this.applyTheme(savedId || DEFAULT_ICON_THEME_ID, false);
    }
  }

  public applyTheme(id: string, persist = true) {
    const theme = this.registry.get(id) || this.registry.get(DEFAULT_ICON_THEME_ID);
    if (!theme) return;

    this.activeId = theme.id;
    fileIconRegistry.loadIconTheme(theme.themeMap as IconThemeMap);
    if (persist) {
      useSettingsStore.getState().updateSetting('workbench.iconTheme', theme.id);
    }

    msEvents.emit('onDidChangeIconTheme', theme.id);
  }

  public registerIconTheme(def: IconThemeDefinition) {
    this.registry.set(def.id, { ...def, source: def.source ?? 'extension' });
    this._updateSettingsOptions();

    if (this.pendingThemeId === def.id || this.activeId === def.id) {
      this.applyTheme(def.id, false);
      this.pendingThemeId = null;
    }
  }

  public unregisterIconTheme(id: string) {
    if (BUILTIN_IDS.has(id)) return; // Protect all built-in TTF themes

    this.registry.delete(id);
    this._updateSettingsOptions();

    if (this.activeId === id) {
      this.applyTheme(DEFAULT_ICON_THEME_ID);
    }
  }

  public getAllThemes() {
    return Array.from(this.registry.values());
  }

  public getActiveThemeId(): string {
    return this.activeId;
  }

  private _updateSettingsOptions() {
    configRegistry.registerConfiguration({
      id: 'workbench_icon_theme_update',
      title: 'Workbench',
      properties: {
        'workbench.iconTheme': {
          title: 'File Icon Theme',
          category: 'Workbench',
          subCategory: 'Appearance',
          type: 'select',
          defaultValue: DEFAULT_ICON_THEME_ID,
          markdownDescription:
            'Specifies the file icon theme used in the file explorer, breadcrumbs, and editor tabs. Built-in themes use local TTF/WOFF icon fonts; extensions can contribute additional TTF or SVG icon themes.',
          options: this.getAllThemes().map((t) => ({ label: t.name, value: t.id })),
        },
      },
    });
  }
}

export const iconThemeService = new IconThemeService();