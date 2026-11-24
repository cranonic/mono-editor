/**
 * Undo grouping tests — typing bursts, Backspace/Delete bursts, transactions.
 *
 *   cd packages/mono-editor && npx tsx tests/undo-group.test.mts
 *
 * A tiny "editor" below mimics what InputController does (capture selection → edit → move caret),
 * and a fake clock drives the idle rule.
 */
import assert from 'node:assert/strict';
import { TextModel } from '../src/common/model/TextModel';
import { SelectionState } from '../src/common/core/SelectionState';

let T = 0; // fake clock (ms)

function makeEditor(initial = '') {
  const model = new TextModel(initial);
  const sel = new SelectionState();
  model.editStack.clock = () => T;
  model.setSelectionCapture(() => ({
    aLine: sel.anchor.lineNumber, aCol: sel.anchor.column,
    bLine: sel.active.lineNumber, bCol: sel.active.column,
  }));
  const off = () => model.getOffsetAt(sel.active.lineNumber, sel.active.column);
  const caretTo = (o: number) => { const p = model.getPositionAt(o); sel.setCaret(p.lineNumber, p.column); };
  const ed = {
    model, sel,
    /** type text char by char, `dt` ms apart (like a keyboard) */
    type(text: string, dt = 80) {
      for (const ch of text) {
        T += dt;
        if (ch === '\n') ed.enter(); else ed.typeChunk(ch);
      }
    },
    /** one input event carrying `text` (Gboard word commit) */
    typeChunk(text: string) {
      if (!sel.isEmpty) {
        const a = model.getOffsetAt(sel.anchor.lineNumber, sel.anchor.column);
        const b = model.getOffsetAt(sel.active.lineNumber, sel.active.column);
        const s = Math.min(a, b);
        model.replaceRange(s, Math.max(a, b), text, undefined, 'typing');
        caretTo(s + text.length);
      } else {
        const o = off();
        model.insert(o, text, 'typing');
        caretTo(o + text.length);
      }
    },
    enter() {
      const o = off();
      model.replaceRange(o, o, '\n', undefined, 'other');
      caretTo(o + 1);
    },
    backspace(n = 1, dt = 60) {
      for (let i = 0; i < n; i++) {
        T += dt;
        const o = off();
        if (o > 0) { model.delete(o - 1, o, 'deleteLeft'); caretTo(o - 1); }
      }
    },
    del(n = 1, dt = 60) {
      for (let i = 0; i < n; i++) {
        T += dt;
        const o = off();
        if (o < model.getValue().length) model.delete(o, o + 1, 'deleteRight');
      }
    },
    select(a: number, b: number) {
      const pa = model.getPositionAt(a), pb = model.getPositionAt(b);
      sel.anchor = { ...pa }; sel.active = { ...pb };
    },
    caretTo,
    /** user moves the caret (tap / arrows / teardrop): the editor closes the typing burst */
    moveCaret(o: number) { model.pushStackElement(); caretTo(o); },
    value: () => model.getValue(),
    depth: () => model.editStack.undoDepth,
    undo() {
      const e = model.undoEntry();
      if (e?.beforeSel) {
        sel.anchor = { lineNumber: e.beforeSel.aLine, column: e.beforeSel.aCol };
        sel.active = { lineNumber: e.beforeSel.bLine, column: e.beforeSel.bCol };
      }
      return !!e;
    },
    redo() {
      const e = model.redoEntry();
      if (e?.afterSel) {
        sel.anchor = { lineNumber: e.afterSel.aLine, column: e.afterSel.aCol };
        sel.active = { lineNumber: e.afterSel.bLine, column: e.afterSel.bCol };
      }
      return !!e;
    },
  };
  return ed;
}

const tests: [string, () => void][] = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

// ── typing bursts ───────────────────────────────────────────────────────────
test('one word typed fast = ONE undo step', () => {
  const e = makeEditor();
  e.type('hello');
  assert.equal(e.depth(), 1);
  e.undo();
  assert.equal(e.value(), '');
  e.redo();
  assert.equal(e.value(), 'hello');
  assert.deepEqual([e.sel.active.lineNumber, e.sel.active.column], [1, 6], 'redo puts the caret after the text');
});

test('word boundary: "hello world foo" undoes as foo → world → hello', () => {
  const e = makeEditor();
  e.type('hello world foo');
  assert.equal(e.depth(), 3);
  e.undo(); assert.equal(e.value(), 'hello world');
  e.undo(); assert.equal(e.value(), 'hello');
  e.undo(); assert.equal(e.value(), '');
  assert.equal(e.undo(), false);
});

