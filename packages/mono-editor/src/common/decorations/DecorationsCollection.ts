import type {
  IModelDecoration,
  IModelDeltaDecoration,
  DecorationRenderItem,
  IRange,
} from './types';

function rangesOverlap(a: IRange, b: IRange): boolean {
  if (a.endLineNumber < b.startLineNumber) return false;
  if (a.startLineNumber > b.endLineNumber) return false;
  if (a.endLineNumber === b.startLineNumber && a.endColumn < b.startColumn) return false;
  if (a.startLineNumber === b.endLineNumber && a.startColumn > b.endColumn) return false;
  return true;
}

/**
 * Monaco `deltaDecorations` store — opaque string ids with range queries & change notifications.
 */
export class DecorationsCollection {
  private nextId = 1;
  private map = new Map<string, IModelDecoration>();
  private listeners = new Set<() => void>();

  deltaDecorations(
    oldDecorations: readonly string[],
    newDecorations: readonly IModelDeltaDecoration[],
  ): string[] {
    let changed = false;
    for (const id of oldDecorations) {
      if (this.map.delete(id)) changed = true;
    }
    const ids: string[] = [];
    for (const d of newDecorations) {
      const id = `d${this.nextId++}`;
      this.map.set(id, {
        id,
        ownerId: 0,
        range: { ...d.range },
        options: { ...d.options },
      });
      ids.push(id);
      changed = true;
    }
    if (changed) this.fireChange();
    return ids;
  }

  getDecoration(id: string): IModelDecoration | undefined {
    return this.map.get(id);
  }

  getAll(): IModelDecoration[] {
    return Array.from(this.map.values());
  }

  getInRange(range: IRange): IModelDecoration[] {
    const out: IModelDecoration[] = [];
    for (const d of this.map.values()) {
      if (rangesOverlap(d.range, range)) out.push(d);
    }
    return out;
  }

  onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  clear(): void {
    if (this.map.size === 0) return;
    this.map.clear();
    this.fireChange();
  }

  private fireChange(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch {
        /* ignore */
      }
    }
  }

  /** Flatten for canvas paint */
  toRenderItems(): DecorationRenderItem[] {
    const items: DecorationRenderItem[] = [];
    for (const d of this.map.values()) {
      const o = d.options;
      let underline: DecorationRenderItem['underline'] = o.monoUnderline ?? 'none';
      let color = o.monoUnderlineColor ?? '#cccccc';
      if (underline === 'none' && o.inlineClassName) {
        const c = o.inlineClassName;
        if (/error|squiggle-error/i.test(c)) {
          underline = 'squiggle';
          color = '#f14c4c';
        } else if (/warn/i.test(c)) {
          underline = 'squiggle';
          color = '#cca700';
        } else if (/info/i.test(c)) {
          underline = 'squiggle';
          color = '#3794ff';
        } else if (/hint/i.test(c)) {
          underline = 'dots';
          color = '#b0b0b0';
        }
      }
      let glyphColor = o.glyphMarginColor;
      if (!glyphColor && o.glyphMarginClassName) {
        const gc = o.glyphMarginClassName;
        if (/break|error|red/i.test(gc)) glyphColor = '#e51400';
        else if (/warn|yellow|amber/i.test(gc)) glyphColor = '#cca700';
        else if (/book|info|blue/i.test(gc)) glyphColor = '#3794ff';
        else glyphColor = '#4ec9b0';
      }
      items.push({
        range: d.range,
        underline,
        color,
        background: o.monoBackgroundColor,
        isWholeLine: o.isWholeLine,
        glyphMarginColor: glyphColor,
        glyphMarginSymbol: o.glyphMarginSymbol,
        glyphMarginClassName: o.glyphMarginClassName,
      });
    }
    return items;
  }
}
