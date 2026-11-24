import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as mono from '../src/index';

const SNAPSHOT_PATH = path.resolve(import.meta.dirname, 'api-surface.snapshot.json');

function ownKeys(obj: unknown): string[] {
  if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) return [];
  return Object.keys(obj as Record<string, unknown>).sort();
}

function protoMethods(ctor: unknown): string[] {
  if (typeof ctor !== 'function' || !ctor.prototype) return [];
  return Object.getOwnPropertyNames(ctor.prototype)
    .filter((k) => k !== 'constructor' && typeof ctor.prototype[k] === 'function')
    .sort();
}

function buildSnapshot() {
  return {
    indexExports: ownKeys(mono),
    editorNamespaceKeys: ownKeys(mono.editor),
    languagesNamespaceKeys: ownKeys(mono.languages),
    monoCommandsKeys: ownKeys(mono.MonoCommands),
    monoCommandsValues: Object.fromEntries(
      Object.entries(mono.MonoCommands).sort(([a], [b]) => a.localeCompare(b)),
    ),
    monoEditorMethods: protoMethods(mono.MonoEditor),
    defaultThemeKeys: ownKeys(mono.DEFAULT_THEME),
    selectionDirectionKeys: ownKeys(mono.SelectionDirection),
    endOfLineSequenceKeys: ownKeys(mono.EndOfLineSequence),
    completionItemKindKeys: ownKeys(mono.CompletionItemKind),
    completionTriggerKindKeys: ownKeys(mono.CompletionTriggerKind),
    indentActionKeys: ownKeys(mono.IndentAction),
    keyModKeys: ownKeys(mono.KeyMod),
    keyCodeKeys: ownKeys(mono.KeyCode),
  };
}

const REQUIRED_PUBLIC_EDITOR_METHODS = [
  'addAction',
  'addContextMenuItem',
  'addKeybinding',
  'blur',
  'deltaDecorations',
  'dispose',
  'executeCommand',
  'executeEdits',
  'focus',
  'foldAll',
  'getAction',
  'getAlternativeVersionId',
  'getCommandsForPalette',
  'getContribution',
  'getFoldedCount',
  'getLanguageId',
  'getModel',
  'getModelMarkers',
  'getModelVersionId',
  'getPaletteService',
  'getPosition',
  'getScrollLeft',
  'getScrollTop',
  'getSelection',
  'getSelections',
  'getValue',
  'hasTextFocus',
  'hideContextMenu',
  'layout',
  'listKeybindings',
  'onDidBlurEditorText',
  'onDidChangeCursorPosition',
  'onDidChangeCursorSelection',
  'onDidChangeMarkers',
  'onDidChangeModel',
  'onDidChangeModelContent',
  'onDidFocusEditorText',
  'onDidScrollChange',
  'pushUndoStop',
  'registerCommand',
  'removeContextMenuItem',
  'removeKeybinding',
  'revealFind',
  'revealLine',
  'revealLineInCenter',
  'revealPosition',
  'revealPositionInCenter',
  'revealRange',
  'revealReplace',
  'setContext',
  'setContextMenuItems',
  'setContextMenuStyle',
  'setLanguageId',
  'setModel',
  'setModelMarkers',
  'setPosition',
  'setScrollLeft',
  'setScrollTop',
  'setSelection',
  'setSelections',
  'setStickyScroll',
  'setTheme',
  'setValue',
  'showContextMenu',
  'toggleFoldAtLine',
  'unfoldAll',
  'updateOptions',
];

const current = buildSnapshot();

if (process.argv.includes('--update') || !fs.existsSync(SNAPSHOT_PATH)) {
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(current, null, 2) + '\n', 'utf8');
  console.log(`Updated API surface snapshot (${current.indexExports.length} exports, ${current.monoEditorMethods.length} MonoEditor methods).`);
} else {
  const expected = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
  assert.deepEqual(current.indexExports, expected.indexExports, 'src/index.ts runtime exports changed!');
  assert.deepEqual(current.editorNamespaceKeys, expected.editorNamespaceKeys, 'editor.* namespace keys changed!');
  assert.deepEqual(current.languagesNamespaceKeys, expected.languagesNamespaceKeys, 'languages.* namespace keys changed!');
  assert.deepEqual(current.monoCommandsKeys, expected.monoCommandsKeys, 'MonoCommands keys changed!');
  assert.deepEqual(current.monoCommandsValues, expected.monoCommandsValues, 'MonoCommands values changed!');
  assert.deepEqual(current.monoEditorMethods, expected.monoEditorMethods, 'MonoEditor methods snapshot changed!');
  for (const method of REQUIRED_PUBLIC_EDITOR_METHODS) {
    assert.ok(
      current.monoEditorMethods.includes(method),
      `Required public IMonoEditor method missing on MonoEditor.prototype: ${method}`,
    );
  }
  assert.deepEqual(current.defaultThemeKeys, expected.defaultThemeKeys, 'DEFAULT_THEME keys changed!');
  assert.deepEqual(current.selectionDirectionKeys, expected.selectionDirectionKeys, 'SelectionDirection changed!');
  assert.deepEqual(current.endOfLineSequenceKeys, expected.endOfLineSequenceKeys, 'EndOfLineSequence changed!');
  assert.deepEqual(current.completionItemKindKeys, expected.completionItemKindKeys, 'CompletionItemKind changed!');
  assert.deepEqual(current.completionTriggerKindKeys, expected.completionTriggerKindKeys, 'CompletionTriggerKind changed!');
  assert.deepEqual(current.indentActionKeys, expected.indentActionKeys, 'IndentAction changed!');
  assert.deepEqual(current.keyModKeys, expected.keyModKeys, 'KeyMod changed!');
  assert.deepEqual(current.keyCodeKeys, expected.keyCodeKeys, 'KeyCode changed!');
  console.log(
    `PASS: API-surface snapshot verified (${current.indexExports.length} exports, ${REQUIRED_PUBLIC_EDITOR_METHODS.length} public MonoEditor methods, ${current.monoCommandsKeys.length} commands).`,
  );
}