test('several spaces stay with the word that follows them', () => {
  const e = makeEditor();
  e.type('a   b');
  assert.equal(e.depth(), 2);
  e.undo(); assert.equal(e.value(), 'a');
});

test('pause longer than the idle limit starts a new step', () => {
  const e = makeEditor();
  e.type('ab');
  T += 2000;
  e.type('cd');
  assert.equal(e.depth(), 2);
  e.undo(); assert.equal(e.value(), 'ab');
});

test('slow typist (400 ms per key) still groups', () => {
  const e = makeEditor();
  e.type('abcdef', 400);
  assert.equal(e.depth(), 1);
});

test('groupIdleMs = 0 → never splits on time', () => {
  const e = makeEditor();
  e.model.editStack.groupIdleMs = 0;
  e.type('ab'); T += 10 * 60 * 1000; e.type('cd');
  assert.equal(e.depth(), 1);
});

test('caret moved (tap / arrows) and even moved BACK to the same spot → new step', () => {
  const e = makeEditor('xx');
  e.caretTo(2); e.type('ab');
  e.moveCaret(0);          // user taps elsewhere …
  e.moveCaret(4);          // … and back to exactly the end
  e.type('cd');
  assert.equal(e.depth(), 2);
  e.undo(); assert.equal(e.value(), 'xxab');
});

test('safety net: caret changed without any hook (API setPosition) → new step because the selection no longer matches', () => {
  const e = makeEditor('abcdef');
  e.caretTo(3); e.type('X');
  e.caretTo(1); e.type('Y');      // different spot, no seal call
  assert.equal(e.depth(), 2);
  e.caretTo(5); e.type('Z');
  assert.equal(e.depth(), 3);
});

test('typing at a different place never merges', () => {
  const e = makeEditor('abc\ndef');
  e.caretTo(3); e.type('X');
  e.caretTo(8); e.type('Y');
  assert.equal(e.depth(), 2);
  assert.equal(e.value(), 'abcX\ndefY');
});

test('Enter is its own step; typing after it starts a fresh group', () => {
  const e = makeEditor();
  e.type('ab\ncd');
  assert.equal(e.depth(), 3);
  e.undo(); assert.equal(e.value(), 'ab\n');
  e.undo(); assert.equal(e.value(), 'ab');
  e.undo(); assert.equal(e.value(), '');
});

test('multi-char input event (word commit) joins the burst', () => {
  const e = makeEditor();
  e.typeChunk('he'); T += 100; e.typeChunk('llo'); T += 100; e.typeChunk('_x');
  assert.equal(e.depth(), 1);
  assert.equal(e.value(), 'hello_x');
});

test('typing over a selection: first edit of the burst — undo restores text AND selection together', () => {
  const e = makeEditor('one abc two');
  e.select(4, 7);
  e.type('xyz');
  assert.equal(e.value(), 'one xyz two');
  assert.equal(e.depth(), 1);
  e.undo();
  assert.equal(e.value(), 'one abc two');
  assert.deepEqual(
    [e.sel.anchor.column, e.sel.active.column], [5, 8], 'selection restored in the same undo step');
  e.redo();
  assert.equal(e.value(), 'one xyz two');
});

// ── deleting ────────────────────────────────────────────────────────────────
test('Backspace burst = one step; undo restores all deleted chars and the caret', () => {
  const e = makeEditor('abcdef');
  e.caretTo(6);
  e.backspace(3);
  assert.equal(e.value(), 'abc');
  assert.equal(e.depth(), 1);
  e.undo();
  assert.equal(e.value(), 'abcdef');
  assert.equal(e.sel.active.column, 7);
  e.redo();
  assert.equal(e.value(), 'abc');
  assert.equal(e.sel.active.column, 4);
});

test('Delete (forward) burst = one step', () => {
  const e = makeEditor('abcdef');
  e.caretTo(1);
  e.del(3);
  assert.equal(e.value(), 'aef');
  assert.equal(e.depth(), 1);
  e.undo(); assert.equal(e.value(), 'abcdef');
});

test('Backspace across a newline merges too', () => {
  const e = makeEditor('ab\ncd');
  e.caretTo(4);            // line 2, after "c"
  e.backspace(3);          // deletes c, newline, b
  assert.equal(e.value(), 'ad');
  assert.equal(e.depth(), 1);
  e.undo(); assert.equal(e.value(), 'ab\ncd');
});

test('typing → Backspace → typing are three steps (kind changes)', () => {
  const e = makeEditor();
  e.type('helo'); e.backspace(1); e.type('lo');
  assert.equal(e.depth(), 3);
  assert.equal(e.value(), 'hello');
  e.undo(); assert.equal(e.value(), 'hel');
  e.undo(); assert.equal(e.value(), 'helo');
  e.undo(); assert.equal(e.value(), '');
});

