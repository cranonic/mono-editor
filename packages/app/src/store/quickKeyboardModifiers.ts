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
