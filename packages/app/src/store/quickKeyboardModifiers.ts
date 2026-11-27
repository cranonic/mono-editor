// src/store/quickKeyboardModifiers.ts
// Pure 3-state sticky modifier state machine for mobile Quick Keyboard Bar:
//   off   --tap--> armed (one-shot, auto-resets after next key)
//   armed --tap within doubleTapMs--> locked (stays active across keys)
//   armed --tap after doubleTapMs---> off
//   locked --tap--> off

export type ModifierKey = 'ctrl' | 'alt' | 'shift';
export type ModifierState = 'off' | 'armed' | 'locked';

export interface ModifierStates {
  ctrl: ModifierState;
  alt: ModifierState;
  shift: ModifierState;
}

export interface ModifierTimestamps {
  ctrl: number;
  alt: number;
  shift: number;
}

export interface ModifierSnapshot {
  states: ModifierStates;
  lastTapAt: ModifierTimestamps;
}

export const DOUBLE_TAP_LOCK_MS = 320;

export function createInitialModifierSnapshot(): ModifierSnapshot {
  return {
    states: { ctrl: 'off', alt: 'off', shift: 'off' },
    lastTapAt: { ctrl: 0, alt: 0, shift: 0 },
  };
}

/**
 * Transitions a single modifier on tap:
 * - off -> armed
 * - armed -> locked (if within doubleTapMs) OR off (if slow tap)
 * - locked -> off
 */
export function tapModifier(
  snapshot: ModifierSnapshot,
  mod: ModifierKey,
  nowMs: number,
  doubleTapMs = DOUBLE_TAP_LOCK_MS,
): ModifierSnapshot {
  const cur = snapshot.states[mod];
  const prevTap = snapshot.lastTapAt[mod];
  let next: ModifierState;

  if (cur === 'off') {
    next = 'armed';
  } else if (cur === 'armed') {
    next = nowMs - prevTap <= doubleTapMs ? 'locked' : 'off';
  } else {
    next = 'off';
  }

  return {
    states: { ...snapshot.states, [mod]: next },
    lastTapAt: { ...snapshot.lastTapAt, [mod]: next === 'off' ? 0 : nowMs },
  };
}

/**
 * Consumes one-shot (`armed`) modifiers after a key/action is dispatched,
 * preserving any `locked` modifiers.
 */
export function consumeArmedModifiers(snapshot: ModifierSnapshot): ModifierSnapshot {
  const s = snapshot.states;
  if (s.ctrl !== 'armed' && s.alt !== 'armed' && s.shift !== 'armed') {
    return snapshot;
  }
  return {
    states: {
      ctrl: s.ctrl === 'armed' ? 'off' : s.ctrl,
      alt: s.alt === 'armed' ? 'off' : s.alt,
      shift: s.shift === 'armed' ? 'off' : s.shift,
    },
    lastTapAt: {
      ctrl: s.ctrl === 'armed' ? 0 : snapshot.lastTapAt.ctrl,
      alt: s.alt === 'armed' ? 0 : snapshot.lastTapAt.alt,
      shift: s.shift === 'armed' ? 0 : snapshot.lastTapAt.shift,
    },
  };
}

/** Returns boolean active flags (true when `armed` or `locked`). */
export function getActiveModifiers(states: ModifierStates): {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
} {
  return {
    ctrl: states.ctrl !== 'off',
    alt: states.alt !== 'off',
    shift: states.shift !== 'off',
  };
}

export function hasAnyActiveModifier(states: ModifierStates): boolean {
  return states.ctrl !== 'off' || states.alt !== 'off' || states.shift !== 'off';
}

export interface ActiveModifierFlags {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

const STANDALONE_MODIFIER_KEYS = new Set([
  'Control',
  'Alt',
  'Shift',
  'Meta',
  'AltGraph',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'OS',
  'Dead',
  'Process',
]);

export function isStandaloneModifierKey(key: string): boolean {
  return STANDALONE_MODIFIER_KEYS.has(key);
}

const LEGACY_KEY_MAP: Record<string, [string, string, number]> = {
  Up: ['ArrowUp', 'ArrowUp', 38],
  Down: ['ArrowDown', 'ArrowDown', 40],
  Left: ['ArrowLeft', 'ArrowLeft', 37],
  Right: ['ArrowRight', 'ArrowRight', 39],
  Esc: ['Escape', 'Escape', 27],
  Del: ['Delete', 'Delete', 46],
};

const KEYCODE_FALLBACK_MAP: Record<number, [string, string]> = {
  38: ['ArrowUp', 'ArrowUp'],
  40: ['ArrowDown', 'ArrowDown'],
  37: ['ArrowLeft', 'ArrowLeft'],
  39: ['ArrowRight', 'ArrowRight'],
  8: ['Backspace', 'Backspace'],
  46: ['Delete', 'Delete'],
  9: ['Tab', 'Tab'],
  13: ['Enter', 'Enter'],
  27: ['Escape', 'Escape'],
  36: ['Home', 'Home'],
  35: ['End', 'End'],
  33: ['PageUp', 'PageUp'],
  34: ['PageDown', 'PageDown'],
};

/**
 * Normalizes Android WebView / soft keyboard / legacy key names and keyCodes
 * into standard DOM `KeyboardEvent` `key` + `code` + `keyCode` values.
 */
export function normalizeNativeKey(
  key: string,
  keyCode: number,
  code: string,
): { key: string; code: string; keyCode: number } {
  if (key && LEGACY_KEY_MAP[key]) {
    const [normKey, normCode, normKeyCode] = LEGACY_KEY_MAP[key]!;
    return { key: normKey, code: code || normCode, keyCode: keyCode || normKeyCode };
  }
  if ((!key || key === 'Unidentified') && KEYCODE_FALLBACK_MAP[keyCode]) {
    const [normKey, normCode] = KEYCODE_FALLBACK_MAP[keyCode]!;
    return { key: normKey, code: code || normCode, keyCode };
  }
  return { key, code, keyCode };
}

/**
 * Determines whether a native `keydown` event should be intercepted and merged
 * with active Quick Keyboard Bar sticky modifiers.
 */
export function shouldInterceptNativeKeyDown(
  e: { key: string; keyCode: number; code?: string; isComposing?: boolean },
  sticky: ActiveModifierFlags,
): boolean {
  if (!sticky.ctrl && !sticky.alt && !sticky.shift) return false;
  if (e.isComposing) return false;
  if (e.keyCode === 229) return false;
  const norm = normalizeNativeKey(e.key, e.keyCode, e.code ?? '');
  if (!norm.key || norm.key === 'Unidentified') return false;
  if (isStandaloneModifierKey(norm.key)) return false;
  return true;
}

/** Merges native event modifier flags with Quick Keyboard Bar sticky modifiers. */
export function mergeNativeAndStickyModifiers(
  nativeMods: ActiveModifierFlags,
  sticky: ActiveModifierFlags,
): ActiveModifierFlags {
  return {
    ctrl: nativeMods.ctrl || sticky.ctrl,
    alt: nativeMods.alt || sticky.alt,
    shift: nativeMods.shift || sticky.shift,
  };
}