test('Backspace after caret jump does not merge', () => {
  const e = makeEditor('abcdef');
  e.caretTo(6); e.backspace(1);
  e.caretTo(2); e.backspace(1);
  assert.equal(e.depth(), 2);
});

// ── sealing ─────────────────────────────────────────────────────────────────
test('undo / redo seal: typing afterwards does not glue onto the old step', () => {
  const e = makeEditor();
  e.type('abc');
  e.undo(); e.redo();       // top entry is "abc" again, caret right after it
  e.type('d');
  assert.equal(e.depth(), 2);
  e.undo(); assert.equal(e.value(), 'abc');
});

test('after undo, new typing at the landing spot is a new step', () => {
  const e = makeEditor();
  e.type('ab'); T += 50;
  e.type('cd', 80);  // same burst → one step "abcd"
  assert.equal(e.depth(), 1);
  e.undo();
  e.type('xy');
  assert.equal(e.depth(), 1);
  assert.equal(e.value(), 'xy');
  e.undo(); assert.equal(e.value(), '');
});

test('pushStackElement() splits a burst', () => {
  const e = makeEditor();
  e.type('ab');
  e.model.pushStackElement();
  e.type('cd');
  assert.equal(e.depth(), 2);
});

test('redo stack is cleared by a new edit', () => {
  const e = makeEditor();
  e.type('abc'); e.undo();
  e.type('x');
  assert.equal(e.redo(), false);
});

test('setValue(…, false) closes the step; setValue clears history by default', () => {
  const e = makeEditor();
  e.type('ab');
  e.model.setValue('zz', false);
  e.caretTo(2); e.type('c');
  assert.equal(e.depth(), 2);
  e.model.setValue('q');
  assert.equal(e.depth(), 0);
});

// ── transactions ────────────────────────────────────────────────────────────
test('transact: many edits = one undo step; undo/redo restore everything', () => {
  const e = makeEditor('a1 b1 c1 d1');
  e.select(0, 0);
  const before = e.value();
  e.model.transact(() => {
    for (const at of [9, 6, 3, 0]) e.model.replaceRange(at + 1, at + 2, 'XX');   // replace from the end
  });
  assert.equal(e.value(), 'aXX bXX cXX dXX');
  assert.equal(e.depth(), 1);
  e.undo(); assert.equal(e.value(), before);
  e.redo(); assert.equal(e.value(), 'aXX bXX cXX dXX');
  e.undo(); assert.equal(e.value(), before);
});

test('transact: nested groups collapse into the outer one; single edit stays a plain entry', () => {
  const e = makeEditor('abc');
  e.model.transact(() => {
    e.model.insert(0, '1');
    e.model.transact(() => { e.model.insert(0, '2'); });
  });
  assert.equal(e.depth(), 1);
  e.undo(); assert.equal(e.value(), 'abc');
  e.model.transact(() => { e.model.insert(0, 'x'); });
  assert.equal(e.depth(), 1);
});

test('transact: empty or throwing callback leaves a consistent stack', () => {
  const e = makeEditor('abc');
  e.model.transact(() => {});
  assert.equal(e.depth(), 0);
  assert.throws(() => e.model.transact(() => { e.model.insert(0, 'z'); throw new Error('boom'); }), /boom/);
  assert.equal(e.depth(), 1);
  e.type('k');   // later edits still work after a throw
  assert.equal(e.depth(), 2);
});

test('Replace All through FindModel = one undo step (literal + regex), regex does not re-read the document per match', async () => {
  // dynamic import keeps this file runnable even if find/ changes shape
  const { findMatches, replaceMatch } = await import('../src/contrib/find/FindModel');
  for (const regex of [false, true]) {
    const e = makeEditor(Array.from({ length: 200 }, (_, i) => `foo${i} bar foo`).join('\n'));
    const opts: any = { regex, matchCase: false, wholeWord: false };
    const before = e.value();
    const list = findMatches(e.model, regex ? 'fo+' : 'foo', opts).slice().reverse();
    assert.equal(list.length, 400);
    const source = regex ? e.model.getValue() : undefined;
    e.model.transact(() => { for (const m of list) replaceMatch(e.model, m, 'Z', regex ? 'fo+' : 'foo', opts, source); });
    assert.ok(!e.value().includes('foo'));
    assert.equal(e.depth(), 1, `regex=${regex}`);
    e.undo();
    assert.equal(e.value(), before, `regex=${regex}`);
    e.redo();
    assert.ok(!e.value().includes('foo'));
  }
});

