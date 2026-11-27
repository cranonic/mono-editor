// src/store/quickKeyboardStore.ts

import { create } from 'zustand';
import {
  consumeArmedModifiers,
  createInitialModifierSnapshot,
  getActiveModifiers,
  tapModifier,
  type ModifierKey,
  type ModifierSnapshot,
  type ModifierStates,
} from './quickKeyboardModifiers';

export type { ModifierKey, ModifierState, ModifierStates } from './quickKeyboardModifiers';

/**
 * Represents a single auxiliary key action displayed in the mobile quick-access bar.
 */
export interface QuickKey {
  /** Unique identifier for the key binding. */
  id: string;
  /** Visible label or symbol displayed on the key. */
  label?: string;
  /** Optional icon name for the key. */
  icon?: string;
  /** The command ID or action trigger string executed when pressed. */
  action: string;
}

interface QuickKeyboardState {
  isVisible: boolean;
  keys: QuickKey[];
  /** Boolean active flags (`armed` or `locked`) for backwards compatibility. */
  modifiers: { ctrl: boolean; alt: boolean; shift: boolean };
  /** 3-state sticky modifier state (`off` | `armed` | `locked`). In-memory only (never persisted). */
  modifierStates: ModifierStates;
  _modSnapshot: ModifierSnapshot;

  toggleVisibility: () => void;
  setKeys: (keys: QuickKey[]) => void;
  toggleModifier: (mod: ModifierKey, nowMs?: number) => void;
  /** Consumes one-shot (`armed`) modifiers while preserving `locked` modifiers. */
  consumeArmedModifiers: () => void;
  /** Hard-resets all modifiers (including locked) to `off`. */
  resetModifiers: () => void;
}

const initialSnap = createInitialModifierSnapshot();

export const useQuickKeyboardStore = create<QuickKeyboardState>((set) => ({
  isVisible: false,
  keys: [],
  modifiers: getActiveModifiers(initialSnap.states),
  modifierStates: initialSnap.states,
  _modSnapshot: initialSnap,

  toggleVisibility: () => set((s) => ({ isVisible: !s.isVisible })),

  setKeys: (keys: QuickKey[]) => set({ keys }),

  toggleModifier: (mod, nowMs = Date.now()) =>
    set((s) => {
      const next = tapModifier(s._modSnapshot, mod, nowMs);
      return {
        _modSnapshot: next,
        modifierStates: next.states,
        modifiers: getActiveModifiers(next.states),
      };
    }),

  consumeArmedModifiers: () =>
    set((s) => {
      const next = consumeArmedModifiers(s._modSnapshot);
      if (next === s._modSnapshot) return s;
      return {
        _modSnapshot: next,
        modifierStates: next.states,
        modifiers: getActiveModifiers(next.states),
      };
    }),

  resetModifiers: () => {
    const fresh = createInitialModifierSnapshot();
    set({
      _modSnapshot: fresh,
      modifierStates: fresh.states,
      modifiers: getActiveModifiers(fresh.states),
    });
  },
}));
