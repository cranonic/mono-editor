import assert from 'node:assert/strict';
import {
  consumeArmedModifiers,
  createInitialModifierSnapshot,
  DOUBLE_TAP_LOCK_MS,
  getActiveModifiers,
  hasAnyActiveModifier,
  mergeNativeAndStickyModifiers,
  normalizeNativeKey,
  shouldInterceptNativeKeyDown,
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

test('Soft-keyboard ArrowUp/ArrowDown is intercepted and merged when Quick Tool Alt is active', () => {
  const stickyAlt = { ctrl: false, alt: true, shift: false };
  assert.equal(shouldInterceptNativeKeyDown({ key: 'ArrowUp', keyCode: 38 }, stickyAlt), true);
  assert.equal(shouldInterceptNativeKeyDown({ key: 'ArrowDown', keyCode: 40 }, stickyAlt), true);
  // Android WebView legacy/empty key with keyCode 38/40
  assert.equal(shouldInterceptNativeKeyDown({ key: 'Unidentified', keyCode: 38 }, stickyAlt), true);
  assert.deepEqual(normalizeNativeKey('Unidentified', 38, ''), {
    key: 'ArrowUp',
    code: 'ArrowUp',
    keyCode: 38,
  });
  assert.deepEqual(normalizeNativeKey('Down', 40, ''), {
    key: 'ArrowDown',
    code: 'ArrowDown',
    keyCode: 40,
  });

  // Standalone modifiers and IME composition (229) are NOT intercepted
  assert.equal(shouldInterceptNativeKeyDown({ key: 'Alt', keyCode: 18 }, stickyAlt), false);
  assert.equal(shouldInterceptNativeKeyDown({ key: 'Shift', keyCode: 16 }, stickyAlt), false);
  assert.equal(shouldInterceptNativeKeyDown({ key: 'Unidentified', keyCode: 229 }, stickyAlt), false);
  assert.equal(
    shouldInterceptNativeKeyDown({ key: 'a', keyCode: 65, isComposing: true }, stickyAlt),
    false,
  );
  // No sticky modifier active -> never intercept
  assert.equal(
    shouldInterceptNativeKeyDown({ key: 'ArrowUp', keyCode: 38 }, { ctrl: false, alt: false, shift: false }),
    false,
  );

  // Merge native Shift + Quick Tool Alt -> Alt+Shift
  assert.deepEqual(
    mergeNativeAndStickyModifiers(
      { ctrl: false, alt: false, shift: true },
      { ctrl: false, alt: true, shift: false },
    ),
    { ctrl: false, alt: true, shift: true },
  );
});

console.log('All Quick Keyboard Sticky Modifiers tests passed!');