// ── fuzz: whatever happens, full undo → initial, full redo → final ───────────
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Replays a random editing session (deterministic per seed) for `ops` operations. */
function session(seed: number, ops: number) {
  const r = rng(seed);
  const initial = 'the quick brown fox\njumps over\nthe lazy dog';
  T = 0;
  const e = makeEditor(initial);
  e.caretTo(Math.floor(r() * initial.length));
  // snap[i] = document value when the undo stack was i deep, so undoing from depth d must land on snap[d-1]
  const snap: string[] = [initial];
  const record = () => { snap[e.depth()] = e.value(); };
  const log: string[] = [];
  for (let i = 0; i < ops; i++) {
    const op = r();
    if (op < 0.40) {
      const dt = 50 + Math.floor(r() * 700);
      const str = ['a', 'bc', ' ', 'x y', 'word', '  '][Math.floor(r() * 6)]!;
      log.push(`type ${JSON.stringify(str)} dt=${dt}`);
      for (const ch of str) { e.type(ch, dt); record(); }
    } else if (op < 0.52) { const n = 1 + Math.floor(r() * 3); log.push(`backspace ${n}`); for (let k = n; k > 0; k--) { e.backspace(1); record(); } }
    else if (op < 0.60) { const n = 1 + Math.floor(r() * 3); log.push(`del ${n}`); for (let k = n; k > 0; k--) { e.del(1); record(); } }
    else if (op < 0.68) { const o = Math.floor(r() * (e.value().length + 1)); log.push(`moveCaret ${o}`); e.moveCaret(o); }
    else if (op < 0.74) { const d = 100 + Math.floor(r() * 3000); log.push(`wait ${d}`); T += d; }
    else if (op < 0.80) { const a = Math.floor(r() * (e.value().length + 1)); const b = Math.min(e.value().length, a + 1 + Math.floor(r() * 5)); log.push(`select ${a}-${b}`); e.select(a, b); }
    else if (op < 0.84) { log.push('pushStackElement'); e.model.pushStackElement(); }
    else if (op < 0.88) { log.push('enter'); e.enter(); record(); }
    else if (op < 0.93) { log.push('transact'); e.model.transact(() => { for (let k = 0; k < 3; k++) { const o = Math.floor(r() * (e.value().length + 1)); e.model.insert(o, 'T' + k); } }); record(); }
    else if (op < 0.97) { log.push('undo(+redo?)'); if (e.undo()) { record(); if (r() < 0.5) { e.redo(); record(); } } }
    else { log.push('paste'); e.model.replaceRange(0, Math.min(3, e.value().length), 'PASTE\n'); record(); }
  }
  return { e, initial, snap, log };
}

test('fuzz: 400 random sessions — every undo lands on the recorded state, full undo = start, full redo = end', () => {
  for (let seed = 1; seed <= 400; seed++) {
    for (const ops of [60]) {
      const { e, initial, snap, log } = session(seed, ops);
      // The session may end with undone steps waiting in the redo stack → "everything redone" is a different
      // text than the current one. Get that reference from an identical replay.
      const ref = session(seed, ops).e;
      while (ref.redo()) { /* redo everything */ }
      const allRedone = ref.value();

      const depth = e.depth();
      for (let d = depth; d > 0; d--) {
        assert.equal(e.depth(), d);
        e.undo();
        assert.equal(e.value(), snap[d - 1], `seed ${seed}: undo from depth ${d}\n${log.join(' | ')}`);
      }
      assert.equal(e.value(), initial, `seed ${seed}: full undo`);
      while (e.redo()) { /* redo all */ }
      assert.equal(e.value(), allRedone, `seed ${seed}: full redo\n${log.join(' | ')}`);
      // and once more back and forth: undo/redo must be exactly invertible
      while (e.undo()) { /* back */ }
      assert.equal(e.value(), initial, `seed ${seed}: second full undo`);
      while (e.redo()) { /* forward */ }
      assert.equal(e.value(), allRedone, `seed ${seed}: second full redo`);
    }
  }
});

// ── run ──────────────────────────────────────────────────────────────────────
let failed = 0;
for (const [name, fn] of tests) {
  T = 0;
  try { await fn(); console.log('  ✓', name); }
  catch (err: any) { failed++; console.log('  ✗', name, '\n     ', String(err.message).split('\n').slice(0, 6).join('\n      ')); }
}
console.log(failed ? `\n${failed} FAILED` : '\nAll undo-grouping tests passed.');
process.exit(failed ? 1 : 0);
