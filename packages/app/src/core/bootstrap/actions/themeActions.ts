// src/core/bootstrap/actions/themeActions.ts
import { commands } from '@/core/extensionAPI/registry/commandRegistry';
import { usePaletteStore } from '@/store/paletteStore';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { themeService } from '@/core/theme/service/themeService';
import { iconThemeService } from '@/core/theme/service/iconThemeService';
import { productIconThemeService } from '@/core/theme/service/productIconThemeService';
import { notifyThemeChanged } from '@/core/native/statusBarSync';

export function registerThemeActions(): void {
  commands.registerCommand(
    'workbench.action.selectTheme',
    () => {
      const activeThemeId = themeService.getActiveThemeId();
      const items = themeService.getAllThemes().map((t) => ({
        id: t.definition.id,
        label: t.definition.name,
        suffix: t.definition.id === activeThemeId ? ' - configured color theme' : undefined,
        rightIcon: t.definition.id === activeThemeId ? 'check' : undefined,
        onSelect: () => {
          themeService.applyTheme(t.definition.id);
          notifyThemeChanged();
        },
      }));
      usePaletteStore.getState().openQuickPick('Select Color Theme', items, (sel) => sel.onSelect?.());
    },
    { title: 'Preferences: Color Theme', category: 'Preferences', icon: 'symbol-color' },
  );

  commands.registerCommand(
    'workbench.action.selectIconTheme',
    () => {
      const activeIconId =
        useSettingsStore.getState().settings['workbench.iconTheme'] || 'mscode-icons';
      const items = iconThemeService.getAllThemes().map((t) => ({
        id: t.id,
        label: t.name,
        suffix: t.id === activeIconId ? ' - configured file icon theme' : undefined,
        rightIcon: t.id === activeIconId ? 'check' : undefined,
        onSelect: () => iconThemeService.applyTheme(t.id),
      }));
      usePaletteStore.getState().openQuickPick('Select File Icon Theme', items, (sel) => sel.onSelect?.());
    },
    { title: 'Preferences: File Icon Theme', category: 'Preferences', icon: 'files' },
  );

  commands.registerCommand(
    'workbench.action.selectProductIconTheme',
    () => {
      const activeProdId =
        useSettingsStore.getState().settings['workbench.productIconTheme'] || 'mscode-codicons';
      const items = productIconThemeService.getAllThemes().map((t) => ({
        id: t.id,
        label: t.name,
        suffix: t.id === activeProdId ? ' - configured product icon theme' : undefined,
        rightIcon: t.id === activeProdId ? 'check' : undefined,
        onSelect: () => productIconThemeService.applyTheme(t.id),
      }));
      usePaletteStore.getState().openQuickPick('Select Product Icon Theme', items, (sel) => sel.onSelect?.());
    },
    { title: 'Preferences: Product Icon Theme', category: 'Preferences', icon: 'symbol-property' },
  );
}
