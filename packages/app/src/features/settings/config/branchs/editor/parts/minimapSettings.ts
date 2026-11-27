// src/features/settings/config/branchs/editor/parts/minimapSettings.ts
import type { IConfigurationSection } from '@/core/extensionAPI/registry/configurationRegistry';

export const minimapProperties: IConfigurationSection['properties'] = {
  'editor.minimap.enabled': {
    title: 'Minimap Enabled',
    type: 'boolean',
    subCategory: 'Minimap',
    defaultValue: false,
    order: 1,
    tags: ['minimap', 'mono'],
    description: 'Controls whether the minimap is shown.',
  },

  'editor.minimap.side': {
    title: 'Minimap Side',
    type: 'select',
    subCategory: 'Minimap',
    defaultValue: 'right',
    order: 2,
    tags: ['minimap', 'mono'],
    description: 'Controls the side where to render the minimap.',
    enum: ['left', 'right'],
    enumItemLabels: ['Left', 'Right'],
  },

  'editor.minimap.width': {
    title: 'Minimap Width',
    type: 'number',
    subCategory: 'Minimap',
    defaultValue: 84,
    minimum: 40,
    maximum: 300,
    order: 3,
    tags: ['minimap', 'mono'],
    description: 'Controls the width of the minimap in pixels.',
  },

  'editor.minimap.showSlider': {
    title: 'Minimap Show Slider',
    type: 'select',
    subCategory: 'Minimap',
    defaultValue: 'mouseover',
    order: 4,
    tags: ['minimap', 'mono'],
    description: 'Controls when the minimap slider is shown.',
    enum: ['always', 'mouseover'],
    enumItemLabels: ['Always', 'Mouse Over'],
  },

  'editor.minimap.renderCharacters': {
    title: 'Minimap Render Characters',
    type: 'boolean',
    subCategory: 'Minimap',
    defaultValue: true,
    order: 5,
    tags: ['minimap', 'mono'],
    description: 'Render the actual characters on a line as opposed to color blocks.',
  },

  'editor.minimap.maxColumn': {
    title: 'Minimap Max Column',
    type: 'number',
    subCategory: 'Minimap',
    defaultValue: 120,
    minimum: 20,
    maximum: 10000,
    order: 6,
    tags: ['minimap', 'mono'],
    description: 'Limit the width of the minimap to render at most a certain number of columns.',
  },

  'editor.minimap.autohide': {
    title: 'Minimap Autohide',
    type: 'boolean',
    subCategory: 'Minimap',
    defaultValue: false,
    order: 7,
    tags: ['minimap'],
    supportStatus: 'not-available',
    description: 'Controls whether the minimap is hidden automatically.',
  },

  'editor.minimap.size': {
    title: 'Minimap Size',
    type: 'select',
    subCategory: 'Minimap',
    defaultValue: 'proportional',
    order: 8,
    tags: ['minimap'],
    supportStatus: 'not-available',
    description: 'Controls the size of the minimap.',
    enum: ['proportional', 'fill', 'fit'],
    enumItemLabels: ['Proportional', 'Fill', 'Fit'],
    enumDescriptions: [
      'The minimap has the same size as the editor contents (and might scroll).',
      'The minimap will stretch or shrink as necessary to fill the height of the editor (no scrolling).',
      'The minimap will shrink as necessary to never be larger than the editor (no scrolling).',
    ],
  },

  'editor.minimap.scale': {
    title: 'Minimap Scale',
    type: 'select',
    subCategory: 'Minimap',
    defaultValue: '1',
    order: 9,
    tags: ['minimap'],
    supportStatus: 'not-available',
    description: "Scale of content drawn in the minimap. Larger values reduce the minimap's relative size.",
    enum: ['1', '2', '3'],
    enumItemLabels: ['1×', '2×', '3×'],
  },

  'editor.minimap.sectionHeaderFontSize': {
    title: 'Minimap Section Header Font Size',
    type: 'number',
    subCategory: 'Minimap',
    defaultValue: 9,
    minimum: 4,
    maximum: 32,
    order: 10,
    tags: ['minimap'],
    supportStatus: 'removed',
    supportNote: 'Monaco MARK: comment header quirk — not needed in Mono Editor.',
    description: 'Controls the font size of section headers in the minimap.',
  },
};
