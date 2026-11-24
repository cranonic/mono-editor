/**
 * Hash-consed state interning table for O(1) tokenizer state equality checks.
 *
 * Every distinct tokenizer stack/embedded state is canonicalized once into a string
 * key and assigned a compact integer ID. Incremental re-tokenization convergence
 * checks (`oldEndState === newEndState`) become a single O(1) integer `===`.
 */
export class StateInterner<T> {
  private readonly keyToId = new Map<string, number>();
  private readonly idToValue: T[] = [];
  private readonly idToKey: string[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 16_384) {
    this.maxEntries = maxEntries;
  }

  intern(key: string, createValue: () => T): number {
    const existing = this.keyToId.get(key);
    if (existing !== undefined) return existing;
    const id = this.idToValue.length;
    if (id >= this.maxEntries) {
      // Soft guard: avoid unbounded table growth in pathological sessions.
      this.keyToId.clear();
      this.idToValue.length = 0;
      this.idToKey.length = 0;
    }
    const assigned = this.idToValue.length;
    this.keyToId.set(key, assigned);
    this.idToValue.push(createValue());
    this.idToKey.push(key);
    return assigned;
  }

  get(id: number): T | undefined {
    return this.idToValue[id];
  }

  keyOf(id: number): string | undefined {
    return this.idToKey[id];
  }

  size(): number {
    return this.idToValue.length;
  }
}
