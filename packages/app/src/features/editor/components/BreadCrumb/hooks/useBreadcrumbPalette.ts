import { useEffect, useState } from 'react';
import { getActivePickerPalette, monoThemeService, type PickerPalette } from '@mono/editor';

/**
 * Palette of the breadcrumb bar icons and picker, derived from the active colour theme
 * (the same `symbolIcon.*Foreground` / `editorSuggestWidget.*` keys the completion list uses).
 * Re-resolves whenever the colour theme changes.
 */
export function useBreadcrumbPalette(): PickerPalette {
  const [palette, setPalette] = useState<PickerPalette>(() => getActivePickerPalette());

  useEffect(() => {
    setPalette(getActivePickerPalette());
    const sub = monoThemeService.onDidChangeColorTheme(() => {
      setPalette(getActivePickerPalette());
    });
    return () => sub.dispose();
  }, []);

  return palette;
}
