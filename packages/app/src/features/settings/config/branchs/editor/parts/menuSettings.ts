// src/features/settings/config/branchs/editor/parts/menuSettings.ts
import type { IConfigurationSection } from '@/core/extensionAPI/registry/configurationRegistry';

export const menuProperties: IConfigurationSection['properties'] = {
  // ── Native Mono Editor Context Menu API ──────────────────────────────────

  'editor.contextMenu.enabled': {
    title: 'Context Menu Enabled',
    type: 'boolean',
    defaultValue: true,
    order: 140,
    subCategory: 'Context Menu > Editor',
    tags: ['menu', 'context', 'mono'],
    description: 'Controls whether the native Mono Editor context menu is enabled.',
  },

  'editor.contextMenu.type': {
    title: 'Context Menu Layout',
    type: 'select',
    defaultValue: 'horizontal',
    order: 141,
    subCategory: 'Context Menu > Editor',
    tags: ['menu', 'context', 'mono'],
    description: 'Controls whether the native Mono Editor context menu opens as a horizontal mobile action bar or a vertical dropdown list.',
    enum: ['horizontal', 'vertical'],
    enumItemLabels: ['Horizontal Bar', 'Vertical List'],
  },

  'editor.contextMenu.animation': {
    title: 'Context Menu Animation',
    type: 'select',
    defaultValue: 'cascade',
    order: 142,
    subCategory: 'Context Menu > Editor',
    tags: ['menu', 'context', 'animation', 'mono'],
    description: 'Controls the opening animation style of the native Mono Editor context menu.',
    enum: ['cascade', 'smooth', 'none'],
    enumItemLabels: ['Cascade', 'Smooth', 'None'],
  },

  'editor.contextMenu.horizontal.showIcons': {
    title: 'Horizontal Menu: Show Icons',
    type: 'boolean',
    defaultValue: true,
    order: 143,
    subCategory: 'Context Menu > Editor',
    tags: ['menu', 'context', 'horizontal', 'mono'],
    description: 'Show icons in the horizontal context menu bar.',
  },

  'editor.contextMenu.horizontal.more.showIcons': {
    title: 'Horizontal Overflow Menu: Show Icons',
    type: 'boolean',
    defaultValue: true,
    order: 144,
    subCategory: 'Context Menu > Editor',
    tags: ['menu', 'context', 'horizontal', 'mono'],
    description: 'Show icons inside the overflow ("More") menu opened from the horizontal bar.',
  },

  'editor.contextMenu.horizontal.more.showShortcuts': {
    title: 'Horizontal Overflow Menu: Show Shortcuts',
    type: 'boolean',
    defaultValue: true,
    order: 145,
    subCategory: 'Context Menu > Editor',
    tags: ['menu', 'context', 'horizontal', 'mono'],
    description: 'Show keyboard shortcuts inside the overflow ("More") menu.',
  },

  'editor.contextMenu.vertical.showIcons': {
    title: 'Vertical Menu: Show Icons',
    type: 'boolean',
    defaultValue: true,
    order: 146,
    subCategory: 'Context Menu > Editor',
    tags: ['menu', 'context', 'vertical', 'mono'],
    description: 'Show icons in the vertical context menu.',
  },

  'editor.contextMenu.vertical.showShortcuts': {
    title: 'Vertical Menu: Show Shortcuts',
    type: 'boolean',
    defaultValue: true,
    order: 147,
    subCategory: 'Context Menu > Editor',
    tags: ['menu', 'context', 'vertical', 'mono'],
    description: 'Show keyboard shortcuts in the vertical context menu.',
  },

  'editor.contextMenu.maxHeight': {
    title: 'Vertical Menu Max Height',
    type: 'number',
    defaultValue: 260,
    minimum: 120,
    maximum: 600,
    order: 148,
    subCategory: 'Context Menu > Editor',
    tags: ['menu', 'context', 'vertical', 'mono'],
    description: 'Controls the maximum height (in pixels) of the scrollable vertical context menu.',
  },

  // ── Removed Legacy App Context Menu Settings (Replaced by Native Mono Menu) ──

  'editor.contextMenuStyle': {
    title: 'Context Menu Style (Legacy)',
    type: 'select',
    defaultValue: 'android',
    order: 150,
    subCategory: 'Context Menu > Editor',
    tags: ['menu', 'context'],
    supportStatus: 'removed',
    supportNote: 'Old MSCode custom editor menu removed — use editor.contextMenu.type instead.',
    description: 'Legacy setting from the old app-level editor context menu.',
    enum: ['android', 'vertical', 'native'],
    enumItemLabels: ['Android (Horizontal)', 'Vertical (MS Code)', 'Native'],
  },

  'editor.androidMenuOverflowLimit': {
    title: 'Android Menu Overflow Limit (Legacy)',
    type: 'number',
    defaultValue: 5,
    minimum: 1,
    maximum: 10,
    order: 151,
    subCategory: 'Context Menu > Editor',
    tags: ['menu', 'context', 'android', 'overflow'],
    supportStatus: 'removed',
    supportNote: 'Old MSCode custom editor menu removed — native Mono Editor handles overflow automatically.',
    markdownDescription: 'Legacy overflow item count from the removed app-level editor menu.',
  },

  'editor.androidMenuOverflowStyle': {
    title: 'Android Menu Overflow Style (Legacy)',
    type: 'select',
    defaultValue: 'more',
    order: 152,
    subCategory: 'Context Menu > Editor',
    tags: ['menu', 'context', 'android', 'overflow', 'style'],
    supportStatus: 'removed',
    supportNote: 'Old MSCode custom editor menu removed — replaced by Mono Editor native context menu.',
    enum: ['scroll', 'more'],
    enumItemLabels: ['Horizontal Scroll', 'More Button (⋮)'],
    markdownDescription: 'Legacy overflow style from the removed app-level editor menu.',
  },

  'editor.androidMenuItemDisplay': {
    title: 'Android Menu Item Display (Legacy)',
    type: 'select',
    defaultValue: 'icon',
    order: 153,
    subCategory: 'Context Menu > Editor',
    tags: ['menu', 'context', 'android', 'display', 'icon', 'label'],
    supportStatus: 'removed',
    supportNote: 'Old MSCode custom editor menu removed — use editor.contextMenu.horizontal.showIcons instead.',
    enum: ['icon', 'label', 'both'],
    enumItemLabels: ['Only Icons', 'Only Labels', 'Icon and Label'],
    markdownDescription: 'Legacy display mode from the removed app-level editor menu.',
  },
};