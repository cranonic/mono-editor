// src/features/settings/config/branchs/editor/parts/touchSettings.ts
import type { IConfigurationSection } from '@/core/extensionAPI/registry/configurationRegistry';

export const touchProperties: IConfigurationSection['properties'] = {
  // ── Native Mono Editor Touch & Mobile APIs ───────────────────────────────

  'editor.pinchZoom': {
    title: 'Pinch To Zoom',
    type: 'boolean',
    subCategory: 'Touch',
    defaultValue: true,
    order: 1,
    tags: ['touch', 'mobile', 'zoom', 'mono'],
    description: 'Allow two-finger pinch gestures on touch devices to smoothly zoom the editor font size.',
  },

  'editor.mobileQuickKeys.enabled': {
    title: 'Bottom Mobile Quick Keys Bar',
    type: 'boolean',
    subCategory: 'Touch',
    defaultValue: false,
    order: 2,
    tags: ['touch', 'mobile', 'keyboard', 'mono'],
    description: 'Show the built-in Mono Editor mobile quick coding keys bar at the bottom of the editor (disabled by default).',
  },

  // ── Legacy / Planned Touch Settings ──────────────────────────────────────

  'editor.teardrops.enabled': {
    title: 'Legacy DOM Selection Handles (Teardrops)',
    type: 'boolean',
    subCategory: 'Touch',
    defaultValue: true,
    order: 10,
    tags: ['touch', 'teardrops'],
    supportStatus: 'removed',
    supportNote: 'Mono Editor renders native canvas/pointer teardrops built-in; the legacy Monaco DOM overlay is no longer needed.',
    description: 'Legacy toggle for the old Monaco DOM teardrop overlay.',
  },

  'editor.teardrops.lens.enabled': {
    title: 'Selection Magnifier Lens',
    type: 'boolean',
    subCategory: 'Touch',
    defaultValue: false,
    order: 11,
    tags: ['touch', 'teardrops', 'lens'],
    supportStatus: 'not-available',
    supportNote: 'Planned for Mono Editor touch selection loupe.',
    description:
      'Show a rectangular magnifier near the finger while dragging selection handles — similar to the Android text selection loupe.',
  },

  'editor.teardrops.lens.scale': {
    title: 'Magnifier Scale',
    type: 'number',
    subCategory: 'Touch',
    defaultValue: 1.6,
    minimum: 1.2,
    maximum: 3,
    order: 12,
    tags: ['touch', 'teardrops', 'lens'],
    supportStatus: 'not-available',
    description: 'Zoom level of the selection magnifier lens.',
  },
};
