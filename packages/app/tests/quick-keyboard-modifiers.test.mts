import assert from 'node:assert/strict';
import {
  consumeArmedModifiers,
  createInitialModifierSnapshot,
  DOUBLE_TAP_LOCK_MS,
  getActiveModifiers,
  hasAnyActiveModifier,
  tapModifier,
} from '../src/store/quickKeyboardModifiers';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    throw err;
  }
}

console.log('Running Quick Keyboard Sticky Modifiers tests...');

test('Single tap arms one-shot modifier and auto-clears after consuming next key', () => {
  let snap = createInitialModifierSnapshot();
  assert.equal(hasAnyActiveModifier(snap.states), false);

  snap = tapModifier(snap, 'alt', 1000);
  assert.equal(snap.states.alt, 'armed');
  assert.deepEqual(getActiveModifiers(snap.states), { ctrl: false, alt: true, shift: false });

  snap = consumeArmedModifiers(snap);
  assert.equal(snap.states.alt, 'off');
  assert.equal(hasAnyActiveModifier(snap.states), false);
});

test('Double-tap within threshold locks modifier across multiple keys until tapped again', () => {
  let snap = createInitialModifierSnapshot();
  snap = tapModifier(snap, 'ctrl', 1000);
  assert.equal(snap.states.ctrl, 'armed');

  snap = tapModifier(snap, 'ctrl', 1000 + DOUBLE_TAP_LOCK_MS - 50);
  assert.equal(snap.states.ctrl, 'locked');

  // Survives multiple key dispatches
  snap = consumeArmedModifiers(snap);
  snap = consumeArmedModifiers(snap);
  assert.equal(snap.states.ctrl, 'locked');
  assert.equal(getActiveModifiers(snap.states).ctrl, true);

  // Tap again unlocks
  snap = tapModifier(snap, 'ctrl', 2500);
  assert.equal(snap.states.ctrl, 'off');
  assert.equal(getActiveModifiers(snap.states).ctrl, false);
});

test('Slow second tap while armed turns modifier off instead of locking', () => {
  let snap = createInitialModifierSnapshot();
  snap = tapModifier(snap, 'shift', 1000);
  assert.equal(snap.states.shift, 'armed');

  snap = tapModifier(snap, 'shift', 1000 + DOUBLE_TAP_LOCK_MS + 100);
  assert.equal(snap.states.shift, 'off');
});

test('Mixed states: locked Shift + armed Alt consumes Alt only and keeps Shift locked', () => {
  let snap = createInitialModifierSnapshot();
  snap = tapModifier(snap, 'shift', 100);
  snap = tapModifier(snap, 'shift', 220); // locked
  snap = tapModifier(snap, 'alt', 500);   // armed

  assert.equal(snap.states.shift, 'locked');
  assert.equal(snap.states.alt, 'armed');
  assert.deepEqual(getActiveModifiers(snap.states), { ctrl: false, alt: true, shift: true });

  snap = consumeArmedModifiers(snap);
  assert.equal(snap.states.shift, 'locked');
  assert.equal(snap.states.alt, 'off');
  assert.deepEqual(getActiveModifiers(snap.states), { ctrl: false, alt: false, shift: true });
});

console.log('All Quick Keyboard Sticky Modifiers tests passed!');
