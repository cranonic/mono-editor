import assert from 'node:assert/strict';
import { resolvePickerPalette, symbolIconColor, symbolKindIconKey } from '../src/platform/theme/widgetPalette.ts';
import { resolveSuggestPalette } from '../src/contrib/suggest/widget/suggestStyle.ts';
import { CompletionItemKind as CK } from '../src/common/languages/providers/types.ts';
import { SymbolKind as SK } from '../src/common/languages/providers/extendedTypes.ts';

// VS Code defaults, dark + light
const dark = resolvePickerPalette({}, 'dark');
assert.equal(dark.iconForSymbolKind(SK.Class), '#ee9d28');
assert.equal(dark.iconForSymbolKind(SK.Method), '#b180d7');
assert.equal(dark.iconForSymbolKind(SK.Function), '#b180d7');
assert.equal(dark.iconForSymbolKind(SK.Constructor), '#b180d7');
assert.equal(dark.iconForSymbolKind(SK.Field), '#75beff');
assert.equal(dark.iconForSymbolKind(SK.Variable), '#75beff');
assert.equal(dark.iconForSymbolKind(SK.Constant), '#75beff');
assert.equal(dark.iconForSymbolKind(SK.Interface), '#75beff');
assert.equal(dark.iconForSymbolKind(SK.Enum), '#ee9d28');
assert.equal(dark.iconForSymbolKind(SK.EnumMember), '#75beff');
assert.equal(dark.iconForSymbolKind(SK.TypeParameter), '#4ec9b0');
assert.equal(dark.iconForSymbolKind(SK.String), '#cccccc');
assert.ok(dark.indentGuide.length > 0);
const light = resolvePickerPalette({}, 'light');
assert.equal(light.iconForSymbolKind(SK.Class), '#d67e00');
assert.equal(light.iconForSymbolKind(SK.Method), '#652d90');

// theme override wins, incl. VS Code's real enum names
const themed = resolvePickerPalette(
  {
    'symbolIcon.classForeground': '#111111',
    'symbolIcon.enumeratorForeground': '#222222',
    'symbolIcon.enumeratorMemberForeground': '#333333',
    'tree.indentGuidesStroke': '#556677',
  },
  'dark',
);
assert.equal(themed.iconForSymbolKind(SK.Class), '#111111');
assert.equal(themed.iconForSymbolKind(SK.Enum), '#222222');
assert.equal(themed.iconForSymbolKind(SK.EnumMember), '#333333');
assert.equal(themed.activeIndentGuide, '#556677');

// unknown / missing kind never throws
assert.equal(symbolKindIconKey(undefined), 'variable');
assert.equal(symbolKindIconKey(999), 'variable');

// picker == completion list by default (same background/border/selection/highlight, same icon colours)
const colors = {
  'editorSuggestWidget.background': '#0a0a0a',
  'editorSuggestWidget.border': '#252525',
  'editorSuggestWidget.selectedBackground': '#0a2840',
  'editorSuggestWidget.highlightForeground': '#18a3ff',
  'symbolIcon.methodForeground': '#ff00ff',
};
const pick = resolvePickerPalette(colors, 'dark');
const sug = resolveSuggestPalette({ themeColors: colors, themeType: 'dark' });
assert.equal(pick.background, sug.background);
assert.equal(`1px solid ${pick.border}`, sug.border);
assert.equal(pick.selectedBackground, sug.selectedBackground);
assert.equal(pick.highlight, sug.highlight);
assert.equal(pick.iconForSymbolKind(SK.Method), sug.icon(CK.Method));
assert.equal(pick.iconForSymbolKind(SK.Class), sug.icon(CK.Class));
assert.equal(pick.iconForSymbolKind(SK.Field), sug.icon(CK.Field));

// breadcrumbPicker.background overrides only the picker
assert.equal(resolvePickerPalette({ ...colors, 'breadcrumbPicker.background': '#123456' }, 'dark').background, '#123456');
assert.equal(symbolIconColor('class', undefined, undefined), '#ee9d28');

// light selection background without an explicit foreground must stay readable
const lightSel = resolvePickerPalette({ 'editorSuggestWidget.selectedBackground': '#d6ebff', 'editorSuggestWidget.foreground': '#000000' }, 'light');
assert.equal(lightSel.selectedForeground, '#000000');
assert.equal(resolvePickerPalette({}, 'light').selectedForeground, '#ffffff');
assert.equal(resolvePickerPalette({ 'editorSuggestWidget.selectedForeground': '#123123', 'editorSuggestWidget.selectedBackground': '#d6ebff' }, 'light').selectedForeground, '#123123');
console.log('widget-palette.test.mts OK');
