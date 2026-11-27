/**
 * a typed here, caret moved elsewhere, b typed there → Ctrl+Z / Ctrl+Y move ONE step at a time,
 * on the plain keyboard path and on the IME path (also when the IME never sends compositionend).
 *   cd packages/mono-editor && npx tsx tests/undo-caret-move.test.mts
 */
import assert from 'node:assert/strict';
import { TextModel } from '../src/common/model/TextModel';
import { SelectionState } from '../src/common/core/SelectionState';
import { replaceSelectionText } from '../src/common/editOperations/typeOperations';
import { CompositionHandler } from '../src/browser/input/compositionHandler';

const BASE = 'hello world\nsecond line';
function mk() {
  const m = new TextModel(BASE);
  const s = new SelectionState();
  m.setSelectionCapture(() => ({ aLine: s.anchor.lineNumber, aCol: s.anchor.column, bLine: s.active.lineNumber, bCol: s.active.column }));
  return { m, s };
}
const A = 'helloa world\nsecond line';
const AB = 'helloa world\nsebcond line';

function check(name: string, m: TextModel) {
  assert.equal(m.getValue(), AB, `${name}: both typed`);
  m.undo(); assert.equal(m.getValue(), A, `${name}: first undo removes only b`);
  m.redo(); assert.equal(m.getValue(), AB, `${name}: first redo restores only b`);
  m.undo(); m.undo(); assert.equal(m.getValue(), BASE, `${name}: second undo removes a`);
  m.redo(); assert.equal(m.getValue(), A, `${name}: redo restores only a`);
  m.redo(); assert.equal(m.getValue(), AB, `${name}: redo restores b`);
}

{ // plain keyboard, with an idle gap longer than the group window in between
  const { m, s } = mk(); let t = 0; m.editStack.clock = () => t;
  s.setCaret(1, 6); replaceSelectionText(m, s, 'a');
  t += 8000; s.setCaret(2, 3); replaceSelectionText(m, s, 'b');
  check('plain', m);
}
{ // IME, each composition ended
  const { m, s } = mk(); const c = new CompositionHandler();
  s.setCaret(1, 6); c.handleUpdate(m, s, 'a'); c.handleEnd(m, s, 'a', () => {});
  s.setCaret(2, 3); c.handleUpdate(m, s, 'b'); c.handleEnd(m, s, 'b', () => {});
  check('ime-ended', m);
}
{ // IME never ended the first composition; caret was moved; b typed at the new caret
  const { m, s } = mk(); const c = new CompositionHandler();
  s.setCaret(1, 6); c.handleUpdate(m, s, 'a');
  s.setCaret(2, 3); c.handleUpdate(m, s, 'b');
  assert.equal(m.getValue(), AB, 'ime-open: a stays, b lands at the new caret');
  assert.deepEqual({ ...s.active }, { lineNumber: 2, column: 4 });
  c.handleEnd(m, s, 'b', () => {});
  check('ime-open', m);
}
{ // a normal multi-update composition (caret never moved) is still a single undo step
  const { m, s } = mk(); const c = new CompositionHandler();
  s.setCaret(1, 6); c.handleUpdate(m, s, 'k'); c.handleUpdate(m, s, 'ka'); c.handleUpdate(m, s, 'kal');
  c.handleEnd(m, s, 'kal', () => {});
  assert.equal(m.getValue(), 'hellokal world\nsecond line');
  m.undo(); assert.equal(m.getValue(), BASE);
}
console.log('undo-caret-move.test.mts OK');
