/** Enter after `{` keeps/increases indent in JS (built-in path, no LSP). */
import assert from 'node:assert/strict';
import { TextModel } from '../src/common/model/TextModel';
import { SelectionState } from '../src/common/core/SelectionState';
import { applyEnterKey } from '../src/common/editOperations/indentOperations';
import { registerDefaultLanguages } from '../src/index';
registerDefaultLanguages();
function enter(text: string, ln: number, col: number) {
  const m = new TextModel(text, 'javascript'); const s = new SelectionState(); s.setCaret(ln, col);
  applyEnterKey(m, s, 4, true, 'full', true);
  return { v: m.getValue(), ln: s.active.lineNumber, col: s.active.column };
}
assert.deepEqual(enter('(function () {', 1, 15), { v: '(function () {\n    ', ln: 2, col: 5 });
assert.deepEqual(enter('f() {\n    const captureLog = (type, args) => {', 2, 41),
  { v: 'f() {\n    const captureLog = (type, args) => {\n        ', ln: 3, col: 9 });
assert.deepEqual(enter('(function () {}', 1, 15), { v: '(function () {\n    \n}', ln: 2, col: 5 });
console.log('enter-indent.test.mts OK');
