// src/features/settings/config/branchs/editor/parts/breadcrumbsSettings.ts
import type { IConfigurationSection } from '@/core/extensionAPI/registry/configurationRegistry';

const KIND_TOGGLES: Array<[string, string]> = [
  ['showFiles', 'Show Files'],
  ['showModules', 'Show Modules'],
  ['showNamespaces', 'Show Namespaces'],
  ['showPackages', 'Show Packages'],
  ['showClasses', 'Show Classes'],
  ['showMethods', 'Show Methods'],
  ['showProperties', 'Show Properties'],
  ['showFields', 'Show Fields'],
  ['showConstructors', 'Show Constructors'],
  ['showEnums', 'Show Enums'],
  ['showInterfaces', 'Show Interfaces'],
  ['showFunctions', 'Show Functions'],
  ['showVariables', 'Show Variables'],
  ['showConstants', 'Show Constants'],
  ['showStrings', 'Show Strings'],
  ['showNumbers', 'Show Numbers'],
  ['showBooleans', 'Show Booleans'],
  ['showArrays', 'Show Arrays'],
  ['showObjects', 'Show Objects'],
  ['showKeys', 'Show Keys'],
  ['showNull', 'Show Null'],
  ['showEnumMembers', 'Show Enum Members'],
  ['showStructs', 'Show Structs'],
  ['showEvents', 'Show Events'],
  ['showOperators', 'Show Operators'],
  ['showTypeParameters', 'Show Type Parameters'],
];

const kindProperties: IConfigurationSection['properties'] = {};
KIND_TOGGLES.forEach(([key, title], idx) => {
  kindProperties[`breadcrumbs.${key}`] = {
    title: `Breadcrumbs: ${title}`,
    type: 'boolean',
    defaultValue: true,
    order: 220 + idx,
    subCategory: 'Breadcrumbs > Symbols',
    tags: ['breadcrumbs', 'symbols', 'mono'],
    description: `When enabled, breadcrumbs show ${title.replace(/^Show /, '').toLowerCase()} symbols.`,
  };
});

export const breadcrumbsProperties: IConfigurationSection['properties'] = {
  'breadcrumbs.enabled': {
    title: 'Breadcrumbs: Enabled',
    type: 'boolean',
    defaultValue: true,
    order: 210,
    subCategory: 'Breadcrumbs',
    tags: ['breadcrumbs', 'navigation', 'mono'],
    description: 'Enable or disable navigation breadcrumbs above the editor.',
  },

  'breadcrumbs.filePath': {
    title: 'Breadcrumbs: File Path',
    type: 'select',
    defaultValue: 'on',
    order: 211,
    subCategory: 'Breadcrumbs',
    tags: ['breadcrumbs', 'navigation', 'mono'],
    description: 'Controls whether and how file paths are shown in the breadcrumbs view.',
    enum: ['on', 'off', 'last'],
    enumItemLabels: ['On', 'Off', 'Last Only'],
    enumDescriptions: [
      'Show the full file path in the breadcrumbs view.',
      'Do not show the file path in the breadcrumbs view.',
      'Only show the last element (filename) of the file path.',
    ],
  },

  'breadcrumbs.symbolPath': {
    title: 'Breadcrumbs: Symbol Path',
    type: 'select',
    defaultValue: 'on',
    order: 212,
    subCategory: 'Breadcrumbs',
    tags: ['breadcrumbs', 'symbols', 'mono'],
    description: 'Controls whether and how symbols are shown in the breadcrumbs view.',
    enum: ['on', 'off', 'last'],
    enumItemLabels: ['On', 'Off', 'Last Only'],
    enumDescriptions: [
      'Show all enclosing symbols in the breadcrumbs view.',
      'Do not show symbols in the breadcrumbs view.',
      'Only show the current (innermost) symbol.',
    ],
  },

  'breadcrumbs.icons': {
    title: 'Breadcrumbs: Icons',
    type: 'boolean',
    defaultValue: true,
    order: 213,
    subCategory: 'Breadcrumbs',
    tags: ['breadcrumbs', 'icons', 'mono'],
    description: 'Render breadcrumb items with file and symbol icons.',
  },

  'breadcrumbs.symbolSortOrder': {
    title: 'Breadcrumbs: Symbol Sort Order',
    type: 'select',
    defaultValue: 'position',
    order: 214,
    subCategory: 'Breadcrumbs',
    tags: ['breadcrumbs', 'symbols', 'mono'],
    description: 'Controls how symbols are sorted in the breadcrumbs outline picker.',
    enum: ['position', 'name', 'type'],
    enumItemLabels: ['Position', 'Name', 'Type'],
    enumDescriptions: [
      'Outline position order.',
      'Alphabetical order.',
      'Symbol kind order.',
    ],
  },

  'breadcrumbs.showSymbolDetails': {
    title: 'Breadcrumbs: Show Symbol Details',
    type: 'boolean',
    defaultValue: false,
    order: 215,
    subCategory: 'Breadcrumbs',
    tags: ['breadcrumbs', 'symbols', 'mono'],
    description: 'Show right-aligned symbol detail text (e.g. let, const, function) in the breadcrumb picker.',
  },

  'breadcrumbs.folderClickBehavior': {
    title: 'Breadcrumbs: Folder Click Behavior',
    type: 'select',
    defaultValue: 'expand',
    order: 216,
    subCategory: 'Breadcrumbs',
    tags: ['breadcrumbs', 'navigation', 'mono'],
    description: 'Controls whether clicking a folder in the breadcrumb picker expands it inline as a tree or enters the folder.',
    enum: ['expand', 'enter'],
    enumItemLabels: ['Expand / Collapse Tree', 'Enter Folder'],
    enumDescriptions: [
      'Expand or collapse the folder inline with vertical indent guides (VS Code tree style).',
      'Drill into the folder and display its children with a back button.',
    ],
  },

  ...kindProperties,
};
