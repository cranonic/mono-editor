// src/features/settings/config/branchs/lsp/parts/cssJsonSettings.ts
import { generateLspLanguageSettings } from '../lspFactory';

export const cssLspProperties = generateLspLanguageSettings(
  'CSS / SCSS / Less', 'css', 'Mono Built-in',
  {
    // Mono already provides colour swatches for CSS/SCSS/Less.
    // Keep the setting so users can turn them off without losing other CSS features.
    'lsp.css.colorDecorators': {
      title:               'Color Decorators',
      type:                'boolean',
      subCategory:         'CSS / SCSS / Less',
      defaultValue:        true,
      markdownDescription:
        'Show inline colour swatches next to colour values. Mono built-in — works offline without a language server.',
    },
    'lsp.css.lint.unknownProperties': {
      title:               'Warn on Unknown Properties',
      type:                'boolean',
      subCategory:         'CSS / SCSS / Less',
      defaultValue:        true,
      markdownDescription: 'Flag CSS properties that are not recognised by the built-in CSS language service.',
    },
  },
);

export const jsonLspProperties = generateLspLanguageSettings(
  'JSON', 'json', 'Mono Built-in',
  {
    'lsp.json.schemaValidation': {
      title:               'Schema Validation',
      type:                'boolean',
      subCategory:         'JSON',
      defaultValue:        true,
      markdownDescription:
        'Validate JSON files against known schemas (e.g. `package.json`, `tsconfig.json`).',
    },
    'lsp.json.sortOnSave': {
      title:               'Sort Keys on Save',
      type:                'boolean',
      subCategory:         'JSON',
      defaultValue:        false,
      markdownDescription: 'Automatically sort JSON keys alphabetically when the file is saved.',
    },
  },
);
