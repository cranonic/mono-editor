import type { MonoContextKeyValue, MonoDisposable } from './types';
import { evaluateWhenExpression } from './whenExpr';

/**
 * Monaco-compatible ContextKeyService.
 * Supports: key, !key, key == value, key != value, a && b, a || b, and nested parentheses.
 */
export class ContextKeyService {
  private keys = new Map<string, MonoContextKeyValue>();
  private listeners = new Set<() => void>();

  set(key: string, value: MonoContextKeyValue): void {
    const prev = this.keys.get(key);
    if (prev === value) return;
    this.keys.set(key, value);
    this.emit();
  }

  get(key: string): MonoContextKeyValue | undefined {
    return this.keys.get(key);
  }

  createKey(key: string, defaultValue: MonoContextKeyValue): {
    set: (v: MonoContextKeyValue) => void;
    get: () => MonoContextKeyValue;
    reset: () => void;
  } {
    if (!this.keys.has(key)) this.keys.set(key, defaultValue);
    return {
      set: (v) => this.set(key, v),
      get: () => this.keys.get(key) ?? defaultValue,
      reset: () => this.set(key, defaultValue),
    };
  }

  onDidChange(listener: () => void): MonoDisposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  /** Evaluate when-clause string or fn. Empty/undefined → true. */
  match(when?: string | (() => boolean)): boolean {
    if (when == null || when === '') return true;
    if (typeof when === 'function') {
      try {
        return !!when();
      } catch {
        return false;
      }
    }
    return evaluateWhenExpression(when, (k) => this.keys.get(k));
  }

  private emit(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch {
        /* */
      }
    }
  }
}
