/**
 * On-type formatting edits that arrive after the document changed again must be dropped
 * (they were computed for another version and would land at wrong offsets).
 *   cd packages/mono-editor && npx tsx tests/format-on-type-stale.test.mts
 */
import assert from 'node:assert/strict';
import { TextModel } from '../src/common/model/TextModel';
import { languageFeatures } from '../src/common/languages/languageFeaturesService';
import { FormatController } from '../src/contrib/format/FormatController';

const model = new TextModel('const x = {\n    ', 'javascript');
let applied = 0;
const host: any = {
  keybindings: { add() {} },
  commands: { registerCommand() {} },
  isReadOnly: () => false,
  isDisposed: () => false,
  getModel: () => model,
  getPosition: () => ({ lineNumber: 2, column: 5 }),
  getLanguageIdAtPosition: () => 'javascript',
  getTabSize: () => 4,
  modelAsFeatureLike: () => ({}),
  applyTextEditsAtomic: () => { applied++; return true; },
};
let release!: () => void;
const gate = new Promise<void>((r) => { release = r; });
const sub = languageFeatures.registerOnTypeFormattingEditProvider('javascript', {
  autoFormatTriggerCharacters: ['\n'],
  provideOnTypeFormattingEdits: async () => {
    await gate;
    return [{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 }, text: 'X' }];
  },
});
const fc = new FormatController(host);

// 1) user types while the provider is still answering → stale → dropped
let p = fc.runOnTypeFormatting('\n');
model.insert(model.getValue().length, 'a');
release();
assert.equal(await p, false);
assert.equal(applied, 0, 'stale edits dropped');

// 2) nothing changed → applied
p = fc.runOnTypeFormatting('\n');
assert.equal(await p, true);
assert.equal(applied, 1, 'fresh edits applied');
(sub as any).dispose?.();
console.log('format-on-type-stale.test.mts OK');
